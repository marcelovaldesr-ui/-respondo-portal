import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { auditarSistema } from "@/lib/auditoria";
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
 * La firma vieja (solo cuerpo) se acepta hasta una FECHA, no hasta que alguien
 * se acuerde de apagarla. Ver `FIN_FIRMA_VIEJA`.
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
 * FIN DE LA FIRMA VIEJA — una FECHA, no un interruptor.
 *
 * Reproducido el 11-sep-2026 contra el servidor: una petición firmada con el
 * esquema viejo se acepta las veces que se quiera, para siempre. En
 * /api/externo/pendientes y /api/externo/conversacion eso es una copia de la
 * conversación cada vez que al que la capturó se le antoje. En
 * /api/externo/responder y /api/externo/adjunto es peor: `enviarComoHumano` no
 * tiene guarda de idempotencia, así que reenvía de verdad —el mismo WhatsApp,
 * al mismo cliente final, otra vez—. Una firma vieja capturada no es un dato
 * viejo: es una credencial permanente.
 *
 * Por qué una fecha y no `const MODO_FIRMA_VIEJA = false`. Apagarlo hoy a
 * ciegas deja al negocio sin poder responderle a sus clientes desde su propia
 * app si su sistema todavía no migró, y eso no se puede comprobar desde este
 * repositorio: el único emisor —la app de Gestión— vive fuera. Dejarlo en un
 * booleano tampoco sirve: es exactamente la seguridad que depende de que
 * alguien se acuerde para siempre. Una ventana con fecha se cierra sola.
 *
 * `RESPONDO_FIRMA_VIEJA_HASTA` permite correr la fecha desde la configuración
 * —sin volver a compilar— si el día de la verdad Gestión todavía no migró. Una
 * fecha ilegible no abre la ventana: la cierra.
 *
 * Para saber si alguien sigue usándola antes de la fecha, cada aceptación
 * queda registrada en `ed_auditoria_portal` como `firma_vieja_aceptada`
 * (máximo una por cliente por hora: es una señal, no un log de tráfico).
 */
const FIN_FIRMA_VIEJA = "2026-09-30T00:00:00Z";

export function ventanaViejaAbierta(): boolean {
  const hasta = Date.parse(process.env.RESPONDO_FIRMA_VIEJA_HASTA || FIN_FIRMA_VIEJA);
  if (!Number.isFinite(hasta)) return false;
  return Date.now() < hasta;
}

const ultimoAvisoFirmaVieja = new Map<string, number>();

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

  if (!ventanaViejaAbierta()) return false;
  const ok = secretos.some((s) => firmaValidaCon(s, material, firma));
  if (ok) await avisarFirmaVieja(clienteId);
  return ok;
}

/** Deja rastro de que alguien todavía firma sin ts/nonce. Una vez por hora. */
async function avisarFirmaVieja(clienteId: string): Promise<void> {
  const ahora = Date.now();
  if (ahora - (ultimoAvisoFirmaVieja.get(clienteId) ?? 0) < 3_600_000) return;
  ultimoAvisoFirmaVieja.set(clienteId, ahora);
  console.warn(
    JSON.stringify({
      evento: "externo.firma_vieja",
      cliente: clienteId,
      hasta: process.env.RESPONDO_FIRMA_VIEJA_HASTA || FIN_FIRMA_VIEJA,
    }),
  );
  await auditarSistema(clienteId, "firma_vieja_aceptada");
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
