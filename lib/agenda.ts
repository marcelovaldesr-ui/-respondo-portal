import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computarSlots,
  diaChileDe,
  elegirProfesional,
  fechaChileDe,
  horaChileAUtc,
  type Ocupado,
  type Slot,
  type VentanaSemanal,
} from "@/lib/agendaCore";
import { ocupadosDesdeGoogle, sincronizarCita, quitarCitaDeGoogle } from "@/lib/agendaGoogle";
import { notificarHQ } from "@/lib/hqBridge";

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
 *  - Lo mismo aplica a la carrera cita↔bloqueo (auditoría 13-sep-2026, ver
 *    migración 308): un trigger en la base, no una lectura previa desde acá,
 *    es lo que impide que una cita caiga dentro de un bloqueo creado a la vez.
 *    Se traduce igual: código propio 'ED001' → 'cupo_tomado'.
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
  /** Minutos de preparación después de la hora (migración 277). */
  buffer_min: number;
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
  /**
   * Credencial del enlace de autogestión (migración 277). Puede venir null si
   * la migración todavía no se aplicó: quien la use debe tolerarlo.
   */
  gestion_token?: string | null;
};

export type ResultadoCita =
  | { ok: true; cita: Cita }
  | {
      ok: false;
      motivo:
        | "cupo_tomado"
        | "servicio_invalido"
        | "profesional_invalido"
        | "sin_profesionales"
        | "inscripcion_de_clase"
        | "error";
      detalle?: string;
    };

const ESTADOS_ACTIVOS = ["agendada", "confirmada", "reagendada"];

/** Fila mínima de ed_clases que necesita el cálculo de disponibilidad. */
type FilaClase = { profesional_id: string | null; inicio: string; fin: string };

/** Código Postgres de exclusion_violation (el EXCLUDE de ed_citas). */
const EXCLUSION_VIOLATION = "23P01";
/**
 * Código propio (migración 308, auditoría 13-sep-2026): el trigger
 * ed_citas_verificar_bloqueo rechazó el INSERT/UPDATE porque la cita cae
 * dentro de un bloqueo activo. Mismo tratamiento que EXCLUSION_VIOLATION —
 * para quien llama, ambos significan "ese cupo ya no está disponible".
 */
const BLOQUEO_VIOLATION = "ED001";

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

export async function listarServicios(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<Servicio[]> {
  const { data } = await supa
    .from("ed_servicios")
    .select("id, nombre, descripcion, duracion_min, precio_clp, cupo, requiere_abono, activo, orden, buffer_min")
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
export type OpcionesDisponibilidad = {
  ahora?: Date;
  supa?: SupabaseClient;
  /** Primer día chileno del cálculo (por defecto, hoy). Vista de mes. */
  desdeDia?: Date;
  /** Días a mirar. Se acota al horizonte que configuró el negocio. */
  dias?: number;
  /** Solo este profesional: el caso «quiero con Marcelo». */
  profesionalId?: string | null;
  /** Tope de cupos por día (la vista de mes solo necesita 1). */
  maxPorDia?: number;
  /** Basta con saber si el día tiene cupo. */
  soloPrimeroPorDia?: boolean;
  maxSlots?: number;
  /**
   * Incluir a los profesionales cuyo Google Calendar no se pudo comprobar.
   * Por defecto NO (regla de Fase 2, ver `noVerificables`). El portal puede
   * pedirlos para mostrarle al dueño lo que hay, avisando del problema.
   */
  incluirNoVerificables?: boolean;
};

export type ProfesionalDisponible = { id: string; nombre: string };

export type ResultadoDisponibilidad =
  | {
      ok: true;
      servicio: Servicio;
      slots: Slot[];
      /** Profesionales elegibles de este servicio, para el selector público. */
      profesionales: ProfesionalDisponible[];
      /**
       * Elegibles cuyo calendario de Google no se pudo comprobar AHORA. Sus
       * horas quedaron FUERA (salvo `incluirNoVerificables`): no sabemos si
       * están libres, y ofrecerlas es cómo se produce una doble reserva encima
       * del calendario personal del dueño.
       */
      noVerificables: ProfesionalDisponible[];
      /** Citas ya tomadas por profesional, para repartir carga al asignar. */
      carga: { porDia: Map<string, number>; total: Map<string, number> };
    }
  | { ok: false; motivo: string };

export async function disponibilidad(
  clienteId: string,
  servicioId: string,
  opts: OpcionesDisponibilidad = {},
): Promise<ResultadoDisponibilidad> {
  const supa = opts.supa ?? db();
  const ahora = opts.ahora ?? new Date();

  const { data: servicio } = await supa
    .from("ed_servicios")
    .select("id, nombre, descripcion, duracion_min, precio_clp, cupo, requiere_abono, activo, orden, buffer_min")
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
  const horizonte = cfg?.horizonte_dias ?? 30;
  /**
   * (Fase 2) El rango lo pide el llamador —un mes, un día— y el horizonte del
   * negocio lo acota. Antes el único freno era un tope de 120 CUPOS aplicado
   * después de mezclar profesionales: con tres profesionales, el calendario
   * público mostraba dos días de los treinta que el negocio tenía abiertos.
   */
  const desdeDia = opts.desdeDia ?? ahora;
  const diasYaPasados = Math.max(
    0,
    Math.round((mediodiaChile(desdeDia) - mediodiaChile(ahora)) / 86_400_000),
  );
  const dias = Math.max(0, Math.min(opts.dias ?? horizonte, horizonte - diasYaPasados));
  if (dias === 0) {
    const vacio = { porDia: new Map<string, number>(), total: new Map<string, number>() };
    return { ok: true, servicio: servicio as Servicio, slots: [], profesionales: [], noVerificables: [], carga: vacio };
  }

  // Nombre de cada profesional: se va llenando con las consultas que ya se
  // hacen, para no gastar una consulta extra solo en los nombres.
  const nombres = new Map<string, string>();

  // Profesionales que atienden este servicio (o todos los activos del cliente).
  const { data: mapeo } = await supa
    .from("ed_servicio_profesional")
    .select("profesional_id")
    .eq("servicio_id", servicioId);
  let profesionalIds = (mapeo ?? []).map((m) => m.profesional_id as string);
  /**
   * BARRERA ENTRE NEGOCIOS (Fase 0, 11-sep-2026). ed_servicio_profesional se
   * leía solo por servicio_id. El trigger de la 273 impide mapeos cruzados
   * NUEVOS, pero no borró los viejos: un servicio de A mapeado a un profesional
   * de B hacía que la página pública de A leyera las horas —y el Google
   * Calendar, con el token— del profesional de B. Se intersecta con los
   * profesionales del negocio, sin depender de que la 273 esté aplicada.
   */
  if (profesionalIds.length) {
    const { data: propios } = await supa
      .from("ed_profesionales")
      .select("id, nombre")
      .eq("cliente_id", clienteId)
      .in("id", profesionalIds);
    for (const p of propios ?? []) nombres.set(p.id as string, (p.nombre as string) ?? "");
    const deEsteNegocio = new Set((propios ?? []).map((p) => p.id as string));
    profesionalIds = profesionalIds.filter((id) => deEsteNegocio.has(id));
  }
  if (profesionalIds.length === 0) {
    const { data: todos } = await supa
      .from("ed_profesionales")
      .select("id, nombre")
      .eq("cliente_id", clienteId)
      .eq("activo", true);
    for (const p of todos ?? []) nombres.set(p.id as string, (p.nombre as string) ?? "");
    profesionalIds = (todos ?? []).map((p) => p.id as string);
  }
  if (profesionalIds.length === 0) return { ok: false, motivo: "sin_profesionales" };

  // «Quiero con Marcelo»: se filtra ACÁ, antes de consultar horarios y Google,
  // para no traer ni calcular lo que no se va a ofrecer.
  if (opts.profesionalId) {
    if (!profesionalIds.includes(opts.profesionalId)) return { ok: false, motivo: "profesional_invalido" };
    profesionalIds = [opts.profesionalId];
  }

  const desdeMs = mediodiaChile(desdeDia) - 12 * 3_600_000;
  const inicioRango = new Date(Math.max(desdeMs, ahora.getTime()));
  const hastaIso = new Date(mediodiaChile(desdeDia) + (dias - 1) * 86_400_000 + 12 * 3_600_000).toISOString();
  const ahoraIso = inicioRango.toISOString();

  const [{ data: horarios }, { data: bloqueos }, { data: citas }, { data: clases }] = await Promise.all([
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
    /**
     * CLASES GRUPALES (Fase 2). Una clase ocupa al profesional aunque todavía
     * no tenga inscritos: antes solo bloqueaban las inscripciones, así que una
     * clase de yoga recién programada y vacía seguía ofreciéndose como hora
     * personal a esa misma hora. Suave: si la migración 260 no está aplicada,
     * la agenda sigue funcionando igual que siempre.
     */
    (async () => {
      try {
        const r = await supa
          .from("ed_clases")
          .select("profesional_id, inicio, fin")
          .eq("cliente_id", clienteId)
          .eq("estado", "activa")
          .lt("inicio", hastaIso)
          .gt("fin", ahoraIso);
        return r.error ? { data: [] as FilaClase[] } : { data: (r.data ?? []) as unknown as FilaClase[] };
      } catch {
        return { data: [] as FilaClase[] };
      }
    })(),
  ]);

  const comoLista = (ids: readonly string[]): ProfesionalDisponible[] =>
    ids.map((id) => ({ id, nombre: nombres.get(id) ?? "" }));

  // Compromisos personales en el Google Calendar de cada profesional (F5).
  const { ocupados: ocupadosGoogle, noVerificables } = await ocupadosDesdeGoogle(
    profesionalIds,
    ahoraIso,
    hastaIso,
    supa,
    clienteId,
  );
  /**
   * REGLA DE SEGURIDAD (Fase 2): «no pude comprobar» ≠ «está libre».
   * Un profesional con sincronización encendida cuyo calendario no responde
   * queda fuera de la oferta hasta que se pueda verificar. Antes, cualquier
   * caída de Google convertía su día entero en horas ofrecidas.
   */
  const ofrecibles = opts.incluirNoVerificables
    ? profesionalIds
    : profesionalIds.filter((id) => !noVerificables.includes(id));

  const ventanas: VentanaSemanal[] = (horarios ?? [])
    .filter((h) => ofrecibles.includes(h.profesional_id as string))
    .map((h) => ({
      profesionalId: h.profesional_id as string,
      diaSemana: h.dia_semana as number,
      // Postgres devuelve time como "10:00:00" — parseHHMM toma HH:MM.
      desde: String(h.desde).slice(0, 5),
      hasta: String(h.hasta).slice(0, 5),
    }));

  const ocupados: Ocupado[] = [
    // Los bloqueos NO llevan preparación: si el negocio para 13-14 para
    // almorzar, la tarde parte a las 14:00 exactas (ver Ocupado.tipo).
    ...(bloqueos ?? []).map((b) => ({
      profesionalId: (b.profesional_id as string | null) ?? null,
      desde: b.desde as string,
      hasta: b.hasta as string,
      tipo: "bloqueo" as const,
    })),
    ...(citas ?? []).map((c) => ({
      profesionalId: c.profesional_id as string,
      desde: c.inicio as string,
      hasta: c.fin as string,
      tipo: "cita" as const,
    })),
    // Compromisos del calendario personal: son eventos ajenos a la agenda,
    // no citas nuestras — sin buffer.
    ...ocupadosGoogle.map((o) => ({ ...o, tipo: "bloqueo" as const })),
    // Clases programadas: el profesional está dando clase, tenga o no inscritos.
    ...(clases ?? [])
      .filter((c): c is FilaClase & { profesional_id: string } => typeof c.profesional_id === "string")
      .map((c) => ({
        profesionalId: c.profesional_id as string,
        desde: c.inicio as string,
        hasta: c.fin as string,
        tipo: "bloqueo" as const,
      })),
  ];

  const slots = computarSlots({
    ahora,
    desdeDia,
    dias,
    ventanas,
    ocupados,
    duracionMin: (servicio as Servicio).duracion_min,
    bufferMin: (servicio as Servicio).buffer_min ?? 0,
    anticipacionMin,
    maxSlots: opts.maxSlots,
    maxPorDia: opts.maxPorDia,
    soloPrimeroPorDia: opts.soloPrimeroPorDia,
  });

  // Carga real de cada profesional, para repartir cuando el cliente dice
  // «cualquiera» (ver elegirProfesional en el núcleo).
  const porDia = new Map<string, number>();
  const total = new Map<string, number>();
  for (const c of citas ?? []) {
    const id = c.profesional_id as string;
    if (!id) continue;
    total.set(id, (total.get(id) ?? 0) + 1);
    const clave = `${id}|${diaChileDe(c.inicio as string)}`;
    porDia.set(clave, (porDia.get(clave) ?? 0) + 1);
  }

  return {
    ok: true,
    servicio: servicio as Servicio,
    slots,
    profesionales: comoLista(ofrecibles),
    noVerificables: comoLista(noVerificables.filter((id) => profesionalIds.includes(id))),
    carga: { porDia, total },
  };
}

/** Mediodía chileno (en ms UTC) del día calendario al que pertenece `d`. */
function mediodiaChile(d: Date): number {
  const f = fechaChileDe(d);
  return horaChileAUtc(f.anio, f.mes, f.dia, 12, 0).getTime();
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
    /**
     * Respuestas de la ficha del servicio (migración 277), ya validadas por
     * lib/fichaServicio. Se guardan tal cual en ed_citas.datos_extra.
     */
    datosExtra?: Record<string, string> | null;
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
      ...(params.datosExtra ? { datos_extra: params.datosExtra } : {}),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION || error.code === BLOQUEO_VIOLATION) {
      return { ok: false, motivo: "cupo_tomado" };
    }
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

  // Puente a HQ (ver lib/hqBridge.ts): agrupa las 3 vías de creación de cita
  // (bot, portal, reserva pública) en un único punto — cualquier cita real
  // cuenta para "Clientes & Bots" en HQ, sin importar el canal de origen.
  notificarHQ({
    tipo: "meeting_booked",
    clientePortalId: params.clienteId,
    detalle: `${params.nombreContacto} · ${(svc?.nombre as string) ?? "servicio"} · ${params.origen}`,
  });

  return { ok: true, cita };
}

export async function reagendar(
  clienteId: string,
  citaId: string,
  nuevoInicioIso: string,
  supa: SupabaseClient = db(),
  /**
   * (Fase 2) Profesional que atenderá la hora nueva. Va aquí porque el hueco
   * elegido puede ser de OTRA persona: antes la cita se movía conservando al
   * profesional original, que podía no trabajar a esa hora o estar bloqueado,
   * y el único freno era que ya tuviera otra cita encima.
   */
  opts: { profesionalId?: string | null } = {},
): Promise<ResultadoCita> {
  const { data: cita } = await supa
    .from("ed_citas")
    .select("*, ed_servicios!servicio_id(duracion_min)")
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!cita) return { ok: false, motivo: "error", detalle: "cita no encontrada" };

  /**
   * Una inscripción a clase NO se mueve de hora: pertenece a una sesión
   * concreta (clase_id) con su cupo contado. Moverla dejaba la inscripción
   * apuntando a la clase vieja, sin liberar el cupo y fuera del anti-solape.
   * Para cambiarse de clase, se anula y se inscribe en otra.
   */
  if ((cita as { clase_id?: string | null }).clase_id) {
    return { ok: false, motivo: "inscripcion_de_clase" };
  }

  const dur = ((cita as { ed_servicios?: { duracion_min?: number } }).ed_servicios?.duracion_min ?? 30) * 60_000;
  const inicio = new Date(nuevoInicioIso);
  if (Number.isNaN(inicio.getTime())) return { ok: false, motivo: "error", detalle: "inicio inválido" };

  let profesionalId = (cita as Cita).profesional_id as string | null;
  if (opts.profesionalId && opts.profesionalId !== profesionalId) {
    const { data: prof } = await supa
      .from("ed_profesionales")
      .select("id, activo")
      .eq("id", opts.profesionalId)
      .eq("cliente_id", clienteId) // barrera de acceso
      .maybeSingle();
    if (!prof || !prof.activo) return { ok: false, motivo: "profesional_invalido" };
    profesionalId = opts.profesionalId;
  }

  const { data, error } = await supa
    .from("ed_citas")
    .update({
      inicio: inicio.toISOString(),
      fin: new Date(inicio.getTime() + dur).toISOString(),
      estado: "reagendada",
      profesional_id: profesionalId,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", citaId)
    .eq("cliente_id", clienteId)
    .select("*")
    .single();

  if (error) {
    if (error.code === EXCLUSION_VIOLATION || error.code === BLOQUEO_VIOLATION) {
      return { ok: false, motivo: "cupo_tomado" };
    }
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
  const anterior = (cita as Cita).profesional_id as string | null;
  if (anterior && anterior !== actualizada.profesional_id) {
    // Cambió de persona: hay que sacar el evento del calendario del anterior,
    // o queda una hora fantasma bloqueando su día.
    await quitarCitaDeGoogle(actualizada.id, anterior, supa);
  }
  await sincronizarCita(actualizada, (svc2?.nombre as string) ?? "Hora reservada", supa);

  return { ok: true, cita: actualizada };
}

/**
 * RESERVAR UN CUPO CON ASIGNACIÓN DE PROFESIONAL (Fase 2).
 *
 * Es el único camino que deberían usar la página pública y Tino. Hace tres
 * cosas que por separado se olvidaban:
 *
 *  1. VUELVE A CALCULAR la disponibilidad del día pedido. Lo que el cliente vio
 *     hace dos minutos no prueba nada; entre medio pudo entrar otra reserva o
 *     aparecer un compromiso en el Google del profesional.
 *  2. ELIGE al profesional cuando el cliente dijo «cualquiera», de forma
 *     determinista (menos citas ese día; ver `elegirProfesional`).
 *  3. REINTENTA con el siguiente disponible si justo le ganaron la carrera a
 *     ese profesional (Postgres devuelve 23P01 y aquí se traduce). Solo si no
 *     queda ninguno se responde `cupo_tomado`, con las horas más cercanas para
 *     no dejar al cliente en un callejón sin salida.
 */
export async function reservarCupo(
  params: {
    clienteId: string;
    servicioId: string;
    inicioIso: string;
    /** Profesional pedido por el cliente; null/undefined = «cualquiera». */
    profesionalId?: string | null;
    nombreContacto: string;
    chatId?: string;
    telefono?: string;
    origen: "whatsapp" | "web" | "portal" | "importada";
    empleadoId?: string;
    notas?: string;
    estado?: "agendada" | "confirmada";
    datosExtra?: Record<string, string> | null;
    ahora?: Date;
  },
  supa: SupabaseClient = db(),
): Promise<ResultadoCita & { alternativas?: Slot[] }> {
  const ahora = params.ahora ?? new Date();
  const disp = await disponibilidad(params.clienteId, params.servicioId, {
    ahora,
    supa,
    desdeDia: new Date(params.inicioIso),
    dias: 1,
    profesionalId: params.profesionalId ?? null,
  });
  if (!disp.ok) {
    const motivo = disp.motivo === "sin_profesionales" || disp.motivo === "profesional_invalido" ? disp.motivo : "servicio_invalido";
    return { ok: false, motivo };
  }

  const cupo = disp.slots.find((s) => s.inicio === params.inicioIso);
  if (!cupo) {
    // Puede ser que se acabe de ocupar, o que nunca haya existido. Para quien
    // reserva es lo mismo: esa hora ya no está. Se ofrecen las cercanas.
    const cercanas = await alternativasCercanas(params, ahora, supa);
    return { ok: false, motivo: "cupo_tomado", alternativas: cercanas };
  }

  const dia = diaChileDe(cupo.inicio);
  const porDia = new Map<string, number>();
  for (const id of cupo.profesionales) porDia.set(id, disp.carga.porDia.get(`${id}|${dia}`) ?? 0);

  const pendientes = [...cupo.profesionales];
  let ultimo: ResultadoCita = { ok: false, motivo: "cupo_tomado" };
  while (pendientes.length) {
    const elegido = elegirProfesional(pendientes, { porDia, total: disp.carga.total }, params.profesionalId ?? null);
    if (!elegido) break;
    const r = await crearCita(
      {
        clienteId: params.clienteId,
        servicioId: params.servicioId,
        profesionalId: elegido,
        inicioIso: params.inicioIso,
        nombreContacto: params.nombreContacto,
        chatId: params.chatId,
        telefono: params.telefono,
        origen: params.origen,
        empleadoId: params.empleadoId,
        notas: params.notas,
        estado: params.estado,
        datosExtra: params.datosExtra,
      },
      supa,
    );
    if (r.ok) return r;
    ultimo = r;
    if (r.motivo !== "cupo_tomado") return r; // un error real no se reintenta
    pendientes.splice(pendientes.indexOf(elegido), 1);
    if (params.profesionalId) break; // pidió a una persona concreta: no se sustituye
  }

  const cercanas = await alternativasCercanas(params, ahora, supa);
  return { ...ultimo, alternativas: cercanas };
}

/** Las próximas horas libres del mismo servicio, para «esa hora se acaba de ocupar». */
async function alternativasCercanas(
  params: { clienteId: string; servicioId: string; profesionalId?: string | null; inicioIso: string },
  ahora: Date,
  supa: SupabaseClient,
  cuantas = 3,
): Promise<Slot[]> {
  const r = await disponibilidad(params.clienteId, params.servicioId, {
    ahora,
    supa,
    desdeDia: new Date(params.inicioIso),
    dias: 7,
    profesionalId: params.profesionalId ?? null,
    maxPorDia: 4,
    maxSlots: 12,
  });
  if (!r.ok) return [];
  return r.slots.filter((s) => s.inicio !== params.inicioIso).slice(0, cuantas);
}

export async function cambiarEstado(
  clienteId: string,
  citaId: string,
  estado: "confirmada" | "cancelada" | "no_show" | "completada",
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; error?: string; encontrada?: boolean }> {
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
  // `encontrada` distingue "se actualizó" de "ese id no es de este negocio":
  // quien llama no debe tocar nada más (seguimientos) si la cita no era suya.
  return { ok: true, encontrada: Boolean(data) };
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
 * Puede fallar si en el intertanto otra persona tomó ese cupo (23P01, EXCLUDE
 * de ed_citas) o si el dueño bloqueó esa hora mientras tanto (ED001, ver
 * migración 308) — en ambos casos la cita se queda como está.
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
    if (error.code === EXCLUSION_VIOLATION || error.code === BLOQUEO_VIOLATION) {
      return { ok: false, motivo: "cupo_tomado" };
    }
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
