import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import { esSoloMensajeria } from "@/lib/soloMensajeria";

/**
 * WEBHOOK DE SALIDA HACIA KAMBAK.
 *
 * El portal le avisa al sistema de Kambak (kambak.cl) lo que pasó con sus
 * mensajes, para que su base de datos refleje la realidad:
 *   - message.status   sent | delivered | read | failed (+ reason)
 *   - message.inbound  alguien le escribió al número
 *   - contact.optout   alguien pidió no recibir más avisos
 *
 * CONFIGURACIÓN (solo variables de entorno, cargadas por una persona):
 *   KAMBAK_WEBHOOK_URL      dirección completa (https), ej. la de /api/hooks/respondo
 *   KAMBAK_WEBHOOK_SECRET   secreto compartido para la firma
 * Sin alguna de las dos, no se encola nada (apagado seguro).
 *
 * FIRMA: cabecera `X-Respondo-Signature: sha256=<hex>`, con
 * HMAC-SHA256(secreto, cuerpo EXACTO). Otras cabeceras: `X-Respondo-Event`
 * (tipo) y `X-Respondo-Delivery` (id del evento, para que Kambak ignore
 * repetidos). Kambak responde 2xx = recibido; cualquier otra cosa se reintenta.
 *
 * REINTENTOS: 1 min, 5 min, 15 min, 1 h, 6 h, 24 h. Después de eso el evento
 * queda `fallido` en ed_eventos_salida (la bandeja de fallidos) y se puede
 * reenviar con POST /api/kambak/eventos.
 *
 * Solo emiten cuentas de solo mensajería: es un canal pensado para Kambak, no un
 * puente genérico (para clientes con sistema propio ya existe puenteSalida.ts).
 */

export type TipoEvento = "message.status" | "message.inbound" | "contact.optout";

/** Minutos de espera antes de cada reintento. */
export const ESPERAS_MIN = [1, 5, 15, 60, 360, 1440];
const MAX_INTENTOS = ESPERAS_MIN.length + 1;
const TIMEOUT_MS = 4000;

export function configWebhook(): { url: string; secreto: string } | null {
  const url = (process.env.KAMBAK_WEBHOOK_URL ?? "").trim();
  const secreto = process.env.KAMBAK_WEBHOOK_SECRET ?? "";
  if (!url || !secreto) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, secreto };
}

export function firmarCuerpo(cuerpo: string, secreto: string): string {
  return "sha256=" + createHmac("sha256", secreto).update(cuerpo).digest("hex");
}

type FilaEvento = {
  id: string;
  cliente_id: string;
  tipo: string;
  payload: Record<string, unknown> | null;
  intentos: number;
  creado_en?: string;
};

function cuerpoDe(f: FilaEvento): string {
  return JSON.stringify({
    id: f.id,
    type: f.tipo,
    created_at: f.creado_en ?? new Date().toISOString(),
    data: f.payload ?? {},
  });
}

/**
 * Deja el evento en la cola y lo intenta entregar en el acto (con plazo corto).
 * Nunca lanza: un problema con Kambak no puede afectar al mensaje que lo causó.
 */
export async function emitirEvento(
  clienteId: string,
  tipo: TipoEvento,
  clave: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    if (!configWebhook()) return;
    if (!(await esSoloMensajeria(clienteId))) return;
    const supa = db();
    const { data: fila, error } = await supa
      .from("ed_eventos_salida")
      .insert({ cliente_id: clienteId, clave, tipo, payload: data, estado: "pendiente", intentos: 0, proximo_intento: new Date().toISOString() })
      .select("id, cliente_id, tipo, payload, intentos, creado_en")
      .single();
    if (error) {
      if (error.code !== "23505") console.error("[webhook-salida] no se pudo encolar:", error.message);
      return; // 23505 = ya estaba (Meta repitió el aviso)
    }
    await entregar(fila as FilaEvento);
  } catch (e) {
    console.error("[webhook-salida]", (e as Error).message);
  }
}

/** Un intento de entrega. Actualiza la fila según el resultado. */
export async function entregar(f: FilaEvento, ahora: Date = new Date()): Promise<boolean> {
  const cfg = configWebhook();
  const supa = db();
  if (!cfg) {
    // Sin configuración no se pierde nada: queda pendiente para cuando se cargue.
    await supa.from("ed_eventos_salida")
      .update({ ultimo_error: "webhook sin configurar", proximo_intento: new Date(ahora.getTime() + 15 * 60_000).toISOString() })
      .eq("id", f.id);
    return false;
  }
  const cuerpo = cuerpoDe(f);
  let error: string | null = null;
  try {
    const r = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Respondo-Signature": firmarCuerpo(cuerpo, cfg.secreto),
        "X-Respondo-Event": f.tipo,
        "X-Respondo-Delivery": f.id,
      },
      body: cuerpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) error = `HTTP ${r.status}`;
  } catch (e) {
    error = ((e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message).slice(0, 120);
  }

  if (!error) {
    await supa.from("ed_eventos_salida")
      .update({ estado: "enviado", payload: null, ultimo_error: null, entregado_en: ahora.toISOString(), intentos: f.intentos + 1 })
      .eq("id", f.id);
    return true;
  }
  const intentos = f.intentos + 1;
  if (intentos >= MAX_INTENTOS) {
    await supa.from("ed_eventos_salida").update({ estado: "fallido", intentos, ultimo_error: error }).eq("id", f.id);
  } else {
    const espera = ESPERAS_MIN[intentos - 1] * 60_000;
    await supa.from("ed_eventos_salida")
      .update({ intentos, ultimo_error: error, proximo_intento: new Date(ahora.getTime() + espera).toISOString() })
      .eq("id", f.id);
  }
  return false;
}

/** Cron: reintenta lo pendiente cuyo turno ya llegó. */
export async function procesarEventosPendientes(
  ahora: Date = new Date(),
  max = 30,
): Promise<{ revisados: number; entregados: number }> {
  if (!configWebhook()) return { revisados: 0, entregados: 0 };
  const { data } = await db()
    .from("ed_eventos_salida")
    .select("id, cliente_id, tipo, payload, intentos, creado_en")
    .eq("estado", "pendiente").lte("proximo_intento", ahora.toISOString())
    .order("proximo_intento", { ascending: true }).limit(max);
  let entregados = 0;
  for (const f of data ?? []) if (await entregar(f as FilaEvento, ahora)) entregados++;
  return { revisados: (data ?? []).length, entregados };
}

/** Bandeja de fallidos: devuelve los eventos a la cola para un nuevo ciclo. */
export async function reencolarFallidos(clienteId: string, ids?: string[]): Promise<number> {
  let q = db().from("ed_eventos_salida")
    .update({ estado: "pendiente", intentos: 0, proximo_intento: new Date().toISOString() })
    .eq("cliente_id", clienteId).eq("estado", "fallido");
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q.select("id");
  return (data ?? []).length;
}
