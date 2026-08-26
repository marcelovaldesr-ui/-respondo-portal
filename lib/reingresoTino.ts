import { db } from "@/lib/db";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { guardarMensaje } from "@/lib/mensajes";
import { avisarACliente, resumirParaAviso } from "@/lib/push";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { ventanaAbierta } from "@/lib/ventana24";
import {
  elegible,
  filtrar,
  habilitadasPara,
  type Decision,
  type Propuesta,
} from "@/lib/reingresoDecision";

/**
 * EL VIGILANTE DE CONVERSACIONES ABANDONADAS.
 *
 * Corre colgado del cron único. Busca conversaciones donde el cliente escribió,
 * alguien del equipo tomó el control, y después nadie contestó nunca más.
 *
 * Ver `lib/reingresoDecision.ts` para las dos reglas que gobiernan qué se manda
 * (nunca un mensaje vacío; «estar seguro» no es opinión del modelo) y
 * `sql/284_reingreso_tino.sql` para por qué todo nace apagado.
 *
 * ⚠️ TOPE POR PASADA. Cada reingreso invoca al modelo. Igual que el reintento de
 * webhooks, se procesa un puñado y el resto queda para el siguiente latido: es
 * preferible ir lento a arriesgar el timeout del cron, que es compartido con los
 * seguimientos, los informes y los cupos.
 */
const MAX_POR_PASADA = 5;

/** Cuánto historial lee para decidir. Suficiente para entender qué se pidió. */
const MENSAJES_CONTEXTO = 20;

export type ResumenReingreso = {
  revisados: number;
  reingresados: number;
  callados: number;
  detalle: string[];
};

export async function revisarAbandonadas(
  supa = db(),
): Promise<ResumenReingreso> {
  const out: ResumenReingreso = { revisados: 0, reingresados: 0, callados: 0, detalle: [] };

  /**
   * Puerta 1: ¿hay algún cliente con esto encendido? Si no, se corta acá sin
   * tocar nada más. Mientras nadie lo active, este bloque cuesta una consulta
   * por latido y nada más.
   */
  const { data: clientes } = await supa
    .from("ed_clientes")
    .select("id, transporte, reingreso_minutos, reingreso_precios")
    .eq("reingreso_activo", true)
    .limit(50);

  if (!clientes?.length) return out;

  const ahora = Date.now();

  for (const cli of clientes) {
    const clienteId = cli.id as string;
    const transporte = (cli.transporte as string | null) ?? "waha";
    const umbral = (cli.reingreso_minutos as number | null) ?? 180;
    const habilitadas = habilitadasPara({ precios: Boolean(cli.reingreso_precios) });

    // Empleados del cliente: la barrera de aislamiento de siempre.
    const { data: emps } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", clienteId)
      .limit(50);
    const empIds = (emps ?? []).map((e) => e.id as string);
    if (!empIds.length) continue;

    /**
     * Candidatos: modo humano, nunca reingresado, no bloqueado, y con el cliente
     * esperando desde hace más del umbral pero menos de 24 h.
     *
     * El límite es explícito: PostgREST corta en 1.000 filas **sin avisar**, y
     * este repositorio ya pagó ese error una vez (analítica, 31-jul).
     */
    const desde = new Date(ahora - 24 * 3600_000).toISOString();
    const hasta = new Date(ahora - umbral * 60_000).toISOString();

    const { data: candidatos } = await supa
      .from("ed_chat_estado")
      .select("empleado_id, chat_id, ultimo_entrante_en")
      .in("empleado_id", empIds)
      .eq("modo", "humano")
      .eq("reingreso_bloqueado", false)
      .is("reingreso_en", null)
      .gte("ultimo_entrante_en", desde)
      .lte("ultimo_entrante_en", hasta)
      .order("ultimo_entrante_en", { ascending: true })
      .limit(200);

    if (!candidatos?.length) continue;
    out.revisados += candidatos.length;

    /**
     * ¿Alguien contestó después? UNA sola consulta para todos los candidatos, no
     * una por chat. Con 3 clientes la diferencia no se nota; con 30 son decenas
     * de viajes en serie dentro de un cron con techo de tiempo.
     */
    const chatIds = candidatos.map((c) => c.chat_id as string);
    const { data: salientes } = await supa
      .from("ed_mensajes")
      .select("chat_id, empleado_id, creado_en")
      .in("empleado_id", empIds)
      .in("chat_id", chatIds)
      .neq("rol", "cliente")
      .gte("creado_en", desde)
      .limit(1000);

    /** Última respuesta del negocio por conversación. */
    const ultimaSalida = new Map<string, string>();
    for (const m of salientes ?? []) {
      const k = `${m.empleado_id}|${m.chat_id}`;
      const prev = ultimaSalida.get(k);
      const cur = m.creado_en as string;
      if (!prev || cur > prev) ultimaSalida.set(k, cur);
    }

    let procesados = 0;
    for (const c of candidatos) {
      if (procesados >= MAX_POR_PASADA) break;

      const empleadoId = c.empleado_id as string;
      const chatId = c.chat_id as string;
      const entranteEn = c.ultimo_entrante_en as string;
      const k = `${empleadoId}|${chatId}`;

      // Si el negocio respondió DESPUÉS del último mensaje del cliente, no hay
      // nada abandonado. Es el caso normal y se descarta sin gastar modelo.
      const salida = ultimaSalida.get(k);
      if (salida && salida > entranteEn) continue;

      const minutos = Math.floor((ahora - new Date(entranteEn).getTime()) / 60_000);

      /**
       * ⚠️ SE USA `ventanaAbierta` DE `lib/ventana24.ts`, NO LA REGLA PURA.
       *
       * Y la diferencia importa: **la ventana de 24 h es por NÚMERO de WhatsApp,
       * no por empleado digital.** Si el cliente le escribió a Tino hace dos
       * horas, Beto también puede mandarle texto libre — para Meta es la misma
       * conversación.
       *
       * `ventanaDesde()` mira `ed_chat_estado.ultimo_entrante_en`, que es por
       * (empleado, chat). Con un solo empleado da igual, pero con Beto y Vera
       * encima diría «cerrada» cuando en realidad está abierta, y este vigilante
       * se quedaría callado sin motivo.
       *
       * En WAHA no hay ventana, así que ni se pregunta.
       */
      const hayVentana =
        transporte !== "cloud" || (await ventanaAbierta({ clienteId, chatId, supa }));

      const permiso = elegible({
        minutosSinRespuesta: minutos,
        umbralMinutos: umbral,
        clienteEsperando: true,
        ventanaAbierta: hayVentana,
        yaReingreso: false,
        bloqueado: false,
        activo: true,
      });
      if (!permiso.ok) continue;

      procesados++;
      try {
        const r = await reingresarEn({
          supa,
          clienteId,
          empleadoId,
          chatId,
          transporte,
          habilitadas,
          minutos,
        });
        if (r.accion === "callar") {
          out.callados++;
          out.detalle.push(`callado (${r.motivo})`);
        } else {
          out.reingresados++;
          out.detalle.push(`reingreso ${r.accion}`);
        }
      } catch (e) {
        // Best-effort: un chat que falla no puede tumbar el barrido entero.
        console.error("[reingreso] falló en un chat:", (e as Error).message);
      }
    }
  }

  return out;
}

/**
 * Relee UNA conversación, le pide una propuesta al modelo, la pasa por la reja y
 * actúa.
 *
 * ⚠️ Se marca `reingreso_en` **pase lo que pase**, incluso cuando se decide
 * callar. La regla es «una revisión por conversación», no «un mensaje por
 * conversación»: si Tino miró y no tenía nada que aportar, volver a mirarlo cada
 * cinco minutos solo gastaría llamadas al modelo para llegar a lo mismo.
 */
async function reingresarEn(p: {
  supa: ReturnType<typeof db>;
  clienteId: string;
  empleadoId: string;
  chatId: string;
  transporte: string;
  habilitadas: readonly string[];
  minutos: number;
}): Promise<Decision> {
  const { supa, clienteId, empleadoId, chatId, transporte, habilitadas, minutos } = p;

  const { data: filas } = await supa
    .from("ed_mensajes")
    .select("rol, texto")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .order("creado_en", { ascending: false })
    .limit(MENSAJES_CONTEXTO);

  const historial: MensajePrueba[] = (filas ?? [])
    .reverse()
    .map((f) => ({ rol: f.rol as MensajePrueba["rol"], texto: (f.texto as string) ?? "" }));

  if (!historial.length) {
    await marcarRevisado(supa, empleadoId, chatId);
    return { accion: "callar", motivo: "sin historial" };
  }

  const prompt = await armarPrompt(clienteId, empleadoId, historial, bloqueReingreso(habilitadas, minutos));
  if (!prompt) {
    await marcarRevisado(supa, empleadoId, chatId);
    return { accion: "callar", motivo: "no se pudo armar el prompt" };
  }

  const bruto = await generarJSON(prompt);
  const propuesta = normalizar(bruto);
  const decision = filtrar(propuesta, habilitadas);

  await marcarRevisado(supa, empleadoId, chatId);

  if (decision.accion === "callar") {
    /**
     * SILENCIO HACIA EL CLIENTE, GRITO HACIA EL EQUIPO.
     *
     * Es la mitad menos vistosa de la función y la más importante: cuando no hay
     * nada que aportar, mandar cualquier cosa sería peor que no mandar nada. El
     * problema pasa a ser del equipo, y para eso está el aviso.
     */
    await avisarAbandono(supa, clienteId, chatId, minutos);
    return decision;
  }

  const texto = decision.texto;
  const enviado = await mandar({ clienteId, chatId, texto, transporte });
  if (!enviado) return { accion: "callar", motivo: "no se pudo enviar" };

  await guardarMensaje(supa, {
    empleadoId,
    chatId,
    // Va como "empleado" porque lo escribió el asistente, no una persona. Que
    // aparezca como humano sería mentirle al propio equipo en la bandeja.
    rol: "empleado",
    texto,
  });

  // El equipo se entera SIEMPRE de lo que Tino dijo. Enterarse después de que un
  // asistente habló por ti es la forma más rápida de perderle la confianza.
  await avisarACliente(clienteId, {
    titulo: "Tino retomó una conversación que quedó sin responder",
    cuerpo: resumirParaAviso(texto),
    url: `/conversaciones?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`,
    tag: `reingreso:${chatId}`,
  }, supa);

  return decision;
}

/** Aviso cuando Tino NO tuvo nada que aportar: le toca a una persona. */
async function avisarAbandono(
  supa: ReturnType<typeof db>,
  clienteId: string,
  chatId: string,
  minutos: number,
) {
  const { data: c } = await supa
    .from("ed_contactos")
    .select("nombre")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  const quien = (c?.nombre as string | null) || `+${chatId}`;
  const horas = Math.floor(minutos / 60);

  await avisarACliente(clienteId, {
    titulo: `${quien} lleva ${horas} h esperando`,
    cuerpo: "Nadie del equipo respondió y Tino no tiene la respuesta. Necesita a una persona.",
    url: `/conversaciones?chat=${encodeURIComponent(chatId)}`,
    tag: `abandono:${chatId}`,
  }, supa);
}

async function marcarRevisado(
  supa: ReturnType<typeof db>,
  empleadoId: string,
  chatId: string,
) {
  await supa
    .from("ed_chat_estado")
    .update({ reingreso_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId);
}

async function mandar(p: {
  clienteId: string;
  chatId: string;
  texto: string;
  transporte: string;
}): Promise<boolean> {
  if (p.transporte === "cloud") {
    const cfg = await configPorCliente(p.clienteId);
    if (!cfg) return false;
    // `sinEspera`: nadie está mirando la pantalla del otro lado esperando los
    // puntitos. La pausa humana solo gastaría tiempo del cron.
    const r = await enviarTexto(cfg, p.chatId, p.texto, { sinEspera: true });
    return Boolean(r?.ok);
  }
  /**
   * ⚠️ `clienteId` VA SÍ O SÍ, aunque el tipo lo declare opcional.
   *
   * WAHA tiene UNA sola sesión. Sin este dato, el mensaje sale por el WhatsApp
   * del dueño de esa sesión y queda guardado en SU conversación — o sea, el
   * cliente equivocado recibe el mensaje. Es exactamente el hallazgo de la
   * auditoría del 11-ago-2026 (ver `lib/waha.ts`).
   */
  const r = await enviarTextoWaha(p.chatId, p.texto, { clienteId: p.clienteId });
  return Boolean(r?.ok);
}

/** Lo que el modelo devuelve puede venir con cualquier forma. Se normaliza. */
function normalizar(bruto: unknown): Propuesta {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const accion = String(o.accion ?? "nada");
  return {
    accion: accion === "responder" || accion === "preguntar" ? accion : "nada",
    categoria: typeof o.categoria === "string" ? o.categoria : undefined,
    texto: typeof o.texto === "string" ? o.texto : undefined,
  };
}

/**
 * Las instrucciones del reingreso, que se agregan al prompt normal del empleado.
 *
 * El énfasis está puesto donde duele: **prohibido el mensaje de relleno**. Un
 * segundo «déjame confirmarlo» le confirma al cliente que lo tienen olvidado, y
 * eso molesta más que el silencio.
 */
function bloqueReingreso(habilitadas: readonly string[], minutos: number): string {
  return `
## SITUACIÓN ESPECIAL: RETOMAS UNA CONVERSACIÓN ABANDONADA

Una persona del equipo tomó el control de este chat y después no respondió más.
El cliente lleva ${Math.floor(minutos / 60)} horas esperando.

Tu trabajo NO es contestar todo. Es evitar que esta conversación se muera, sin
decir nada que no sepas con certeza.

Responde SOLO con este JSON:

{"accion":"responder"|"preguntar"|"nada","categoria":"<categoría>","texto":"<mensaje>"}

**"responder"** — solo si la respuesta está literalmente en la información del
negocio que tienes arriba Y su categoría es una de estas:
${habilitadas.map((h) => `  - ${h}`).join("\n")}
Si la categoría no está en esa lista, NO uses "responder" aunque creas saberla.

**"preguntar"** — si no puedes responder pero falta un dato que de todas formas
se va a necesitar para atenderlo (modelo del equipo, cantidad, urgencia, si es
retiro o despacho). Pregunta ESO, una sola cosa, breve.

**"nada"** — si no puedes responder y no hay ningún dato útil que pedir.

REGLAS QUE NO PUEDES ROMPER:
1. PROHIBIDO mandar un mensaje que solo diga que siguen revisando, que no se han
   olvidado, que confirmas a la brevedad o que agradeces la paciencia. Si no
   tienes nada que aportar, usa "nada". El silencio es mejor que un mensaje
   vacío.
2. No pidas disculpas por la demora ni menciones que nadie respondió. No lo
   señales: resuélvelo.
3. Nunca inventes precios, stock, disponibilidad ni plazos.
4. Una persona pudo haber hablado con este cliente por teléfono o en el local.
   No des por hecho lo que se acordó ni contradigas nada.
5. Un solo mensaje, corto, en el tono de siempre.
`.trim();
}
