import webpush from "web-push";
import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * NOTIFICACIONES PUSH DEL PORTAL.
 *
 * QUÉ RESUELVE
 * ------------
 * Hoy, si un cliente escribe a las tres de la tarde y nadie tiene el portal
 * abierto, el negocio se entera cuando se acuerda de mirar. Eso es exactamente
 * lo que Respondo promete resolver, y se le estaba pidiendo a la persona.
 *
 * Con esto, el teléfono suena. Es la única razón real para instalar el portal
 * como app: sin push, un ícono en la pantalla de inicio es un marcador.
 *
 * CÓMO FUNCIONA, EN CORTO
 * -----------------------
 * El navegador entrega un `endpoint` (una URL del servicio de push de Google o
 * de Apple) y dos llaves. Nosotros firmamos con VAPID —para que el servicio sepa
 * que el aviso viene de nosotros— y ciframos el contenido con esas llaves, así
 * que **Google y Apple transportan el mensaje sin poder leerlo**. Eso importa:
 * el texto que viaja es de un cliente real de una pyme.
 *
 * ⚠️ TODO ACÁ ES BEST-EFFORT, A PROPÓSITO.
 * Un aviso que no sale no puede romper la recepción de un mensaje. Si algo
 * falla, se registra y se sigue. La conversación es el producto; la notificación
 * es una comodidad encima.
 */

/** ¿Están las llaves configuradas? Sin esto no se ofrece la función. */
export function pushConfigurado(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  );
}

let listo = false;
function configurar(): boolean {
  if (listo) return true;
  if (!pushConfigurado()) return false;
  webpush.setVapidDetails(
    // El "subject" es a quién contactar si un servicio de push detecta abuso.
    // Debe ser un mailto o una URL nuestra, no un dato del cliente.
    process.env.VAPID_SUBJECT || "mailto:hola@respon-do.com",
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  listo = true;
  return true;
}

export type AvisoPush = {
  titulo: string;
  cuerpo: string;
  /** A dónde ir al tocarla. Debe ser una ruta del portal. */
  url?: string;
  /**
   * Agrupador. Dos avisos con el mismo `tag` se reemplazan en vez de apilarse:
   * si el mismo cliente manda cinco mensajes, se ve UNA notificación que se
   * actualiza, no cinco. Sin esto la barra queda inservible.
   */
  tag?: string;
};

/**
 * Avisa a todos los dispositivos de un cliente.
 *
 * Devuelve cuántos avisos salieron. Las suscripciones muertas —el teléfono se
 * formateó, la persona desinstaló la app— se borran solas: los servicios de push
 * responden 404 o 410 y esa es la única señal fiable de que ya no existe.
 * Sin esa limpieza, la tabla se llena de destinos fantasma que se reintentan
 * para siempre.
 */
export async function avisarACliente(
  clienteId: string,
  aviso: AvisoPush,
  supa: SupabaseClient = db(),
): Promise<number> {
  if (!configurar()) return 0;

  const { data, error } = await supa
    .from("ed_push_suscripciones")
    .select("id, endpoint, p256dh, auth")
    .eq("cliente_id", clienteId);

  // Tabla inexistente (migración 283 sin aplicar) u otro problema: sin avisos,
  // pero el mensaje del cliente ya se guardó y se atiende igual.
  if (error || !data?.length) return 0;

  const carga = JSON.stringify({
    titulo: aviso.titulo,
    cuerpo: aviso.cuerpo,
    url: aviso.url ?? "/conversaciones",
    tag: aviso.tag ?? "respondo",
  });

  const muertas: string[] = [];
  let enviados = 0;

  await Promise.all(
    data.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint as string,
            keys: { p256dh: s.p256dh as string, auth: s.auth as string },
          },
          carga,
          {
            // 4 horas: si el teléfono estuvo apagado más que eso, el aviso ya no
            // sirve — la conversación se atendió o se perdió.
            TTL: 4 * 60 * 60,
            urgency: "high",
            // Un servicio de push colgado no puede comerse el presupuesto del
            // cron ni del webhook: 8 s y se sigue (auditoría 3-sep-2026).
            timeout: 8_000,
          },
        );
        enviados++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        if (codigo === 404 || codigo === 410) muertas.push(s.id as string);
        else console.warn("[push] fallo al enviar:", codigo, (e as Error).message);
      }
    }),
  );

  if (muertas.length) {
    await supa
      .from("ed_push_suscripciones")
      .delete()
      .in("id", muertas)
      .then(
        () => undefined,
        () => undefined,
      );
  }

  return enviados;
}

/**
 * Recorta un texto para que quepa en una notificación.
 *
 * En la barra del teléfono se ven ~2 líneas. Un mensaje largo cortado a la mitad
 * obliga a abrir la app para entender de qué se trata — que es justo lo que la
 * notificación tenía que evitar.
 */
export function resumirParaAviso(texto: string, max = 120): string {
  const limpio = (texto ?? "").replace(/\s+/g, " ").trim();
  if (limpio.length <= max) return limpio;
  return limpio.slice(0, max - 1).trimEnd() + "…";
}
