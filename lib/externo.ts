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
 * LO QUE ESTA CAPA NO HACE: no decide qué puede hacer el cliente con sus
 * datos. Eso lo resuelve cada ruta, y todas trabajan acotadas a su `clienteId`.
 */

type Fallo = { ok: false; respuesta: Response };
type Exito = { ok: true; clienteId: string; cuerpo: Record<string, unknown> };

function no(status: number, error: string): Fallo {
  return { ok: false, respuesta: Response.json({ ok: false, error }, { status }) };
}

/** Secreto vigente del puente de ese cliente, o null si no tiene uno activo. */
async function secretoDe(clienteId: string): Promise<string | null> {
  const { data } = await db()
    .from("ed_integraciones")
    .select("secreto")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .maybeSingle();
  const secreto = (data?.secreto as string | null) ?? null;
  return secreto && secreto.length > 0 ? secreto : null;
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
  const crudo = await request.text();

  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = JSON.parse(crudo) as Record<string, unknown>;
  } catch {
    return no(400, "JSON inválido");
  }

  const clienteId = typeof cuerpo.clienteId === "string" ? cuerpo.clienteId : "";
  if (!clienteId) return no(400, "Falta clienteId");

  // Anti-abuso ANTES de tocar la base: un secreto filtrado no debe poder
  // convertirse en un bucle de peticiones contra Supabase.
  if (!(await limitarDistribuido(`externo:${clienteId}`, 120, 60)).ok) {
    return no(429, "Demasiadas peticiones seguidas");
  }

  const secreto = await secretoDe(clienteId);
  if (!secreto) return no(403, "Este negocio no tiene integración activa");

  if (!firmaValidaCon(secreto, crudo, request.headers.get("x-respondo-firma"))) {
    return no(401, "Firma inválida");
  }

  return { ok: true, clienteId, cuerpo };
}

/**
 * Variante para peticiones SIN cuerpo (una descarga, por ejemplo): se firma una
 * cadena canónica acordada entre las dos partes en vez del cuerpo.
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

  if (!(await limitarDistribuido(`externo:${clienteId}`, 120, 60)).ok) return null;

  const secreto = await secretoDe(clienteId);
  if (!secreto) return null;

  return firmaValidaCon(secreto, canonico, firma) ? clienteId : null;
}
