import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "crypto";

/**
 * GOOGLE CALENDAR POR OAuth ("Conectar Google Calendar", F5-OAuth).
 *
 * Coexiste con lib/googleCalendar.ts (cuenta de servicio) sin reemplazarla:
 * la cuenta de servicio sigue siendo el camino sin espera para clientes
 * nuevos mientras Google revisa esta app; este módulo es el botón de un
 * clic para cuando la verificación esté aprobada (ver
 * docs/OAUTH_GOOGLE_EXPEDIENTE.md). Cada profesional usa uno u otro según
 * ed_profesionales.gcal_modo.
 *
 * SIN DEPENDENCIAS: todo con `crypto`/`fetch` nativos, mismo criterio que el
 * resto del módulo de Google.
 *
 * CONFIGURACIÓN (variables de entorno, las genera Google Cloud → Clientes):
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *
 * INERTE POR DEFECTO: sin esas variables, oauthConfigurado() da false y el
 * portal simplemente no ofrece el botón — la cuenta de servicio sigue
 * funcionando exactamente igual.
 */

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Fijo a propósito (no derivado del request): tiene que ser BYTE A BYTE el
// mismo URI que se registró en Google Cloud → Clientes → URIs de
// redireccionamiento, o Google rechaza el intercambio con redirect_uri_mismatch.
const URL_PORTAL = "https://respondo-portal.vercel.app";
const REDIRECT_URI = `${URL_PORTAL}/api/google/callback`;

// Angosto a propósito (ver C1 del expediente): alcanza para crear, mover y
// borrar los eventos de las citas sin pedir el calendario completo.
// openid+email son scopes básicos (no requieren revisión) solo para poder
// mostrarle al dueño "Conectado como fulano@gmail.com" en el portal.
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "openid", "email"].join(" ");

function credenciales(): { id: string; secreto: string } | null {
  const id = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const secreto = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!id || !secreto) return null;
  return { id, secreto };
}

/** ¿Está configurado el botón de conexión? (para mostrarlo u ocultarlo en el portal) */
export function oauthConfigurado(): boolean {
  return credenciales() !== null;
}

// ---------------------------------------------------------------------------
// `state`: viaja por el navegador del dueño (nadie de confianza) y vuelve en
// el callback. Va firmado (HMAC) para que nadie pueda fabricar uno y conectar
// SU Google a la agenda de OTRO cliente — la firma es la única barrera real
// acá, porque el callback no tiene sesión de portal (Google no la reenvía).
// ---------------------------------------------------------------------------

function claveFirma(): Buffer {
  // Deriva de un secreto que YA existe y nunca llega al navegador — no hace
  // falta pedirle a Marcelo una variable de entorno más.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(`respondo-gcal-state:${base}`).digest();
}

export type EstadoConexion = { profesionalId: string; clienteId: string };

export function firmarEstado(estado: EstadoConexion): string {
  const payload = Buffer.from(JSON.stringify(estado)).toString("base64url");
  const firma = createHmac("sha256", claveFirma()).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}

export function verificarEstado(valor: string): EstadoConexion | null {
  const [payload, firma] = valor.split(".");
  if (!payload || !firma) return null;
  const esperada = createHmac("sha256", claveFirma()).update(payload).digest("base64url");
  if (firma !== esperada) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EstadoConexion;
  } catch {
    return null;
  }
}

/** URL de Google a la que se redirige al dueño para que apriete "Permitir". */
export function urlAutorizacion(estado: string): string {
  const cred = credenciales();
  if (!cred) throw new Error("GOOGLE_OAUTH_CLIENT_ID/SECRET no configurados");
  const params = new URLSearchParams({
    client_id: cred.id,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline", // sin esto Google NO manda refresh_token
    prompt: "consent", // fuerza a devolver refresh_token también en reconexiones
    include_granted_scopes: "true",
    state: estado,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type ResultadoOAuth<T> = { ok: true; datos: T } | { ok: false; motivo: string };

/** Intercambia el `code` del callback por tokens. Se llama UNA vez, al conectar. */
export async function intercambiarCodigo(
  code: string,
): Promise<ResultadoOAuth<{ refreshToken: string; email: string | null }>> {
  const cred = credenciales();
  if (!cred) return { ok: false, motivo: "sin_credenciales" };
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: cred.id,
        client_secret: cred.secreto,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const j = (await r.json()) as {
      refresh_token?: string;
      id_token?: string;
      error_description?: string;
      error?: string;
    };
    if (!r.ok || !j.refresh_token) {
      // Típico: el dueño ya había conectado antes SIN "prompt=consent" y
      // Google no vuelve a mandar refresh_token. Con prompt=consent fijo
      // arriba esto no debería pasar, pero se deja el mensaje útil por si
      // el dueño revocó el acceso desde su cuenta de Google a mano.
      return { ok: false, motivo: j.error_description ?? j.error ?? `HTTP ${r.status}` };
    }
    return { ok: true, datos: { refreshToken: j.refresh_token, email: correoDesdeIdToken(j.id_token) } };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

/** Decodifica el email del id_token (JWT) SOLO para mostrarlo — no es la barrera de seguridad. */
function correoDesdeIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const cuerpo = idToken.split(".")[1];
    const json = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/** Access token fresco a partir del refresh token guardado. Se pide de nuevo en cada uso: no expira nunca solo, y así no hay caché que se pueda quedar vieja entre invocaciones serverless. */
export async function accessTokenDesdeRefresh(refreshToken: string): Promise<ResultadoOAuth<string>> {
  const cred = credenciales();
  if (!cred) return { ok: false, motivo: "sin_credenciales" };
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: cred.id,
        client_secret: cred.secreto,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const j = (await r.json()) as { access_token?: string; error_description?: string; error?: string };
    if (!r.ok || !j.access_token) {
      return { ok: false, motivo: j.error_description ?? j.error ?? `HTTP ${r.status}` };
    }
    return { ok: true, datos: j.access_token };
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Cifrado del refresh token en reposo (AES-256-GCM). La clave se deriva del
// mismo secreto de servidor que ya protege toda la base (nunca llega al
// navegador) — evita agregar una variable de entorno más solo para esto.
// ---------------------------------------------------------------------------

function claveCifrado(): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(`respondo-gcal-refresh:${base}`).digest();
}

export function cifrarRefreshToken(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", claveCifrado(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, cifrado].map((b) => b.toString("base64url")).join(".");
}

export function descifrarRefreshToken(valor: string): string | null {
  try {
    const [ivB64, tagB64, cifradoB64] = valor.split(".");
    const iv = Buffer.from(ivB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const cifrado = Buffer.from(cifradoB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", claveCifrado(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString("utf8");
  } catch {
    return null; // clave rotada o dato corrupto: se trata como "no conectado"
  }
}
