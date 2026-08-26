import { db } from "@/lib/db";
import { descifrar } from "@/lib/cifrado";
import { delayHumano } from "@/lib/ritmoHumano";

/**
 * Integración con la WhatsApp Cloud API oficial (Opción B).
 *
 * DESARROLLO vs PRODUCCIÓN:
 *  - En desarrollo se usa el número de PRUEBA de Meta: un único token y
 *    phone_number_id desde variables de entorno (WHATSAPP_TOKEN, etc.).
 *  - En producción cada cliente tiene su propio número y token (los que
 *    devuelve Embedded Signup, guardados en ed_clientes). La resolución por
 *    cliente ya está preparada abajo.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

export type ConfigWhatsApp = {
  clienteId: string;
  phoneNumberId: string;
  token: string;
};

type FilaToken = { waba_token_cifrado?: string | null; waba_token?: string | null };

/**
 * Lee una fila de ed_clientes pidiendo la columna cifrada, y si la migración
 * 279 todavía no está aplicada, reintenta sin ella.
 *
 * POR QUÉ EXISTE ESTO: la convención de este repo es desplegar ANTES de migrar
 * (runbook de coexistencia), porque normalmente el código viejo ignora las
 * columnas nuevas. Acá es al revés — el código nuevo NECESITA la columna — y
 * pedirla antes de tiempo hace que PostgREST devuelva error, `data` venga null
 * y **el cliente deje de recibir y responder mensajes**.
 *
 * En vez de confiar en que el orden se respete, el código aguanta los dos
 * órdenes. Cuando la 280 esté aplicada y estable, este respaldo se puede
 * borrar.
 */
async function leerCliente(
  campo: string,
  valor: string,
  columnas: string,
): Promise<Record<string, unknown> | null> {
  const consultar = (cols: string) =>
    db().from("ed_clientes").select(cols).eq(campo, valor).maybeSingle();

  const conCifrado = await consultar(`${columnas}, waba_token_cifrado`);
  if (!conCifrado.error) return conCifrado.data as Record<string, unknown> | null;

  console.warn(
    "[whatsapp] waba_token_cifrado no existe todavía (falta la migración 279); leyendo solo el texto plano.",
  );
  const sinCifrado = await consultar(columnas);
  return sinCifrado.error ? null : (sinCifrado.data as Record<string, unknown> | null);
}

/**
 * Token de WhatsApp de un cliente, venga cifrado (migración 279) o todavía en
 * texto plano (columna vieja, en retirada).
 *
 * Durante la transición conviven las dos columnas. Si el descifrado FALLA
 * teniendo un valor cifrado, se cae al texto plano igual pero se grita en el
 * log: preferimos un cliente atendido y un error visible antes que un cliente
 * mudo y un log limpio. `/api/salud` reporta esta condición aparte.
 *
 * Cuando la migración 280 deje `waba_token` en null, el respaldo se vuelve
 * inofensivo por sí solo y esta función queda leyendo solo lo cifrado.
 */
export function tokenDeFila(fila: FilaToken | null | undefined): string {
  if (!fila) return "";
  const cifrado = fila.waba_token_cifrado;
  if (cifrado) {
    const claro = descifrar(cifrado, "waba-token");
    if (claro) return claro;
    console.error(
      "[whatsapp] waba_token_cifrado no se pudo descifrar (¿rotaron SUPABASE_SERVICE_ROLE_KEY?). Usando el texto plano si existe.",
    );
  }
  return (fila.waba_token as string) || "";
}

/**
 * Resuelve la config de WhatsApp a partir del phone_number_id que manda Meta
 * en el webhook. Primero busca un cliente con ese waba_phone_id; si no lo
 * encuentra y coincide con el número de prueba del entorno, usa el token de
 * entorno (modo desarrollo).
 */
export async function configPorPhoneId(
  phoneNumberId: string,
): Promise<ConfigWhatsApp | null> {
  const data = await leerCliente("waba_phone_id", phoneNumberId, "id, waba_token");

  if (data) {
    const token = tokenDeFila(data as FilaToken) || process.env.WHATSAPP_TOKEN || "";
    if (!token) return null;
    return { clienteId: data.id as string, phoneNumberId, token };
  }

  // Modo desarrollo: número de prueba de Meta configurado por entorno.
  if (
    process.env.WHATSAPP_PHONE_NUMBER_ID === phoneNumberId &&
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_DEV_CLIENTE_ID
  ) {
    return {
      clienteId: process.env.WHATSAPP_DEV_CLIENTE_ID,
      phoneNumberId,
      token: process.env.WHATSAPP_TOKEN,
    };
  }
  return null;
}

/**
 * Config de WhatsApp para ENVIAR desde el portal (inbox), a partir del cliente.
 * En dev, si el cliente no tiene número propio pero es el cliente de prueba,
 * usa el número de prueba del entorno.
 */
export async function configPorCliente(
  clienteId: string,
): Promise<ConfigWhatsApp | null> {
  const data = await leerCliente("id", clienteId, "waba_phone_id, waba_token");

  const phoneId = (data?.waba_phone_id as string) || "";
  const token = tokenDeFila(data as FilaToken);
  if (phoneId && token) return { clienteId, phoneNumberId: phoneId, token };

  // Modo desarrollo: número de prueba de Meta.
  if (
    process.env.WHATSAPP_DEV_CLIENTE_ID === clienteId &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_TOKEN
  ) {
    return {
      clienteId,
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      token: process.env.WHATSAPP_TOKEN,
    };
  }
  return null;
}

/**
 * Envía un mensaje de texto libre (solo válido dentro de la ventana de 24h).
 * Devuelve el `wamid` del mensaje creado: con él se reconoce después su ECO en
 * el webhook (Coexistencia) y se trackean sus ACKs (statuses) — igual que en WAHA.
 */
export async function enviarTexto(
  cfg: ConfigWhatsApp,
  para: string,
  texto: string,
  opts?: {
    /**
     * Última comprobación antes de mandar de verdad (G2, 21-ago-2026).
     *
     * POR QUÉ HACE FALTA ACÁ Y NO SOLO ANTES
     * Entre que se decide responder y que el mensaje sale pasan hasta 6 s de
     * "escribiendo…". La revalidación de `responderSiBot` ocurre ANTES de esa
     * espera, así que un mensaje del cliente que llegue durante esos segundos no
     * la ve, y la respuesta —ya obsoleta— se manda igual. Pasó en producción por
     * WAHA y se arregló el 31-jul; el camino de Meta **nunca tuvo la guardia**.
     *
     * EL STRING DEL ERROR IMPORTA: `responderBot` reconoce exactamente
     * `obsoleto:llego_mensaje_nuevo` para no marcar el envío como fallo real. Si
     * se cambia acá sin cambiarlo allá, la conversación queda esperando a una
     * persona que nadie llamó.
     */
    vigente?: () => Promise<boolean>;
    /**
     * `wamid` del mensaje del cliente al que se está respondiendo. Habilita el
     * indicador oficial de "escribiendo…" de Meta, que se pide sobre un mensaje
     * concreto. Sin esto el envío funciona igual, solo sin la señal.
     */
    mensajeIdCliente?: string | null;
    /**
     * Salta el ritmo humano. Para envíos que NO son una respuesta en vivo
     * (seguimientos, plantillas, avisos): ahí la pausa no aporta nada y solo
     * gasta presupuesto de la función.
     */
    sinEspera?: boolean;
  },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  try {
    /**
     * RITMO HUMANO (G3). Nada delata más a un bot que cuatro líneas que
     * aparecen 200 ms después. El indicador de Meta se manda al MISMO endpoint
     * de mensajes, combinado con marcar como leído, y dura hasta 25 s o hasta
     * que sale el mensaje — de sobra para nuestro retardo.
     *
     * Es best-effort a propósito: si falla, se envía igual. Un `catch` que
     * bloqueara el envío convertiría un detalle cosmético en un mensaje perdido.
     *
     * ⚠️ VERIFICAR EN LA PRIMERA PRUEBA REAL: circulan dos formatos del
     * `typing_indicator` y la documentación oficial está tras login. Si Meta
     * responde 400 acá, el envío igual sale (por el catch) pero conviene mirar
     * el log y ajustar el cuerpo.
     */
    if (!opts?.sinEspera) {
      if (opts?.mensajeIdCliente) {
        try {
          await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${cfg.token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              status: "read",
              message_id: opts.mensajeIdCliente,
              typing_indicator: { type: "text" },
            }),
            signal: AbortSignal.timeout(5_000),
          });
        } catch {
          /* señal opcional: nunca bloquea el envío */
        }
      }
      await new Promise((r) => setTimeout(r, delayHumano(texto)));
    }

    // Último control, ya sin nada más en el medio.
    if (opts?.vigente && !(await opts.vigente())) {
      return { ok: false, error: "obsoleto:llego_mensaje_nuevo" };
    }

    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "text",
        text: { body: texto },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    return { ok: true, waId: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Canjea el `id` de un adjunto de Meta por una URL de descarga.
 *
 * CÓMO FUNCIONA Y POR QUÉ SON DOS PASOS
 * Meta nunca manda el archivo en el webhook: manda un id. Con ese id se pide a
 * Graph la ficha del media, que devuelve una URL **temporal** (dura unos
 * minutos) alojada en `lookaside.fbsbx.com`. Y esa URL tampoco es pública:
 * bajarla exige el mismo `Authorization: Bearer` del negocio.
 *
 * ⚠️ POR ESO NO SE PUEDE CACHEAR LA URL. Guardarla en la base sería guardar
 * algo que caduca; lo que se guarda es el id (`meta:<id>` en `media_url`) y se
 * resuelve en cada visita. El archivo en sí sí se puede cachear en el navegador,
 * porque el contenido de un mensaje no cambia nunca.
 */
export async function resolverMediaMeta(
  cfg: ConfigWhatsApp,
  mediaId: string,
): Promise<{ url: string; mime: string | null; bytes: number | null } | null> {
  try {
    const r = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.error("[whatsapp] resolverMediaMeta HTTP", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = (await r.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!j.url) return null;
    return {
      url: j.url,
      mime: j.mime_type ?? null,
      bytes: typeof j.file_size === "number" ? j.file_size : null,
    };
  } catch (e) {
    console.error("[whatsapp] resolverMediaMeta:", (e as Error).message);
    return null;
  }
}

/**
 * Sube un archivo a Meta y devuelve su `media_id`.
 *
 * Enviar una imagen por Cloud API son DOS pasos: primero se sube el binario y
 * Meta devuelve un id, y recién después se manda el mensaje refiriendo ese id.
 * No existe la opción de mandar el archivo en el mismo llamado.
 *
 * ⚠️ Esto NO estaba implementado hasta el 21-ago-2026: adjuntar un archivo solo
 * funcionaba por WAHA, y a los clientes en Cloud API el portal les respondía
 * «llega en una próxima etapa». O sea, todo cliente nuevo.
 */
export async function subirMediaMeta(
  cfg: ConfigWhatsApp,
  archivo: { bytes: Uint8Array; mime: string; nombre: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const form = new FormData();
    form.set("messaging_product", "whatsapp");
    form.set("type", archivo.mime);
    form.set(
      "file",
      new Blob([archivo.bytes as unknown as BlobPart], { type: archivo.mime }),
      archivo.nombre,
    );

    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const t = await r.text();
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    const j = JSON.parse(t) as { id?: string };
    if (!j.id) return { ok: false, error: "Meta no devolvió el id del archivo" };
    return { ok: true, id: j.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Envía un archivo ya subido (por su `media_id`).
 *
 * El `tipo` decide cómo lo muestra WhatsApp: `image` se ve dentro de la
 * conversación, `document` aparece como archivo adjunto con su nombre. Mandar
 * una foto como documento es técnicamente válido y se ve mal, así que quien
 * llama elige según el mime real.
 */
export async function enviarMediaMeta(
  cfg: ConfigWhatsApp,
  para: string,
  media: { id: string; tipo: "image" | "document"; caption?: string; nombre?: string },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const cuerpo: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to: para,
    type: media.tipo,
    [media.tipo]: {
      id: media.id,
      ...(media.caption ? { caption: media.caption } : {}),
      // El nombre solo aplica a documentos; en una imagen Meta lo ignora.
      ...(media.tipo === "document" && media.nombre ? { filename: media.nombre } : {}),
    },
  };
  try {
    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { ok: true, waId: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * ¿La URL apunta a un host de Meta desde el que aceptamos descargar?
 *
 * BARRERA ANTI-SSRF. La URL viene de una respuesta de la API, no del usuario,
 * pero el proxy va a hacer un `fetch` con el **token del negocio en la
 * cabecera**: si alguna vez llegara una URL apuntando a otro lado, estaríamos
 * regalando el token. Mismo criterio que `reanclarUrlWaha`, que fue la
 * conclusión de la auditoría de seguridad.
 */
export function hostDeMediaPermitido(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "lookaside.fbsbx.com" ||
      h === "graph.facebook.com" ||
      h.endsWith(".fbcdn.net") ||
      h.endsWith(".cdninstagram.com")
    );
  } catch {
    return false;
  }
}

/** Un botón de respuesta rápida. El `id` vuelve en el webhook al tocarlo. */
export type BotonRapido = { id: string; titulo: string };

/**
 * Envía un mensaje con 1 a 3 BOTONES NATIVOS de WhatsApp.
 *
 * POR QUÉ IMPORTA
 * Hasta ahora sabíamos RECIBIR respuestas de botón (`parsearWebhook` las lee
 * desde el 1-ago) pero no sabíamos enviarlos. O sea que Tino tenía que pedir
 * "responde 1, 2 o 3", que es exactamente lo que hace parecer un bot a un bot.
 *
 * Cuando el cliente toca un botón, Meta manda de vuelta un mensaje de tipo
 * `interactive` con `button_reply.title`, y `parsearWebhook` ya lo convierte en
 * texto normal. O sea: para el cerebro, tocar "Confirmar" es idéntico a
 * escribir "Confirmar". No hay que enseñarle nada nuevo.
 *
 * LÍMITES DE META QUE ESTA FUNCIÓN RESPETA (los valida, no los asume):
 *  - Entre 1 y 3 botones. Con más, WhatsApp rechaza el mensaje entero.
 *  - Título de botón: 20 caracteres. Se corta, no se falla: quedarse sin
 *    responder es peor que un título abreviado.
 *  - Cuerpo: 1024 caracteres.
 *  - Los `id` deben ser únicos dentro del mensaje.
 *
 * ⚠️ SOLO DENTRO DE LA VENTANA DE 24 H. Fuera de ella hay que usar una
 * plantilla con botones dados de alta en Meta — no vale mandar esto. Ver
 * lib/ventana24.ts.
 */
export async function enviarBotones(
  cfg: ConfigWhatsApp,
  para: string,
  cuerpo: string,
  botones: BotonRapido[],
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  const limpios = botones.slice(0, 3).map((b) => ({
    id: b.id.slice(0, 256),
    titulo: b.titulo.trim().slice(0, 20),
  }));

  if (!limpios.length) return { ok: false, error: "botones: hacen falta 1 a 3" };
  if (limpios.some((b) => !b.titulo)) {
    return { ok: false, error: "botones: hay un título vacío" };
  }
  if (new Set(limpios.map((b) => b.id)).size !== limpios.length) {
    return { ok: false, error: "botones: los id se repiten" };
  }
  const texto = cuerpo.trim();
  if (!texto) return { ok: false, error: "botones: cuerpo vacío" };

  try {
    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: texto.slice(0, 1024) },
          action: {
            buttons: limpios.map((b) => ({
              type: "reply",
              reply: { id: b.id, title: b.titulo },
            })),
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 200)}` };
    }
    const j = (await r.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    return { ok: true, waId: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Envía una PLANTILLA aprobada. Es la única forma de escribirle a alguien fuera
 * de la ventana de 24 h (ver lib/ventana24.ts y lib/plantillas.ts).
 *
 * El cuerpo NO va acá: Meta ya lo tiene guardado desde el alta de la plantilla.
 * Nosotros solo mandamos el nombre, el idioma y los valores de las variables, y
 * el orden del array ES el orden de {{1}}, {{2}}…
 *
 * Errores frecuentes que devuelve Meta y que conviene reconocer en el log:
 *  - 132001: la plantilla no existe con ese nombre/idioma en este WABA.
 *  - 132000: la cantidad de parámetros no calza con el cuerpo aprobado.
 *  - 132012: un parámetro trae saltos de línea o espacios de más.
 *  - 131047: se intentó texto libre fuera de la ventana (no debería llegar acá).
 */
export async function enviarPlantilla(
  cfg: ConfigWhatsApp,
  para: string,
  plantilla: { nombre: string; idioma: string; params: string[] },
): Promise<{ ok: boolean; waId?: string; error?: string }> {
  try {
    const componentes = plantilla.params.length
      ? [
          {
            type: "body",
            parameters: plantilla.params.map((p) => ({ type: "text", text: p })),
          },
        ]
      : [];
    const r = await fetch(`${GRAPH}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: para,
        type: "template",
        template: {
          name: plantilla.nombre,
          language: { code: plantilla.idioma },
          ...(componentes.length ? { components: componentes } : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const t = await r.text();
      return { ok: false, error: `HTTP ${r.status}: ${t.slice(0, 300)}` };
    }
    const j = (await r.json().catch(() => ({}))) as { messages?: { id?: string }[] };
    return { ok: true, waId: j?.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Forma mínima de un mensaje entrante ya normalizado desde el webhook de Meta. */
/**
 * El parser del webhook vive en lib/parserMeta.ts (puro y con tests). Se
 * re-exporta para no tocar a quien ya lo importaba desde acá.
 */
export {
  parsearWebhook,
  type EntranteNormalizado,
  type Referencia,
} from "@/lib/parserMeta";

// ============================================================================
// ACKs (statuses) y ECOS de Coexistencia — espejo de lo que ya se hizo en WAHA
// ============================================================================

/** ACK de entrega normalizado desde value.statuses[] del webhook de Meta. */
export type AckMeta = {
  phoneNumberId: string;
  waId: string; // wamid del mensaje al que refiere
  estado: "server_ack" | "entregado" | "leido" | "error";
  errorDetalle?: string;
};

const MAPA_STATUS_META: Record<string, AckMeta["estado"]> = {
  sent: "server_ack",
  delivered: "entregado",
  read: "leido",
  failed: "error",
};

/** Extrae los ACKs (statuses) de un payload del webhook de Meta. */
export function parsearAcksMeta(payload: unknown): AckMeta[] {
  const out: AckMeta[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          statuses?: {
            id?: string;
            status?: string;
            errors?: { title?: string; message?: string }[];
          }[];
        };
      }[];
    }[];
  };

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.statuses?.length) continue;
      for (const s of value.statuses) {
        const estado = s.status ? MAPA_STATUS_META[s.status] : undefined;
        if (!s.id || !estado) continue;
        const err = s.errors?.[0];
        out.push({
          phoneNumberId,
          waId: s.id,
          estado,
          errorDetalle: err ? (err.message ?? err.title) : undefined,
        });
      }
    }
  }
  return out;
}

/**
 * ECO de Coexistencia normalizado. Con Coexistencia activa, los mensajes que el
 * NEGOCIO manda desde su app de WhatsApp Business llegan por el campo de webhook
 * `smb_message_echoes` (value.message_echoes[]). Igual que el fromMe de WAHA:
 * puede ser (a) eco de un envío propio o (b) una PERSONA (Cecilia) escribiendo
 * desde su teléfono → toma de control humana. Se resuelve aguas abajo por id.
 */
export type EcoMeta = {
  phoneNumberId: string;
  para: string; // número del cliente final (chat_id)
  texto: string;
  waId: string | null;
  /**
   * Adjunto que mandó la PERSONA desde su teléfono.
   *
   * ⚠️ FALTABA, Y NO ERA COSMÉTICO (26-ago-2026). Acá había un
   * `if (e.type !== "text") continue` que descartaba el eco entero. O sea: si
   * Cecilia mandaba una FOTO desde su teléfono, pasaban dos cosas malas a la vez:
   *
   *  1. la foto no aparecía en el portal, y
   *  2. **Tino no se enteraba de que ella había tomado el chat**, así que podía
   *     seguir respondiendo encima — el cliente recibía dos voces del mismo
   *     negocio.
   *
   * Es el mismo error que ya se arregló dos veces en el camino del cliente
   * (auditoría del 1-ago y adjuntos del 21-ago): descartar todo lo que no fuera
   * texto. Quedó vivo en el camino de los ecos hasta que Impresora migró a la vía
   * oficial y empezó a importar.
   */
  adjunto?: { id: string; tipo: string; mime?: string | null; nombre?: string | null };
};

/** Extrae los ecos de Coexistencia (message_echoes) de un payload de Meta. */
export function parsearEcosMeta(payload: unknown): EcoMeta[] {
  const out: EcoMeta[] = [];
  const p = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          message_echoes?: {
            id?: string;
            to?: string;
            type?: string;
            text?: { body?: string };
            image?: { id?: string; mime_type?: string; caption?: string };
            video?: { id?: string; mime_type?: string; caption?: string };
            document?: { id?: string; mime_type?: string; caption?: string; filename?: string };
            audio?: { id?: string; mime_type?: string };
            voice?: { id?: string; mime_type?: string };
            sticker?: { id?: string; mime_type?: string };
          }[];
        };
      }[];
    }[];
  };

  /**
   * `revoke` y `edit` NO son mensajes nuevos.
   *
   * Meta los manda con el id del mensaje ORIGINAL cuando alguien borra o edita
   * desde la app. Tratarlos como mensajes duplicaría el texto en el portal y
   * podría leerse como una toma de control humana que ya había ocurrido.
   */
  const NO_SON_MENSAJES = new Set(["revoke", "edit", "reaction", "system", "unsupported"]);

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!phoneNumberId || !value?.message_echoes?.length) continue;
      for (const e of value.message_echoes) {
        const tipo = e.type ?? "";
        // ⚠️ `to`, no `from`: en un eco el que manda es el negocio.
        if (!e.to || !tipo || NO_SON_MENSAJES.has(tipo)) continue;

        let texto: string;
        if (tipo === "text") {
          if (!e.text?.body) continue;
          texto = e.text.body;
        } else {
          /**
           * Pie de foto, o un marcador legible.
           *
           * El marcador dice «el equipo envió…» y no «el cliente envió…» —que es
           * lo que usa el camino del cliente— porque acá el que mandó fue el
           * negocio. Un historial que dice al revés quién mandó qué confunde a
           * quien lo lee y, peor, confunde a Tino cuando arma el contexto.
           */
          const caption =
            e.image?.caption ?? e.video?.caption ?? e.document?.caption ?? "";
          texto = caption.trim() || marcadorEcoAdjunto(tipo, e.document?.filename);
        }

        const bruto = e.image ?? e.video ?? e.document ?? e.audio ?? e.voice ?? e.sticker;
        const adjunto =
          bruto?.id && tipo !== "text"
            ? {
                id: bruto.id,
                tipo: tipoAdjuntoMeta(tipo),
                mime: bruto.mime_type ?? null,
                nombre: e.document?.filename ?? null,
              }
            : undefined;

        out.push({
          phoneNumberId,
          para: e.to,
          texto,
          waId: e.id ?? null,
          ...(adjunto ? { adjunto } : {}),
        });
      }
    }
  }
  return out;
}

/** Vocabulario propio de tipos, el mismo que usan WAHA y el parser del cliente. */
function tipoAdjuntoMeta(tipoMeta: string): string {
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

/** Marcador de un adjunto que mandó el NEGOCIO desde la app del teléfono. */
function marcadorEcoAdjunto(tipo: string, filename?: string): string {
  const nombre = filename ? ` (${filename})` : "";
  switch (tipo) {
    case "image":
      return `[el equipo envió una imagen${nombre}]`;
    case "document":
      return `[el equipo envió un archivo${nombre}]`;
    case "audio":
    case "voice":
      return "[el equipo envió un audio]";
    case "video":
      return "[el equipo envió un video]";
    case "sticker":
      return "[el equipo envió un sticker]";
    default:
      return "[el equipo envió un archivo]";
  }
}

/** El empleado que atiende el inbound de WhatsApp de un cliente es su Tino. */
export async function tinoDe(clienteId: string): Promise<string | null> {
  const { data } = await db()
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("rol", "tino")
    .eq("activo", true)
    .maybeSingle();
  return (data?.id as string) ?? null;
}
