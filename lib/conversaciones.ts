import { db } from "@/lib/db";
import { ultimosMensajes, type MensajeInbox } from "@/lib/inboxConsulta";
import { empleadosDeCliente } from "@/lib/empleadosCache";

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
  ultimoRol: string;
  mensajes: number;
  modo: string;
  esperandoHumano: boolean;
  etiquetas: string[];
};

export type DetalleConversacion = {
  chatId: string;
  contacto: string;
  telefono: string | null;
  etiqueta: string | null;
  empleadoNombre: string;
  empleadoRol: string;
  modo: string;
  /**
   * Tramo reciente de la conversación, ya listo para el inbox.
   *
   * ⚠️ Antes esto traía solo `{rol, texto, creadoEn}`: sin `id` React no tenía
   * clave estable, y sin `media` las fotos NO se veían hasta que el primer
   * refresco reemplazaba la lista entera — un parpadeo en cada apertura.
   */
  mensajes: MensajeInbox[];
  escalacion: { trigger: string; resumen: string; atendida: boolean } | null;
  resultados: string[];
  etiquetas: string[];
  /** Estado de la ventana de 24h de WhatsApp (Opción B). */
  ventana: "abierta" | "cerrada" | "desconocida";
  /**
   * CONTEXTO de la persona, para el panel lateral del rediseño.
   *
   * Sale todo de ed_contactos, que desde la migración 250 ya trae el total de
   * mensajes y la fecha del primero mantenidos por trigger. O sea: es gratis.
   * Antes, mostrar "cliente desde" habría obligado a buscar el mensaje más
   * antiguo del chat en cada apertura.
   */
  etapa: string;
  mensajesTotal: number;
  clienteDesde: string | null;
  notas: string | null;
};

export type ResumenConversaciones = {
  total: number;
  espera: number;
  humano: number;
  bot: number;
  etiquetas: Record<string, number>;
};

export type PaginaConversaciones = {
  items: ItemConversacion[];
  totalFiltrado: number;
  resumen: ResumenConversaciones;
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

/**
 * Empleados del cliente. Base de toda validación de acceso.
 *
 * Delega en la versión cacheada por petición: esta misma consulta la hacían
 * también el layout, el resumen y la analítica, cada uno por su lado.
 */
async function empleadosDe(clienteId: string) {
  const emps = await empleadosDeCliente(clienteId);
  return emps.map((e) => ({ id: e.id, rol: e.rol, nombre_publico: e.nombrePublico }));
}

/** Bandeja paginada en base de datos (migración 273). */
export async function listarConversacionesPagina(
  clienteId: string,
  opts: {
    q?: string;
    estado?: string;
    etiqueta?: string;
    pagina?: number;
    porPagina?: number;
  } = {},
): Promise<PaginaConversaciones> {
  const pagina = Math.max(1, opts.pagina ?? 1);
  const porPagina = Math.min(100, Math.max(1, opts.porPagina ?? 50));
  const supa = db();
  const [filasR, resumenR] = await Promise.all([
    supa.rpc("ed_listar_conversaciones_portal", {
      p_cliente_id: clienteId,
      p_q: opts.q?.trim() || null,
      p_estado: ["espera", "humano", "bot"].includes(opts.estado ?? "")
        ? opts.estado
        : null,
      p_etiqueta: opts.etiqueta || null,
      p_limite: porPagina,
      p_offset: (pagina - 1) * porPagina,
    }),
    supa.rpc("ed_resumen_conversaciones_portal", { p_cliente_id: clienteId }),
  ]);
  if (filasR.error || resumenR.error) {
    // Rollout seguro: si el código llega antes que la migración, se conserva
    // una bandeja funcional y acotada a 100 filas. Al aplicar la 273, filtros,
    // conteos y paginación pasan automáticamente a Postgres.
    console.warn(
      "[conversaciones] usando respaldo acotado; falta migración 273:",
      filasR.error?.message ?? resumenR.error?.message,
    );
    const todos = await listarConversaciones(clienteId);
    const etiquetas: Record<string, number> = {};
    for (const item of todos) {
      for (const etiqueta of item.etiquetas) etiquetas[etiqueta] = (etiquetas[etiqueta] ?? 0) + 1;
    }
    const resumen: ResumenConversaciones = {
      total: todos.length,
      espera: todos.filter((c) => c.esperandoHumano).length,
      humano: todos.filter((c) => c.modo === "humano" && !c.esperandoHumano).length,
      bot: todos.filter((c) => c.modo === "bot" && !c.esperandoHumano).length,
      etiquetas,
    };
    const busqueda = opts.q?.trim().toLocaleLowerCase("es") ?? "";
    const digitos = busqueda.replace(/\D/g, "");
    const filtrados = todos.filter((c) => {
      if (opts.etiqueta && !c.etiquetas.includes(opts.etiqueta)) return false;
      if (opts.estado === "espera" && !c.esperandoHumano) return false;
      if (opts.estado === "humano" && (c.modo !== "humano" || c.esperandoHumano)) return false;
      if (opts.estado === "bot" && (c.modo !== "bot" || c.esperandoHumano)) return false;
      if (!busqueda) return true;
      return (
        c.contacto.toLocaleLowerCase("es").includes(busqueda) ||
        c.ultimoMensaje.toLocaleLowerCase("es").includes(busqueda) ||
        (digitos.length > 0 && c.chatId.includes(digitos))
      );
    });
    const inicio = (pagina - 1) * porPagina;
    return {
      items: filtrados.slice(inicio, inicio + porPagina),
      totalFiltrado: filtrados.length,
      resumen,
    };
  }
  const filas = (filasR.data ?? []) as Record<string, unknown>[];
  const resumenRaw = (Array.isArray(resumenR.data) ? resumenR.data[0] : resumenR.data) as
    | Record<string, unknown>
    | null;
  const resumen: ResumenConversaciones = {
    total: Number(resumenRaw?.total ?? 0),
    espera: Number(resumenRaw?.espera ?? 0),
    humano: Number(resumenRaw?.humano ?? 0),
    bot: Number(resumenRaw?.bot ?? 0),
    etiquetas: (resumenRaw?.etiquetas as Record<string, number> | undefined) ?? {},
  };
  return {
    items: filas.map((f) => ({
      empleadoId: String(f.empleado_id ?? ""),
      empleadoNombre: String(f.empleado_nombre ?? ""),
      empleadoRol: String(f.empleado_rol ?? ""),
      chatId: String(f.chat_id ?? ""),
      contacto: String(f.contacto ?? ""),
      ultimoMensaje: String(f.ultimo_mensaje ?? ""),
      ultimoEn: String(f.ultimo_en ?? ""),
      ultimoRol: String(f.ultimo_rol ?? "cliente"),
      mensajes: Number(f.mensajes ?? 0),
      modo: String(f.modo ?? "bot"),
      esperandoHumano: Boolean(f.esperando_humano),
      etiquetas: (f.etiquetas as string[] | null) ?? [],
    })),
    totalFiltrado: Number(filas[0]?.total ?? 0),
    resumen,
  };
}

/** Compatibilidad interna acotada; la UI usa listarConversacionesPagina. */
export async function listarConversaciones(
  clienteId: string,
): Promise<ItemConversacion[]> {
  const supa = db();
  const empleados = await empleadosDe(clienteId);
  if (!empleados.length) return [];

  const ids = empleados.map((e) => e.id as string);
  const porId = new Map(empleados.map((e) => [e.id as string, e]));

  /**
   * BANDEJA — se arma desde ed_contactos, no recorriendo los mensajes.
   *
   * Antes esta consulta traía los 4.000 mensajes más recientes y los agrupaba
   * por chat en JavaScript. Tenía dos problemas, y el segundo era grave:
   *
   *  1. Lento y creciente: transferir miles de filas en cada carga.
   *  2. PERDÍA CONVERSACIONES. Al pasar los 4.000 mensajes en total, cualquier
   *     conversación cuyo último mensaje quedara fuera de esa ventana
   *     simplemente desaparecía de la bandeja, sin aviso. Se detectó con la base
   *     al 39% de ese límite.
   *
   * Ahora el último mensaje, su rol y el empleado que atiende vienen mantenidos
   * por la base (migración 250): una consulta, tiempo constante, y ninguna
   * conversación se pierde por antigua que sea.
   */
  const [contactos, estados, escalaciones] = await Promise.all([
    supa
      .from("ed_contactos")
      .select(
        "chat_id, nombre, etiqueta, etiquetas, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol, ultimo_empleado_id, total_mensajes",
      )
      .eq("cliente_id", clienteId)
      .not("ultimo_mensaje_en", "is", null)
      .order("ultimo_mensaje_en", { ascending: false })
      .limit(100),
    supa
      .from("ed_chat_estado")
      .select("empleado_id, chat_id, modo")
      .in("empleado_id", ids)
      .limit(500),
    supa
      .from("ed_escalaciones")
      .select("empleado_id, chat_id, atendida_en")
      .in("empleado_id", ids)
      .is("atendida_en", null)
      .limit(500),
  ]);

  const modoPorChat = new Map(
    (estados.data ?? []).map((e) => [`${e.empleado_id}|${e.chat_id}`, e.modo as string]),
  );
  const pendientes = new Set(
    (escalaciones.data ?? []).map((e) => `${e.empleado_id}|${e.chat_id}`),
  );

  const lista: ItemConversacion[] = [];
  for (const c of contactos.data ?? []) {
    const chatId = c.chat_id as string;
    // El empleado que atiende viene del resumen; si faltara (contacto anterior
    // al trigger), se usa el principal para no dejar la fila sin enlace.
    const empId = ((c.ultimo_empleado_id as string) ?? ids[0]) as string;
    const emp = porId.get(empId);
    if (!emp) continue;
    const clave = `${empId}|${chatId}`;
    lista.push({
      empleadoId: empId,
      empleadoNombre: (emp.nombre_publico as string) ?? "",
      empleadoRol: emp.rol as string,
      chatId,
      contacto: (c.nombre as string) || `+${chatId}`,
      ultimoMensaje: (c.ultimo_mensaje_texto as string) ?? "",
      ultimoEn: (c.ultimo_mensaje_en as string) ?? "",
      ultimoRol: (c.ultimo_mensaje_rol as string) ?? "cliente",
      mensajes: (c.total_mensajes as number) ?? 0,
      modo: modoPorChat.get(clave) ?? "bot",
      esperandoHumano: pendientes.has(clave),
      etiquetas: ((c.etiquetas as string[] | null) ?? []),
    });
  }

  /**
   * ORDEN: SIEMPRE de la más reciente a la más antigua. Sin excepciones.
   *
   * Antes esto subía primero las que esperaban a una persona y recién dentro de
   * cada grupo ordenaba por fecha. La intención era buena —lo urgente arriba—
   * pero el resultado rompía lo único que la gente da por sentado en una
   * bandeja: que lo de más arriba es lo más nuevo.
   *
   * Medido con datos reales el 31-jul: una conversación de las 20:49 y otra de
   * las 20:20 aparecían DEBAJO de otras de las 17:50, 16:45 y 10:30. Marcelo
   * abrió la bandeja buscando una conversación recién ocurrida y creyó que
   * faltaba. Una bandeja en la que hay que buscar el mensaje más nuevo deja de
   * ser una bandeja.
   *
   * Lo urgente no se perdió: sigue marcado en coral en cada fila y tiene su
   * propia pestaña ("Te esperan"). Para eso está el filtro — no hacía falta
   * torcer el orden, que es el contrato implícito de la pantalla.
   */
  return lista.sort((a, b) => b.ultimoEn.localeCompare(a.ultimoEn));
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

  const [mensajes, contacto, estado, escalacion, resultados, ventana] = await Promise.all([
    /**
     * Tramo reciente, con id, adjunto y estado de entrega.
     *
     * BAJÓ DE 500 A 60 MENSAJES (21-ago-2026). Quinientos era cargar la vida
     * entera del chat en el HTML de la página: pesado de servir, lento de
     * hidratar y casi todo invisible. Sesenta llena la pantalla con margen, y
     * lo anterior se pide con "ver mensajes anteriores" cuando hace falta.
     */
    ultimosMensajes(supa, { empleadoId, chatId, limite: 60 }),
    supa
      .from("ed_contactos")
      .select("nombre, telefono, etiqueta, etiquetas, etapa, total_mensajes, primer_mensaje_en, notas")
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
    // Iba suelta al final, en serie. Es una consulta más que puede viajar junto
    // a las otras cinco en vez de sumar su latencia a la de todas.
    estadoVentana(empleadoId, chatId),
  ]);

  if (!mensajes.length) return null;

  return {
    chatId,
    contacto: (contacto.data?.nombre as string) ?? `+${chatId}`,
    telefono: (contacto.data?.telefono as string) ?? null,
    etiqueta: (contacto.data?.etiqueta as string) ?? null,
    empleadoNombre: (emp.nombre_publico as string) ?? "",
    empleadoRol: emp.rol as string,
    modo: (estado.data?.modo as string) ?? "bot",
    mensajes,
    escalacion: escalacion.data
      ? {
          trigger: escalacion.data.trigger as string,
          resumen: escalacion.data.resumen as string,
          atendida: Boolean(escalacion.data.atendida_en),
        }
      : null,
    resultados: (resultados.data ?? []).map((r) => r.tipo as string),
    etiquetas: ((contacto.data?.etiquetas as string[] | null) ?? []),
    ventana,
    etapa: (contacto.data?.etapa as string) ?? "nuevo",
    // Si el resumen todavía no existe (contacto anterior al trigger), se cae al
    // largo del hilo que ya se trajo: nunca un 0 que parezca un dato real.
    mensajesTotal: (contacto.data?.total_mensajes as number) || mensajes.length,
    clienteDesde: (contacto.data?.primer_mensaje_en as string) ?? null,
    notas: (contacto.data?.notas as string) ?? null,
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
