import crypto from "crypto";

/**
 * Utilidades de seguridad para los endpoints públicos (webhooks y cron).
 *
 * Contexto: los webhooks son las ÚNICAS rutas del portal sin sesión de usuario;
 * son la superficie que un atacante ve desde internet. Acá viven las defensas.
 */

/**
 * Comparación de secretos en tiempo constante.
 *
 * `a !== b` corta en el primer carácter distinto, así que el tiempo de
 * respuesta filtra cuántos caracteres acertó el atacante y permite adivinar el
 * secreto byte a byte (timing attack). timingSafeEqual siempre demora lo mismo.
 */
export function secretoValido(recibido: string | null, esperado: string | undefined): boolean {
  // Un endpoint sensible sin secreto configurado debe quedar INACTIVO. Antes
  // se aceptaba cualquier valor para facilitar desarrollo; en producción eso
  // convertía una variable ausente en una ruta pública con service_role.
  if (!esperado) return false;
  if (!recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false; // longitudes distintas: no filtra el contenido
  return crypto.timingSafeEqual(a, b);
}

/**
 * Verifica la firma X-Hub-Signature-256 de un webhook de Meta.
 *
 * POR QUÉ IMPORTA: sin esto, cualquiera que descubra la URL del webhook (que es
 * pública y viaja en la config de la app) puede POSTear mensajes FALSOS. El
 * portal los procesaría como reales: Tino respondería a números arbitrarios
 * —con costo por mensaje— y se podría envenenar la base de conversaciones o
 * usar el número del negocio para spam. Meta firma cada request con el App
 * Secret; verificar esa firma es la única forma de saber que el payload viene
 * de Meta y no de un tercero.
 *
 * Se compara sobre el cuerpo CRUDO (el JSON re-serializado no da el mismo hash).
 */
export function firmaMetaValida(cuerpoCrudo: string, cabecera: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  // Sin App Secret no existe forma de autenticar al remitente: cerrar la ruta.
  if (!secret) {
    console.warn(
      "[seguridad] WHATSAPP_APP_SECRET no configurado: webhook de Meta rechazado.",
    );
    return false;
  }
  if (!cabecera) return false;

  const esperado =
    "sha256=" + crypto.createHmac("sha256", secret).update(cuerpoCrudo, "utf8").digest("hex");
  const a = Buffer.from(cabecera);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Igual que la anterior, pero con el secreto explícito para soportar más de una
 * app de Meta. Ambas variantes fallan cerradas cuando falta su App Secret.
 *
 * Además cada app de Meta tiene SU PROPIO secreto: usar el de WhatsApp para
 * validar Instagram haría fallar todas las firmas y el canal se vería "muerto"
 * sin ningún error visible.
 */
export function firmaValidaCon(
  secreto: string | undefined,
  cuerpoCrudo: string,
  cabecera: string | null,
): boolean {
  if (!secreto || !cabecera) return false;
  const esperado =
    "sha256=" + crypto.createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex");
  const a = Buffer.from(cabecera);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Limitador de tasa simple en memoria (por instancia).
 *
 * Limitación conocida: en serverless cada instancia tiene su propio contador,
 * así que el límite real es "N por instancia". Aun así frena el abuso obvio
 * (bucles automatizados) sin agregar infraestructura. Si algún día se necesita
 * un límite estricto y global, se migra a Upstash/Redis con la misma interfaz.
 */
const cubos = new Map<string, { n: number; hasta: number }>();

export function limitar(
  clave: string,
  max: number,
  ventanaSeg: number,
): { ok: boolean; restantes: number } {
  const ahora = Date.now();
  const c = cubos.get(clave);
  if (!c || ahora > c.hasta) {
    cubos.set(clave, { n: 1, hasta: ahora + ventanaSeg * 1000 });
    // Limpieza oportunista para que el Map no crezca sin control.
    if (cubos.size > 5000) {
      for (const [k, v] of cubos) if (ahora > v.hasta) cubos.delete(k);
    }
    return { ok: true, restantes: max - 1 };
  }
  if (c.n >= max) return { ok: false, restantes: 0 };
  c.n += 1;
  return { ok: true, restantes: max - c.n };
}

export type ResultadoLimite = {
  ok: boolean;
  restantes: number;
  /** false indica que se usó el respaldo local porque falta la migración/DB. */
  distribuido: boolean;
};

let ultimoAvisoLimite = 0;

/**
 * Rate limit global respaldado por Postgres (migración 273). El bucket local
 * corre primero para no golpear la base cuando una misma instancia ya detectó
 * abuso. Si la RPC aún no existe, mantiene el límite local y deja una alerta.
 */
export async function limitarDistribuido(
  clave: string,
  max: number,
  ventanaSeg: number,
): Promise<ResultadoLimite> {
  const local = limitar(clave, max, ventanaSeg);
  if (!local.ok) return { ...local, distribuido: false };

  const claveHash = crypto.createHash("sha256").update(clave).digest("hex");
  try {
    // Importación diferida: las utilidades criptográficas puras se pueden probar
    // con Node sin cargar el cliente de base ni resolver aliases de Next.
    const { db } = await import("@/lib/db");
    const { data, error } = await db().rpc("ed_consumir_limite", {
      p_clave: claveHash,
      p_max: max,
      p_ventana_seg: ventanaSeg,
    });
    if (error) throw error;
    const fila = (Array.isArray(data) ? data[0] : data) as
      | { permitido?: boolean; restantes?: number }
      | null;
    if (!fila || typeof fila.permitido !== "boolean") throw new Error("respuesta RPC inválida");
    return {
      ok: fila.permitido,
      restantes: Math.max(0, Number(fila.restantes ?? 0)),
      distribuido: true,
    };
  } catch (error) {
    const ahora = Date.now();
    if (ahora - ultimoAvisoLimite > 60_000) {
      ultimoAvisoLimite = ahora;
      console.error("[rate-limit] respaldo local activo; revisar migración 273:", (error as Error).message);
    }
    return { ...local, distribuido: false };
  }
}
