import { db } from "@/lib/db";
import { manejarEntranteMeta } from "@/lib/inboundMeta";
import { manejarEntranteWaha } from "@/lib/inboundWaha";
import { manejarEntranteInstagram } from "@/lib/inboundInstagram";
import { logOperacion } from "@/lib/observabilidad";
import type { ProveedorWebhook } from "@/lib/webhookId";

export { idEventoWebhook } from "@/lib/webhookId";

type Reclamo = { id: string; procesar: boolean; estado: string };

async function reclamar(
  proveedor: ProveedorWebhook,
  eventoId: string,
  payload: unknown,
): Promise<Reclamo> {
  const { data, error } = await db().rpc("ed_reclamar_webhook", {
    p_proveedor: proveedor,
    p_evento_id: eventoId,
    p_payload: payload,
  });
  if (error) throw new Error(`inbox webhook no disponible: ${error.message}`);
  const fila = (Array.isArray(data) ? data[0] : data) as
    | { evento_uuid?: string; procesar?: boolean; estado_actual?: string }
    | null;
  if (!fila?.evento_uuid || typeof fila.procesar !== "boolean") {
    throw new Error("inbox webhook devolvió una respuesta inválida");
  }
  return {
    id: fila.evento_uuid,
    procesar: fila.procesar,
    estado: fila.estado_actual ?? "error",
  };
}

async function finalizar(id: string, ok: boolean, error?: string): Promise<void> {
  const ahora = new Date().toISOString();
  const { error: dbError } = await db()
    .from("ed_webhook_eventos")
    .update({
      estado: ok ? "procesado" : "error",
      ultimo_error: ok ? null : (error ?? "error").slice(0, 500),
      procesado_en: ok ? ahora : null,
      actualizado_en: ahora,
    })
    .eq("id", id);
  if (dbError) throw new Error(`no se pudo finalizar webhook: ${dbError.message}`);
}

export async function ejecutarProveedor(
  proveedor: ProveedorWebhook,
  payload: unknown,
): Promise<unknown> {
  if (proveedor === "meta_whatsapp") return manejarEntranteMeta(payload);
  if (proveedor === "instagram") return manejarEntranteInstagram(payload);
  return manejarEntranteWaha(payload);
}

/** Reclama idempotentemente, procesa y registra éxito/error durable. */
export async function procesarConInbox<T>(params: {
  proveedor: ProveedorWebhook;
  eventoId: string;
  payload: unknown;
  requestId: string;
  manejar?: (payload: unknown) => Promise<T>;
}): Promise<{ duplicado: boolean; resultado?: T }> {
  const reclamo = await reclamar(params.proveedor, params.eventoId, params.payload);
  if (!reclamo.procesar) {
    logOperacion("info", "webhook_duplicado", {
      requestId: params.requestId,
      proveedor: params.proveedor,
    }, { estado: reclamo.estado });
    return { duplicado: true };
  }

  try {
    const resultado = params.manejar
      ? await params.manejar(params.payload)
      : (await ejecutarProveedor(params.proveedor, params.payload)) as T;
    await finalizar(reclamo.id, true);
    logOperacion("info", "webhook_procesado", {
      requestId: params.requestId,
      proveedor: params.proveedor,
    });
    return { duplicado: false, resultado };
  } catch (error) {
    const mensaje = (error as Error).message || "error desconocido";
    try {
      await finalizar(reclamo.id, false, mensaje);
    } catch (finalError) {
      logOperacion("error", "webhook_finalizacion_fallida", {
        requestId: params.requestId,
        proveedor: params.proveedor,
      }, { error: (finalError as Error).message.slice(0, 200) });
    }
    logOperacion("error", "webhook_procesamiento_fallido", {
      requestId: params.requestId,
      proveedor: params.proveedor,
    }, { error: mensaje.slice(0, 200) });
    throw error;
  }
}

/** Reintenta errores y vacía payloads antiguos conservando la idempotencia. */
export async function reprocesarWebhooksPendientes(limite = 10): Promise<{
  reintentados: number;
  fallidos: number;
  purgados: number;
}> {
  const supa = db();
  const tope = Math.min(50, Math.max(1, limite));
  const corteError = new Date(Date.now() - 60_000).toISOString();
  const corteAtascado = new Date(Date.now() - 5 * 60_000).toISOString();
  const [errores, atascados] = await Promise.all([
    supa
      .from("ed_webhook_eventos")
      .select("proveedor, evento_id, payload")
      .eq("estado", "error")
      .lt("intentos", 8)
      .lt("actualizado_en", corteError)
      .order("actualizado_en", { ascending: true })
      .limit(tope),
    supa
      .from("ed_webhook_eventos")
      .select("proveedor, evento_id, payload")
      .eq("estado", "procesando")
      .lt("intentos", 8)
      .lt("actualizado_en", corteAtascado)
      .order("actualizado_en", { ascending: true })
      .limit(tope),
  ]);
  if (errores.error || atascados.error) {
    throw new Error(`no se pudieron listar webhooks: ${errores.error?.message ?? atascados.error?.message}`);
  }
  const pendientes = [...(errores.data ?? []), ...(atascados.data ?? [])].slice(0, tope);

  let reintentados = 0;
  let fallidos = 0;
  for (const fila of pendientes) {
    const proveedor = fila.proveedor as ProveedorWebhook;
    try {
      const r = await procesarConInbox({
        proveedor,
        eventoId: fila.evento_id as string,
        payload: fila.payload,
        requestId: `cron-${(fila.evento_id as string).slice(0, 12)}`,
      });
      if (!r.duplicado) reintentados++;
    } catch {
      fallidos++;
    }
  }

  const retencion = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: purgados, error: errorPurga } = await supa
    .from("ed_webhook_eventos")
    .update({ payload: {}, payload_purgado_en: new Date().toISOString() })
    .eq("estado", "procesado")
    .lt("procesado_en", retencion)
    .is("payload_purgado_en", null)
    .select("id");
  if (errorPurga) throw new Error(`no se pudieron purgar payloads: ${errorPurga.message}`);

  // Todos los límites admiten como máximo 24 h; dos días sin actividad hacen
  // segura la limpieza y evitan crecimiento ilimitado por claves aleatorias.
  await supa
    .from("ed_rate_limits")
    .delete()
    .lt("actualizado_en", new Date(Date.now() - 2 * 86400_000).toISOString());
  return { reintentados, fallidos, purgados: purgados?.length ?? 0 };
}
