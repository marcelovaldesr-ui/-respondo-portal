import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { cambiarEstado, resultadoCrearBloqueo } from "@/lib/agenda";
import { anularSeguimientosDeCita } from "@/lib/agendaSeguimientos";
import { horaChileAUtc } from "@/lib/agendaCore";

/**
 * AGENDA DE LOS LOCALES DE KAMBAK, DESDE EL PANEL DE KAMBAK.
 *
 * El dueño de una barbería o un restaurante configura su agenda y mira sus
 * reservas en el panel de Kambak, no en el portal de Respondo. Kambak firma el
 * pedido con la credencial de SU cuenta (la misma de /api/externo/mensajes) y
 * este módulo ejecuta la acción sobre el negocio HIJO de ese local.
 *
 * SEGURIDAD
 *  · Solo una cuenta de «solo mensajería» (Kambak) puede usar esto.
 *  · El negocio se busca por (cuenta que firmó, slug del local): una cuenta
 *    jamás alcanza negocios que no cuelgan de ella.
 *  · Todo id que llega (servicio, profesional, cita…) se vuelve a comprobar
 *    contra el negocio hijo antes de tocar nada.
 */

export type RespuestaAgenda = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = {}): RespuestaAgenda => ({ status: 200, body: { ok: true, ...body } });
const fallo = (status: number, error: string): RespuestaAgenda => ({ status, body: { ok: false, error } });

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const HORA_RE = /^\d{2}:\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIPOS_CAMPO = ["texto", "parrafo", "numero", "telefono", "email", "opciones", "si_no", "fecha", "rut"];
const ESTADOS_CITA = ["confirmada", "cancelada", "no_show", "completada"] as const;

type Local = { slug: string; nombre: string; rubro: string };

function txt(v: unknown, max: number): string {
  return String(v ?? "").trim().slice(0, max);
}
function entero(v: unknown, min: number, max: number, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : def;
}
const esUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function leerLocal(v: unknown): Local | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const slug = txt(o.slug, 60).toLowerCase();
  const nombre = txt(o.nombre, 80);
  if (!SLUG_RE.test(slug) || nombre.length < 2) return null;
  return { slug, nombre, rubro: txt(o.rubro, 40).toLowerCase() };
}

/** Pasa un texto "2026-08-03T15:00" (hora de pared de Chile) a instante UTC. */
function localChileAUtc(valor: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(valor ?? ""));
  if (!m) return null;
  return horaChileAUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]));
}

async function esCuentaKambak(supa: SupabaseClient, padreId: string): Promise<boolean> {
  const { data } = await supa.from("ed_clientes").select("solo_mensajeria").eq("id", padreId).maybeSingle();
  return Boolean((data as { solo_mensajeria?: boolean } | null)?.solo_mensajeria);
}

async function hijoDe(supa: SupabaseClient, padreId: string, slug: string): Promise<string | null> {
  const { data } = await supa
    .from("ed_clientes")
    .select("id")
    .eq("kambak_padre_id", padreId)
    .eq("kambak_local_slug", slug)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

/** Crea el negocio hijo con lo mínimo para que el link de reservas funcione desde el minuto uno. */
async function activarLocal(supa: SupabaseClient, padreId: string, local: Local): Promise<RespuestaAgenda> {
  const existente = await hijoDe(supa, padreId, local.slug);
  if (existente) return ok({ activo: true, yaExistia: true });

  // El slug público es global: si lo usa otro negocio que no es este local, no se pisa.
  const { data: ocupado } = await supa.from("ed_clientes").select("id").eq("slug", local.slug).maybeSingle();
  if (ocupado) return fallo(409, "Ese enlace ya está en uso por otro negocio. Escribe a soporte de Kambak.");

  const esRestaurante = /restauran|caf[eé]|bar\b|gastro|comida|pizzer|panader|helader|past?eler/i.test(local.rubro);
  const rubro = esRestaurante ? "restaurante" : "barbería";

  const { data: hijo, error } = await supa
    .from("ed_clientes")
    .insert({
      nombre: local.nombre,
      slug: local.slug,
      rubro,
      activo: true,
      reservas_online: true,
      kambak_padre_id: padreId,
      kambak_local_slug: local.slug,
    })
    .select("id")
    .single();
  if (error || !hijo) {
    console.error("[kambak-agenda] activar:", error?.message);
    return fallo(500, "No se pudo activar la agenda. Intenta de nuevo.");
  }
  const hijoId = (hijo as { id: string }).id;

  // Semilla: un servicio, un profesional/sector y horario de lunes a sábado.
  const { data: srv } = await supa
    .from("ed_servicios")
    .insert({
      cliente_id: hijoId,
      nombre: esRestaurante ? "Reserva de mesa" : "Corte de pelo",
      duracion_min: esRestaurante ? 90 : 30,
      precio_clp: esRestaurante ? null : 10000,
      orden: 1,
    })
    .select("id")
    .single();
  const { data: prof } = await supa
    .from("ed_profesionales")
    .insert({ cliente_id: hijoId, nombre: esRestaurante ? "Salón principal" : "Barbero 1" })
    .select("id")
    .single();
  if (prof) {
    const profId = (prof as { id: string }).id;
    const dias = [1, 2, 3, 4, 5, 6];
    await supa.from("ed_horarios").insert(
      dias.map((d) => ({
        profesional_id: profId,
        dia_semana: d,
        desde: esRestaurante ? "12:30:00" : "10:00:00",
        hasta: esRestaurante ? "22:30:00" : "19:00:00",
      })),
    );
  }
  if (srv && esRestaurante) {
    const servicioId = (srv as { id: string }).id;
    await supa.from("ed_servicio_campos").insert({
      servicio_id: servicioId,
      etiqueta: "Cantidad de personas",
      tipo: "opciones",
      opciones: ["1 Persona", "2 Personas", "3 Personas", "4 Personas", "5 Personas", "6 Personas", "7 a 8 Personas"],
      obligatorio: true,
      ayuda: "Cuántos comensales asistirán",
      orden: 0,
    });
  }
  return ok({ activo: true, yaExistia: false });
}

async function leerConfig(supa: SupabaseClient, hijoId: string): Promise<RespuestaAgenda> {
  const [cli, srv, prof, blq] = await Promise.all([
    supa
      .from("ed_clientes")
      .select("slug, rubro, reservas_online, anticipacion_min_horas, horizonte_dias, confirmacion_automatica")
      .eq("id", hijoId)
      .maybeSingle(),
    supa
      .from("ed_servicios")
      .select("id, nombre, descripcion, duracion_min, precio_clp, buffer_min, activo, orden")
      .eq("cliente_id", hijoId)
      .order("orden", { ascending: true }),
    supa
      .from("ed_profesionales")
      .select("id, nombre, comision_pct, activo")
      .eq("cliente_id", hijoId)
      .order("creado_en", { ascending: true }),
    supa
      .from("ed_bloqueos")
      .select("id, profesional_id, desde, hasta, motivo")
      .eq("cliente_id", hijoId)
      .gte("hasta", new Date().toISOString())
      .order("desde", { ascending: true })
      .limit(60),
  ]);
  const servicios = (srv.data ?? []) as { id: string }[];
  const profesionales = (prof.data ?? []) as { id: string }[];
  const [campos, horarios] = await Promise.all([
    servicios.length
      ? supa
          .from("ed_servicio_campos")
          .select("id, servicio_id, etiqueta, tipo, opciones, obligatorio, orden")
          .in("servicio_id", servicios.map((s) => s.id))
          .order("orden", { ascending: true })
      : Promise.resolve({ data: [] }),
    profesionales.length
      ? supa
          .from("ed_horarios")
          .select("id, profesional_id, dia_semana, desde, hasta")
          .in("profesional_id", profesionales.map((p) => p.id))
          .order("dia_semana", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);
  return ok({
    cliente: cli.data,
    servicios,
    campos: campos.data ?? [],
    profesionales,
    horarios: horarios.data ?? [],
    bloqueos: blq.data ?? [],
  });
}

async function servicioDe(supa: SupabaseClient, hijoId: string, id: unknown): Promise<boolean> {
  if (!esUuid(id)) return false;
  const { data } = await supa.from("ed_servicios").select("id").eq("id", id).eq("cliente_id", hijoId).maybeSingle();
  return Boolean(data);
}
async function profesionalDe(supa: SupabaseClient, hijoId: string, id: unknown): Promise<boolean> {
  if (!esUuid(id)) return false;
  const { data } = await supa.from("ed_profesionales").select("id").eq("id", id).eq("cliente_id", hijoId).maybeSingle();
  return Boolean(data);
}

async function ejecutarSobreHijo(
  supa: SupabaseClient,
  hijoId: string,
  accion: string,
  d: Record<string, unknown>,
): Promise<RespuestaAgenda> {
  switch (accion) {
    case "config.leer":
      return leerConfig(supa, hijoId);

    case "servicio.guardar": {
      const nombre = txt(d.nombre, 80);
      if (!nombre) return fallo(400, "Falta el nombre.");
      const fila = {
        nombre,
        descripcion: txt(d.descripcion, 200) || null,
        duracion_min: entero(d.duracionMin, 5, 480, 30),
        precio_clp: d.precioClp === null || d.precioClp === "" || d.precioClp === undefined ? null : entero(d.precioClp, 0, 10_000_000, 0),
        buffer_min: entero(d.bufferMin, 0, 120, 0),
        activo: d.activo === false ? false : true,
      };
      if (d.id !== undefined && d.id !== null && d.id !== "") {
        if (!(await servicioDe(supa, hijoId, d.id))) return fallo(404, "Servicio no encontrado.");
        const { error } = await supa.from("ed_servicios").update(fila).eq("id", d.id as string).eq("cliente_id", hijoId);
        return error ? fallo(500, "No se pudo guardar.") : ok();
      }
      const { data: ult } = await supa
        .from("ed_servicios")
        .select("orden")
        .eq("cliente_id", hijoId)
        .order("orden", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await supa
        .from("ed_servicios")
        .insert({ ...fila, cliente_id: hijoId, orden: (((ult as { orden?: number } | null)?.orden) ?? 0) + 1 });
      return error ? fallo(500, "No se pudo guardar.") : ok();
    }

    case "servicio.eliminar": {
      if (!(await servicioDe(supa, hijoId, d.id))) return fallo(404, "Servicio no encontrado.");
      const { count } = await supa
        .from("ed_citas")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", hijoId)
        .eq("servicio_id", d.id as string);
      if ((count ?? 0) > 0) {
        await supa.from("ed_servicios").update({ activo: false }).eq("id", d.id as string).eq("cliente_id", hijoId);
        return ok({ desactivado: true });
      }
      await supa.from("ed_servicios").delete().eq("id", d.id as string).eq("cliente_id", hijoId);
      return ok({ eliminado: true });
    }

    case "campo.guardar": {
      if (!(await servicioDe(supa, hijoId, d.servicioId))) return fallo(404, "Servicio no encontrado.");
      const etiqueta = txt(d.etiqueta, 60);
      const tipo = txt(d.tipo, 20);
      if (!etiqueta || !TIPOS_CAMPO.includes(tipo)) return fallo(400, "Revisa la pregunta.");
      const opciones =
        tipo === "opciones"
          ? [...new Set(String(d.opciones ?? "").split(/[\n,]/).map((o) => o.trim().slice(0, 60)).filter(Boolean))].slice(0, 20)
          : null;
      if (tipo === "opciones" && (!opciones || opciones.length === 0)) return fallo(400, "Agrega al menos una opción.");
      const { data: ult } = await supa
        .from("ed_servicio_campos")
        .select("orden")
        .eq("servicio_id", d.servicioId as string)
        .order("orden", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { error } = await supa.from("ed_servicio_campos").insert({
        servicio_id: d.servicioId as string,
        etiqueta,
        tipo,
        opciones,
        obligatorio: d.obligatorio === true,
        orden: (((ult as { orden?: number } | null)?.orden) ?? -1) + 1,
      });
      return error ? fallo(500, "No se pudo guardar.") : ok();
    }

    case "campo.eliminar": {
      if (!(await servicioDe(supa, hijoId, d.servicioId)) || !esUuid(d.id)) return fallo(404, "No encontrado.");
      await supa.from("ed_servicio_campos").delete().eq("id", d.id as string).eq("servicio_id", d.servicioId as string);
      return ok();
    }

    case "profesional.guardar": {
      const nombre = txt(d.nombre, 60);
      if (!nombre) return fallo(400, "Falta el nombre.");
      const comision = entero(d.comisionPct, 0, 100, 0);
      if (d.id !== undefined && d.id !== null && d.id !== "") {
        if (!(await profesionalDe(supa, hijoId, d.id))) return fallo(404, "No encontrado.");
        await supa
          .from("ed_profesionales")
          .update({ nombre, comision_pct: comision, activo: d.activo === false ? false : true })
          .eq("id", d.id as string)
          .eq("cliente_id", hijoId);
        return ok();
      }
      const { error } = await supa.from("ed_profesionales").insert({ cliente_id: hijoId, nombre, comision_pct: comision });
      return error ? fallo(500, "No se pudo guardar.") : ok();
    }

    case "profesional.eliminar": {
      if (!(await profesionalDe(supa, hijoId, d.id))) return fallo(404, "No encontrado.");
      const { count } = await supa
        .from("ed_citas")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", hijoId)
        .eq("profesional_id", d.id as string);
      if ((count ?? 0) > 0) {
        await supa.from("ed_profesionales").update({ activo: false }).eq("id", d.id as string).eq("cliente_id", hijoId);
        return ok({ desactivado: true });
      }
      await supa.from("ed_profesionales").delete().eq("id", d.id as string).eq("cliente_id", hijoId);
      return ok({ eliminado: true });
    }

    case "horario.agregar": {
      const desde = txt(d.desde, 5);
      const hasta = txt(d.hasta, 5);
      if (!(await profesionalDe(supa, hijoId, d.profesionalId))) return fallo(404, "No encontrado.");
      if (!HORA_RE.test(desde) || !HORA_RE.test(hasta) || desde >= hasta) return fallo(400, "Revisa las horas.");
      const dias = (Array.isArray(d.dias) ? d.dias : []).map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
      if (!dias.length) return fallo(400, "Elige al menos un día.");
      const { error } = await supa
        .from("ed_horarios")
        .insert([...new Set(dias)].map((dia) => ({ profesional_id: d.profesionalId as string, dia_semana: dia, desde, hasta })));
      return error ? fallo(500, "No se pudo guardar.") : ok();
    }

    case "horario.eliminar": {
      if (!esUuid(d.id)) return fallo(400, "Solicitud inválida.");
      const { data: h } = await supa
        .from("ed_horarios")
        .select("id, ed_profesionales!inner(cliente_id)")
        .eq("id", d.id)
        .eq("ed_profesionales.cliente_id", hijoId)
        .maybeSingle();
      if (!h) return fallo(404, "No encontrado.");
      await supa.from("ed_horarios").delete().eq("id", d.id);
      return ok();
    }

    case "bloqueo.crear": {
      const desde = localChileAUtc(d.desde);
      const hasta = localChileAUtc(d.hasta);
      if (!desde || !hasta || desde >= hasta) return fallo(400, "Revisa las fechas.");
      const prof = d.profesionalId ? String(d.profesionalId) : "";
      if (prof && !(await profesionalDe(supa, hijoId, prof))) return fallo(404, "No encontrado.");
      const { error } = await supa.from("ed_bloqueos").insert({
        cliente_id: hijoId,
        profesional_id: prof || null,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        motivo: txt(d.motivo, 120) || null,
      });
      const r = resultadoCrearBloqueo(error);
      return r.ok ? ok() : fallo(409, r.error ?? "No se pudo crear el bloqueo.");
    }

    case "bloqueo.eliminar": {
      if (!esUuid(d.id)) return fallo(400, "Solicitud inválida.");
      await supa.from("ed_bloqueos").delete().eq("id", d.id).eq("cliente_id", hijoId);
      return ok();
    }

    case "reservas.config": {
      const { error } = await supa
        .from("ed_clientes")
        .update({
          reservas_online: d.reservasOnline === true,
          anticipacion_min_horas: entero(d.anticipacionMinHoras, 0, 72, 2),
          horizonte_dias: entero(d.horizonteDias, 1, 90, 30),
        })
        .eq("id", hijoId);
      return error ? fallo(500, "No se pudo guardar.") : ok();
    }

    case "citas.listar": {
      const desde = localChileAUtc(`${txt(d.desde, 10)}T00:00`);
      const hasta = localChileAUtc(`${txt(d.hasta, 10)}T23:59`);
      if (!desde || !hasta || hasta < desde) return fallo(400, "Revisa las fechas.");
      if (hasta.getTime() - desde.getTime() > 62 * 86_400_000) return fallo(400, "Rango muy largo.");
      const { data } = await supa
        .from("ed_citas")
        .select("id, inicio, fin, estado, nombre_contacto, telefono, origen, notas, datos_extra, servicio_id, profesional_id, ed_servicios(nombre, precio_clp), ed_profesionales(nombre)")
        .eq("cliente_id", hijoId)
        .gte("inicio", desde.toISOString())
        .lte("inicio", hasta.toISOString())
        .order("inicio", { ascending: true })
        .limit(300);
      return ok({ citas: data ?? [] });
    }

    case "cita.estado": {
      const estado = txt(d.estado, 20) as (typeof ESTADOS_CITA)[number];
      if (!esUuid(d.id) || !ESTADOS_CITA.includes(estado)) return fallo(400, "Solicitud inválida.");
      const r = await cambiarEstado(hijoId, d.id, estado, supa);
      if (!r.ok) return fallo(500, "No se pudo actualizar la reserva.");
      if (!r.encontrada) return fallo(404, "Reserva no encontrada.");
      if (estado === "cancelada" || estado === "no_show") await anularSeguimientosDeCita(d.id, hijoId);
      return ok();
    }

    default:
      return fallo(400, "Acción desconocida.");
  }
}

/** Punto de entrada: valida quién pide, resuelve el negocio hijo y ejecuta. */
export async function ejecutarAgendaKambak(
  padreId: string,
  cuerpo: Record<string, unknown>,
  supa: SupabaseClient = db(),
): Promise<RespuestaAgenda> {
  if (!(await esCuentaKambak(supa, padreId))) return fallo(403, "Esta cuenta no puede administrar agendas de locales.");
  const local = leerLocal(cuerpo.local);
  if (!local) return fallo(400, "Local inválido.");
  const accion = txt(cuerpo.accion, 40);
  const datos = cuerpo.datos && typeof cuerpo.datos === "object" ? (cuerpo.datos as Record<string, unknown>) : {};

  if (accion === "activar") return activarLocal(supa, padreId, local);

  const hijoId = await hijoDe(supa, padreId, local.slug);
  if (accion === "estado") return ok({ activo: Boolean(hijoId), slug: local.slug });
  if (!hijoId) return fallo(409, "La agenda de este local todavía no está activada.");
  return ejecutarSobreHijo(supa, hijoId, accion, datos);
}
