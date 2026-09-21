import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaChileDe } from "@/lib/agendaCore";

export type AsistenteClase = {
  citaId: string;
  contactoId: string | null;
  nombre: string;
  telefono: string | null;
  chatId: string | null;
  estado: "agendada" | "confirmada" | "completada" | "no_show" | "cancelada";
  planNombre: string | null;
  creadoEn: string;
};

export type ClaseOperacional = {
  id: string;
  servicioId: string;
  servicioNombre: string;
  profesionalId: string;
  profesionalNombre: string;
  inicio: string;
  fin: string;
  cupoMaximo: number;
  cupoOcupado: number;
  lugaresLibres: number;
  estado: string;
};

export type DetalleClaseOperacional = ClaseOperacional & {
  inscritos: AsistenteClase[];
};

export type GruposClases = {
  hoy: ClaseOperacional[];
  estaSemana: ClaseOperacional[];
  proximas: ClaseOperacional[];
};

function claveDia(iso: string): string {
  const f = fechaChileDe(new Date(iso));
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
}

/**
 * LISTA LAS CLASES AGRUPADAS OPERACIONALMENTE: HOY, ESTA SEMANA, PRÓXIMAS.
 */
export async function listarClasesOperacionales(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<GruposClases> {
  const ahoraIso = new Date().toISOString();
  const { data: filas, error } = await supa
    .from("ed_clases")
    .select(`
      id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado, estado,
      ed_servicios!servicio_id (nombre),
      ed_profesionales!profesional_id (nombre)
    `)
    .eq("cliente_id", clienteId)
    .gte("fin", ahoraIso)
    .order("inicio", { ascending: true })
    .limit(100);

  if (error || !filas) {
    return { hoy: [], estaSemana: [], proximas: [] };
  }

  const hoyClave = claveDia(ahoraIso);
  const finSemanaMs = Date.now() + 7 * 86_400_000;

  const hoy: ClaseOperacional[] = [];
  const estaSemana: ClaseOperacional[] = [];
  const proximas: ClaseOperacional[] = [];

  for (const f of filas) {
    const s = Array.isArray(f.ed_servicios) ? f.ed_servicios[0] : f.ed_servicios;
    const p = Array.isArray(f.ed_profesionales) ? f.ed_profesionales[0] : f.ed_profesionales;
    const max = (f.cupo_maximo as number) ?? 0;
    const ocup = (f.cupo_ocupado as number) ?? 0;

    const clase: ClaseOperacional = {
      id: f.id as string,
      servicioId: f.servicio_id as string,
      servicioNombre: (s?.nombre as string) || "Clase",
      profesionalId: f.profesional_id as string,
      profesionalNombre: (p?.nombre as string) || "Instructor",
      inicio: f.inicio as string,
      fin: f.fin as string,
      cupoMaximo: max,
      cupoOcupado: ocup,
      lugaresLibres: Math.max(0, max - ocup),
      estado: f.estado as string,
    };

    const fechaClave = claveDia(clase.inicio);
    const inicioMs = new Date(clase.inicio).getTime();

    if (fechaClave === hoyClave) {
      hoy.push(clase);
    } else if (inicioMs <= finSemanaMs) {
      estaSemana.push(clase);
    } else {
      proximas.push(clase);
    }
  }

  return { hoy, estaSemana, proximas };
}

/**
 * OBTIENE EL DETALLE DE UNA CLASE CON TODOS SUS ALUMNOS INSCRITOS Y SUS ESTADOS.
 */
export async function obtenerDetalleClaseOperacional(
  clienteId: string,
  claseId: string,
  supa: SupabaseClient = db(),
): Promise<DetalleClaseOperacional | null> {
  const { data: f, error: errClase } = await supa
    .from("ed_clases")
    .select(`
      id, servicio_id, profesional_id, inicio, fin, cupo_maximo, cupo_ocupado, estado,
      ed_servicios!servicio_id (nombre),
      ed_profesionales!profesional_id (nombre)
    `)
    .eq("cliente_id", clienteId)
    .eq("id", claseId)
    .maybeSingle();

  if (errClase || !f) return null;

  const s = Array.isArray(f.ed_servicios) ? f.ed_servicios[0] : f.ed_servicios;
  const p = Array.isArray(f.ed_profesionales) ? f.ed_profesionales[0] : f.ed_profesionales;
  const max = (f.cupo_maximo as number) ?? 0;
  const ocup = (f.cupo_ocupado as number) ?? 0;

  // Consultar alumnos inscritos en ed_citas
  const citasConContacto = await supa
    .from("ed_citas")
    .select("id, contacto_id, nombre_contacto, telefono, chat_id, estado, creado_en")
    .eq("cliente_id", clienteId)
    .eq("clase_id", claseId)
    .order("creado_en", { ascending: true });

  // Compatibilidad durante el despliegue de la migración 320.
  const citasSinContacto = citasConContacto.error
    ? await supa
      .from("ed_citas")
      .select("id, nombre_contacto, telefono, chat_id, estado, creado_en")
      .eq("cliente_id", clienteId)
      .eq("clase_id", claseId)
      .order("creado_en", { ascending: true })
    : null;

  const citas = (citasConContacto.error ? citasSinContacto?.data : citasConContacto.data ?? []) as Array<{
    id: string;
    contacto_id?: string | null;
    nombre_contacto?: string | null;
    telefono?: string | null;
    chat_id?: string | null;
    estado?: string | null;
    creado_en: string;
  }>;

  const inscritos: AsistenteClase[] = [];

  if (citas && citas.length > 0) {
    // Resolver membresías activas para los contactos inscritos
    const contactoPorChat = new Map<string, string>();
    const chatsSinContacto = citas
      .filter((c) => !c.contacto_id && c.chat_id)
      .map((c) => c.chat_id as string);

    if (chatsSinContacto.length > 0) {
      const { data: contactos } = await supa
        .from("ed_contactos")
        .select("id, chat_id")
        .eq("cliente_id", clienteId)
        .in("chat_id", [...new Set(chatsSinContacto)]);
      for (const contacto of contactos ?? []) {
        if (contacto.chat_id) contactoPorChat.set(contacto.chat_id, contacto.id);
      }
    }

    const contactoIds = citas
      .map((c) => c.contacto_id ?? (c.chat_id ? contactoPorChat.get(c.chat_id) : null))
      .filter(Boolean) as string[];
    const mapaPlanes = new Map<string, string>();

    if (contactoIds.length > 0) {
      const { data: mems } = await supa
        .from("ed_membresias")
        .select("contacto_id, ed_planes!plan_id(nombre)")
        .eq("cliente_id", clienteId)
        .in("contacto_id", contactoIds)
        .in("estado", ["activa", "agotada"]);

      if (mems) {
        for (const m of mems) {
          const pl = Array.isArray(m.ed_planes) ? m.ed_planes[0] : m.ed_planes;
          if (m.contacto_id && pl?.nombre) {
            mapaPlanes.set(m.contacto_id, pl.nombre);
          }
        }
      }
    }

    for (const c of citas) {
      const contactoId = c.contacto_id ?? (c.chat_id ? contactoPorChat.get(c.chat_id) : null) ?? null;
      inscritos.push({
        citaId: c.id as string,
        contactoId,
        nombre: (c.nombre_contacto as string) || "Sin nombre",
        telefono: (c.telefono as string) || null,
        chatId: (c.chat_id as string) || null,
        estado: (c.estado as AsistenteClase["estado"]) || "agendada",
        planNombre: contactoId ? mapaPlanes.get(contactoId) ?? null : null,
        creadoEn: c.creado_en as string,
      });
    }
  }

  return {
    id: f.id as string,
    servicioId: f.servicio_id as string,
    servicioNombre: (s?.nombre as string) || "Clase",
    profesionalId: f.profesional_id as string,
    profesionalNombre: (p?.nombre as string) || "Instructor",
    inicio: f.inicio as string,
    fin: f.fin as string,
    cupoMaximo: max,
    cupoOcupado: ocup,
    lugaresLibres: Math.max(0, max - ocup),
    estado: f.estado as string,
    inscritos,
  };
}

/**
 * MARCA LA ASISTENCIA DE UN ALUMNO (ESTADO = 'completada').
 */
export async function marcarAsistenciaCita(
  clienteId: string,
  citaId: string,
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supa
    .from("ed_citas")
    .update({
      estado: "completada",
      actualizado_en: new Date().toISOString(),
    })
    .eq("cliente_id", clienteId)
    .eq("id", citaId);

  if (error) {
    console.error("[commerce] no se pudo marcar asistencia:", error.message);
    return { ok: false, error: "No se pudo marcar la asistencia. Intenta nuevamente." };
  }
  return { ok: true };
}
