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
/** Solo existe en la copia hacia BrainRoot (lo que escribe una persona desde el celular). */
export type TipoEventoBrainroot = TipoEvento | "message.outbound";

/** Minutos de espera antes de cada reintento. */
export const ESPERAS_MIN = [1, 5, 15, 60, 360, 1440];
const MAX_INTENTOS = ESPERAS_MIN.length + 1;
const TIMEOUT_MS = 4000;

/**
 * Freno de entrega inmediata. Si Kambak está caído, cada aviso de Meta
 * (a veces decenas en un mismo paquete) esperaría hasta TIMEOUT_MS y el
 * webhook de Meta podría pasarse de plazo. Tras un fallo, durante un minuto
 * los eventos solo se encolan y los entrega el cron con sus reintentos.
 */
const PAUSA_MS = 60_000;
let pausaHasta = 0;
export function reiniciarPausaWebhook(): void {
  pausaHasta = 0;
}

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
  /** Campos que van SOLO en la copia hacia BrainRoot (kambak.cl no los recibe). */
  extraBrainroot?: Record<string, unknown>,
): Promise<void> {
  await emitirKambak(clienteId, tipo, clave, data);
  // DESPUÉS de Kambak y por un camino aparte: si BrainRoot falla o tarda,
  // kambak.cl no se entera ni se atrasa.
  await emitirBrainroot(clienteId, tipo, clave, { ...data, ...(extraBrainroot ?? {}) });
}

async function emitirKambak(
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
    if (Date.now() < pausaHasta) return; // queda pendiente para el cron
    const ok = await entregar(fila as FilaEvento);
    if (!ok) pausaHasta = Date.now() + PAUSA_MS;
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
  let seguidosFallidos = 0;
  let revisados = 0;
  for (const f of data ?? []) {
    revisados++;
    if (await entregar(f as FilaEvento, ahora)) {
      entregados++;
      seguidosFallidos = 0;
    } else if (++seguidosFallidos >= 2) {
      break; // Kambak no responde: no se gasta el plazo del cron esperando evento por evento
    }
  }
  return { revisados, entregados };
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


/* ========================================================================== *
 * COPIA HACIA BRAINROOT (3-nov-2026)
 *
 * BrainRoot (el sistema personal de Marcelo) recibe una COPIA de los eventos
 * de las cuentas de solo mensajería (Kambak). No reemplaza nada: el webhook de
 * Meta sigue llegando acá, la bandeja sigue igual y kambak.cl sigue recibiendo
 * sus avisos. BrainRoot es un segundo destino con cola y reintentos PROPIOS
 * (tabla ed_eventos_brainroot, migración 329): si BrainRoot falla, Kambak no
 * se entera ni se atrasa, y viceversa.
 *
 * CONFIGURACIÓN:
 *   BRAINROOT_WEBHOOK_SECRET  secreto compartido. SIN ÉL NO SE MANDA NADA.
 *   BRAINROOT_WEBHOOK_URL     opcional; por defecto la de producción de BrainRoot.
 * No depende de KAMBAK_WEBHOOK_*: la copia funciona aunque kambak.cl esté apagado.
 *
 * Mismo sobre {id, type, created_at, data} y mismas cabeceras/firma que Kambak.
 * Además de los 3 eventos de Kambak, BrainRoot recibe `message.outbound`
 * (lo que una persona escribe desde la app del celular, por Coexistencia).
 *
 * Si la migración 329 todavía no está aplicada, el evento se intenta entregar
 * UNA vez en el acto, sin cola (mejor algo que nada), y se avisa en el log.
 * ========================================================================== */

export const BRAINROOT_URL_POR_DEFECTO =
  "https://brainroot-eight.vercel.app/api/integrations/respondo/webhook";

let pausaBrainrootHasta = 0;
export function reiniciarPausaBrainroot(): void {
  pausaBrainrootHasta = 0;
}

export function configBrainroot(): { url: string; secreto: string } | null {
  const secreto = process.env.BRAINROOT_WEBHOOK_SECRET ?? "";
  if (!secreto) return null;
  const url = (process.env.BRAINROOT_WEBHOOK_URL ?? "").trim() || BRAINROOT_URL_POR_DEFECTO;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, secreto };
}

/** Postgres 42P01 / PostgREST PGRST205: la tabla no existe (migración 329 sin aplicar). */
function esTablaInexistente(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

async function postFirmado(
  cfg: { url: string; secreto: string },
  f: FilaEvento,
): Promise<string | null> {
  const cuerpo = cuerpoDe(f);
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
    return r.ok ? null : `HTTP ${r.status}`;
  } catch (e) {
    return ((e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message).slice(0, 120);
  }
}

/**
 * Encola la copia para BrainRoot y la intenta entregar en el acto.
 * Nunca lanza. Solo cuentas de solo mensajería (Kambak).
 */
export async function emitirBrainroot(
  clienteId: string,
  tipo: TipoEventoBrainroot,
  clave: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const cfg = configBrainroot();
    if (!cfg) return;
    if (!(await esSoloMensajeria(clienteId))) return;
    const supa = db();
    const { data: fila, error } = await supa
      .from("ed_eventos_brainroot")
      .insert({ cliente_id: clienteId, clave, tipo, payload: data, estado: "pendiente", intentos: 0, proximo_intento: new Date().toISOString() })
      .select("id, cliente_id, tipo, payload, intentos, creado_en")
      .single();
    if (error) {
      if (error.code === "23505") return; // ya estaba (Meta repitió el aviso)
      if (esTablaInexistente(error)) {
        // Sin cola todavía: un solo intento directo, con un id estable por evento.
        console.error("[brainroot] falta la migración 329; entrega directa sin reintentos");
        if (Date.now() < pausaBrainrootHasta) return;
        const directo: FilaEvento = {
          id: idEstable(clienteId, clave),
          cliente_id: clienteId,
          tipo,
          payload: data,
          intentos: 0,
        };
        const err = await postFirmado(cfg, directo);
        if (err) {
          pausaBrainrootHasta = Date.now() + PAUSA_MS;
          console.error("[brainroot] entrega directa falló:", err);
        }
        return;
      }
      console.error("[brainroot] no se pudo encolar:", error.message);
      return;
    }
    if (Date.now() < pausaBrainrootHasta) return; // queda para el cron
    const ok = await entregarBrainroot(fila as FilaEvento);
    if (!ok) pausaBrainrootHasta = Date.now() + PAUSA_MS;
  } catch (e) {
    console.error("[brainroot]", (e as Error).message);
  }
}

/** UUID determinista (v4 de forma) a partir de cliente+clave: BrainRoot deduplica por él. */
function idEstable(clienteId: string, clave: string): string {
  const h = createHmac("sha256", "brainroot-id").update(`${clienteId}:${clave}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function entregarBrainroot(f: FilaEvento, ahora: Date = new Date()): Promise<boolean> {
  const cfg = configBrainroot();
  const supa = db();
  if (!cfg) {
    await supa.from("ed_eventos_brainroot")
      .update({ ultimo_error: "brainroot sin configurar", proximo_intento: new Date(ahora.getTime() + 15 * 60_000).toISOString() })
      .eq("id", f.id);
    return false;
  }
  const error = await postFirmado(cfg, f);
  if (!error) {
    await supa.from("ed_eventos_brainroot")
      .update({ estado: "enviado", payload: null, ultimo_error: null, entregado_en: ahora.toISOString(), intentos: f.intentos + 1 })
      .eq("id", f.id);
    return true;
  }
  const intentos = f.intentos + 1;
  if (intentos >= MAX_INTENTOS) {
    await supa.from("ed_eventos_brainroot").update({ estado: "fallido", intentos, ultimo_error: error }).eq("id", f.id);
  } else {
    const espera = ESPERAS_MIN[intentos - 1] * 60_000;
    await supa.from("ed_eventos_brainroot")
      .update({ intentos, ultimo_error: error, proximo_intento: new Date(ahora.getTime() + espera).toISOString() })
      .eq("id", f.id);
  }
  return false;
}

/** Cron: reintenta la cola de BrainRoot. Independiente de la de Kambak. */
export async function procesarEventosBrainroot(
  ahora: Date = new Date(),
  max = 30,
): Promise<{ revisados: number; entregados: number }> {
  if (!configBrainroot()) return { revisados: 0, entregados: 0 };
  const { data, error } = await db()
    .from("ed_eventos_brainroot")
    .select("id, cliente_id, tipo, payload, intentos, creado_en")
    .eq("estado", "pendiente").lte("proximo_intento", ahora.toISOString())
    .order("proximo_intento", { ascending: true }).limit(max);
  if (error) return { revisados: 0, entregados: 0 }; // p. ej. migración 329 sin aplicar
  let entregados = 0;
  let seguidosFallidos = 0;
  let revisados = 0;
  for (const f of data ?? []) {
    revisados++;
    if (await entregarBrainroot(f as FilaEvento, ahora)) {
      entregados++;
      seguidosFallidos = 0;
    } else if (++seguidosFallidos >= 2) {
      break;
    }
  }
  return { revisados, entregados };
}
