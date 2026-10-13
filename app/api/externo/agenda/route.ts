import { autenticarExterno } from "@/lib/externo";
import { ejecutarAgendaKambak } from "@/lib/kambakAgenda";

/**
 * Agenda de los locales de Kambak, administrada desde el panel de Kambak.
 *
 * Cuerpo firmado (misma firma que /api/externo/mensajes):
 *   { clienteId, accion, local: { slug, nombre, rubro }, datos }
 * Respuesta: { ok, ... } — ver lib/kambakAgenda.ts para las acciones.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await autenticarExterno(request);
  if (!auth.ok) return auth.respuesta;
  const r = await ejecutarAgendaKambak(auth.clienteId, auth.cuerpo);
  return Response.json(r.body, { status: r.status });
}
