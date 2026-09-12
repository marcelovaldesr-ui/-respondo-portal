import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { notificarConTope, notificarYEsperar } from "@/lib/puenteSalida";
import {
  DIAS_SILENCIO,
  ETAPAS,
  MOTIVO_SILENCIO,
  ORDEN_ETAPA,
  datosConPerdidaAnterior,
  esMotivoPerdida,
  metaEtapa,
  motivoCierrePorSilencio,
  type Etapa,
} from "@/lib/etapasCore";

// El catálogo vive en etapasCore (puro). Se re-exporta para no tocar imports.
export { DIAS_SILENCIO, ETAPAS, MOTIVO_SILENCIO, ORDEN_ETAPA, metaEtapa };
export type { Etapa };

/**
 * EMBUDO — en qué va cada conversación.
 *
 * Las etiquetas dicen QUÉ es una conversación (cotización, reclamo). La etapa
 * dice EN QUÉ VA. Es la diferencia entre una bandeja y un tablero de ventas:
 * responde "¿cuánto tengo por cerrar?" y "¿qué está frenado?".
 *
 * CÓMO SE MUEVE UNA CONVERSACIÓN
 *  - Sola: a partir de las señales que el asistente ya emite hoy (etiquetas
 *    automáticas y agendamientos). No hay que configurar nada.
 *  - A mano: si una persona la mueve, queda marcada como manual y el cálculo
 *    automático NO la vuelve a tocar. El criterio del dueño siempre gana.
 *
 * La etapa NUNCA retrocede sola: si el asistente ya la había llevado a
 * "cotizado", un mensaje nuevo no la devuelve a "nuevo".
 */

/**
 * CIERRE POR SILENCIO — la salida que le faltaba al embudo.
 *
 * Una oportunidad entraba a "cotizado" y no salía nunca: la etapa solo avanza
 * con señales del asistente y ninguna señal dice "esto terminó". Medido en
 * Impresora Color: de 9 oportunidades abiertas, cuatro eran despedidas.
 *
 * LA REGLA, Y EL DETALLE QUE LA HACE CORRECTA
 * Se cierra cuando el NEGOCIO fue el último en escribir y el cliente no
 * respondió en una semana. Ese "el negocio fue el último" no es un adorno: si
 * el último mensaje lo mandó el CLIENTE, la conversación no está en silencio
 * —te está esperando a ti—, que es exactamente lo contrario de una oportunidad
 * muerta. Cerrarla sería esconder trabajo pendiente.
 *
 * Nunca toca lo que movió una persona (etapa_manual). El criterio del dueño
 * siempre gana, incluso contra el reloj.
 */

export function enSilencio(
  ultimoRol: string | null,
  ultimoEn: string | null,
  dias = DIAS_SILENCIO,
): boolean {
  if (!ultimoEn) return false;
  // Si habló el cliente al final, la pelota es del negocio: no es silencio.
  if ((ultimoRol ?? "cliente") === "cliente") return false;
  return Date.now() - new Date(ultimoEn).getTime() > dias * 86400_000;
}

/**
 * Etapa que corresponde según las señales del asistente.
 * Solo mira lo que YA existe: etiquetas automáticas y agendamientos.
 */
/**
 * Motivos que marcan el INICIO de un ciclo nuevo para un contacto: lo que
 * pasó antes de `etapa_en` (ventas, agendas, etiquetas) ya no lo empuja.
 */
export const MOTIVOS_CICLO_NUEVO: ReadonlySet<string> = new Set([
  "nuevo_ciclo",
  "volvio_a_escribir",
  "correccion_auditoria",
]);

export function etapaSegunSenales(params: {
  etiquetas: string[];
  tieneAgendamiento?: boolean;
  tieneVenta?: boolean;
}): Etapa {
  const e = params.etiquetas ?? [];
  if (params.tieneVenta || params.tieneAgendamiento || e.includes("agendado")) return "ganado";
  if (e.includes("cotizacion")) return "cotizado";
  if (e.includes("posible_comprador")) return "interesado";
  return "nuevo";
}

export type TarjetaEmbudo = {
  chatId: string;
  contacto: string;
  etapa: Etapa;
  etapaManual: boolean;
  etiquetas: string[];
  ultimoMensaje: string;
  ultimoEn: string | null;
  esperandoHumano: boolean;
  /** "sin_respuesta" si la cerró el reloj; null si fue una señal o una persona. */
  motivo: string | null;
  /**
   * Con quién abrir la conversación: el último empleado que habló (Fase 1).
   * Antes el tablero enlazaba siempre con Tino y, en un negocio sin Tino o con
   * el chat en Beto, el enlace no abría nada.
   */
  empleadoId: string | null;
};

/**
 * El tablero listo para pintar, con las etapas automáticas recalculadas EN
 * MEMORIA.
 *
 * ⚠️ SOLO LECTURA DESDE LA FASE 0 (11-sep-2026). Antes, ABRIR la página
 * escribía las etapas nuevas en la base y avisaba cada cambio al sistema del
 * cliente (Gestión), esperando hasta 4 s. Consecuencias: el estado de un
 * contacto dependía de si alguien había abierto el embudo; dos personas
 * abriéndolo a la vez duplicaban avisos; y elegir «Todas» podía cerrar como
 * perdidas cientos de conversaciones viejas y mandarle cada una a Gestión, con
 * un simple GET. Ahora la página muestra lo mismo que antes, pero la escritura
 * y los avisos los hace el cron (`recalcularEtapasEmbudo`, una vez por hora).
 */
export async function cargarEmbudo(
  clienteId: string,
  diasActividad = 14,
  supaOpt?: SupabaseClient,
): Promise<TarjetaEmbudo[]> {
  return (await calcularEmbudo(clienteId, diasActividad, supaOpt)).tarjetas;
}

/**
 * Lo que antes hacía el GET del embudo: recalcular Y persistir las etapas, y
 * avisar al puente. Lo llama el cron. Devuelve cuántos contactos cambiaron.
 */
export async function recalcularEtapasEmbudo(
  clienteId: string,
  diasActividad = 14,
  supaOpt?: SupabaseClient,
): Promise<{ cambios: number }> {
  const supa = supaOpt ?? db();
  const calc = await calcularEmbudo(clienteId, diasActividad, supa);
  await persistirEmbudo(clienteId, calc, supa);
  return { cambios: calc.cambios.length };
}

type CalculoEmbudo = {
  tarjetas: TarjetaEmbudo[];
  cambios: { chat_id: string; etapa: Etapa; motivo: string | null }[];
};

async function calcularEmbudo(
  clienteId: string,
  /**
   * Solo conversaciones con actividad en los últimos N días (0 = todas).
   *
   * POR QUÉ EXISTE: sin este corte, el tablero se llena de conversaciones que
   * ya terminaron ("muchas gracias", "recibido") y que quedaron en Nuevo porque
   * son historial importado que nunca pasó por el asistente. El dueño abría el
   * embudo, veía "55 por cerrar" cuando en verdad tenía 7, y dejaba de creerle
   * al panel. Un tablero de ventas sirve por lo que DEJA FUERA.
   */
  diasActividad = 14,
  supaOpt?: SupabaseClient,
): Promise<CalculoEmbudo> {
  const supa = supaOpt ?? db();

  // Con cliente inyectado (cron, pruebas) se consulta con ESE cliente; en el
  // render se usa el caché por petición.
  const ids = supaOpt
    ? ((await supa.from("ed_empleados").select("id").eq("cliente_id", clienteId)).data ?? []).map((e) => e.id as string)
    : await idsEmpleadosDeCliente(clienteId);
  if (!ids.length) return { tarjetas: [], cambios: [] };

  const corteActividad =
    diasActividad > 0
      ? new Date(Date.now() - diasActividad * 86400_000).toISOString()
      : null;
  let consultaContactos = supa
    .from("ed_contactos")
    .select(
      "chat_id, nombre, etiquetas, etapa, etapa_manual, etapa_motivo, etapa_en, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol, ultimo_empleado_id, datos",
    )
    .eq("cliente_id", clienteId);
  if (corteActividad) consultaContactos = consultaContactos.gte("ultimo_mensaje_en", corteActividad);

  /**
   * LÍMITE EXPLÍCITO (auditoría 24-ago-2026).
   *
   * PostgREST corta en 1.000 filas pase lo que pase. Sin decirlo acá, un cliente
   * con más contactos vería un tablero incompleto **sin ningún aviso**: tarjetas
   * que simplemente no están. Peor que un error, porque parece correcto.
   *
   * 500 es lo que un tablero de embudo puede mostrar sin volverse inútil, y el
   * corte por actividad ya deja fuera lo que no se está trabajando.
   */
  const contactosR = await consultaContactos
    .order("ultimo_mensaje_en", { ascending: false, nullsFirst: false })
    .limit(500);

  const contactos = contactosR.data ?? [];
  if (!contactos.length) return { tarjetas: [], cambios: [] };
  const chats = contactos.map((c) => c.chat_id as string);
  const [resultadosR, escalacionesR] = await Promise.all([
    supa
      .from("ed_resultados")
      .select("chat_id, tipo, creado_en")
      .in("empleado_id", ids)
      .in("chat_id", chats),
    supa
      .from("ed_escalaciones")
      .select("chat_id")
      .in("empleado_id", ids)
      .in("chat_id", chats)
      .is("atendida_en", null),
  ]);

  /**
   * Señales de "ganado" que vienen de ed_resultados (agenda y ventas).
   *
   * ⚠️ CICLO NUEVO (auditoría 3-sep-2026). Un cliente que ya compró y vuelve
   * a cotizar baja a "cotizado" con motivo `nuevo_ciclo` (detector de
   * cierres), y un perdido que vuelve a escribir sube a "nuevo" con
   * `volvio_a_escribir` (reconciliar). Pero la venta ANTERIOR sigue en
   * ed_resultados: sin esta regla, al abrir el embudo la señal vieja lo
   * devolvía a "ganado", el detector lo bajaba en el próximo latido y así cada
   * cinco minutos. Para esos motivos solo cuentan los resultados posteriores
   * a `etapa_en` (el inicio del ciclo).
   */
  const inicioCiclo = new Map<string, string>();
  for (const c of contactos) {
    const motivo = c.etapa_motivo as string | null;
    const en = c.etapa_en as string | null;
    if (en && motivo && MOTIVOS_CICLO_NUEVO.has(motivo)) inicioCiclo.set(c.chat_id as string, en);
  }
  const conAgenda = new Set<string>();
  const conVenta = new Set<string>();
  for (const r of resultadosR.data ?? []) {
    const chat = r.chat_id as string;
    const desde = inicioCiclo.get(chat);
    if (desde && ((r.creado_en as string | null) ?? "") < desde) continue;
    const t = r.tipo as string;
    if (t === "agendamiento") conAgenda.add(chat);
    if (t === "venta_confirmada" || t === "venta_recuperada") conVenta.add(chat);
  }
  const esperando = new Set((escalacionesR.data ?? []).map((e) => e.chat_id as string));

  /**
   * El último mensaje de cada chat ya viene en ed_contactos, mantenido por el
   * trigger de la migración 250. Antes se recorrían todos los mensajes del
   * negocio para averiguarlo: era la consulta más cara del portal (1,3 s con
   * 1.467 mensajes y creciendo lineal).
   */

  const cambios: { chat_id: string; etapa: Etapa; motivo: string | null }[] = [];
  const tarjetas: TarjetaEmbudo[] = [];

  for (const c of contactos) {
    const chatId = c.chat_id as string;
    const etiquetas = (c.etiquetas as string[] | null) ?? [];
    const guardada = ((c.etapa as string) ?? "nuevo") as Etapa;
    const manual = Boolean(c.etapa_manual);
    const ultimoEn = (c.ultimo_mensaje_en as string) ?? null;
    const ultimoRol = (c.ultimo_mensaje_rol as string) ?? null;

    let etapa = guardada;
    let motivo: string | null = (c.etapa_motivo as string) ?? null;

    if (!manual) {
      const sugerida = etapaSegunSenales({
        etiquetas,
        tieneAgendamiento: conAgenda.has(chatId),
        tieneVenta: conVenta.has(chatId),
      });
      // Solo avanza; nunca retrocede sola.
      if (ORDEN_ETAPA[sugerida] > ORDEN_ETAPA[guardada]) {
        etapa = sugerida;
        motivo = null;
        cambios.push({ chat_id: chatId, etapa, motivo });
      }

      /**
       * Cierre por silencio. Va DESPUÉS del avance automático para que una
       * señal fresca —una cotización recién enviada— tenga prioridad sobre el
       * reloj. Solo aplica a etapas intermedias: "ganado" y "perdido" ya son
       * terminales y no se reabren solas.
       */
      if (
        (etapa === "interesado" || etapa === "cotizado") &&
        enSilencio(ultimoRol, ultimoEn)
      ) {
        etapa = "perdido";
        // Una pérdida explícita previa (y sin mensajes nuevos) no se convierte
        // en «sin respuesta»: Beto no debe retomar a quien dijo que no.
        motivo = motivoCierrePorSilencio(c.datos, ultimoRol, ultimoEn);
        cambios.push({ chat_id: chatId, etapa, motivo });
      }
    }

    tarjetas.push({
      chatId,
      contacto: (c.nombre as string) || `+${chatId}`,
      etapa,
      etapaManual: manual,
      etiquetas,
      ultimoMensaje: (c.ultimo_mensaje_texto as string) ?? "",
      ultimoEn,
      esperandoHumano: esperando.has(chatId),
      motivo,
      empleadoId: (c.ultimo_empleado_id as string | null) ?? null,
    });
  }

  // Más recientes primero dentro de cada columna.
  tarjetas.sort((a, b) => (b.ultimoEn ?? "").localeCompare(a.ultimoEn ?? ""));

  return { tarjetas, cambios };
}

async function persistirEmbudo(clienteId: string, calc: CalculoEmbudo, supa: SupabaseClient): Promise<void> {
  const { tarjetas } = calc;
  // Un mismo chat puede generar DOS cambios en la misma pasada (avanza a
  // "cotizado" y el silencio lo cierra en "perdido"). Antes iban en dos
  // updates en paralelo y podía quedar el primero. Gana el último (Fase 0).
  const cambios = [...new Map(calc.cambios.map((c) => [c.chat_id, c])).values()];
  /**
   * Persistir lo que cambió — AGRUPADO, no fila por fila.
   *
   * Antes esto era un `await update()` por conversación dentro de un for: cada
   * cambio, un viaje de ida y vuelta a la base, en serie. Medido el 31-jul con
   * 14 tarjetas: 15,3 segundos. La primera vez que corre el cierre por silencio
   * es justamente cuando MÁS cambios hay, así que el peor caso coincide con la
   * primera vez que un cliente abre el embudo.
   *
   * Los cambios posibles son pocos y repetidos (interesado, cotizado, ganado,
   * perdido·sin_respuesta…), así que se agrupan por destino y se manda un
   * update por grupo con `in`. De N viajes se pasa a 5 como mucho, sin importar
   * cuántas conversaciones cambien.
   */
  if (cambios.length) {
    const porDestino = new Map<string, string[]>();
    for (const c of cambios) {
      const clave = `${c.etapa}|${c.motivo ?? ""}`;
      const arr = porDestino.get(clave);
      if (arr) arr.push(c.chat_id);
      else porDestino.set(clave, [c.chat_id]);
    }

    const ahora = new Date().toISOString();
    await Promise.all(
      [...porDestino.entries()].map(([clave, chats]) => {
        const [etapa, motivo] = clave.split("|");
        return supa
          .from("ed_contactos")
          .update({
            etapa,
            etapa_motivo: motivo || null,
            etapa_en: ahora,
          })
          .eq("cliente_id", clienteId) // barrera de acceso, igual que antes
          .in("chat_id", chats);
      }),
    );

    /**
     * PUENTE: avisar los cambios de etapa al sistema del cliente, si tiene uno
     * (agregado 11-ago-2026).
     *
     * Importa que esté acá y no solo en el mensaje entrante: dos de los cambios
     * que hace este cálculo no vienen de un mensaje nuevo. El cierre por
     * silencio lo dispara el RELOJ (una cotización que llevaba una semana sin
     * respuesta pasa a perdida), y el avance a "ganado" lo dispara una venta o
     * un agendamiento. Sin este aviso, esos dos casos quedarían solo en el
     * portal y los dos sistemas mostrarían estados distintos de la misma
     * conversación — que es la forma más rápida de que alguien deje de creerle
     * a los dos.
     *
     * Se esperan TODOS a la vez con un tope de 4 s (auditoría 3-sep-2026):
     * en serverless, un fire-and-forget se perdía al terminar el render, y
     * el sistema del cliente se quedaba con la etapa vieja. Cuatro segundos
     * de tope para no colgar la pantalla si Gestión no responde.
     */
    const porChat = new Map(cambios.map((c) => [c.chat_id, c]));
    const avisos: Promise<void>[] = [];
    for (const t of tarjetas) {
      const cambio = porChat.get(t.chatId);
      if (!cambio) continue;
      avisos.push(
        notificarYEsperar({
          evento: "etapa",
          clienteId,
          contacto: {
            chatId: t.chatId,
            nombre: t.contacto.startsWith("+") ? null : t.contacto,
            // El embudo no distingue canal; se deduce del prefijo que usa
            // inboundInstagram para que un IGSID no colisione con un teléfono.
            canal: t.chatId.startsWith("ig:") ? "instagram" : "whatsapp",
            etapa: cambio.etapa,
            etapaManual: false, // por construcción: acá solo entran cambios automáticos
            // Solo motivos que Gestión ya conocía (ver moverEtapa).
            etapaMotivo: cambio.motivo === MOTIVO_SILENCIO ? cambio.motivo : null,
            etapaEn: ahora,
            etiquetas: t.etiquetas,
            ultimoMensajeEn: t.ultimoEn,
          },
          supa,
        }).catch((e) => console.warn("[embudo] puente:", (e as Error).message)),
      );
    }
    if (avisos.length) {
      await Promise.race([Promise.allSettled(avisos), new Promise((r) => setTimeout(r, 4_000))]);
    }
  }

}

/**
 * Mueve una conversación de etapa a mano. Queda marcada como manual para que el
 * cálculo automático no la pise después.
 */
export async function moverEtapa(
  clienteId: string,
  chatId: string,
  etapa: Etapa,
  supaOpt?: SupabaseClient,
  opts: { motivo?: string | null } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!ETAPAS.some((e) => e.valor === etapa)) return { ok: false, error: "Etapa no válida" };
  const supa = supaOpt ?? db();

  /**
   * MOTIVO DE PÉRDIDA (Fase 1). Mover a Perdido guarda POR QUÉ: «sin
   * respuesta» sigue siendo retomable por Beto; «no le interesó», «eligió a
   * otro», «no quiere que lo contacten» no se retoman nunca. Un motivo que no
   * está en el catálogo se rechaza en vez de guardarse como texto libre.
   */
  const motivo = etapa === "perdido" ? (opts.motivo ?? null) : null;
  if (motivo !== null && !esMotivoPerdida(motivo)) return { ok: false, error: "Motivo no válido" };

  const { data: actual, error: errLeer } = await supa
    .from("ed_contactos")
    .select("etapa, etapa_motivo, etapa_en, etiquetas, datos")
    .eq("cliente_id", clienteId) // barrera de acceso
    .eq("chat_id", chatId)
    .maybeSingle();
  if (errLeer) return { ok: false, error: errLeer.message };
  if (!actual) return { ok: false, error: "Conversación no encontrada" };

  const ahora = new Date().toISOString();
  const cambios: Record<string, unknown> = { etapa, etapa_manual: true, etapa_motivo: motivo, etapa_en: ahora };
  // Sale de Perdido: se conserva por qué estaba perdido.
  if (actual.etapa === "perdido" && etapa !== "perdido") {
    cambios.datos = datosConPerdidaAnterior(actual.datos, actual.etapa_motivo as string | null, actual.etapa_en as string | null);
  }
  // «No quiere que lo contacten» se vuelve la etiqueta que TODO el producto ya
  // respeta (Beto, seguimientos, reingreso, avisos de pedido).
  if (motivo === "no_contactar") {
    const etiquetas = (actual.etiquetas as string[] | null) ?? [];
    if (!etiquetas.includes("no_contactar")) cambios.etiquetas = [...etiquetas, "no_contactar"];
  }

  const { error } = await supa
    .from("ed_contactos")
    .update(cambios)
    .eq("cliente_id", clienteId) // barrera de acceso
    .eq("chat_id", chatId);
  if (error) return { ok: false, error: error.message };

  /**
   * PUENTE: avisar el movimiento manual al sistema del cliente.
   *
   * ⚠ Puede quedar sin efecto, y está bien: si en ESE sistema una persona ya
   * había fijado el estado a mano, allá manda su criterio y el aviso se ignora.
   * Es la regla acordada para que los dos tableros no se peleen — no un bug.
   * Cuando pase, los dos guardan la etapa cruda y el desacuerdo se puede
   * auditar sin adivinar.
   */
  // Esperado con tope: es una server action y el fire-and-forget se perdía.
  await notificarConTope({
    evento: "etapa",
    clienteId,
    contacto: {
      chatId,
      canal: chatId.startsWith("ig:") ? "instagram" : "whatsapp",
      etapa,
      etapaManual: true,
      // Contrato con un sistema externo (Gestión): solo viajan motivos que ya
      // conocía. Los motivos nuevos de pérdida se quedan en el portal.
      etapaMotivo: motivo === MOTIVO_SILENCIO ? motivo : null,
      etapaEn: ahora,
    },
    supa,
  });

  return { ok: true };
}

/**
 * Devuelve el control de la etapa al cálculo automático.
 *
 * Ojo con un detalle que confunde si no se maneja: como la etapa nunca retrocede
 * sola, con solo quitar la marca manual la tarjeta se quedaría donde el humano
 * la dejó y el botón "que la maneje el asistente" no haría nada visible. Por eso
 * acá SÍ se recalcula de inmediato desde las señales, aunque implique retroceder:
 * es lo que la persona acaba de pedir explícitamente.
 */
export async function liberarEtapa(
  clienteId: string,
  chatId: string,
  supaOpt?: SupabaseClient,
): Promise<{ ok: boolean }> {
  const supa = supaOpt ?? db();

  const [contactoR, empleadosR] = await Promise.all([
    supa
      .from("ed_contactos")
      .select("etiquetas, etapa, etapa_motivo, etapa_en, datos")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    supa.from("ed_empleados").select("id").eq("cliente_id", clienteId),
  ]);

  const ids = (empleadosR.data ?? []).map((e) => e.id as string);
  let tieneAgendamiento = false;
  let tieneVenta = false;
  if (ids.length) {
    const { data: res } = await supa
      .from("ed_resultados")
      .select("tipo")
      .in("empleado_id", ids)
      .eq("chat_id", chatId);
    for (const r of res ?? []) {
      const t = r.tipo as string;
      if (t === "agendamiento") tieneAgendamiento = true;
      if (t === "venta_confirmada" || t === "venta_recuperada") tieneVenta = true;
    }
  }

  const etapa = etapaSegunSenales({
    etiquetas: ((contactoR.data?.etiquetas as string[] | null) ?? []),
    tieneAgendamiento,
    tieneVenta,
  });

  const cambios: Record<string, unknown> = {
    etapa_manual: false,
    etapa,
    etapa_motivo: null,
    etapa_en: new Date().toISOString(),
  };
  /**
   * (Fase 1, revisión) Sale de Perdido: se guarda POR QUÉ estaba perdido. Sin
   * esto, «no le interesó» se borraba y el cierre por silencio la volvía
   * `sin_respuesta` — retomable por Beto. Ver motivoCierrePorSilencio.
   */
  const previo = contactoR.data;
  if (previo?.etapa === "perdido" && etapa !== "perdido") {
    cambios.datos = datosConPerdidaAnterior(previo.datos, previo.etapa_motivo as string | null, previo.etapa_en as string | null);
  }

  const { error } = await supa
    .from("ed_contactos")
    .update(cambios)
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId);
  return { ok: !error };
}
