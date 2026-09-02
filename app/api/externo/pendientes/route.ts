import { autenticarExterno } from "@/lib/externo";
import { seguimientoPendiente } from "@/lib/seguimientoPendiente";

/**
 * TODO LO QUE QUEDÓ EN MANOS DE UNA PERSONA Y EL CLIENTE SIGUE ESPERANDO.
 *
 * Ver `lib/seguimientoPendiente.ts` para el porqué: es la red de contención
 * de dos límites a propósito del vigilante de reingreso (ventana de 24h, y
 * que su aviso es un push que puede caer al vacío si nadie lo activó).
 *
 * Cuerpo: { clienteId }
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;

  const conversaciones = await seguimientoPendiente(auth.clienteId);
  return Response.json({ ok: true, conversaciones });
}
