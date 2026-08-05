import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Etapa } from "@/lib/embudo";

/**
 * FICHA DE CLIENTE — la memoria del negocio sobre cada persona.
 *
 * La bandeja responde "¿qué me dijeron?"; el embudo, "¿en qué va?". Falta la
 * pregunta que se hace todos los días quien atiende: "¿quién es esta persona y
 * qué hemos hecho con ella?". Eso es esta ficha.
 *
 * Casi todo el modelo ya existía: ed_contactos guarda nombre, teléfono, correo,
 * notas y etiquetas desde el principio — el campo `notas` incluso estaba sin
 * usar en la interfaz. Acá se junta con el historial que ya se registra en otras
 * tablas, sin duplicar nada.
 */

export type EventoCliente = {
  tipo: "conversacion" | "resultado" | "escalacion" | "seguimiento" | "etapa";
  fecha: string;
  titulo: string;
  detalle?: string;
};

export type ResumenCliente = {
  chatId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  etiquetas: string[];
  etapa: Etapa;
  /** Métricas calculadas del historial */
  mensajes: number;
  primeraVez: string | null;
  ultimaVez: string | null;
  diasSinHablar: number | null;
  cotizaciones: number;
  esperandoHumano: boolean;
};

export type FichaCliente = ResumenCliente & {
  empleadoId: string;
  eventos: EventoCliente[];
};

/** Días completos entre una fecha y hoy. */
function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

/** Ids de los empleados del cliente (barrera de acceso de todas las consultas). */
async function empleadosDe(clienteId: string, supa: SupabaseClient): Promise<string[]> {
  const { data } = await supa.from("ed_empleados").select("id").eq("cliente_id", clienteId);
  return (data ?? []).map((e) => e.id as string);
}

/**
 * Lista de clientes con sus métricas, ordenada por actividad reciente.
 * `q` busca por nombre o número.
 */
export async function listarClientes(
  clienteId: string,
  opts?: { q?: string; etapa?: string; pagina?: number; porPagina?: number; supa?: SupabaseClient },
): Promise<{ items: ResumenCliente[]; total: number }> {
  const supa = opts?.supa ?? db();
  const ids = await empleadosDe(clienteId, supa);
  if (!ids.length) return { items: [], total: 0 };

  const porPagina = Math.min(100, Math.max(1, opts?.porPagina ?? 25));
  const pagina = Math.max(1, opts?.pagina ?? 1);
  const desde = (pagina - 1) * porPagina;
  let consulta = supa
    .from("ed_contactos")
    .select(
      "chat_id, nombre, telefono, email, notas, etiquetas, etapa, ultimo_mensaje_en, primer_mensaje_en, total_mensajes",
      { count: "exact" },
    )
    .eq("cliente_id", clienteId);
  if (opts?.etapa) consulta = consulta.eq("etapa", opts.etapa);
  if (opts?.q) {
    // Evita que comas/paréntesis del usuario alteren la gramática de `.or`.
    const termino = opts.q.replace(/[,()%_]/g, " ").trim().slice(0, 80);
    if (termino) {
      consulta = consulta.or(
        `nombre.ilike.%${termino}%,chat_id.ilike.%${termino}%,notas.ilike.%${termino}%`,
      );
    }
  }

  const contactosR = await consulta
    .order("ultimo_mensaje_en", { ascending: false, nullsFirst: false })
    .order("chat_id", { ascending: true })
    .range(desde, desde + porPagina - 1);
  const contactos = contactosR.data ?? [];
  if (!contactos.length) return { items: [], total: contactosR.count ?? 0 };
  const chats = contactos.map((c) => c.chat_id as string);

  const [escalacionesR, resultadosR] = await Promise.all([
    supa
      .from("ed_escalaciones")
      .select("chat_id")
      .in("empleado_id", ids)
      .in("chat_id", chats)
      .is("atendida_en", null),
    supa
      .from("ed_resultados")
      .select("chat_id, tipo")
      .in("empleado_id", ids)
      .in("chat_id", chats),
  ]);

  const esperando = new Set((escalacionesR.data ?? []).map((e) => e.chat_id as string));
  /**
   * Cotizaciones. OJO: ed_resultados hoy solo lo escribe el módulo de agenda,
   * así que contar únicamente de ahí daría "0 cotizaciones" a alguien que el
   * propio portal muestra en etapa "Cotizado" — una contradicción que le hace
   * perder credibilidad a la ficha. Se suma la señal que el asistente sí deja
   * en vivo: la etiqueta "cotizacion".
   */
  const cotizacionesPorChat = new Map<string, number>();
  for (const r of resultadosR.data ?? []) {
    if (r.tipo === "cotizacion_enviada") {
      const c = r.chat_id as string;
      cotizacionesPorChat.set(c, (cotizacionesPorChat.get(c) ?? 0) + 1);
    }
  }
  for (const c of contactos) {
    const chatId = c.chat_id as string;
    const tags = ((c.etiquetas as string[] | null) ?? []);
    if (tags.includes("cotizacion") && !cotizacionesPorChat.has(chatId)) {
      cotizacionesPorChat.set(chatId, 1);
    }
  }

  /**
   * Antes acá se recorrían TODOS los mensajes del negocio para sacar el primero,
   * el último y el total de cada chat. Costaba una consulta por cada 1.000
   * mensajes: 0,4 s hoy, pero 12 s proyectados a un año con un cliente activo.
   * Ahora esos tres datos los mantiene la base con un trigger (migración 250) y
   * vienen en la misma consulta de contactos: cero recorridos, tiempo constante
   * sin importar cuánto crezca el historial.
   */

  const lista: ResumenCliente[] = contactos.map((c) => {
    const chatId = c.chat_id as string;
    const ultima = (c.ultimo_mensaje_en as string) ?? null;
    return {
      chatId,
      nombre: (c.nombre as string) || `+${chatId}`,
      telefono: (c.telefono as string) ?? null,
      email: (c.email as string) ?? null,
      notas: (c.notas as string) ?? null,
      etiquetas: ((c.etiquetas as string[] | null) ?? []),
      etapa: (((c.etapa as string) ?? "nuevo") as Etapa),
      mensajes: (c.total_mensajes as number) ?? 0,
      primeraVez: (c.primer_mensaje_en as string) ?? null,
      ultimaVez: ultima,
      diasSinHablar: diasDesde(ultima),
      cotizaciones: cotizacionesPorChat.get(chatId) ?? 0,
      esperandoHumano: esperando.has(chatId),
    };
  });

  return { items: lista, total: contactosR.count ?? lista.length };
}

/**
 * Ficha completa: datos + línea de tiempo de todo lo que pasó con esa persona.
 *
 * La línea de tiempo agrupa los mensajes POR DÍA en vez de listar uno por uno:
 * un cliente con 200 mensajes generaría una lista imposible de leer, y lo que
 * interesa acá es "el 27 de julio hablamos", no cada línea del chat (para eso
 * está la bandeja, a un clic).
 */
export async function fichaCliente(
  clienteId: string,
  chatId: string,
  supaOpt?: SupabaseClient,
): Promise<FichaCliente | null> {
  const supa = supaOpt ?? db();
  const ids = await empleadosDe(clienteId, supa);
  if (!ids.length) return null;

  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, telefono, email, notas, etiquetas, etapa, etapa_en")
    .eq("cliente_id", clienteId) // barrera de acceso
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) return null;

  const [mensajesR, resultadosR, escalacionesR, seguimientosR, tinoR] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("rol, texto, creado_en, empleado_id")
      .in("empleado_id", ids)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: true })
      .limit(1000),
    supa.from("ed_resultados").select("tipo, creado_en").in("empleado_id", ids).eq("chat_id", chatId),
    supa
      .from("ed_escalaciones")
      .select("trigger, resumen, creado_en, atendida_en")
      .in("empleado_id", ids)
      .eq("chat_id", chatId),
    supa
      .from("ed_seguimientos")
      .select("tipo, enviado_en, respuesta_recibida")
      .in("empleado_id", ids)
      .eq("chat_id", chatId)
      .not("enviado_en", "is", null),
    supa.from("ed_empleados").select("id").eq("cliente_id", clienteId).eq("rol", "tino").maybeSingle(),
  ]);

  const mensajes = mensajesR.data ?? [];
  const eventos: EventoCliente[] = [];

  // Conversaciones agrupadas por día (hora de Chile en el formateo del render).
  const porDia = new Map<string, { n: number; primero: string; ultimo: string }>();
  for (const m of mensajes) {
    const dia = (m.creado_en as string).slice(0, 10);
    const d = porDia.get(dia);
    if (!d) porDia.set(dia, { n: 1, primero: m.creado_en as string, ultimo: m.creado_en as string });
    else {
      d.n += 1;
      d.ultimo = m.creado_en as string;
    }
  }
  for (const [, d] of porDia) {
    eventos.push({
      tipo: "conversacion",
      fecha: d.ultimo,
      titulo: `${d.n} mensaje${d.n === 1 ? "" : "s"} intercambiados`,
    });
  }

  const NOMBRE_RESULTADO: Record<string, string> = {
    lead_capturado: "Se registró como interesado",
    cotizacion_enviada: "Se le envió una cotización",
    agendamiento: "Agendó una hora",
    venta_confirmada: "Compró",
    venta_recuperada: "Compra recuperada",
    cotizacion_retomada: "Retomó una cotización",
    cliente_reactivado: "Volvió tras un seguimiento",
    encuesta_respondida: "Respondió la encuesta",
    resena_conseguida: "Dejó una reseña",
    cliente_molesto: "Quedó molesto",
  };
  for (const r of resultadosR.data ?? []) {
    eventos.push({
      tipo: "resultado",
      fecha: r.creado_en as string,
      titulo: NOMBRE_RESULTADO[r.tipo as string] ?? (r.tipo as string),
    });
  }

  for (const e of escalacionesR.data ?? []) {
    eventos.push({
      tipo: "escalacion",
      fecha: e.creado_en as string,
      titulo: e.atendida_en ? "Pidió una persona (atendido)" : "Pidió una persona",
      detalle: (e.resumen as string) ?? undefined,
    });
  }

  for (const s of seguimientosR.data ?? []) {
    eventos.push({
      tipo: "seguimiento",
      fecha: s.enviado_en as string,
      titulo: "Se le envió un seguimiento",
      detalle: s.respuesta_recibida ? "Respondió" : "Sin respuesta",
    });
  }

  if (contacto.etapa_en) {
    eventos.push({
      tipo: "etapa",
      fecha: contacto.etapa_en as string,
      titulo: `Pasó a “${contacto.etapa}”`,
    });
  }

  eventos.sort((a, b) => b.fecha.localeCompare(a.fecha)); // más reciente arriba

  const primera = mensajes[0]?.creado_en as string | undefined;
  const ultima = mensajes[mensajes.length - 1]?.creado_en as string | undefined;
  const etiquetasContacto = ((contacto.etiquetas as string[] | null) ?? []);
  const cotizaciones =
    (resultadosR.data ?? []).filter((r) => r.tipo === "cotizacion_enviada").length ||
    (etiquetasContacto.includes("cotizacion") ? 1 : 0);

  return {
    chatId,
    nombre: (contacto.nombre as string) || `+${chatId}`,
    telefono: (contacto.telefono as string) ?? null,
    email: (contacto.email as string) ?? null,
    notas: (contacto.notas as string) ?? null,
    etiquetas: ((contacto.etiquetas as string[] | null) ?? []),
    etapa: (((contacto.etapa as string) ?? "nuevo") as Etapa),
    mensajes: mensajes.length,
    primeraVez: primera ?? null,
    ultimaVez: ultima ?? null,
    diasSinHablar: diasDesde(ultima ?? null),
    cotizaciones,
    esperandoHumano: (escalacionesR.data ?? []).some((e) => !e.atendida_en),
    empleadoId: (tinoR.data?.id as string) ?? "",
    eventos,
  };
}

/** Guarda los datos editables de la ficha. Filtra por cliente (barrera). */
export async function guardarDatosCliente(
  clienteId: string,
  chatId: string,
  datos: { nombre?: string; telefono?: string; email?: string; notas?: string },
  supaOpt?: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const supa = supaOpt ?? db();
  const limpio: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(datos)) {
    const s = (v ?? "").trim();
    limpio[k] = s === "" ? null : s.slice(0, 2000);
  }
  const { error } = await supa
    .from("ed_contactos")
    .update({ ...limpio, actualizado_en: new Date().toISOString() })
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
