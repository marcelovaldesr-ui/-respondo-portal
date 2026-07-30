import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { secretoValido } from "@/lib/seguridad";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * SALUD DEL SISTEMA — un solo vistazo a todo lo que puede fallar.
 *
 * PROBLEMA QUE RESUELVE: hoy, si Tino deja de responder de madrugada (WAHA
 * desconectado, token vencido, modelo caído, base inalcanzable), NADIE se entera
 * hasta que un cliente reclama. Este endpoint responde "¿está todo bien?" en una
 * llamada, y devuelve HTTP 503 cuando algo está roto — que es justo lo que
 * cualquier vigilante gratuito (cron-job.org, UptimeRobot) necesita para avisar
 * por correo automáticamente. Sin desplegar nada extra.
 *
 * Uso:
 *   GET /api/salud            → chequeo liviano (base + WAHA + actividad)
 *   GET /api/salud?full=1&k=  → agrega modelo IA y token de Meta (gasta cuota)
 *
 * Protección: los detalles internos solo se muestran con el secreto correcto;
 * sin él responde apenas ok/degradado (para no filtrar la infraestructura).
 */

type Chequeo = { ok: boolean; detalle: string; ms?: number };

async function medir(fn: () => Promise<Chequeo>): Promise<Chequeo> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { ...r, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detalle: (e as Error).message, ms: Date.now() - t0 };
  }
}

/** 1) Base de datos: ¿responde y trae datos? */
async function chequearBase(): Promise<Chequeo> {
  const { error, count } = await db()
    .from("ed_clientes")
    .select("id", { count: "exact", head: true });
  if (error) return { ok: false, detalle: `error: ${error.message}` };
  return { ok: true, detalle: `${count ?? 0} clientes` };
}

/** 2) WAHA: ¿la sesión sigue vinculada y trabajando? */
async function chequearWaha(): Promise<Chequeo> {
  const base = (process.env.WAHA_API_URL ?? "").replace(/\/+$/, "");
  const key = process.env.WAHA_API_KEY;
  const sesion = process.env.WAHA_SESSION || "default";
  if (!base || !key) return { ok: true, detalle: "no configurado (omitido)" };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/api/sessions/${sesion}`, {
      headers: { "X-Api-Key": key },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, detalle: `HTTP ${r.status}` };
    const j = (await r.json()) as { status?: string; me?: { id?: string } };
    const estado = j.status ?? "?";
    // SCAN_QR_CODE / FAILED / STOPPED = Tino NO puede atender por este canal.
    return {
      ok: estado === "WORKING",
      detalle: `${estado}${j.me?.id ? ` · ${j.me.id}` : ""}`,
    };
  } finally {
    clearTimeout(t);
  }
}

/**
 * 3) Actividad reciente — el chequeo MÁS IMPORTANTE.
 * Detecta el fallo silencioso: todo "verde" pero nada fluyendo. Si entraron
 * mensajes de clientes y el asistente no respondió ninguno, algo está roto
 * aunque los servicios digan estar bien.
 */
async function chequearActividad(): Promise<Chequeo> {
  const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const supa = db();
  const [ent, sal] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .eq("rol", "cliente")
      .gte("creado_en", desde),
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .in("rol", ["empleado", "humano"])
      .gte("creado_en", desde),
  ]);
  const entrantes = ent.count ?? 0;
  const salientes = sal.count ?? 0;
  // Señal de alarma: llegaron mensajes y NO salió ninguno.
  const mudo = entrantes >= 3 && salientes === 0;
  return {
    ok: !mudo,
    detalle: mudo
      ? `⚠ ${entrantes} mensajes entrantes en 6h y NINGUNA respuesta`
      : `6h: ${entrantes} entrantes / ${salientes} salientes`,
  };
}

/** 4) Modelo de IA (solo en modo full: consume cuota). */
async function chequearModelo(): Promise<Chequeo> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { ok: false, detalle: "falta GEMINI_API_KEY" };
  const modelo = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`,
      {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "di OK" }] }] }),
      },
    );
    return r.ok
      ? { ok: true, detalle: modelo }
      : { ok: false, detalle: `${modelo}: HTTP ${r.status}` };
  } finally {
    clearTimeout(t);
  }
}

/** 5) Token de Meta (solo en modo full): detecta un token revocado/vencido. */
async function chequearMeta(): Promise<Chequeo> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: true, detalle: "no configurado (omitido)" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}?fields=quality_rating`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return { ok: false, detalle: `token/número inválido (HTTP ${r.status})` };
    const j = (await r.json()) as { quality_rating?: string };
    return { ok: true, detalle: `calidad ${j.quality_rating ?? "?"}` };
  } finally {
    clearTimeout(t);
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const full = searchParams.get("full") === "1";
  const secreto = process.env.CRON_SECRET || process.env.EVOLUTION_WEBHOOK_SECRET;
  const autorizado = secretoValido(searchParams.get("k"), secreto);

  const chequeos: Record<string, Chequeo> = {
    base_de_datos: await medir(chequearBase),
    whatsapp_waha: await medir(chequearWaha),
    actividad: await medir(chequearActividad),
  };
  if (full && autorizado) {
    chequeos.modelo_ia = await medir(chequearModelo);
    chequeos.whatsapp_meta = await medir(chequearMeta);
  }

  const sano = Object.values(chequeos).every((c) => c.ok);
  const estado = sano ? "ok" : "degradado";

  // Sin el secreto: solo el veredicto (no filtrar detalles de infraestructura).
  if (!autorizado) {
    return NextResponse.json({ estado }, { status: sano ? 200 : 503 });
  }

  return NextResponse.json(
    {
      estado,
      revisado: new Date().toISOString(),
      chequeos,
      // 503 hace que cualquier vigilante externo (cron-job.org, UptimeRobot)
      // dispare la alerta por correo automáticamente.
    },
    { status: sano ? 200 : 503 },
  );
}
