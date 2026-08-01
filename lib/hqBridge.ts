/**
 * PUENTE HACIA RESPONDO HQ (agregado 1-ago-2026).
 *
 * Contexto: `/clientes` en respondo-hq ("Clientes & Bots") escuchaba eventos
 * que n8n le mandaba a `/api/hooks/bot-events` — pero desde el 21-jul-2026 los
 * bots corren como código ACÁ, en respondo-portal, no en n8n. Sin este puente,
 * HQ queda ciego aunque entre el primer cliente real (ver
 * `respondo-hq/AUDITORIA_RESPONDHQ_AGO2026.md`, sección 4, opción 1).
 *
 * Este archivo llama al MISMO endpoint que n8n llamaba antes
 * (`POST /api/hooks/bot-events`, header `x-hq-token`) — no se tocó nada en
 * HQ salvo por esto. La diferencia es solo quién lo llama.
 *
 * Reglas de diseño, deliberadas:
 * - Best-effort SIEMPRE. Si HQ_BRIDGE_URL o HQ_API_TOKEN no están configuradas,
 *   la función no hace nada (sin lanzar, sin loguear como error). Así el
 *   puente puede quedar "apagado" simplemente no configurando las variables,
 *   sin tocar código.
 * - Nunca bloquea ni retrasa la respuesta al cliente: no se espera (`await`)
 *   este envío en el camino caliente del bot. Timeout corto (3s) + swallow de
 *   errores de red — un problema en HQ jamás debe frenar una conversación real.
 * - Resolución de cliente en HQ: se manda `workflow_id` = el `cliente_id`
 *   (uuid) de ESTE portal (tabla `ed_clientes`). En HQ hay que pegar ese mismo
 *   uuid en el campo "ID de referencia" de `/clientes` al dar de alta al
 *   cliente real — si no está registrado, el evento igual se guarda en HQ
 *   (queda con client_id null, aparece como "sistema" en el feed).
 *
 * Variables de entorno nuevas (agregar en Vercel del PORTAL, no de HQ):
 *   HQ_BRIDGE_URL=https://<tu-deploy-de-respondo-hq>.vercel.app
 *   HQ_API_TOKEN=<el mismo valor que HQ_API_TOKEN en el proyecto de HQ>
 */

export type TipoEventoHQ =
  | "mensaje"
  | "error"
  | "lead_captured"
  | "quote_generated"
  | "meeting_booked"
  | "human_handoff";

/**
 * Notifica un evento a Respondo HQ. Fire-and-forget: no hay que await-earla
 * desde el camino caliente del bot (aunque hacerlo tampoco rompe nada, ya que
 * nunca lanza).
 */
export function notificarHQ(evento: {
  tipo: TipoEventoHQ;
  /** id del cliente en ESTE portal (ed_clientes.id) — HQ lo resuelve vía workflow_id */
  clientePortalId: string;
  detalle?: string | null;
  costoClp?: number | null;
}): void {
  const url = process.env.HQ_BRIDGE_URL;
  const token = process.env.HQ_API_TOKEN;
  if (!url || !token) return; // puente no configurado: no-op silencioso a propósito

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  fetch(`${url.replace(/\/+$/, "")}/api/hooks/bot-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-hq-token": token },
    body: JSON.stringify({
      tipo: evento.tipo,
      workflow_id: evento.clientePortalId,
      detalle: evento.detalle ?? null,
      costo_clp: evento.costoClp ?? null,
    }),
    signal: controller.signal,
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[hqBridge] HQ respondió ${res.status} para tipo=${evento.tipo}`);
      }
    })
    .catch((e) => {
      // Nunca romper el flujo del bot por esto — solo dejar rastro en logs.
      console.warn("[hqBridge] no se pudo notificar a HQ:", (e as Error).message);
    })
    .finally(() => clearTimeout(timeoutId));
}
