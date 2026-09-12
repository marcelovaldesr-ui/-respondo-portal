import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { programarSeguimiento } from "@/lib/seguimientos";
import { horaChileAUtc, fechaChileDe } from "@/lib/agendaCore";
import { manana10Chile } from "@/lib/seguimientosCore";
import {
  ultimaPorChat,
  vigenciaAlAprobar,
  type ContactoAlAprobar,
  type UltimaPropuesta,
} from "@/lib/propuestasCore";

/**
 * LAS PROPUESTAS DE BETO — lo que quiere escribir, antes de que salga.
 *
 * Ver `sql/297_propuestas_seguimiento.sql` para el porqué. En una línea: cada
 * mensaje cuesta ~$85, así que la primera temporada los mira una persona.
 *
 * ⚠️ ESTE ARCHIVO NO ENVÍA NADA. Ni siquiera al aprobar: `aprobarPropuesta`
 * llama a `programarSeguimiento`, que deja una fila en `ed_seguimientos` para
 * que el cron la mande cuando toque, respetando horario hábil y tope diario.
 * El camino de salida sigue siendo uno solo, y es el de siempre.
 */

export type Propuesta = {
  id: string;
  chat_id: string;
  tipo: string;
  cotizado: string | null;
  motivo_juez: string | null;
  evidencia: Record<string, unknown> | null;
  estado: string;
  creado_en: string;
};

/** Lo que se muestra en /seguimientos, ya con el nombre del contacto. */
export type PropuestaConContacto = Propuesta & {
  nombre: string;
  diasEsperando: number | null;
  ultimoMensaje: string;
  /** Con quién abrir la conversación (Fase 1): sin esto el enlace no abría nada. */
  empleadoId: string | null;
};

export type ModoSeguimiento = "aprobacion" | "automatico";

/**
 * Crea (o refresca) la propuesta viva de una conversación.
 *
 * 🔴 BUG CORREGIDO (Fase 0, 11-sep-2026): esto era un `upsert` con
 * `onConflict: "cliente_id,chat_id,tipo"`. El índice único de la migración 297
 * es PARCIAL (`where estado = 'propuesto'`) y Postgres no acepta un índice
 * parcial como destino de ON CONFLICT sin el mismo predicado: TODA propuesta
 * fallaba con 42P10 y /seguimientos habría quedado vacía para siempre, con el
 * error escondido en un console.log del cron.
 *
 * Ahora: se busca la viva y se actualiza; si no hay, se inserta. Si dos
 * corridas insertan a la vez, el índice parcial rechaza la segunda (23505) y
 * esa se convierte en actualización.
 *
 * Nunca lanza: si la migración no está aplicada, devuelve el error y el
 * generador sigue con el resto.
 */
export async function proponerSeguimiento(p: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  tipo: string;
  cotizado: string;
  motivoJuez: string;
  evidencia?: Record<string, unknown>;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string; actualizada?: boolean }> {
  const supa = p.supa ?? db();
  const datos = {
    empleado_id: p.empleadoId,
    cotizado: p.cotizado,
    motivo_juez: p.motivoJuez,
    evidencia: p.evidencia ?? {},
  };
  const actualizarViva = async () => {
    const { data: viva, error: eBuscar } = await supa
      .from("ed_propuestas_seguimiento")
      .select("id")
      .eq("cliente_id", p.clienteId)
      .eq("chat_id", p.chatId)
      .eq("tipo", p.tipo)
      .eq("estado", "propuesto")
      .maybeSingle();
    if (eBuscar) return { ok: false as const, error: eBuscar.message };
    if (!viva) return null;
    const { error } = await supa
      .from("ed_propuestas_seguimiento")
      .update(datos)
      .eq("id", viva.id as string)
      .eq("cliente_id", p.clienteId)
      .eq("estado", "propuesto");
    return error ? { ok: false as const, error: error.message } : { ok: true as const, actualizada: true };
  };
  try {
    const previa = await actualizarViva();
    if (previa) return previa;

    const { error } = await supa.from("ed_propuestas_seguimiento").insert({
      ...datos,
      cliente_id: p.clienteId,
      chat_id: p.chatId,
      tipo: p.tipo,
      estado: "propuesto",
    });
    if (!error) return { ok: true };
    if ((error as { code?: string }).code === "23505") {
      return (await actualizarViva()) ?? { ok: false, error: error.message };
    }
    return { ok: false, error: error.message };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * El "no" del juez queda guardado (migración 304). Sin esto el mismo hilo se
 * volvía a juzgar —y a pagar— cada 5 minutos. Nunca lanza.
 */
export async function registrarFrenado(p: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  tipo: string;
  motivoJuez: string;
  evidencia?: Record<string, unknown>;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string }> {
  const supa = p.supa ?? db();
  try {
    const { error } = await supa.from("ed_propuestas_seguimiento").insert({
      cliente_id: p.clienteId,
      empleado_id: p.empleadoId,
      chat_id: p.chatId,
      tipo: p.tipo,
      motivo_juez: p.motivoJuez,
      evidencia: p.evidencia ?? {},
      estado: "frenado",
      resuelto_en: new Date().toISOString(),
      resuelto_por: "juez",
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * La última decisión (propuesta, aprobación, rechazo, freno) por chat, para
 * que el generador no vuelva a juzgar lo que ya se decidió. `null` = no se pudo
 * leer: el generador debe fallar CERRADO (no juzgar ni proponer).
 */
export async function memoriaDePropuestas(p: {
  clienteId: string;
  tipo: string;
  chatIds: string[];
  supa?: SupabaseClient;
}): Promise<Map<string, UltimaPropuesta & { chat_id: string }> | null> {
  if (!p.chatIds.length) return new Map();
  const supa = p.supa ?? db();
  const { data, error } = await supa
    .from("ed_propuestas_seguimiento")
    .select("chat_id, estado, creado_en, resuelto_en, motivo_juez")
    .eq("cliente_id", p.clienteId)
    .eq("tipo", p.tipo)
    .in("chat_id", p.chatIds)
    .order("creado_en", { ascending: false })
    .limit(2000);
  if (error) return null;
  return ultimaPorChat((data ?? []) as (UltimaPropuesta & { chat_id: string })[]);
}

/** Cuántas propuestas esperan decisión (el tope de la lista en modo aprobación). */
export async function contarVivas(clienteId: string, tipo: string, supa: SupabaseClient = db()): Promise<number | null> {
  const { count, error } = await supa
    .from("ed_propuestas_seguimiento")
    .select("id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .eq("tipo", tipo)
    .eq("estado", "propuesto");
  return error ? null : count ?? 0;
}

/** Inicio del día de HOY en Chile, como instante UTC. */
export function inicioDiaChile(ahora: Date): Date {
  const f = fechaChileDe(ahora);
  return horaChileAUtc(f.anio, f.mes, f.dia, 0, 0);
}

/** Las propuestas sin resolver de un cliente, más nuevas arriba. */
export async function listarPropuestas(p: {
  clienteId: string;
  estado?: string;
  supa?: SupabaseClient;
}): Promise<PropuestaConContacto[]> {
  const supa = p.supa ?? db();
  const { data } = await supa
    .from("ed_propuestas_seguimiento")
    .select("id, empleado_id, chat_id, tipo, cotizado, motivo_juez, evidencia, estado, creado_en")
    .eq("cliente_id", p.clienteId)
    .eq("estado", p.estado ?? "propuesto")
    .order("creado_en", { ascending: false })
    .limit(100);

  const filas = (data ?? []) as Propuesta[];
  if (!filas.length) return [];

  /**
   * El nombre y el último mensaje se traen de `ed_contactos` en UNA consulta,
   * no una por fila. Se leen ahora y no se copian a la propuesta a propósito:
   * si el cliente escribió después de que se generó la propuesta, Cecilia tiene
   * que ver ESO antes de aprobar un «¿sigue en pie?».
   */
  const chatIds = filas.map((f) => f.chat_id);
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol, ultimo_empleado_id")
    .eq("cliente_id", p.clienteId)
    .in("chat_id", chatIds);

  const porChat = new Map<string, Record<string, unknown>>();
  for (const c of contactos ?? []) porChat.set(c.chat_id as string, c);

  return filas.map((f) => {
    const c = porChat.get(f.chat_id);
    const ultimoEn = (c?.ultimo_mensaje_en as string | null) ?? null;
    const rol = (c?.ultimo_mensaje_rol as string | null) ?? "";
    const texto = ((c?.ultimo_mensaje_texto as string | null) ?? "").replace(/\s+/g, " ").trim();
    return {
      ...f,
      nombre: ((c?.nombre as string | null) ?? "").trim(),
      empleadoId: ((c?.ultimo_empleado_id as string | null) ?? (f as { empleado_id?: string | null }).empleado_id ?? null) || null,
      diasEsperando: ultimoEn
        ? Math.floor((Date.now() - new Date(ultimoEn).getTime()) / 86_400_000)
        : null,
      ultimoMensaje: rol === "cliente" ? `El cliente escribió: ${texto}` : texto,
    };
  });
}

/**
 * APROBAR: recién acá entra a `ed_seguimientos` y queda en manos del cron.
 *
 * 🔴 ANTES NO ERA ATÓMICO (Fase 0): se leía la fila, se programaba y recién
 * después se marcaba aprobada. Dos clics seguidos (o dos personas a la vez)
 * leían las dos 'propuesto' y programaban DOS mensajes pagados al mismo
 * cliente. Ahora la propuesta se RECLAMA primero con un update condicionado a
 * `estado = 'propuesto'`: solo uno gana. Si programar falla, se devuelve a
 * 'propuesto' para que siga visible (el mismo cuidado que había antes).
 *
 * Además, antes de programar se revisa que siga teniendo sentido (el cliente
 * no escribió, no compró, no pidió que no le escriban) y se respeta el tope
 * diario del negocio: si ya se usó, sale mañana a las 10:00 y se avisa.
 */
export async function aprobarPropuesta(p: {
  clienteId: string;
  propuestaId: string;
  negocio: string;
  email: string;
  supa?: SupabaseClient;
  ahora?: Date;
}): Promise<{
  ok: boolean;
  error?: string;
  programadoPara?: string;
  aviso?: string;
  /** true cuando la propuesta dejó de estar pendiente aunque no se aprobó (vencida). */
  retirar?: boolean;
}> {
  const supa = p.supa ?? db();
  const ahora = p.ahora ?? new Date();

  const { data: reclamada, error: eReclamo } = await supa
    .from("ed_propuestas_seguimiento")
    .update({ estado: "aprobado", resuelto_en: ahora.toISOString(), resuelto_por: p.email })
    .eq("id", p.propuestaId)
    .eq("cliente_id", p.clienteId) // el aislamiento va en el WHERE, siempre
    .eq("estado", "propuesto")
    .select("id, empleado_id, chat_id, tipo, cotizado, creado_en")
    .maybeSingle();
  if (eReclamo) return { ok: false, error: `No se pudo aprobar: ${eReclamo.message}` };
  if (!reclamada) return { ok: false, error: "Esta propuesta ya se resolvió o ya no existe" };

  const volverAPropuesto = async () =>
    supa
      .from("ed_propuestas_seguimiento")
      .update({ estado: "propuesto", resuelto_en: null, resuelto_por: null })
      .eq("id", p.propuestaId)
      .eq("cliente_id", p.clienteId)
      .eq("estado", "aprobado");

  const { data: contacto, error: eContacto } = await supa
    .from("ed_contactos")
    .select("nombre, etiquetas, etapa, etapa_motivo, ultimo_mensaje_en, ultimo_mensaje_rol")
    .eq("cliente_id", p.clienteId)
    .eq("chat_id", reclamada.chat_id as string)
    .maybeSingle();
  if (eContacto) {
    await volverAPropuesto();
    return { ok: false, error: `No se pudo revisar la conversación: ${eContacto.message}` };
  }

  const v = vigenciaAlAprobar(contacto as ContactoAlAprobar, reclamada.creado_en as string);
  if (!v.vigente) {
    // Se cierra como vencida (no rechazada: no fue un error del juez) y no sale nada.
    await supa
      .from("ed_propuestas_seguimiento")
      .update({ estado: "vencido", motivo_juez: `Vencida al aprobar: ${v.motivo}` })
      .eq("id", p.propuestaId)
      .eq("cliente_id", p.clienteId);
    return { ok: false, retirar: true, error: `No se envió: ${v.motivo}.` };
  }

  // Tope diario del negocio (el mismo que usa el generador), contado en día de Chile.
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("cotizacion_tope_diario")
    .eq("id", p.clienteId)
    .maybeSingle();
  const tope = Number((cli as { cotizacion_tope_diario?: number } | null)?.cotizacion_tope_diario ?? 10);
  const { count: hoy, error: eHoy } = await supa
    .from("ed_seguimientos")
    .select("id", { count: "exact", head: true })
    .eq("empleado_id", reclamada.empleado_id as string)
    .eq("tipo", reclamada.tipo as string)
    .gte("programado_para", inicioDiaChile(ahora).toISOString())
    .lt("programado_para", manana10Chile(ahora).toISOString());
  if (eHoy) {
    await volverAPropuesto();
    return { ok: false, error: `No se pudo revisar el tope diario: ${eHoy.message}` };
  }
  const topado = (hoy ?? 0) >= tope;
  const programadoPara = topado ? manana10Chile(ahora) : ahora;
  if (topado) {
    // Tampoco se puede apilar todo en mañana: se revisa ese día también.
    const manana = manana10Chile(ahora);
    const { count: enManana, error: eManana } = await supa
      .from("ed_seguimientos")
      .select("id", { count: "exact", head: true })
      .eq("empleado_id", reclamada.empleado_id as string)
      .eq("tipo", reclamada.tipo as string)
      .gte("programado_para", inicioDiaChile(manana).toISOString())
      .lt("programado_para", manana10Chile(manana).toISOString());
    if (eManana || (enManana ?? 0) >= tope) {
      await volverAPropuesto();
      return {
        ok: false,
        error: `Ya están usados los ${tope} mensajes de hoy y de mañana. La propuesta sigue en la lista para aprobarla después.`,
      };
    }
  }

  const r = await programarSeguimiento({
    empleadoId: reclamada.empleado_id as string,
    chatId: reclamada.chat_id as string,
    tipo: reclamada.tipo as string,
    paramsPlantilla: [
      (((contacto as { nombre?: string | null } | null)?.nombre as string | null) || "hola").trim(),
      p.negocio,
      (reclamada.cotizado as string | null) || "lo que nos consultaste",
    ],
    programadoPara,
    supa,
  });
  if (!r.ok) {
    const { error: eVolver } = await volverAPropuesto();
    return {
      ok: false,
      error: eVolver
        ? `No se pudo programar (${r.error}) y la propuesta quedó marcada como aprobada: revísala antes de reintentar.`
        : `No se pudo programar: ${r.error}`,
    };
  }
  return {
    ok: true,
    programadoPara: programadoPara.toISOString(),
    ...(topado ? { aviso: `Ya se usó el tope de ${tope} mensajes de hoy: sale mañana a las 10:00.` } : {}),
  };
}

/**
 * RECHAZAR. No manda nada, y el «no» queda guardado.
 *
 * Cada rechazo es un caso en que el juez se equivocó, y son lo único que va a
 * permitir ajustar el prompt con datos en vez de con intuición.
 */
export async function rechazarPropuesta(p: {
  clienteId: string;
  propuestaId: string;
  email: string;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string }> {
  const supa = p.supa ?? db();
  const { error } = await supa
    .from("ed_propuestas_seguimiento")
    .update({ estado: "rechazado", resuelto_en: new Date().toISOString(), resuelto_por: p.email })
    .eq("id", p.propuestaId)
    .eq("cliente_id", p.clienteId)
    .eq("estado", "propuesto");
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Cómo decide este cliente: proponer o programar directo. */
export async function modoDe(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<ModoSeguimiento> {
  const { data } = await supa
    .from("ed_clientes")
    .select("seguimiento_modo")
    .eq("id", clienteId)
    .maybeSingle();
  // Sin la columna (migración no aplicada) o con basura: aprobación. Fail-closed
  // hacia el modo que NO gasta plata sola.
  return (data?.seguimiento_modo as ModoSeguimiento) === "automatico" ? "automatico" : "aprobacion";
}
