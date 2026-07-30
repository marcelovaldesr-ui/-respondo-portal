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
  if (!esperado) return true; // sin secreto configurado: no se exige (dev)
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
  // Sin App Secret configurado no se puede verificar. Se permite pasar para no
  // romper el piloto, pero queda registrado: hay que configurarlo en Vercel.
  if (!secret) {
    console.warn(
      "[seguridad] WHATSAPP_APP_SECRET no configurado: el webhook de Meta NO está verificando firma.",
    );
    return true;
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
