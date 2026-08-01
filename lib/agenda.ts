import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computarSlots,
  type Ocupado,
  type Slot,
  type VentanaSemanal,
} from "@/lib/agendaCore";
import { ocupadosDesdeGoogle, sincronizarCita, quitarCitaDeGoogle } from "@/lib/agendaGoogle";

/**
 * CAPA DE DATOS del módulo de agenda (F0) — el contrato "AccionesAgenda".
 *
 * Esta interfaz es la que en F2 consumirá el cerebro de los empleados y en F6
 * reimplementará el adaptador AgendaPro. Requiere la migración 220_agenda.sql
 * aplicada; si no está aplicada, las funciones devuelven error controlado (no
 * lanzan) — nada del flujo actual la llama todavía, así que el portal y Tino
 * siguen exactamente igual hasta que las fases siguientes la enchufen.
 *
 * PATRONES DEL PORTAL QUE SE RESPETAN:
 *  - Toda query filtra por cliente_id (aislamiento multi-cliente por código).
 *  - `supa` inyectable (mismo estilo que lib/seguimientos.ts) para tests.
 *  - La doble reserva NO se previene con "leer y luego insertar": la previene
 *    el constraint EXCLUDE de ed_citas. Aquí solo se traduce el error 23P01
 *    (exclusion_violation) a un resultado de negocio: 'cupo_tomado'.
 */

export type Servicio = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracion_min: number;
  precio_clp: number | null;
  cupo: number;
  requiere_abono: boolean;
  activo: boolean;
  orden: number;
};

export type Cita = {
  id: string;
  cliente_id: string;
  servicio_id: string;
  profesional_id: string;
  chat_id: string | null;
  nombre_contacto: string;
  telefono: string | null;
  inicio: string;
  fin: string;
  estado: string;
  origen: string;
  empleado_id: string | null;
  notas: string | null;
};

export type ResultadoCita =
  | { ok: true; cita: Cita }
  | { ok: false; motivo: "cupo_tomado" | "servicio_invalido" | "profesional_invalido" | "error"; detalle?: string };

const ESTADOS_ACTIVOS = ["agendada", "confirmada", "reagendada"];

/** Código Postgres de exclusion_violation (el EXCLUDE de ed_citas). */
const EXCLUSION_VIOLATION = "23P01";

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function listarServicios(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<Servicio[]> {
  const { data } = await supa
    .from("ed_servicios")
    .select("id, nombre, descripcion, duracion_min, precio_clp, cupo, requiere_abono, activo, orden")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("orden", { ascending: true });
  return (data ?? []) as Servicio[];
}

/** Citas activas (futuras) de un contacto de WhatsApp de este cliente. */
export async function citasDe(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<Cita[]> {
  const { data } = await supa
    .from("ed_citas")
    .select("*")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .in("estado", ESTADOS_ACTIVOS)
    .gte("fin", new Date().toISOString())
    .order("inicio", { ascending: true });
  return (data ?? []) as Cita[];
}

/**
 * Cupos disponibles para un servicio del cliente.
 * Config del cliente (anticipación/horizonte) sale de ed_clientes; los
 * profesionales, de ed_servicio_profesional (o todos los activos si el
 * servicio no está mapeado a nadie).
 */
export async function disponibilidad(
  clienteId: string,
  servicioId: string,
  opts: { ahora?: Date; maxSlots?: number; supa?: SupabaseClient } = {},
): Promise<{ ok: true; servicio: Servicio; slots: Slot[] } | { ok: false; motivo: string }> {
  const supa = opts.supa ?? db();
  const ahora = opts.ahora ?? new Date();

  const { data: servicio } = await supa
    .from("ed_servicios")
    .select("id, nombre, descripcion, duracion_min, precio_clp, cupo, requiere_abono, activo, orden")
    .eq("id", servicioId)
    .eq("cliente_id", clienteId) // barrera de acceso
    .eq("activo", true)
    .maybeSingle();
  if (!servicio) return { ok: false, motivo: "servicio_invalido" };

  const { data: cfg } = await supa
    .from("ed_clientes")
    .select("anticipacion_min_horas, horizonte_dias")
    .eq("id", clienteId)
    .maybeSingle();
  const anticipacionMin = (cfg?.anticipacion_min_horas ?? 2) * 60;
  const dias = cfg?.horizonte_dias ?? 30;

  // Profesionales que atienden este servicio (o todos los activos del cliente).
  const { data: mapeo } = await supa
    .from("ed_servicio_profesional")
    .select("profesional_id")
    .eq("servicio_id", servicioId);
  let profesionalIds = (mapeo ?? []).map((m) => m.profesional_id as string);
  if (profesionalIds.length === 0) {
    const { data: todos } = await supa
      .from("ed_profesionales")
      .select("id")
      .eq("cliente_id", clienteId)
      .eq("activo", true);
    profesionalIds = (todos ?? []).map((p) => p.id as string);
  }
  if (profesionalIds.length === 0) return { ok: false, motivo: "sin_profesionales" };

  const hastaIso = new Date(ahora.getTime() + dias * 86_400_000).toISOString();
  const ahoraIso = ahora.toISOString();

  const [{ data: horarios }, { data: bloqueos }, { data: citas }] = await Promise.all([
    supa
      .from("ed_horarios")
      .select("profesional_id, dia_semana, desde, hasta")
      .in("profesional_id", profesionalIds),
    supa
      .from("ed_bloqueos")
      .select("profesional_id, desde, hasta")
      .eq("cliente_id", clienteId)
      .lt("desde", hastaIso)
      .gt("hasta", ahoraIso),
    supa
      .from("ed_citas")
      .select("profesional_id, inicio, fin")
      .in("profesional_id", profesionalIds)
      .in("estado", ESTADOS_ACTIVOS)
      .lt("inicio", hastaIso)
      .gt("fin", ahoraIso),
  ]);

  const ventanas: VentanaSemanal[] = (horarios ?? []).map((h) => ({
    profesionalId: h.profesional_id as string,
    diaSemana: h.dia_semana as number,
    // Postgres devuelve time como "10:00:00" — parseHHMM del núcleo toma HH:MM.
    desde: String(h.desde).slice(0, 5),
    hasta: String(h.hasta).slice(0, 5),
  }));

  // Compromisos personales del dueño en SU Google Calendar (F5). Devuelve []
  // si no hay credenciales o si nadie tiene la sincronización encendida, así
  // que la disponibilidad se calcula igual que siempre en ese caso.
  const ocupadosGoogle = await ocupadosDesdeGoogle(profesionalIds, ahoraIso, hastaIso, supa);

  const ocupados: Ocupado[] = [
    ...(bloqueos ?? []).map((b) => ({
      profesionalId: (b.profesional_id as string | null) ?? null,
      desde: b.desde as string,
      hasta: b.hasta as string,
    })),
    ...(citas ?? []).map((c) => ({
      profesionalId: c.profesional_id as string,
      desde: c.inicio as string,
      hasta: c.fin as string,
    })),
    ...ocupadosGoogle,
  ];

  const slots = computarSlots({
    ahora,
    dias,
    ventanas,
    ocupados,
    duracionMin: (servicio as Servicio).duracion_min,
    anticipacionMin,
    maxSlots: opts.maxSlots ?? 60,
  });

  return { ok: true, servicio: servicio as Servicio, slots };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

export async function crearCita(
  params: {
    clienteId: string;
    servicioId: string;
    profesionalId: string;
    inicioIso: string;
    nombreContacto: string;
    chatId?: string;
    telefono?: string;
    origen: "whatsapp" | "web" | "portal" | "importada";
    empleadoId?: string;
    notas?: string;
    estado?: "agendada" | "confirmada";
  },
  supa: SupabaseClient = db(),
): Promise<ResultadoCita> {
  // Validaciones de pertenencia (nunca confiar en ids que vienen de afuera).
  const { data: servicio } = await supa
    .from("ed_servicios")
    .select("id, duracion_min, activo")
    .eq("id", params.servicioId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();
  if (!servicio || !servicio.activo) return { ok: false, motivo: "servicio_invalido" };

  const { data: prof } = await supa
    .from("ed_profesionales")
    .select("id, activo")
    .eq("id", params.profesionalId)
    .eq("cliente_id", params.clienteId)
    .maybeSingle();
  if (!prof || !prof.activo) return { ok: false, motivo: "profesional_invalido" };

  const inicio = new Date(params.inicioIso);
  if (Number.isNaN(inicio.getTime())) return { ok: false, motivo: "error", detalle: "inicio inválido" };
  const fin = new Date(inicio.getTime() + (servicio.duracion_min as number) * 60_000);

  // Insert directo: la atomicidad la da el EXCLUDE de ed_citas. Si otro canal
  // ganó la carrera por este cupo, Postgres responde 23P01 y se traduce.
  const { data, error } = await supa
    .from("ed_citas")
    .insert({
      cliente_id: params.clienteId,
      servicio_id: params.servicioId,
      profesional_id: params.profesionalId,
      chat_id: params.chatId ?? null,
      nombre_contacto: params.nombreContacto,
      telefono: params.telefono ?? params.chatId ?? null,
      inicio: inicio.toISOString(),
      fin: fin.toISOString(),
      estado: params.estado ?? "agendada",
      origen: params.origen,
      empleado_id: params.empleadoId ?? null,
      notas: params.notas ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) return { ok: false, motivo: "cupo_tomado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }

  // Espejo en el Google Calendar del profesional (F5) — best-effort: si falla
  // o no está configurado, la cita ya quedó creada igual.
  const cita = data as Cita;
  const { data: svc } = await supa
    .from("ed_servicios")
    .select("nombre")
    .eq("id", params.servicioId)
    .maybeSingle();
  await sincronizarCita(cita, (svc?.nombre as string) ?? "Hora reservada", supa);

  return { ok: true, cita };
}

export async function reagendar(
  clienteId: string,
  citaId: string,
  nuevoInicioIso: string,
  supa: SupabaseClient = db(),
): Promise<ResultadoCita> {
  const { data: cita } = await supa
    .from("ed_citas")
    .select("*, ed_servicios(duracion_min)")
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!cita) return { ok: false, motivo: "error", detalle: "cita no encontrada" };

  const dur = ((cita as { ed_servicios?: { duracion_min?: number } }).ed_servicios?.duracion_min ?? 30) * 60_000;
  const inicio = new Date(nuevoInicioIso);
  if (Number.isNaN(inicio.getTime())) return { ok: false, motivo: "error", detalle: "inicio inválido" };

  const { data, error } = await supa
    .from("ed_citas")
    .update({
      inicio: inicio.toISOString(),
      fin: new Date(inicio.getTime() + dur).toISOString(),
      estado: "reagendada",
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .select("*")
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) return { ok: false, motivo: "cupo_tomado" };
    return { ok: false, motivo: "error", detalle: error.message };
  }

  const actualizada = data as Cita;
  const { data: svc2 } = await supa
    .from("ed_servicios")
    .select("nombre")
    .eq("id", actualizada.servicio_id)
    .maybeSingle();
  // El evento de Google usa un id derivado del id de la cita, así que esto
  // MUEVE el evento existente en vez de duplicarlo.
  await sincronizarCita(actualizada, (svc2?.nombre as string) ?? "Hora reservada", supa);

  return { ok: true, cita: actualizada };
}

export async function cambiarEstado(
  clienteId: string,
  citaId: string,
  estado: "confirmada" | "cancelada" | "no_show" | "completada",
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supa
    .from("ed_citas")
    .update({ estado, actualizado_en: new Date().toISOString() })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .select("id, profesional_id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  // Si la hora se cae, sacarla también del calendario del dueño (F5).
  if (data && (estado === "cancelada" || estado === "no_show")) {
    await quitarCitaDeGoogle(data.id as string, data.profesional_id as string, supa);
  }
  return { ok: true };
}

/**
 * Devuelve una cita a "agendada" — el deshacer de Cancelar / No llegó /
 * Completada. Sin esto, un clic equivocado dejaba la cita en un callejón sin
 * salida (todos los botones desaparecían).
 *
 * Vive acá y no como un update suelto en la Server Action porque una cita
 * cancelada YA SE BORRÓ del Google Calendar del dueño (ver `cambiarEstado`):
 * reabrirla tiene que volver a escribir el evento, si no, el portal y Google
 * quedan desincronizados en silencio — la cita reaparece en la agenda del
 * negocio pero el dueño no la ve en su calendario.
 *
 * Puede fallar si en el intertanto otra persona tomó ese cupo: en ese caso el
 * constraint de la base lo impide (23P01) y la cita se queda como está.
 */
export async function reabrirCita(
  clienteId: string,
  citaId: string,
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; error?: string; motivo?: "cupo_tomado" }> {
  const { data, error } = await supa
    .from("ed_citas")
    .update({ estado: "agendada", actualizado_en: new Date().toISOString() })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .select("*")
    .maybeSingle();
  if (error) {
    if (error.code === EXCLUSION_VIOLATION) return { ok: false, motivo: "cupo_tomado" };
    return { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "cita no encontrada" };

  const cita = data as Cita;
  const { data: svc } = await supa
    .from("ed_servicios")
    .select("nombre")
    .eq("id", cita.servicio_id)
    .maybeSingle();
  // El evento de Google usa un id derivado del id de la cita: esto lo vuelve
  // a crear, no lo duplica.
  await sincronizarCita(cita, (svc?.nombre as string) ?? "Hora reservada", supa);

  return { ok: true };
}
