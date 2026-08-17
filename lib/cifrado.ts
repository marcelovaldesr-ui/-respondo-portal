import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

/**
 * CIFRADO DE SECRETOS EN REPOSO (AES-256-GCM).
 *
 * Este código ya existía dentro de lib/googleOAuth.ts para el refresh token de
 * Google. Se sacó acá porque hizo falta lo mismo para el token de WhatsApp de
 * cada cliente (`ed_clientes.waba_token`), que estaba en TEXTO PLANO — y con
 * ese token cualquiera que llegara a la base puede enviar mensajes de WhatsApp
 * haciéndose pasar por el negocio. Con clientes de verdad conectados
 * (RS-Shop, 118 trabajadores) dejó de ser aceptable.
 *
 * SIN DEPENDENCIAS y sin imports con alias `@/`: así se puede testear con
 * `node --test`, igual que agendaCore, fichaServicio y cupoConversaciones.
 *
 * LA CLAVE NO SE GUARDA EN NINGUNA PARTE: se deriva de
 * SUPABASE_SERVICE_ROLE_KEY, un secreto que ya existe, nunca llega al
 * navegador y sin el cual la aplicación no funciona igual. Evita pedirle a
 * Marcelo una variable de entorno más que después haya que rotar.
 *
 * SEPARACIÓN POR PROPÓSITO: cada uso deriva SU PROPIA clave a partir de una
 * etiqueta ("gcal-refresh", "waba-token"). Así un valor cifrado para un
 * propósito no se puede descifrar como si fuera del otro, aunque compartan el
 * secreto de origen.
 *
 * ⚠️ SI SE ROTA SUPABASE_SERVICE_ROLE_KEY, todo lo cifrado deja de leerse.
 * Para el token de Google eso significa "reconectar el calendario"; para el de
 * WhatsApp significa que el cliente queda MUDO. Por eso el fallo de descifrado
 * se reporta en /api/salud en vez de tratarse como "no configurado".
 */

export type Proposito = "gcal-refresh" | "waba-token" | "ig-token" | "ig-estado";

function clave(proposito: Proposito): Buffer {
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY no configurada");
  return createHash("sha256").update(`respondo:${proposito}:${base}`).digest();
}

/** Devuelve "iv.tag.cifrado", todo en base64url. */
export function cifrar(texto: string, proposito: Proposito): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", clave(proposito), iv);
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), cifrado].map((b) => b.toString("base64url")).join(".");
}

/**
 * Descifra. Devuelve null si el valor está corrupto, fue cifrado con otro
 * propósito, o la clave cambió. NUNCA lanza: quien llama decide qué hacer con
 * el null, y en ningún caso queremos que un dato malo tumbe una respuesta.
 */
export function descifrar(valor: string, proposito: Proposito): string | null {
  try {
    const [ivB64, tagB64, cifradoB64] = valor.split(".");
    if (!ivB64 || !tagB64 || !cifradoB64) return null;
    const decipher = createDecipheriv("aes-256-gcm", clave(proposito), Buffer.from(ivB64, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(cifradoB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * ¿Este valor tiene forma de cifrado nuestro?
 *
 * Hace falta durante la transición: la columna vieja en texto plano y la nueva
 * cifrada conviven hasta que se verifique que todo sigue enviando. Un token de
 * Meta empieza con "EAA" y no tiene puntos; uno cifrado son tres bloques
 * base64url separados por puntos.
 */
export function pareceCifrado(valor: string | null | undefined): boolean {
  if (!valor) return false;
  const partes = valor.split(".");
  return partes.length === 3 && partes.every((p) => /^[A-Za-z0-9_-]+$/.test(p) && p.length > 0);
}

// ---------------------------------------------------------------------------
// Estado firmado para vueltas de OAuth
// ---------------------------------------------------------------------------

/**
 * El `state` de OAuth viaja por el navegador del dueño —que no es de fiar— y
 * vuelve en el callback. Va FIRMADO porque es la única barrera real: el
 * callback no trae sesión del portal (el proveedor no la reenvía), así que sin
 * firma cualquiera podría fabricar un state y colgar SU Instagram de la cuenta
 * de OTRO cliente.
 *
 * lib/googleOAuth.ts tiene su propia copia de esto. No se unificó a propósito:
 * esa integración acaba de ser aprobada por Google y no vale la pena tocarla
 * hoy por ahorrar quince líneas. Cuando haya que modificarla por otra razón,
 * ahí se migra a estas funciones.
 */
export function firmarEstado(datos: Record<string, string>, proposito: Proposito): string {
  const payload = Buffer.from(JSON.stringify({ ...datos, emitidoEn: Date.now() })).toString("base64url");
  const firma = createHmac("sha256", clave(proposito)).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}

/** Devuelve los datos firmados, o null si la firma no cuadra o el estado venció. */
export function verificarEstado(
  valor: string,
  proposito: Proposito,
  maxMs = 15 * 60_000,
): Record<string, string> | null {
  const [payload, firma] = valor.split(".");
  if (!payload || !firma) return null;

  const esperada = createHmac("sha256", clave(proposito)).update(payload).digest("base64url");
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  // Comparación en tiempo constante: comparar con === filtra por el primer byte
  // distinto y deja medir la firma correcta a punta de intentos.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const emitidoEn = obj.emitidoEn;
    if (typeof emitidoEn !== "number") return null;
    // Un estado del futuro es tan sospechoso como uno vencido.
    if (emitidoEn > Date.now() + 60_000 || Date.now() - emitidoEn > maxMs) return null;
    const salida: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === "string") salida[k] = v;
    return salida;
  } catch {
    return null;
  }
}
