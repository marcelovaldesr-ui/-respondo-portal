import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { notificarConTope, notificarYEsperar } from "@/lib/puenteSalida";

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

export type Etapa = "nuevo" | "interesado" | "cotizado" | "ganado" | "perdido";

export const ETAPAS: {
  valor: Etapa;
  label: string;
  descripcion: string;
  color: string;
  fondo: string;
}[] = [
  {
    valor: "nuevo",
    label: "Nuevo",
    descripcion: "Escribió; el asistente aún no detecta intención",
    color: "#475569",
    fondo: "#F1F5F9",
  },
  {
    valor: "interesado",
    label: "Interesado",
    descripcion: "Muestra intención de compra",
    color: "#9A3412",
    fondo: "#FFF7ED",
  },
  {
    valor: "cotizado",
    label: "Cotizado",
    descripcion: "Ya tiene precio o propuesta",
    color: "#92400E",
    fondo: "#FEF9C3",
  },
  {
    valor: "ganado",
    label: "Ganado",
    descripcion: "Compró o agendó",
    color: "#166534",
    fondo: "#DCFCE7",
  },
  {
    valor: "perdido",
    label: "Perdido",
    descripcion: "No prosperó",
    color: "#7F1D1D",
    fondo: "#FEE2E2",
  },
];

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
export const DIAS_SILENCIO = 7;

/** Motivo que se guarda en ed_contactos.etapa_motivo (migración 251). */
export const MOTIVO_SILENCIO = "sin_respuesta";

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

/** Orden del embudo: se usa para no retroceder de etapa automáticamente. */
export const ORDEN_ETAPA: Record<Etapa, number> = {
  nuevo: 0,
  interesado: 1,
  cotizado: 2,
  ganado: 3,
  perdido: 3, // terminal, mismo nivel que ganado
};

export function metaEtapa(valor: string) {
  return ETAPAS.find((e) => e.valor === valor) ?? ETAPAS[0];
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
};

/**
 * Recalcula las etapas automáticas y devuelve el tablero listo para pintar.
 *
 * Se recalcula al abrir la página (no hay proceso de fondo): para el volumen de
 * una pyme es instantáneo y evita un cron más que mantener. Solo escribe cuando
 * la etapa cambia de verdad, así no genera tráfico inútil.
 */
export async function cargarEmbudo(
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
): Promise<TarjetaEmbudo[]> {
  const supa = supaOpt ?? db();

  const ids = await idsEmpleadosDeCliente(clienteId);
  if (!ids.length) return [];

  const corteActividad =
    diasActividad > 0
      ? new Date(Date.now() - diasActividad * 86400_000).toISOString()
      : null;
  let consultaContactos = supa
    .from("ed_contactos")
    .select(
      "chat_id, nombre, etiquetas, etapa, etapa_manual, etapa_motivo, etapa_en, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol",
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
  if (!contactos.length) return [];
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
        motivo = MOTIVO_SILENCIO;
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
    });
  }

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
            etapaMotivo: cambio.motivo,
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

  // Más recientes primero dentro de cada columna.
  tarjetas.sort((a, b) => (b.ultimoEn ?? "").localeCompare(a.ultimoEn ?? ""));

  // Corte por actividad. Se aplica DESPUÉS de recalcular las etapas para que el
  // estado quede guardado igual, aunque la tarjeta no se muestre hoy: si el
  // cliente vuelve a escribir, reaparece en la etapa correcta.
  return tarjetas;
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
): Promise<{ ok: boolean; error?: string }> {
  if (!ETAPAS.some((e) => e.valor === etapa)) return { ok: false, error: "Etapa no válida" };
  const supa = supaOpt ?? db();
  const { error } = await supa
    .from("ed_contactos")
    .update({ etapa, etapa_manual: true, etapa_motivo: null, etapa_en: new Date().toISOString() })
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
      etapaMotivo: null,
      etapaEn: new Date().toISOString(),
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
      .select("etiquetas")
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

  const { error } = await supa
    .from("ed_contactos")
    .update({ etapa_manual: false, etapa, etapa_motivo: null, etapa_en: new Date().toISOString() })
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId);
  return { ok: !error };
}
