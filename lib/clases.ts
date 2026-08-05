import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { horaChileAUtc, fechaChileDe } from "@/lib/agendaCore";

/**
 * CLASES GRUPALES CON CUPO — pilates, crossfit, spinning, yoga.
 *
 * La diferencia con la agenda 1:1 no es de tamaño, es de modelo: en una hora
 * de barbería la regla es que nada se solape; en una clase, el solape ES el
 * producto. Doce personas ocupan el mismo bloque a propósito.
 *
 * Por eso la sesión existe como entidad (ed_clases) y la inscripción es una
 * fila de ed_citas que apunta a ella. Reutilizar ed_citas no es una economía:
 * hace que recordatorios, encuesta de postventa, cancelación y ficha del
 * cliente funcionen igual para una clase que para una hora, sin escribir nada
 * nuevo ni tener dos formas de cancelar.
 *
 * EL ALUMNO NO TIENE CUENTA. Su identidad es el teléfono. Ver el comentario de
 * la migración 260.
 *
 * Requiere: migración 260 aplicada.
 */

export type Clase = {
  id: string;
  servicioId: string;
  servicioNombre: string;
  profesionalId: string;
  profesionalNombre: string;
  inicio: string;
  fin: string;
  cupoMaximo: number;
  cupoOcupado: number;
  /** Lo que de verdad le importa a quien mira: cuántos quedan. */
  lugaresLibres: number;
  estado: string;
};

type FilaClase = {
  id: string;
  servicio_id: string;
  profesional_id: string;
  inicio: string;
  fin: string;
  cupo_maximo: number;
  cupo_ocupado: number;
  estado: string;
  ed_servicios?: { nombre?: string } | null;
  ed_profesionales?: { nombre?: string } | null;
};

function aClase(f: FilaClase): Clase {
  const max = f.cupo_maximo ?? 0;
  const ocup = f.cupo_ocupado ?? 0;
  return {
    id: f.id,
    servicioId: f.servicio_id,
    servicioNombre: f.ed_servicios?.nombre ?? "Clase",
    profesionalId: f.profesional_id,
    profesionalNombre: f.ed_profesionales?.nombre ?? "",
    inicio: f.inicio,
    fin: f.fin,
    cupoMaximo: max,
    cupoOcupado: ocup,
    lugaresLibres: Math.max(0, max - ocup),
    estado: f.estado,
  };
}

/**
 * ¿Este negocio usa clases? Se responde mirando si tiene alguna programada.
 *
 * Importa para no cambiarle la experiencia a quien no las usa: una barbería no
 * debe ver jamás la palabra "cupo" ni una lista de sesiones. La agenda 1:1
 * sigue funcionando exactamente igual que antes de esta migración.
 *
 * Defensivo a propósito: si la 260 todavía no está aplicada, devuelve false y
 * el portal se comporta como siempre en vez de romperse.
 */
export async function usaClases(
  clienteId: string,
  supaOpt?: SupabaseClient,
): Promise<boolean> {
  try {
    const { count, error } = await (supaOpt ?? db())
      .from("ed_clases")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", clienteId)
      .eq("estado", "activa");
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Próximas clases con lugares disponibles — lo que se le ofrece a quien quiere
 * reservar, por WhatsApp o desde la página pública.
 *
 * Solo futuras y solo activas. Por defecto NO muestra las llenas: ofrecerle a
 * alguien una clase sin lugares es hacerle perder el tiempo. Se puede pedir
 * todas para el calendario del dueño, que sí necesita ver las llenas.
 */
export async function proximasClases(
  clienteId: string,
  opts?: {
    dias?: number;
    servicioId?: string;
    incluirLlenas?: boolean;
    limite?: number;
    supa?: SupabaseClient;
  },
): Promise<Clase[]> {
  try {
    const supa = opts?.supa ?? db();
    const hasta = new Date(Date.now() + (opts?.dias ?? 21) * 86400_000).toISOString();

    let q = supa
      .from("ed_clases")
      .select(
        "id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado, estado, ed_servicios(nombre), ed_profesionales(nombre)",
      )
      .eq("cliente_id", clienteId)
      .eq("estado", "activa")
      .gt("inicio", new Date().toISOString())
      .lte("inicio", hasta)
      .order("inicio", { ascending: true })
      .limit(opts?.limite ?? 60);

    if (opts?.servicioId) q = q.eq("servicio_id", opts.servicioId);

    const { data, error } = await q;
    if (error) return [];

    const clases = (data ?? []).map((f) => aClase(f as unknown as FilaClase));
    return opts?.incluirLlenas ? clases : clases.filter((c) => c.lugaresLibres > 0);
  } catch {
    return [];
  }
}

/** Clases de un rango, para el calendario del portal (incluye las llenas). */
export async function clasesEntre(
  clienteId: string,
  desde: Date,
  hasta: Date,
  supaOpt?: SupabaseClient,
): Promise<Clase[]> {
  try {
    const { data, error } = await (supaOpt ?? db())
      .from("ed_clases")
      .select(
        "id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado, estado, ed_servicios(nombre), ed_profesionales(nombre)",
      )
      .eq("cliente_id", clienteId)
      .gte("inicio", desde.toISOString())
      .lte("inicio", hasta.toISOString())
      .order("inicio", { ascending: true });
    if (error) return [];
    return (data ?? []).map((f) => aClase(f as unknown as FilaClase));
  } catch {
    return [];
  }
}

/** Por qué no se pudo inscribir. Se distinguen para poder decirle algo útil a
    la persona: "esa clase ya se llenó" no es lo mismo que "esa clase se canceló". */
export type MotivoRechazo = "no_existe" | "cancelada" | "ya_paso" | "cupo_tomado" | "error";

export type ResultadoInscripcion =
  | { ok: true; citaId: string; clase: { cupoOcupado: number; cupoMaximo: number } }
  | { ok: false; motivo: MotivoRechazo };

/**
 * INSCRIBIR A UNA PERSONA. Toda la lógica delicada vive en la base.
 *
 * Se llama a la función `ed_inscribir_en_clase` en vez de hacer
 * "leer cupo → decidir → insertar" desde acá, porque entre esos tres pasos hay
 * una ventana en la que otro se lleva el último lugar. Con dos personas
 * tocando "reservar" en el mismo segundo —que es justo lo que pasa cuando el
 * gimnasio publica los horarios de la semana— esa ventana se abre de verdad.
 */
export async function inscribirEnClase(params: {
  claseId: string;
  clienteId: string;
  nombre: string;
  telefono?: string | null;
  chatId?: string | null;
  origen?: "web" | "whatsapp" | "portal";
  empleadoId?: string | null;
  supa?: SupabaseClient;
}): Promise<ResultadoInscripcion> {
  try {
    const { data, error } = await (params.supa ?? db()).rpc("ed_inscribir_en_clase", {
      p_clase_id: params.claseId,
      p_cliente_id: params.clienteId,
      p_nombre: params.nombre,
      p_telefono: params.telefono ?? null,
      p_chat_id: params.chatId ?? null,
      p_origen: params.origen ?? "web",
      p_empleado_id: params.empleadoId ?? null,
    });

    if (error) {
      console.error("[clases] inscripción falló:", error.message);
      return { ok: false, motivo: "error" };
    }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r) return { ok: false, motivo: "error" };
    if (r.ok) {
      return {
        ok: true,
        citaId: r.cita_id as string,
        clase: { cupoOcupado: r.cupo_ocupado as number, cupoMaximo: r.cupo_maximo as number },
      };
    }
    return { ok: false, motivo: (r.motivo as MotivoRechazo) ?? "error" };
  } catch (e) {
    console.error("[clases] inscripción reventó:", e);
    return { ok: false, motivo: "error" };
  }
}

/**
 * Crea una sesión. El cupo lo define el dueño, no el servicio: la misma clase
 * de pilates puede tener 8 lugares en la sala chica y 14 en la grande.
 */
export async function crearClase(params: {
  clienteId: string;
  servicioId: string;
  profesionalId: string;
  inicio: Date;
  fin: Date;
  cupoMaximo: number;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const supa = params.supa ?? db();
  if (
    !Number.isFinite(params.cupoMaximo) ||
    params.cupoMaximo < 1 ||
    params.cupoMaximo > 500 ||
    !Number.isFinite(params.inicio.getTime()) ||
    !Number.isFinite(params.fin.getTime()) ||
    params.inicio >= params.fin
  ) {
    return { ok: false, error: "Datos de la clase inválidos." };
  }

  // Los UUID vienen del formulario. Validarlos por tenant evita relaciones
  // cruzadas (clase de A apuntando al servicio/profesional de B) que las FK
  // simples no alcanzan a impedir.
  const [{ data: servicio }, { data: profesional }] = await Promise.all([
    supa
      .from("ed_servicios")
      .select("id")
      .eq("id", params.servicioId)
      .eq("cliente_id", params.clienteId)
      .eq("activo", true)
      .maybeSingle(),
    supa
      .from("ed_profesionales")
      .select("id")
      .eq("id", params.profesionalId)
      .eq("cliente_id", params.clienteId)
      .eq("activo", true)
      .maybeSingle(),
  ]);
  if (!servicio || !profesional) {
    return { ok: false, error: "Servicio o profesional no pertenece al negocio." };
  }

  const { data, error } = await supa
    .from("ed_clases")
    .insert({
      cliente_id: params.clienteId,
      servicio_id: params.servicioId,
      profesional_id: params.profesionalId,
      inicio: params.inicio.toISOString(),
      fin: params.fin.toISOString(),
      cupo_maximo: params.cupoMaximo,
    })
    .select("id")
    .single();

  if (error) {
    // 23P01 = el profesional ya tiene otra clase encimada a esa hora.
    if (error.code === "23P01") {
      return { ok: false, error: "Ese profesional ya tiene una clase a esa hora." };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id as string };
}

/**
 * Genera las sesiones de varias semanas de un tirón.
 *
 * Sin esto, un gimnasio con seis clases al día tendría que crear 180 sesiones
 * a mano cada mes, y no lo haría: dejaría la agenda vacía y el asistente no
 * tendría nada que ofrecer. Es la diferencia entre que la función se use o no.
 *
 * Las que choquen con otra clase del mismo profesional se saltan y se informan,
 * en vez de abortar todo: si la semana 3 tiene un feriado ya bloqueado, las
 * otras siete semanas igual se crean.
 */
export async function generarSerie(params: {
  clienteId: string;
  servicioId: string;
  profesionalId: string;
  /** 0=domingo … 6=sábado */
  diasSemana: number[];
  hora: string; // "19:00"
  duracionMin: number;
  cupoMaximo: number;
  semanas: number;
  supa?: SupabaseClient;
}): Promise<{ creadas: number; omitidas: number; detalle: string[] }> {
  const detalle: string[] = [];
  let creadas = 0;
  let omitidas = 0;

  const [h, m] = params.hora.split(":").map(Number);

  /**
   * TODO EL CÁLCULO EN HORA DE CHILE, NUNCA CON setHours.
   *
   * BUG REAL (2-ago-2026): la primera versión usaba `d.setHours(19, 0)`, que
   * aplica la zona horaria DEL SERVIDOR. Vercel corre en UTC, así que "19:00"
   * quedaba guardado como 19:00 UTC — o sea las 15:00 en Chile. Marcelo pidió
   * clases a las 19:00 y aparecieron a las 15:00, cuatro horas antes.
   *
   * El detalle traicionero: en el equipo de desarrollo, con reloj chileno,
   * funcionaba perfecto. Solo fallaba desplegado.
   *
   * `horaChileAUtc` hace la conversión bien e incluye el cambio de horario de
   * septiembre y abril, así que una serie que cruza esa fecha mantiene la hora
   * de pared en todas sus sesiones.
   */
  // Mediodía como ancla para recorrer días de calendario: lejos de cualquier
  // salto de horario, así sumar 24 h nunca cae en el día equivocado.
  const hoyCl = fechaChileDe(new Date());
  const ancla = horaChileAUtc(hoyCl.anio, hoyCl.mes, hoyCl.dia, 12, 0).getTime();

  for (let dias = 0; dias <= params.semanas * 7; dias++) {
    const cl = fechaChileDe(new Date(ancla + dias * 86400_000));
    if (!params.diasSemana.includes(cl.diaSemana)) continue;

    const inicio = horaChileAUtc(cl.anio, cl.mes, cl.dia, h ?? 0, m ?? 0);
    if (inicio.getTime() <= Date.now()) continue; // no se programa hacia atrás

    const fin = new Date(inicio.getTime() + params.duracionMin * 60_000);
    const r = await crearClase({
      clienteId: params.clienteId,
      servicioId: params.servicioId,
      profesionalId: params.profesionalId,
      inicio,
      fin,
      cupoMaximo: params.cupoMaximo,
      supa: params.supa,
    });
    if (r.ok) creadas++;
    else {
      omitidas++;
      detalle.push(
        `${inicio.toLocaleString("es-CL", { timeZone: "America/Santiago" })}: ${r.error}`,
      );
    }
  }
  return { creadas, omitidas, detalle };
}

/**
 * Cancela una sesión completa. Las inscripciones quedan canceladas y el trigger
 * de la migración 260 devuelve los cupos solo.
 *
 * A quién avisarle queda FUERA de esta función a propósito: mandar mensajes es
 * responsabilidad del motor de seguimientos, y mezclarlo acá haría que cancelar
 * desde el portal se quedara esperando a que salgan doce WhatsApps.
 */
export async function cancelarClase(
  clienteId: string,
  claseId: string,
  supaOpt?: SupabaseClient,
): Promise<{ ok: boolean; inscritos: number }> {
  const supa = supaOpt ?? db();

  const { data: inscripciones } = await supa
    .from("ed_citas")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("clase_id", claseId)
    .in("estado", ["agendada", "confirmada", "reagendada"]);

  await supa
    .from("ed_citas")
    .update({ estado: "cancelada", actualizado_en: new Date().toISOString() })
    .eq("cliente_id", clienteId)
    .eq("clase_id", claseId)
    .in("estado", ["agendada", "confirmada", "reagendada"]);

  const { error } = await supa
    .from("ed_clases")
    .update({ estado: "cancelada", actualizado_en: new Date().toISOString() })
    .eq("cliente_id", clienteId)
    .eq("id", claseId);

  return { ok: !error, inscritos: (inscripciones ?? []).length };
}

/** Quiénes están inscritos, para la lista que el profesor mira antes de empezar. */
export async function inscritosDeClase(
  clienteId: string,
  claseId: string,
  supaOpt?: SupabaseClient,
): Promise<{ nombre: string; telefono: string | null; estado: string }[]> {
  const { data } = await (supaOpt ?? db())
    .from("ed_citas")
    .select("nombre_contacto, telefono, estado")
    .eq("cliente_id", clienteId)
    .eq("clase_id", claseId)
    .order("creado_en", { ascending: true });
  return (data ?? []).map((c) => ({
    nombre: (c.nombre_contacto as string) ?? "",
    telefono: (c.telefono as string) ?? null,
    estado: (c.estado as string) ?? "agendada",
  }));
}

/** "Mar 5 · 19:00 · quedan 3" — cómo se lee una clase en una lista. */
export function etiquetaClase(c: Clase): string {
  const f = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(c.inicio));
  const libres =
    c.lugaresLibres === 0
      ? "sin cupos"
      : c.lugaresLibres === 1
        ? "queda 1"
        : `quedan ${c.lugaresLibres}`;
  return `${f} · ${libres}`;
}
