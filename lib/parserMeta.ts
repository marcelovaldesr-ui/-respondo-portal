/**
 * PARSER DEL WEBHOOK DE META — puro, sin acceso a base de datos.
 *
 * Vive aparte de lib/whatsapp.ts por una razón práctica: ese módulo importa
 * `@/lib/db` y `@/lib/cifrado`, y el alias `@/` no lo resuelve `node --test`.
 * Con el parser acá se puede probar de verdad, que es donde más falta hace:
 * es el punto por donde entra TODO lo que dice un cliente, y equivocarse acá
 * significa perder mensajes en silencio.
 *
 * Mismo patrón que agendaCore.ts, generadorCore.ts y cupoConversaciones.ts.
 * REGLA: acá no entra nada que toque red ni base de datos.
 */

export type EntranteNormalizado = {
  phoneNumberId: string; // número del negocio (mapea a cliente)
  de: string; // número del cliente final (chat_id)
  nombre?: string; // nombre de perfil de WhatsApp, si viene
  texto: string;
  tipo: string;
  waId: string | null; // wamid → idempotencia (Meta REINTENTA webhooks)
  /** De qué anuncio vino, si entró por Click-to-WhatsApp. Ver `Referencia`. */
  referencia?: Referencia;
  /** Adjunto que mandó el cliente, si el mensaje traía uno. Ver `AdjuntoMeta`. */
  adjunto?: AdjuntoMeta;
};

/**
 * ADJUNTO DE UN MENSAJE DE META.
 *
 * ⚠️ ESTO FALTABA POR COMPLETO hasta el 21-ago-2026 y era un agujero grande:
 * el parser reconocía que venía una foto —por eso escribía «[el cliente envió
 * una imagen]»— pero **tiraba el `id`**, que es lo único con lo que se puede
 * descargar el archivo. Resultado: por Cloud API, o sea por donde entra TODO
 * cliente nuevo, las fotos que manda un cliente NO se podían ver. Solo
 * funcionaban en WAHA, que es el transporte de un único negocio.
 *
 * Meta no manda el archivo: manda un `id` que después hay que canjear contra
 * Graph por una URL temporal (ver `resolverMediaMeta` en lib/whatsapp.ts).
 */
export type AdjuntoMeta = {
  /** Id del media en Meta. Se canjea por una URL que dura pocos minutos. */
  id: string;
  /** Vocabulario propio, compartido con WAHA: imagen | documento | audio | video | sticker. */
  tipo: string;
  mime?: string | null;
  nombre?: string | null;
};

/** Traduce el tipo de Meta a nuestro vocabulario (el mismo que usa WAHA). */
function tipoNuestro(tipoMeta: string): string {
  switch (tipoMeta) {
    case "image":
      return "imagen";
    case "document":
      return "documento";
    case "audio":
    case "voice":
      return "audio";
    case "video":
      return "video";
    case "sticker":
      return "sticker";
    default:
      return "otro";
  }
}

/**
 * ATRIBUCIÓN DE CAMPAÑA (Click-to-WhatsApp).
 *
 * Cuando alguien llega apretando un anuncio de Facebook o Instagram, Meta
 * agrega un objeto `referral` al PRIMER mensaje de esa conversación, con el id
 * del anuncio y su titular. **Ya venía llegando y lo estábamos tirando.**
 *
 * Importa porque Click-to-WhatsApp es el arma principal de pauta: sin esto, la
 * plata de publicidad se reparte a ojo. Y es gratis — no hay que instrumentar
 * nada, solo dejar de descartar el campo.
 *
 * ⚠️ Llega SOLO en el primer mensaje de la conversación, así que hay que
 * guardarlo cuando aparece; después no vuelve.
 */
export type Referencia = {
  /** `source_id`: el id del anuncio en Meta. Es la clave para cruzar con Ads. */
  anuncioId?: string;
  /** `source_type`: normalmente "ad" o "post". */
  tipo?: string;
  /** Titular del anuncio, útil para leerlo sin entrar a Ads Manager. */
  titular?: string;
  /** Cuerpo del anuncio, si viene. */
  cuerpo?: string;
  /** `source_url`: a dónde apuntaba. */
  url?: string;
};

/**
 * Marcador legible de un adjunto de Meta, para que un mensaje SIN texto (una
 * foto, un audio, un PDF) NO se pierda. Mismo vocabulario que WAHA
 * (lib/waha.ts → textoDeAdjunto) para que el prompt de Tino y el inbox lean
 * igual en los dos transportes.
 */
function placeholderAdjuntoMeta(tipo: string, filename?: string): string {
  const nombre = filename ? ` (${filename})` : "";
  switch (tipo) {
    case "image":
      return `[el cliente envió una imagen${nombre}]`;
    case "document":
      return `[el cliente envió un archivo${nombre}]`;
    case "audio":
    case "voice":
      return "[el cliente envió un audio]";
    case "video":
      return "[el cliente envió un video]";
    case "sticker":
      return "[el cliente envió un sticker]";
    case "location":
      return "[el cliente envió su ubicación]";
    case "contacts":
      return "[el cliente compartió un contacto]";
    default:
      return "[el cliente envió un archivo]";
  }
}

/**
 * Extrae los mensajes de un payload del webhook de Meta.
 * El payload trae entry[].changes[].value.messages[]. Puede venir sin mensajes
 * (por ejemplo, un evento de "entregado" o "leído"): en ese caso, lista vacía.
 *
 * MULTIMEDIA (fix auditoría 1-ago-2026): antes se hacía `if (type !== "text")
 * continue`, así que en la vía OFICIAL una foto/audio/PDF del cliente se
 * DESCARTABA entera: no se guardaba, no aparecía en el portal y Tino ni se
 * enteraba (podía seguir preguntando lo que la foto respondía). Ahora, igual que
 * en WAHA, un mensaje multimedia SIEMPRE se registra: si trae pie de foto se usa
 * ese texto y se anota el adjunto; si no, se registra un marcador legible.
 */
export function parsearWebhook(payload: unknown): EntranteNormalizado[] {
  const out: EntranteNormalizado[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          contacts?: { profile?: { name?: string }; wa_id?: string }[];
          messages?: {
            id?: string;
            from?: string;
            type?: string;
            text?: { body?: string };
            image?: { id?: string; mime_type?: string; caption?: string };
            video?: { id?: string; mime_type?: string; caption?: string };
            document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
            /** Respuesta a botón de plantilla (quick reply). */
            button?: { text?: string; payload?: string };
            /** Respuesta a mensaje interactivo (botones / lista). */
            interactive?: {
              type?: string;
              button_reply?: { id?: string; title?: string };
              list_reply?: { id?: string; title?: string };
            };
            /**
             * Los adjuntos vienen con `id` (para descargar), `mime_type` y a
             * veces `filename`. `sha256` también llega pero no lo usamos.
             */
            audio?: { id?: string; mime_type?: string };
            voice?: { id?: string; mime_type?: string };
            sticker?: { id?: string; mime_type?: string };
            /** Anuncio de origen (Click-to-WhatsApp). Solo en el 1er mensaje. */
            referral?: {
              source_id?: string;
              source_type?: string;
              source_url?: string;
              headline?: string;
              body?: string;
            };
          }[];
        };
      }[];
    }[];
  };

  /**
   * Tipos que NO acarrean un mensaje nuevo del cliente y se dejan fuera.
   *
   * ⚠️ `edit` y `revoke` FALTABAN (auditoría 3-sep-2026). Cuando el cliente
   * editaba o borraba un mensaje, el evento caía en la rama de adjuntos y se
   * registraba como «[el cliente envió un archivo]»: Tino respondía «¡me llegó
   * tu archivo! se lo paso al equipo» y derivaba. Medido en Impresora Color: 32
   * marcadores sin adjunto, todos `edit`/`revoke`. `request_welcome` (chat
   * abierto desde un anuncio, sin texto) y `order` (carrito de catálogo, que
   * no atendemos) tampoco son un mensaje que responder.
   */
  const IGNORADOS = new Set([
    "reaction",
    "system",
    "unsupported",
    "ephemeral",
    "edit",
    "revoke",
    "request_welcome",
    "order",
  ]);

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.messages?.length) continue;
      for (const m of value.messages) {
        const tipo = m.type ?? "";
        if (!m.from || !tipo || IGNORADOS.has(tipo)) continue;
        // El nombre del remitente de ESTE mensaje: Meta agrupa mensajes de
        // varios contactos en un mismo `value`, y tomar siempre contacts[0]
        // le ponía el nombre del primero a todos.
        const nombre =
          value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ??
          (value.contacts?.length === 1 ? value.contacts[0]?.profile?.name : undefined);

        let texto: string;
        if (tipo === "text") {
          if (!m.text?.body) continue;
          texto = m.text.body;
        } else if (tipo === "button" || tipo === "interactive") {
          // RESPUESTA INTERACTIVA (fix revisión independiente 1-ago-2026): el
          // cliente TOCÓ un botón o eligió de una lista — eso ES texto suyo
          // ("Confirmar", "Ver precios"), no un adjunto. Registrarlo como
          // "[archivo]" habría hecho que Tino tratara una confirmación como un
          // documento que no puede ver. Se usa el título tocado tal cual.
          const tocado =
            m.button?.text ??
            m.interactive?.button_reply?.title ??
            m.interactive?.list_reply?.title ??
            "";
          if (!tocado.trim()) continue; // interactivo sin texto: nada que registrar
          texto = tocado.trim();
        } else {
          // Pie de foto (imagen/video/documento) o marcador del adjunto.
          const caption =
            m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? "";
          texto =
            caption.trim() || placeholderAdjuntoMeta(tipo, m.document?.filename);
        }

        /**
         * ADJUNTO. Meta pone el archivo en un sub-objeto con el nombre del tipo
         * (`image`, `document`, `audio`…), así que se busca en todos y se toma
         * el primero que traiga `id`.
         *
         * Sin `id` no hay nada que hacer: es lo único con lo que se puede pedir
         * el archivo después. Si no viene, el mensaje igual se registra con su
         * marcador de texto — vale más un mensaje sin foto que ningún mensaje.
         */
        const bruto = m.image ?? m.video ?? m.document ?? m.audio ?? m.voice ?? m.sticker;
        const adjunto: AdjuntoMeta | undefined =
          bruto?.id && !IGNORADOS.has(tipo) && tipo !== "text"
            ? {
                id: bruto.id,
                tipo: tipoNuestro(tipo),
                mime: bruto.mime_type ?? null,
                nombre: m.document?.filename ?? null,
              }
            : undefined;

        // Solo se arma el objeto si Meta mandó algo útil: así el resto del
        // código puede preguntar `if (m.referencia)` sin falsos positivos.
        const ref = m.referral;
        const referencia: Referencia | undefined =
          ref && (ref.source_id || ref.headline || ref.source_url)
            ? {
                ...(ref.source_id ? { anuncioId: ref.source_id } : {}),
                ...(ref.source_type ? { tipo: ref.source_type } : {}),
                ...(ref.headline ? { titular: ref.headline } : {}),
                ...(ref.body ? { cuerpo: ref.body } : {}),
                ...(ref.source_url ? { url: ref.source_url } : {}),
              }
            : undefined;

        out.push({
          phoneNumberId,
          de: m.from,
          nombre,
          texto,
          tipo,
          waId: m.id ?? null,
          ...(referencia ? { referencia } : {}),
          ...(adjunto ? { adjunto } : {}),
        });
      }
    }
  }
  return out;
}
