import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { programarSeguimiento } from "@/lib/seguimientos";

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
};

export type ModoSeguimiento = "aprobacion" | "automatico";

/**
 * Crea (o refresca) la propuesta viva de una conversación.
 *
 * Es un upsert sobre el índice único parcial de la migración 297: si el
 * generador vuelve a pasar mañana y la propuesta sigue sin resolver, se
 * actualiza el veredicto en vez de aparecer dos veces en la lista de Cecilia.
 *
 * Nunca lanza: si la migración no está aplicada, devuelve el error y el
 * generador sigue con el resto. Que falle una propuesta no puede hacer caer la
 * pasada entera.
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
}): Promise<{ ok: boolean; error?: string }> {
  const supa = p.supa ?? db();
  try {
    const { error } = await supa
      .from("ed_propuestas_seguimiento")
      .upsert(
        {
          cliente_id: p.clienteId,
          empleado_id: p.empleadoId,
          chat_id: p.chatId,
          tipo: p.tipo,
          cotizado: p.cotizado,
          motivo_juez: p.motivoJuez,
          evidencia: p.evidencia ?? {},
          estado: "propuesto",
        },
        { onConflict: "cliente_id,chat_id,tipo", ignoreDuplicates: false },
      );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
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
    .select("id, chat_id, tipo, cotizado, motivo_juez, evidencia, estado, creado_en")
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
    .select("chat_id, nombre, ultimo_mensaje_en, ultimo_mensaje_texto, ultimo_mensaje_rol")
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
 * ⚠️ SE MARCA APROBADA **DESPUÉS** DE PROGRAMAR, NO ANTES. Si se marcara
 * primero y `programarSeguimiento` fallara —una plantilla que no existe, un
 * parámetro vacío—, la propuesta desaparecería de la lista sin que el mensaje
 * exista en ninguna parte: Cecilia creería que lo mandó y nadie escribió nunca.
 * En el orden correcto, un fallo la deja visible para intentar de nuevo.
 */
export async function aprobarPropuesta(p: {
  clienteId: string;
  propuestaId: string;
  negocio: string;
  email: string;
  supa?: SupabaseClient;
}): Promise<{ ok: boolean; error?: string }> {
  const supa = p.supa ?? db();

  const { data: fila } = await supa
    .from("ed_propuestas_seguimiento")
    .select("id, empleado_id, chat_id, tipo, cotizado, estado")
    .eq("id", p.propuestaId)
    .eq("cliente_id", p.clienteId) // el aislamiento va en el WHERE, siempre
    .maybeSingle();

  if (!fila) return { ok: false, error: "La propuesta ya no existe" };
  if (fila.estado !== "propuesto") return { ok: false, error: "Esta propuesta ya se resolvió" };

  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("nombre")
    .eq("cliente_id", p.clienteId)
    .eq("chat_id", fila.chat_id as string)
    .maybeSingle();

  const r = await programarSeguimiento({
    empleadoId: fila.empleado_id as string,
    chatId: fila.chat_id as string,
    tipo: fila.tipo as string,
    paramsPlantilla: [
      ((contacto?.nombre as string | null) || "hola").trim(),
      p.negocio,
      (fila.cotizado as string | null) || "lo que nos consultaste",
    ],
    programadoPara: new Date(),
    supa,
  });
  if (!r.ok) return r;

  const { error } = await supa
    .from("ed_propuestas_seguimiento")
    .update({ estado: "aprobado", resuelto_en: new Date().toISOString(), resuelto_por: p.email })
    .eq("id", p.propuestaId)
    .eq("cliente_id", p.clienteId);

  if (error) {
    /**
     * El mensaje YA quedó programado y la propuesta sigue en 'propuesto'. Es el
     * lado seguro del fallo —se ve, no se pierde— pero hay que decirlo, o
     * aprobarla de nuevo mandaría el mensaje dos veces.
     */
    return { ok: false, error: `Se programó el mensaje pero no se pudo marcar aprobada: ${error.message}` };
  }
  return { ok: true };
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
