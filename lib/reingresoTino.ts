import { db } from "@/lib/db";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { guardarMensaje } from "@/lib/mensajes";
import { avisarACliente, resumirParaAviso } from "@/lib/push";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { ventanaAbierta } from "@/lib/ventana24";
import { ultimaSalidaPorChat } from "@/lib/ultimaSalida";
import {
  elegible,
  filtrar,
  habilitadasPara,
  interpretar,
  type Decision,
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
 *
 * ⚠️ Y ADEMÁS UN PRESUPUESTO DE TIEMPO (2-sep-2026). Medido contra chats reales
 * de Impresora Color, una decisión del modelo tarda entre 2 y 17 s. Cinco
 * seguidas pueden pasar de los 60 s de la función de Vercel, y el vigilante
 * corre al FINAL del cron, después de todo lo demás. Sin techo, el día que
 * funcionara de verdad iba a tumbar el latido y los envíos que vienen después.
 * Por eso recibe `fechaLimite` y deja de empezar revisiones cuando ya no queda
 * tiempo útil; lo que no alcanzó, lo toma el siguiente latido.
 */
const MAX_POR_PASADA = 5;

/** Cuánto historial lee para decidir. Suficiente para entender qué se pidió. */
const MENSAJES_CONTEXTO = 20;

/**
 * Cuánto tiempo hace falta, como mínimo, para empezar una revisión: una llamada
 * al modelo (hasta ~17 s medidos) más el envío y las escrituras.
 */
const MINIMO_POR_REVISION_MS = 22_000;

export type ResumenReingreso = {
  revisados: number;
  reingresados: number;
  callados: number;
  detalle: string[];
};

export async function revisarAbandonadas(
  supa = db(),
  opts: {
    /** `Date.now()` después del cual no se empieza ninguna revisión más. */
    fechaLimite?: number;
  } = {},
): Promise<ResumenReingreso> {
  const out: ResumenReingreso = { revisados: 0, reingresados: 0, callados: 0, detalle: [] };
  const fechaLimite = opts.fechaLimite ?? Date.now() + 5 * 60_000;

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
     * Candidatos: modo humano, no bloqueado, y con el cliente esperando desde
     * hace más del umbral pero menos de 24 h.
     *
     * Ya NO se filtra por `reingreso_en is null` en la consulta (2-sep-2026):
     * la marca se interpreta más abajo, por episodio. Una conversación revisada
     * hace una semana, atendida después por una persona y botada otra vez hoy,
     * tiene que poder entrar de nuevo — antes quedaba fuera para siempre.
     *
     * El límite es explícito: PostgREST corta en 1.000 filas **sin avisar**, y
     * este repositorio ya pagó ese error una vez (analítica, 31-jul).
     */
    const desde = new Date(ahora - 24 * 3600_000).toISOString();
    const hasta = new Date(ahora - umbral * 60_000).toISOString();

    const { data: candidatos } = await supa
      .from("ed_chat_estado")
      .select("empleado_id, chat_id, ultimo_entrante_en, reingreso_en")
      .in("empleado_id", empIds)
      .eq("modo", "humano")
      .eq("reingreso_bloqueado", false)
      .gte("ultimo_entrante_en", desde)
      .lte("ultimo_entrante_en", hasta)
      .order("ultimo_entrante_en", { ascending: true })
      .limit(200);

    if (!candidatos?.length) continue;
    out.revisados += candidatos.length;

    /**
     * `no_contactar` se respeta también acá (auditoría 3-sep-2026): el
     * vigilante le escribiría a quien pidió que no le escriban más. Los
     * seguimientos ya lo miran; faltaba este camino.
     */
    const { data: contactosNC } = await supa
      .from("ed_contactos")
      .select("chat_id")
      .eq("cliente_id", clienteId)
      .in("chat_id", candidatos.map((c) => c.chat_id as string))
      .contains("etiquetas", ["no_contactar"]);
    const noContactar = new Set((contactosNC ?? []).map((c) => c.chat_id as string));

    /**
     * ¿Alguien contestó después? Se lee por CHAT (no por empleado digital): si
     * Beto le escribió, el cliente ya tiene respuesta aunque el estado de Tino
     * diga otra cosa. Paginado en `lib/ultimaSalida.ts` para que el tope de
     * 1.000 filas de PostgREST no vuelva a esconder respuestas.
     *
     * `desde`: lo más antiguo que importa. Para "¿contestaron después del
     * cliente?" bastan las últimas 24 h; para "¿una persona ya gastó la marca
     * anterior?" hay que llegar hasta la marca más vieja entre los candidatos.
     */
    const chatIds = candidatos.map((c) => c.chat_id as string);
    const marcas = candidatos
      .map((c) => c.reingreso_en as string | null)
      .filter((m): m is string => Boolean(m));
    const desdeSalidas = new Date(
      Math.min(new Date(desde).getTime(), ...marcas.map((m) => new Date(m).getTime())),
    ).toISOString();
    const ultimaSalida = await ultimaSalidaPorChat({
      supa,
      empleadoIds: empIds,
      chatIds,
      desde: desdeSalidas,
    });

    let procesados = 0;
    /** Un chat por pasada aunque tenga filas de estado bajo dos empleados. */
    const vistos = new Set<string>();
    for (const c of candidatos) {
      if (procesados >= MAX_POR_PASADA) break;
      if (fechaLimite - Date.now() < MINIMO_POR_REVISION_MS) {
        out.detalle.push("sin tiempo: el resto queda para el siguiente latido");
        break;
      }

      const empleadoId = c.empleado_id as string;
      const chatId = c.chat_id as string;
      const entranteEn = c.ultimo_entrante_en as string;
      const reingresoEn = (c.reingreso_en as string | null) ?? null;

      if (vistos.has(chatId)) continue;
      vistos.add(chatId);
      if (noContactar.has(chatId)) continue;

      // Si el negocio respondió DESPUÉS del último mensaje del cliente, no hay
      // nada abandonado. Es el caso normal y se descarta sin gastar modelo.
      const salida = ultimaSalida.get(chatId)?.cualquiera ?? null;
      if (salida && salida > entranteEn) continue;

      /**
       * ¿Ya revisó en ESTE episodio? Sí, si hay marca y desde esa marca ninguna
       * PERSONA le escribió al cliente. Si una persona sí retomó después de la
       * marca (y aun así el cliente volvió a quedar esperando), es un episodio
       * nuevo. Los mensajes del propio Tino no cuentan: si contara su propio
       * reingreso, podría encadenar dos seguidos, que es justo lo que se evita.
       */
      const humanoEn = ultimaSalida.get(chatId)?.humano ?? null;
      const yaReingreso = Boolean(reingresoEn) && !(humanoEn && reingresoEn && humanoEn > reingresoEn);

      const minutos = Math.floor((ahora - new Date(entranteEn).getTime()) / 60_000);

      /**
       * EL CLIENTE LE CONTESTÓ A TINO Y NADIE SIGUIÓ (auditoría 3-sep-2026).
       *
       * Tino preguntó («¿cuántas unidades?»), el cliente respondió, y como el
       * episodio ya tenía su revisión, esto se saltaba en silencio: el cliente
       * quedaba esperando por segunda vez y el equipo no se enteraba. Ahora se
       * avisa UNA vez por episodio (se anota en la bitácora para no repetir).
       */
      if (yaReingreso && reingresoEn && entranteEn > reingresoEn) {
        const yaAvisado = await avisoRespuestaHecho(supa, clienteId, chatId, reingresoEn);
        if (!yaAvisado) {
          await avisarRespuestaATino(supa, clienteId, chatId, minutos);
          await anotar(
            supa,
            { clienteId, empleadoId, chatId, minutos },
            { accion: "callar", motivo: MOTIVO_RESPONDIO_A_TINO },
          );
          out.detalle.push("cliente respondió a Tino: avisado");
        }
        continue;
      }

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
        yaReingreso,
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
          empIds,
          chatId,
          transporte,
          habilitadas,
          minutos,
          fechaLimite,
          entranteEn,
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
  /** Todos los empleados del cliente: el hilo y la marca son por NÚMERO. */
  empIds: string[];
  chatId: string;
  transporte: string;
  habilitadas: readonly string[];
  minutos: number;
  fechaLimite: number;
  /** Último mensaje del cliente al decidir: si llega otro después, la respuesta caduca. */
  entranteEn: string;
}): Promise<Decision> {
  const { supa, clienteId, empleadoId, empIds, chatId, transporte, habilitadas, minutos, fechaLimite } = p;
  // El hilo completo del número (Tino, Beto, Vera): si Beto mandó un
  // seguimiento y el cliente contestó, ese contexto importa para retomar.
  const { data: filas } = await supa
    .from("ed_mensajes")
    .select("rol, texto")
    .in("empleado_id", empIds)
    .eq("chat_id", chatId)
    .order("creado_en", { ascending: false })
    .limit(MENSAJES_CONTEXTO);

  const historial: MensajePrueba[] = (filas ?? [])
    .reverse()
    .map((f) => ({ rol: f.rol as MensajePrueba["rol"], texto: (f.texto as string) ?? "" }));

  if (!historial.length) {
    await marcarRevisado(supa, empIds, chatId);
    return await anotar(supa, p, { accion: "callar", motivo: "sin historial" });
  }

  /**
   * ⚠️ EL BLOQUE DE REINGRESO VA AL FINAL, NO COMO `bloqueExtra`.
   *
   * `armarPrompt` inserta `bloqueExtra` en el medio y cierra SIEMPRE con la
   * instrucción del chat en vivo: «Responde SOLO con este JSON {"respuesta",
   * "escalar", ...}». Con el bloque en el medio, el modelo tenía dos formatos
   * contradictorios y la última palabra era la del motor. Al final, y diciendo
   * explícitamente que reemplaza al anterior, la última palabra es la nuestra.
   */
  const base = await armarPrompt(clienteId, empleadoId, historial);
  if (!base) {
    await marcarRevisado(supa, empIds, chatId);
    return await anotar(supa, p, { accion: "callar", motivo: "no se pudo armar el prompt" });
  }
  const prompt = `${base}\n\n${bloqueReingreso(habilitadas, minutos)}`;

  // Si el modelo falla o se acaba el tiempo, se lanza: el chat NO se marca y
  // el siguiente latido lo vuelve a intentar. Marcarlo acá sería darlo por
  // revisado sin haberlo mirado.
  const crudo = await generarJSON(prompt, { fechaLimite });
  const propuesta = interpretar(crudo);
  const decision = filtrar(propuesta, habilitadas);

  await marcarRevisado(supa, empIds, chatId);

  if (decision.accion === "callar") {
    /**
     * SILENCIO HACIA EL CLIENTE, GRITO HACIA EL EQUIPO.
     *
     * Es la mitad menos vistosa de la función y la más importante: cuando no hay
     * nada que aportar, mandar cualquier cosa sería peor que no mandar nada. El
     * problema pasa a ser del equipo, y para eso está el aviso.
     */
    await avisarAbandono(supa, clienteId, chatId, minutos);
    return await anotar(supa, p, decision, propuesta);
  }

  const texto = decision.texto;

  /**
   * ÚLTIMA COMPROBACIÓN ANTES DE MANDAR (auditoría 3-sep-2026). Entre la
   * decisión y el envío pasan hasta 40 s de modelo: si en ese rato una persona
   * respondió, o el cliente volvió a escribir, la propuesta ya no vale. Mismo
   * `vigente` que usa el chat en vivo.
   */
  const vigente = async () => {
    const { data } = await supa
      .from("ed_mensajes")
      .select("rol, creado_en")
      .in("empleado_id", empIds)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return true;
    return data.rol === "cliente" && (data.creado_en as string) <= p.entranteEn;
  };

  const enviado = await mandar({ clienteId, chatId, texto, transporte, vigente });
  if (!enviado.ok) {
    if (enviado.error === "obsoleto:llego_mensaje_nuevo") {
      return await anotar(supa, p, { accion: "callar", motivo: "alguien escribió mientras Tino decidía" }, propuesta);
    }
    // El envío falló de verdad: el cliente sigue esperando y ahora lo sabe el
    // equipo (antes se anotaba y nadie se enteraba).
    await avisarAbandono(supa, clienteId, chatId, minutos);
    return await anotar(supa, p, { accion: "callar", motivo: `no se pudo enviar (${enviado.error ?? "?"})` }, propuesta);
  }
  await anotar(supa, p, decision, propuesta);

  await guardarMensaje(supa, {
    empleadoId,
    chatId,
    // Va como "empleado" porque lo escribió el asistente, no una persona. Que
    // aparezca como humano sería mentirle al propio equipo en la bandeja.
    rol: "empleado",
    texto,
    // CON el id de WhatsApp: sin él, el eco de Coexistencia de este mismo
    // mensaje se tomaba por "una persona escribió" (toma humana) y además se
    // duplicaba en el hilo.
    waId: enviado.waId,
    canal: "whatsapp",
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

/** Marca TODAS las filas de estado del chat (por número): una revisión por episodio, no por empleado. */
async function marcarRevisado(
  supa: ReturnType<typeof db>,
  empIds: string[],
  chatId: string,
) {
  await supa
    .from("ed_chat_estado")
    .update({ reingreso_en: new Date().toISOString() })
    .in("empleado_id", empIds)
    .eq("chat_id", chatId);
}

const MOTIVO_RESPONDIO_A_TINO = "el cliente respondió al reingreso: avisado al equipo";

/** ¿Ya se avisó que el cliente respondió al reingreso de ESTE episodio? (bitácora 290) */
async function avisoRespuestaHecho(
  supa: ReturnType<typeof db>,
  clienteId: string,
  chatId: string,
  reingresoEn: string,
): Promise<boolean> {
  const { data, error } = await supa
    .from("ed_reingresos")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .eq("motivo", MOTIVO_RESPONDIO_A_TINO)
    .gte("creado_en", reingresoEn)
    .limit(1);
  // Sin bitácora (migración 290 sin aplicar) se prefiere NO repetir avisos.
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

async function avisarRespuestaATino(
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
  await avisarACliente(clienteId, {
    titulo: `${quien} le respondió a Tino y sigue esperando`,
    cuerpo: `Tino retomó la conversación, el cliente contestó hace ${Math.floor(minutos / 60)} h y nadie siguió. Necesita a una persona.`,
    url: `/conversaciones?chat=${encodeURIComponent(chatId)}`,
    tag: `abandono:${chatId}`,
  }, supa);
}

async function mandar(p: {
  clienteId: string;
  chatId: string;
  texto: string;
  transporte: string;
  vigente: () => Promise<boolean>;
}): Promise<{ ok: boolean; waId?: string; error?: string }> {
  if (p.transporte === "cloud") {
    const cfg = await configPorCliente(p.clienteId);
    if (!cfg) return { ok: false, error: "sin credenciales de Meta" };
    // `sinEspera`: nadie está mirando la pantalla del otro lado esperando los
    // puntitos. La pausa humana solo gastaría tiempo del cron.
    return enviarTexto(cfg, p.chatId, p.texto, { sinEspera: true, vigente: p.vigente });
  }
  /**
   * ⚠️ `clienteId` VA SÍ O SÍ, aunque el tipo lo declare opcional.
   *
   * WAHA tiene UNA sola sesión. Sin este dato, el mensaje sale por el WhatsApp
   * del dueño de esa sesión y queda guardado en SU conversación — o sea, el
   * cliente equivocado recibe el mensaje. Es exactamente el hallazgo de la
   * auditoría del 11-ago-2026 (ver `lib/waha.ts`).
   */
  return enviarTextoWaha(p.chatId, p.texto, { clienteId: p.clienteId, vigente: p.vigente, sinEspera: true });
}

/**
 * BITÁCORA: qué miró el vigilante y qué decidió, chat por chat.
 *
 * Hasta el 2-sep-2026 la única huella de una revisión era `reingreso_en` y un
 * conteo en la respuesta del cron que nadie guarda. Por eso el vigilante pudo
 * estar 94 revisiones callando por un bug sin que nadie lo notara: no había
 * dónde mirar. Ahora cada decisión —incluido "callar" y su motivo— queda en
 * `ed_reingresos` (migración 290).
 *
 * Best-effort a propósito: si la migración no está aplicada todavía, se avisa
 * por consola y el vigilante sigue. Una bitácora que falta no puede impedir
 * que se conteste a un cliente.
 */
async function anotar(
  supa: ReturnType<typeof db>,
  p: { clienteId: string; empleadoId: string; chatId: string; minutos: number },
  decision: Decision,
  propuesta?: { accion: string; categoria?: string; texto?: string },
): Promise<Decision> {
  const { error } = await supa.from("ed_reingresos").insert({
    cliente_id: p.clienteId,
    empleado_id: p.empleadoId,
    chat_id: p.chatId,
    minutos_esperando: p.minutos,
    accion: decision.accion,
    categoria:
      decision.accion === "responder" ? decision.categoria : (propuesta?.categoria ?? null),
    motivo: decision.accion === "callar" ? decision.motivo : null,
    texto: decision.accion === "callar" ? (propuesta?.texto ?? null) : decision.texto,
  });
  if (error) console.warn("[reingreso] sin bitácora (¿migración 290 aplicada?):", error.message);
  return decision;
}

/**
 * Las instrucciones del reingreso. Van AL FINAL del prompt normal del empleado
 * (ver `reingresarEn`), reemplazando el formato de salida del chat en vivo.
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

⚠️ IGNORA el formato de JSON indicado más arriba ("respuesta", "escalar",
"lead"...). En esta situación especial responde ÚNICAMENTE con este otro JSON,
sin nada más:

{"accion":"responder"|"preguntar"|"nada","categoria":"<categoría>","texto":"<mensaje>"}

**"responder"** — solo si la respuesta está literalmente en la información del
negocio que tienes arriba Y su categoría es una de estas:
${habilitadas.map((h) => `  - ${h}`).join("\n")}
Si la categoría no está en esa lista, NO uses "responder" aunque creas saberla.

**"preguntar"** — si no puedes responder pero falta un dato que de todas formas
se va a necesitar para atenderlo (modelo del equipo, cantidad, urgencia, si es
retiro o despacho). Pregunta ESO, una sola cosa, breve. Solo vale si el cliente
dejó algo PENDIENTE de nuestro lado (una consulta, un pedido, una cotización
que espera). NO es "preguntar" un "¿pudiste pasar?", "¿sigues interesado?" o
"¿necesitas algo más?": eso es relleno.

**"nada"** — si no puedes responder y no hay ningún dato útil que pedir. También
si el último mensaje del cliente no pide nada: un "gracias", un "ok", un "sí"
que contesta a una persona del equipo, un sticker, un archivo o comprobante sin
pregunta. Ahí no hay nada que retomar.

REGLAS QUE NO PUEDES ROMPER:
1. PROHIBIDO mandar un mensaje que solo diga que siguen revisando, que no se han
   olvidado, que confirmas a la brevedad, que "ya le avisaste al equipo" o que
   agradeces la paciencia. Si no tienes nada que aportar, usa "nada". El
   silencio es mejor que un mensaje vacío.
2. No pidas disculpas por la demora ni menciones que nadie respondió. No lo
   señales: resuélvelo.
3. Nunca inventes precios, stock, disponibilidad ni plazos.
4. Una persona pudo haber hablado con este cliente por teléfono o en el local.
   No des por hecho lo que se acordó ni contradigas nada.
5. Un solo mensaje, corto, en el tono de siempre.
6. NO pidas abono ni entregues datos de transferencia si en esta conversación
   una persona del equipo todavía no dio el precio o la cotización. Sin precio
   no hay nada que abonar.
7. Habla solo del producto que el cliente pidió en ESTA conversación. Si no
   está claro cuál es, no lo nombres.
`.trim();
}
