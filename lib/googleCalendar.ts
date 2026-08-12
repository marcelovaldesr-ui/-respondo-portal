import { createSign } from "crypto";

/**
 * GOOGLE CALENDAR POR CUENTA DE SERVICIO (F5, vía sin verificación OAuth).
 *
 * POR QUÉ ASÍ: la verificación de la app de Google (pantalla de consentimiento,
 * video demo, revisión) tarda días. Una CUENTA DE SERVICIO no la necesita: es
 * un "correo robot" con el que el dueño COMPARTE su calendario, igual que se
 * lo compartiría a una recepcionista. Desde ese momento podemos leer su
 * disponibilidad y escribirle las citas, sin tokens que expiren ni pantallas
 * de "app no verificada".
 *
 * SIN DEPENDENCIAS: el JWT se firma con `crypto` de Node (RS256). No se
 * instala googleapis ni nada — menos superficie, menos peso en Vercel.
 *
 * INERTE POR DEFECTO: si no hay credenciales en el entorno, todas las
 * funciones devuelven `{ok:false, motivo:"sin_credenciales"}` sin lanzar. El
 * resto del sistema (y Tino) sigue exactamente igual.
 *
 * CONFIGURACIÓN (variables de entorno):
 *   GOOGLE_SA_EMAIL        = agenda@<proyecto>.iam.gserviceaccount.com
 *   GOOGLE_SA_PRIVATE_KEY  = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 * (En Vercel, los \n del JSON quedan escritos como texto: se normalizan abajo.)
 */

const SCOPE = "https://www.googleapis.com/auth/calendar";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

export type ResultadoGCal<T = void> =
  | { ok: true; datos: T }
  | { ok: false; motivo: "sin_credenciales" | "auth" | "api" | "red"; detalle?: string };

function credenciales(): { email: string; clave: string } | null {
  const email = process.env.GOOGLE_SA_EMAIL?.trim();
  const claveCruda = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !claveCruda) return null;
  // En paneles como Vercel la clave se pega con "\n" literales.
  const clave = claveCruda.includes("\\n") ? claveCruda.replace(/\\n/g, "\n") : claveCruda;
  if (!clave.includes("BEGIN") || !clave.includes("PRIVATE KEY")) return null;
  return { email, clave };
}

/** ¿Está configurada la sincronización con Google? (para mostrarlo en el portal) */
export function googleCalendarConfigurado(): boolean {
  return credenciales() !== null;
}

/** base64url sin padding, como exige JWT. */
function b64url(entrada: Buffer | string): string {
  return Buffer.from(entrada)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Token cacheado en memoria de la instancia (dura ~1h; se renueva antes).
let tokenCache: { valor: string; expiraEn: number } | null = null;

async function accessToken(): Promise<ResultadoGCal<string>> {
  const cred = credenciales();
  if (!cred) return { ok: false, motivo: "sin_credenciales" };

  const ahora = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiraEn > ahora + 60) {
    return { ok: true, datos: tokenCache.valor };
  }

  const cabecera = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const cuerpo = b64url(
    JSON.stringify({
      iss: cred.email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: ahora,
      exp: ahora + 3600,
    }),
  );

  let firma: string;
  try {
    const sign = createSign("RSA-SHA256");
    sign.update(`${cabecera}.${cuerpo}`);
    sign.end();
    firma = b64url(sign.sign(cred.clave));
  } catch (e) {
    return { ok: false, motivo: "auth", detalle: `firma inválida: ${(e as Error).message}` };
  }

  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${cabecera}.${cuerpo}.${firma}`,
      }),
      cache: "no-store",
    });
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!r.ok || !j.access_token) {
      return { ok: false, motivo: "auth", detalle: j.error_description ?? `HTTP ${r.status}` };
    }
    tokenCache = { valor: j.access_token, expiraEn: ahora + (j.expires_in ?? 3600) };
    return { ok: true, datos: j.access_token };
  } catch (e) {
    return { ok: false, motivo: "red", detalle: (e as Error).message };
  }
}

async function llamar<T>(
  ruta: string,
  init: { method: string; body?: unknown },
  // Con tokenOAuth: se usa ESE token (del dueño conectado por OAuth) en vez
  // de la cuenta de servicio. Ver lib/googleOAuth.ts — los dos mecanismos
  // hablan la misma API de Google, solo cambia de quién es el token.
  tokenOAuth?: string,
): Promise<ResultadoGCal<T>> {
  const tk = tokenOAuth ? ({ ok: true, datos: tokenOAuth } as const) : await accessToken();
  if (!tk.ok) return tk;
  try {
    const r = await fetch(`${API}${ruta}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${tk.datos}`,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    if (r.status === 204) return { ok: true, datos: undefined as T };
    const j = (await r.json()) as T & { error?: { message?: string } };
    if (!r.ok) {
      return { ok: false, motivo: "api", detalle: j?.error?.message ?? `HTTP ${r.status}` };
    }
    return { ok: true, datos: j };
  } catch (e) {
    return { ok: false, motivo: "red", detalle: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export type EventoGCal = {
  citaId: string;
  calendarioId: string;
  titulo: string;
  descripcion?: string;
  inicio: string; // ISO
  fin: string; // ISO
};

/**
 * Crea (o actualiza si ya existía) el evento de una cita.
 * Usa un id determinista derivado del id de la cita, así reagendar ACTUALIZA
 * el mismo evento en vez de duplicarlo, sin guardar estado extra.
 * Los ids de Google admiten solo a-v y 0-9, así que el uuid se recodifica.
 */
export function idEventoDesdeCita(citaId: string): string {
  const hex = citaId.replace(/-/g, "").toLowerCase();
  // hex (0-9a-f) ya es válido para Google; se prefija para reconocerlo.
  return `respondo${hex}`;
}

export async function guardarEvento(ev: EventoGCal, tokenOAuth?: string): Promise<ResultadoGCal<unknown>> {
  const cuerpo = {
    id: idEventoDesdeCita(ev.citaId),
    summary: ev.titulo,
    description: ev.descripcion,
    start: { dateTime: new Date(ev.inicio).toISOString(), timeZone: "America/Santiago" },
    end: { dateTime: new Date(ev.fin).toISOString(), timeZone: "America/Santiago" },
    source: { title: "Respondo", url: "https://respon-do.com" },
  };
  const cal = encodeURIComponent(ev.calendarioId);
  const idEv = encodeURIComponent(cuerpo.id);

  // Primero intentar crear; si ya existe (409), actualizar.
  const creado = await llamar<unknown>(`/calendars/${cal}/events`, { method: "POST", body: cuerpo }, tokenOAuth);
  if (creado.ok) return creado;
  if (creado.motivo === "api" && /already exists|duplicate/i.test(creado.detalle ?? "")) {
    return llamar<unknown>(`/calendars/${cal}/events/${idEv}`, { method: "PUT", body: cuerpo }, tokenOAuth);
  }
  return creado;
}

export async function borrarEvento(
  calendarioId: string,
  citaId: string,
  tokenOAuth?: string,
): Promise<ResultadoGCal<unknown>> {
  const cal = encodeURIComponent(calendarioId);
  const idEv = encodeURIComponent(idEventoDesdeCita(citaId));
  const r = await llamar<unknown>(`/calendars/${cal}/events/${idEv}`, { method: "DELETE" }, tokenOAuth);
  // Borrar algo que ya no está no es un error para nosotros.
  if (!r.ok && r.motivo === "api" && /not found|deleted/i.test(r.detalle ?? "")) {
    return { ok: true, datos: undefined };
  }
  return r;
}

// ---------------------------------------------------------------------------
// Free/busy (para que la agenda respete los compromisos personales del dueño)
// ---------------------------------------------------------------------------

export type Ocupacion = { calendarioId: string; desde: string; hasta: string };

/**
 * Consulta los bloques ocupados de varios calendarios en una ventana.
 * Devuelve lista vacía (no error) cuando no hay credenciales, para que la
 * disponibilidad siga calculándose igual que hoy.
 */
export async function ocupadosDeGoogle(
  calendarios: string[],
  desdeIso: string,
  hastaIso: string,
): Promise<Ocupacion[]> {
  if (calendarios.length === 0) return [];
  const r = await llamar<{
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  }>("/freeBusy", {
    method: "POST",
    body: {
      timeMin: new Date(desdeIso).toISOString(),
      timeMax: new Date(hastaIso).toISOString(),
      timeZone: "America/Santiago",
      items: calendarios.map((id) => ({ id })),
    },
  });
  if (!r.ok) {
    if (r.motivo !== "sin_credenciales") {
      console.error("[googleCalendar] freeBusy:", r.motivo, r.detalle);
    }
    return [];
  }
  const salida: Ocupacion[] = [];
  for (const [calendarioId, info] of Object.entries(r.datos.calendars ?? {})) {
    for (const b of info.busy ?? []) {
      salida.push({ calendarioId, desde: b.start, hasta: b.end });
    }
  }
  return salida;
}

/** Comprobación de acceso: ¿la cuenta de servicio ve este calendario? */
export async function probarCalendario(calendarioId: string): Promise<ResultadoGCal<{ resumen?: string }>> {
  return llamar<{ resumen?: string }>(`/calendars/${encodeURIComponent(calendarioId)}`, {
    method: "GET",
  });
}

/**
 * Igual que ocupadosDeGoogle, pero para UN calendario con SU PROPIO token
 * OAuth — no se pueden batchear varios calendarios de distintos dueños en
 * una sola llamada de freeBusy porque cada token de OAuth solo ve el
 * calendario de la persona que lo autorizó (a diferencia de la cuenta de
 * servicio, que puede consultar cualquier calendario que se le haya
 * compartido en una sola llamada).
 */
export async function ocupadosDeUnCalendario(
  calendarioId: string,
  desdeIso: string,
  hastaIso: string,
  tokenOAuth: string,
  // Devuelve TAMBIÉN el error, no solo la lista.
  //
  // Antes retornaba [] ante cualquier fallo y solo dejaba una línea en consola.
  // Aguas arriba, [] es indistinguible de "el dueño no tiene nada agendado", así
  // que un 403 por permisos se veía igual que un calendario vacío: Respondo
  // seguía ofreciendo horas que el dueño ya tenía tomadas, sin una sola señal.
  // Fue exactamente lo que pasó con el scope `calendar.freebusy` faltante
  // (12-ago-2026), y se descubrió de casualidad probando el video de
  // verificación. Ahora el error sube y queda visible en el portal.
): Promise<{ ok: boolean; ocupaciones: Ocupacion[]; detalle?: string }> {
  const r = await llamar<{
    calendars?: Record<string, { busy?: { start: string; end: string }[] }>;
  }>(
    "/freeBusy",
    {
      method: "POST",
      body: {
        timeMin: new Date(desdeIso).toISOString(),
        timeMax: new Date(hastaIso).toISOString(),
        timeZone: "America/Santiago",
        items: [{ id: calendarioId }],
      },
    },
    tokenOAuth,
  );
  if (!r.ok) {
    console.error("[googleCalendar] freeBusy (oauth):", r.motivo, r.detalle);
    return { ok: false, ocupaciones: [], detalle: r.detalle ?? r.motivo };
  }

  const salida: Ocupacion[] = [];
  for (const [cal, info] of Object.entries(r.datos.calendars ?? {})) {
    for (const b of info.busy ?? []) salida.push({ calendarioId: cal, desde: b.start, hasta: b.end });
  }
  return { ok: true, ocupaciones: salida };
}
