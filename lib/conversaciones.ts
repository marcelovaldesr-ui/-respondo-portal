import { db } from "@/lib/db";

/**
 * Datos de la pantalla de Conversaciones. Solo lectura en v1: el portal no
 * escribe en ed_chat_estado (pausar/derivar entra en v2).
 *
 * SEGURIDAD: el chat se identifica por (empleado_id, chat_id) y el empleado_id
 * viene de la URL. Por eso SIEMPRE se valida contra los empleados del cliente
 * logueado — si no, alguien podría leer la conversación de otro negocio
 * cambiando el parámetro a mano.
 */

export type ItemConversacion = {
  empleadoId: string;
  empleadoNombre: string;
  empleadoRol: string;
  chatId: string;
  contacto: string;
  ultimoMensaje: string;
  ultimoEn: string;
  mensajes: number;
  modo: string;
  esperandoHumano: boolean;
  etiquetas: string[];
};

/**
 * Trae el mapa chat_id -> etiquetas de un cliente. Defensivo: la columna
 * etiquetas la agrega la migración 211; si aún no está, devuelve mapa vacío sin
 * romper la lista.
 */
async function etiquetasPorChat(clienteId: string): Promise<Map<string, string[]>> {
  const { data, error } = await db()
    .from("ed_contactos")
    .select("chat_id, etiquetas")
    .eq("cliente_id", clienteId);
  const mapa = new Map<string, string[]>();
  if (error || !data) return mapa;
  for (const c of data) {
    mapa.set(c.chat_id as string, (c.etiquetas as string[] | null) ?? []);
  }
  return mapa;
}

export type DetalleConversacion = {
  chatId: string;
  contacto: string;
  telefono: string | null;
  etiqueta: string | null;
  empleadoNombre: string;
  empleadoRol: string;
  modo: string;
  mensajes: { rol: string; texto: string; creadoEn: string }[];
  escalacion: { trigger: string; resumen: string; atendida: boolean } | null;
  resultados: string[];
  etiquetas: string[];
  /** Estado de la ventana de 24h de WhatsApp (Opción B). */
  ventana: "abierta" | "cerrada" | "desconocida";
};

/**
 * Estado de la ventana de 24h a partir del último mensaje entrante del cliente.
 * Defensivo: la columna ultimo_entrante_en la agrega la migración 210; si aún
 * no está aplicada, la consulta devuelve error y esto retorna "desconocida" sin
 * romper la página.
 */
export async function estadoVentana(
  empleadoId: string,
  chatId: string,
): Promise<"abierta" | "cerrada" | "desconocida"> {
  const { data, error } = await db()
    .from("ed_chat_estado")
    .select("ultimo_entrante_en")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();

  if (error || !data?.ultimo_entrante_en) return "desconocida";
  const desde = new Date(data.ultimo_entrante_en as string).getTime();
  const horas = (Date.now() - desde) / 36e5;
  return horas < 24 ? "abierta" : "cerrada";
}

/** Empleados del cliente. Base de toda validación de acceso. */
async function empleadosDe(clienteId: string) {
  const { data } = await db()
    .from("ed_empleados")
    .select("id, rol, nombre_publico")
    .eq("cliente_id", clienteId);
  return data ?? [];
}

export async function listarConversaciones(
  clienteId: string,
): Promise<ItemConversacion[]> {
  const supa = db();
  const empleados = await empleadosDe(clienteId);
  if (!empleados.length) return [];

  const ids = empleados.map((e) => e.id as string);
  const porId = new Map(empleados.map((e) => [e.id as string, e]));

  const [mensajes, contactos, estados, escalaciones] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("empleado_id, chat_id, rol, texto, creado_en")
      .in("empleado_id", ids)
      .order("creado_en", { ascending: false })
      .limit(2000),
    supa
      .from("ed_contactos")
      .select("chat_id, nombre, etiqueta")
      .eq("cliente_id", clienteId),
    supa.from("ed_chat_estado").select("empleado_id, chat_id, modo").in("empleado_id", ids),
    supa
      .from("ed_escalaciones")
      .select("empleado_id, chat_id, atendida_en")
      .in("empleado_id", ids)
      .is("atendida_en", null),
  ]);

  const etiquetasMapa = await etiquetasPorChat(clienteId);

  const nombrePorChat = new Map(
    (contactos.data ?? []).map((c) => [c.chat_id as string, c.nombre as string]),
  );
  const modoPorChat = new Map(
    (estados.data ?? []).map((e) => [`${e.empleado_id}|${e.chat_id}`, e.modo as string]),
  );
  const pendientes = new Set(
    (escalaciones.data ?? []).map((e) => `${e.empleado_id}|${e.chat_id}`),
  );

  // Los mensajes vienen ordenados del más nuevo al más viejo: el primero de
  // cada chat es el último mensaje.
  const agrupado = new Map<string, ItemConversacion>();
  for (const m of mensajes.data ?? []) {
    const clave = `${m.empleado_id}|${m.chat_id}`;
    const emp = porId.get(m.empleado_id as string);
    if (!emp) continue;
    const existente = agrupado.get(clave);
    if (existente) {
      existente.mensajes += 1;
      continue;
    }
    agrupado.set(clave, {
      empleadoId: m.empleado_id as string,
      empleadoNombre: (emp.nombre_publico as string) ?? "",
      empleadoRol: emp.rol as string,
      chatId: m.chat_id as string,
      contacto: nombrePorChat.get(m.chat_id as string) ?? `+${m.chat_id}`,
      ultimoMensaje: m.texto as string,
      ultimoEn: m.creado_en as string,
      mensajes: 1,
      modo: modoPorChat.get(clave) ?? "bot",
      esperandoHumano: pendientes.has(clave),
      etiquetas: etiquetasMapa.get(m.chat_id as string) ?? [],
    });
  }

  return [...agrupado.values()].sort((a, b) =>
    a.esperandoHumano === b.esperandoHumano
      ? b.ultimoEn.localeCompare(a.ultimoEn)
      : a.esperandoHumano
        ? -1
        : 1,
  );
}

export async function obtenerConversacion(
  clienteId: string,
  empleadoId: string,
  chatId: string,
): Promise<DetalleConversacion | null> {
  const supa = db();

  // Validación de acceso: el empleado tiene que ser de ESTE cliente.
  const empleados = await empleadosDe(clienteId);
  const emp = empleados.find((e) => e.id === empleadoId);
  if (!emp) return null;

  const [mensajes, contacto, estado, escalacion, resultados] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("rol, texto, creado_en")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: true }),
    supa
      .from("ed_contactos")
      .select("nombre, telefono, etiqueta")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    supa
      .from("ed_chat_estado")
      .select("modo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .maybeSingle(),
    supa
      .from("ed_escalaciones")
      .select("trigger, resumen, atendida_en")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supa
      .from("ed_resultados")
      .select("tipo")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId),
  ]);

  if (!mensajes.data?.length) return null;

  return {
    chatId,
    contacto: (contacto.data?.nombre as string) ?? `+${chatId}`,
    telefono: (contacto.data?.telefono as string) ?? null,
    etiqueta: (contacto.data?.etiqueta as string) ?? null,
    empleadoNombre: (emp.nombre_publico as string) ?? "",
    empleadoRol: emp.rol as string,
    modo: (estado.data?.modo as string) ?? "bot",
    mensajes: mensajes.data.map((m) => ({
      rol: m.rol as string,
      texto: m.texto as string,
      creadoEn: m.creado_en as string,
    })),
    escalacion: escalacion.data
      ? {
          trigger: escalacion.data.trigger as string,
          resumen: escalacion.data.resumen as string,
          atendida: Boolean(escalacion.data.atendida_en),
        }
      : null,
    resultados: (resultados.data ?? []).map((r) => r.tipo as string),
    etiquetas: (await etiquetasPorChat(clienteId)).get(chatId) ?? [],
    ventana: await estadoVentana(empleadoId, chatId),
  };
}

/** Etiquetas legibles para el dueño (nada de jerga del motor). */
export const ETIQUETA_RESULTADO: Record<string, string> = {
  lead_capturado: "Lead capturado",
  cotizacion_enviada: "Cotización enviada",
  agendamiento: "Agendamiento",
  venta_confirmada: "Venta confirmada",
  cotizacion_retomada: "Cotización retomada",
  cliente_reactivado: "Cliente reactivado",
  venta_recuperada: "Venta recuperada",
  encuesta_respondida: "Encuesta respondida",
  resena_conseguida: "Reseña conseguida",
  cliente_molesto: "Cliente molesto",
};

export const ETIQUETA_TRIGGER: Record<string, string> = {
  pedido_explicito: "El cliente pidió hablar con una persona",
  sentimiento_negativo: "Cliente molesto",
  sin_resolver: "El asistente no pudo resolverlo",
  palabra_clave: "Tema delicado detectado",
  monto_alto: "Monto alto",
  incertidumbre: "El asistente no estaba seguro",
};

// El formateo de fechas vive en lib/fechas.ts, que fija la zona horaria de
// Chile. Se re-exporta para no tocar los imports de las páginas.
export { fechaCorta, fechaLarga } from "@/lib/fechas";
