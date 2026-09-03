import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { firmaValidaCon, limitarDistribuido } from "@/lib/seguridad";

/**
 * ACCESO DESDE EL SISTEMA PROPIO DEL CLIENTE.
 *
 * Algunos negocios ya tienen su software y no quieren mirar dos pantallas. El
 * puente de salida (lib/puenteSalida.ts) les copia leads y mensajes; estas
 * rutas son la dirección contraria: leer una conversación, responderla y
 * pausar al asistente desde su propia app.
 *
 * AUTENTICACIÓN: la MISMA credencial del puente, `ed_integraciones.secreto`,
 * usada al revés. El sistema del cliente firma lo que manda y acá se recalcula
 * la firma. Dos consecuencias buenas: el secreto nunca viaja en la petición, y
 * no hay una credencial nueva que administrar, rotar ni filtrar.
 *
 * POR QUÉ EL `clienteId` DEL CUERPO NO ES UN AGUJERO: sirve solo para elegir
 * CONTRA QUÉ SECRETO verificar. Quien ponga el id de otro negocio tendrá que
 * firmar con el secreto de ese negocio, que es justamente lo que no tiene.
 *
 * FIRMA CON MARCA DE TIEMPO Y NONCE (auditoría 3-sep-2026)
 * --------------------------------------------------------
 * La firma original cubría solo el cuerpo: una petición capturada («responder
 * tal cosa a tal chat») se podía volver a mandar igual días después y seguía
 * siendo válida. Ahora el emisor manda además `x-respondo-ts` (segundos Unix)
 * y `x-respondo-nonce` (aleatorio) y firma `${ts}.${nonce}.${cuerpo}`:
 *   - el reloj tiene que estar a menos de 5 minutos;
 *   - el nonce se consume UNA vez (se reutiliza el limitador distribuido con
 *     tope 1 en 10 minutos: sin tabla nueva);
 * La firma vieja (solo cuerpo) se sigue aceptando mientras Gestión se
 * actualiza, dejando una advertencia en el log. Ver `MODO_FIRMA_VIEJA`.
 *
 * ORDEN DE LAS BARRERAS: límite por IP → firma → límite por cliente. Antes el
 * límite por cliente se consumía ANTES de verificar la firma, así que
 * cualquiera que conociera un `clienteId` público podía agotar el cupo de
 * Gestión con peticiones sin firmar (429 para el cliente legítimo). Ahora una
 * petición sin firma válida no le cuesta nada al cliente.
 *
 * LO QUE ESTA CAPA NO HACE: no decide qué puede hacer el cliente con sus
 * datos. Eso lo resuelve cada ruta, y todas trabajan acotadas a su `clienteId`.
 */

type Fallo = { ok: false; respuesta: Response };
type Exito = { ok: true; clienteId: string; cuerpo: Record<string, unknown> };

/** Tolerancia de reloj entre el sistema del cliente y este servidor. */
const TOLERANCIA_SEG = 5 * 60;
/**
 * Mientras esté en true se acepta la firma sin ts/nonce. Bajar a false cuando
 * todos los sistemas conectados manden la firma nueva (Gestión ya lo hace desde
 * el 3-sep-2026).
 */
const MODO_FIRMA_VIEJA = true;

let ultimoAvisoFirmaVieja = 0;

function no(status: number, error: string): Fallo {
  return { ok: false, respuesta: Response.json({ ok: false, error }, { status }) };
}

function ipDe(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "sin-ip"
  );
}

/**
 * Secretos vigentes del puente de ese cliente. Puede haber más de una
 * integración activa (dos sistemas, o una rotación en curso): antes
 * `maybeSingle` devolvía error con dos filas y TODO el acceso externo daba 403.
 */
async function secretosDe(clienteId: string): Promise<string[]> {
  const { data } = await db()
    .from("ed_integraciones")
    .select("secreto")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .limit(10);
  return (data ?? [])
    .map((d) => (d.secreto as string | null) ?? "")
    .filter((s) => s.length > 0);
}

/**
 * Verifica la firma de `material` contra los secretos del cliente, con ts y
 * nonce si vienen. Devuelve true solo si TODO calza.
 */
async function firmaCorrecta(
  request: Request,
  clienteId: string,
  material: string,
): Promise<boolean> {
  const firma = request.headers.get("x-respondo-firma");
  if (!firma) return false;
  const secretos = await secretosDe(clienteId);
  if (!secretos.length) return false;

  const ts = request.headers.get("x-respondo-ts");
  const nonce = request.headers.get("x-respondo-nonce");

  if (ts || nonce) {
    if (!ts || !nonce) return false;
    const segundos = Number(ts);
    if (!Number.isFinite(segundos)) return false;
    if (Math.abs(Date.now() / 1000 - segundos) > TOLERANCIA_SEG) return false;
    if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(nonce)) return false;

    const firmado = `${ts}.${nonce}.${material}`;
    if (!secretos.some((s) => firmaValidaCon(s, firmado, firma))) return false;

    // El nonce se gasta UNA vez. Se consume DESPUÉS de verificar la firma:
    // si no, cualquiera podría "quemar" nonces ajenos sin conocer el secreto.
    const unico = await limitarDistribuido(`nonce:${clienteId}:${nonce}`, 1, 2 * TOLERANCIA_SEG);
    return unico.ok;
  }

  if (!MODO_FIRMA_VIEJA) return false;
  const ok = secretos.some((s) => firmaValidaCon(s, material, firma));
  if (ok && Date.now() - ultimoAvisoFirmaVieja > 3_600_000) {
    ultimoAvisoFirmaVieja = Date.now();
    console.warn(`[externo] ${clienteId} sigue firmando sin ts/nonce: actualizar su integración`);
  }
  return ok;
}

/**
 * Autentica un POST con cuerpo JSON firmado.
 *
 * El cuerpo se lee como TEXTO y la firma se calcula sobre esos bytes exactos:
 * si se parseara y volviera a serializar, el orden de las claves o un espacio
 * harían que la firma no calce nunca. Es el mismo criterio del receptor que ya
 * corre del otro lado.
 */
export async function autenticarExterno(request: Request): Promise<Exito | Fallo> {
  // Por IP, antes de leer nada: es lo único que frena a quien no tiene firma.
  if (!(await limitarDistribuido(`externo-ip:${ipDe(request)}`, 240, 60)).ok) {
    return no(429, "Demasiadas peticiones seguidas");
  }

  const crudo = await request.text();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    return no(400, "JSON inválido");
  }

  const clienteId = typeof cuerpo.clienteId === "string" ? cuerpo.clienteId : "";
  if (!clienteId) return no(400, "Falta clienteId");

  /**
   * 401 tanto si el negocio no existe/no tiene integración como si la firma no
   * calza: distinguirlos dejaba enumerar qué ids tienen integración activa.
   */
  if (!(await firmaCorrecta(request, clienteId, crudo))) {
    return no(401, "Firma inválida");
  }

  // Ya con firma válida: el cupo del cliente lo consume solo el cliente.
  if (!(await limitarDistribuido(`externo:${clienteId}`, 120, 60)).ok) {
    return no(429, "Demasiadas peticiones seguidas");
  }

  return { ok: true, clienteId, cuerpo };
}

/**
 * Variante para peticiones SIN cuerpo JSON (una descarga, un multipart): se
 * firma una cadena canónica acordada entre las dos partes en vez del cuerpo.
 *
 * Devuelve el `clienteId` cuando la firma es válida y `null` cuando no venía
 * firma — para que una ruta pueda aceptar además su autenticación de siempre.
 * Una firma presente pero equivocada devuelve `null` igual: quien no acierta,
 * no entra.
 */
export async function clienteDeFirmaExterna(
  request: Request,
  canonico: string,
): Promise<string | null> {
  const firma = request.headers.get("x-respondo-firma");
  const clienteId = request.headers.get("x-respondo-cliente");
  if (!firma || !clienteId) return null;

  if (!(await limitarDistribuido(`externo-ip:${ipDe(request)}`, 240, 60)).ok) return null;
  if (!(await firmaCorrecta(request, clienteId, canonico))) return null;
  if (!(await limitarDistribuido(`externo:${clienteId}`, 120, 60)).ok) return null;

  return clienteId;
}

/**
 * Hash del archivo para la cadena canónica de /api/externo/adjunto: la firma
 * cubre el contenido, no solo el chat. Antes se firmaba `chatId=<id>` y con
 * esa firma se podía mandar CUALQUIER archivo a ese chat.
 */
export function huellaDeArchivo(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
