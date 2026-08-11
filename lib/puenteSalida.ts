import { createHmac } from "node:crypto";
import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clasificarProducto,
  detectarUrgencia,
  esRuido,
  esNotificacionAutomatica,
  esMensajePreformateado,
} from "@/lib/clasificadorProducto";

/**
 * PUENTE DE SALIDA — el portal le cuenta al sistema del cliente lo que va pasando.
 *
 * POR QUÉ EXISTE
 * Hay clientes que ya tienen su propio sistema de gestión y no quieren mirar dos
 * pantallas. Con esto el asistente alimenta ESE sistema, y la persona que atiende
 * sigue trabajando donde siempre trabajó. El primer caso es Impresora Color, pero
 * la objeción "ya tengo mi sistema" la pone casi toda empresa mediana: por eso el
 * destino se configura en la base (`ed_integraciones`, migración 274) y no hay un
 * solo `if` por cliente en este archivo.
 *
 * REGLAS DE DISEÑO, DELIBERADAS (calcadas de `lib/hqBridge.ts`, que ya hace esto
 * hacia respondo-hq y lleva tiempo funcionando):
 *
 *  - BEST-EFFORT SIEMPRE. Si el cliente no tiene integración activa, esto no hace
 *    nada: sin lanzar, sin loguear como error. Así el puente se apaga poniendo
 *    `activo = false`, sin tocar código.
 *  - NUNCA BLOQUEA NI RETRASA UNA CONVERSACIÓN REAL. No se hace `await` desde el
 *    camino del bot. Timeout corto y errores tragados: que el sistema del cliente
 *    esté caído no puede frenar la respuesta a alguien que está escribiendo.
 *  - FIRMADO. Cada envío lleva HMAC-SHA256 del cuerpo exacto con el secreto
 *    compartido. Sin esto, cualquiera que descubra la URL podría insertar leads
 *    falsos en la bandeja del cliente.
 *  - EL CLASIFICADOR CORRE ACÁ, no en el receptor. El vocabulario del negocio
 *    (cómo le dicen los clientes a cada producto) vive en el portal, junto a la
 *    ficha de conocimiento de la que salió. Si viviera en el sistema del cliente,
 *    el siguiente cliente tendría que reimplementarlo.
 */

export type EventoPuente = "lead" | "mensaje" | "etapa";

type Integracion = {
  id: string;
  url: string;
  secreto: string;
  eventos: string[];
};

/** Timeout del envío. Corto a propósito: nada de esto vale una conversación lenta. */
const TIMEOUT_MS = 4000;

/**
 * Caché de integraciones por cliente.
 *
 * POR QUÉ: sin esto, cada mensaje entrante agrega una consulta a la base en el
 * camino del bot, para leer una fila que cambia una vez al mes. Mismo criterio
 * que `lib/empleadosCache.ts`.
 *
 * TTL corto (60 s) para que apagar una integración tenga efecto pronto sin
 * necesidad de redeployar.
 */
const TTL_MS = 60_000;
type Config = { rubro: string | null; destinos: Integracion[] };
const cache = new Map<string, { en: number; datos: Config }>();

/**
 * Trae la configuración del cliente: sus destinos activos y su rubro.
 *
 * El rubro va junto porque el clasificador de producto lo necesita, y pedirlo
 * acá evita que cada punto de enganche (WhatsApp, Instagram, embudo) tenga que
 * cargarlo y pasarlo por parámetro. Un dato menos que se puede olvidar.
 */
async function configDe(clienteId: string, supa: SupabaseClient): Promise<Config> {
  const hit = cache.get(clienteId);
  if (hit && Date.now() - hit.en < TTL_MS) return hit.datos;

  const [integracionesR, clienteR] = await Promise.all([
    supa
      .from("ed_integraciones")
      .select("id, url, secreto, eventos")
      .eq("cliente_id", clienteId)
      .eq("activo", true),
    supa.from("ed_clientes").select("rubro").eq("id", clienteId).maybeSingle(),
  ]);

  // Si la migración 274 todavía no está aplicada, la primera consulta falla. Se
  // trata como "no hay integraciones" a propósito: el portal tiene que seguir
  // funcionando igual en un entorno donde el puente no existe todavía.
  const datos: Config = {
    rubro: (clienteR.data?.rubro as string | undefined) ?? null,
    destinos: integracionesR.error ? [] : ((integracionesR.data ?? []) as Integracion[]),
  };
  cache.set(clienteId, { en: Date.now(), datos });
  return datos;
}

/** Permite forzar la relectura tras cambiar una integración (útil en tests). */
export function limpiarCachePuente(): void {
  cache.clear();
}

export type ContactoPuente = {
  chatId: string;
  telefono?: string | null;
  nombre?: string | null;
  canal: "whatsapp" | "instagram";
  etapa?: string | null;
  etapaManual?: boolean;
  etiquetas?: string[] | null;
  ultimoMensajeEn?: string | null;
  ultimoMensajeRol?: string | null;
};

export type MensajePuente = {
  waId?: string | null;
  rol: "cliente" | "empleado" | "humano";
  texto: string;
  creadoEn?: string | null;
};

type Cuerpo = {
  evento: EventoPuente;
  enviadoEn: string;
  cliente: { id: string; rubro: string | null };
  contacto: ContactoPuente;
  mensaje?: (MensajePuente & {
    /** Producto reconocido en ESTE mensaje (null si no se nombró ninguno). */
    producto: string | null;
    /** Término exacto que hizo el match, para poder depurar el diccionario. */
    productoTermino: string | null;
    /** El negocio no hace ese producto. Cuenta igual: es información comercial. */
    productoNoSeHace: boolean;
    urgencia: "alta" | "media" | null;
    /** Cierre, saludo o adjunto sin texto: no cuenta para el ranking de productos. */
    ruido: boolean;
    /** Texto prellenado por el enlace de entrada, no escrito por la persona. */
    preformateado: boolean;
    /** Notificación automática de un tercero (banco, Previred, Rappi): no es un lead. */
    noEsCliente: boolean;
  }) | null;
};

/** Firma que el receptor tiene que poder recalcular con el mismo secreto. */
export function firmar(cuerpo: string, secreto: string): string {
  return `sha256=${createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex")}`;
}

export type ParamsPuente = {
  evento: EventoPuente;
  clienteId: string;
  contacto: ContactoPuente;
  mensaje?: MensajePuente | null;
  /** Solo para el script de backfill y los tests: normalmente se resuelve solo. */
  rubro?: string | null;
  supa?: SupabaseClient;
};

/**
 * Avisa a los destinos configurados del cliente.
 *
 * FIRE-AND-FORGET: devuelve void, no una promesa. Es intencional — así es
 * imposible que alguien la meta en un `await` dentro del camino del bot por
 * accidente y termine sumando latencia a una conversación real.
 *
 * ⚠ LÍMITE CONOCIDO: en un entorno serverless, un envío que quede pendiente
 * cuando la función termina se puede perder. En la práctica casi no pasa, porque
 * el manejador del webhook sigue vivo varios segundos más (el debounce y la
 * espera de "escribiendo…" del bot), pero no es una garantía. Por eso existe
 * `scripts/resincronizar-puente.mjs`: cierra cualquier hueco releyendo de la
 * base, que es la fuente de verdad. Mismo criterio que `lib/hqBridge.ts`.
 */
export function notificarSistemaDelCliente(params: ParamsPuente): void {
  void enviar(params).catch((e) => {
    // Nunca romper el flujo del bot por esto: solo dejar rastro.
    console.warn("[puenteSalida] fallo no bloqueante:", (e as Error).message);
  });
}

/** Versión esperable. Solo para el backfill y los tests, donde sí interesa saber si llegó. */
export async function notificarYEsperar(params: ParamsPuente): Promise<void> {
  await enviar(params);
}

async function enviar(params: ParamsPuente): Promise<void> {
  const supa = params.supa ?? db();
  const config = await configDe(params.clienteId, supa);
  const destinos = config.destinos;
  if (!destinos.length) return; // sin integración: no-op silencioso, a propósito

  const rubro = params.rubro ?? config.rubro;
  const texto = params.mensaje?.texto ?? "";

  const cuerpo: Cuerpo = {
    evento: params.evento,
    enviadoEn: new Date().toISOString(),
    cliente: { id: params.clienteId, rubro },
    contacto: params.contacto,
    mensaje: params.mensaje
      ? (() => {
          // El clasificador solo aplica a lo que escribe el CLIENTE. Clasificar
          // las respuestas del propio negocio inflaría el ranking con los
          // productos que Tino nombra al responder, no con los que se piden.
          const esDelCliente = params.mensaje!.rol === "cliente";
          const c = esDelCliente && rubro
            ? clasificarProducto(texto, rubro)
            : { producto: null, termino: null, noSeHace: false };
          return {
            ...params.mensaje!,
            producto: c.producto,
            productoTermino: c.termino,
            productoNoSeHace: c.noSeHace,
            urgencia: esDelCliente ? detectarUrgencia(texto) : null,
            ruido: esRuido(texto),
            preformateado: esDelCliente && esMensajePreformateado(texto),
            noEsCliente: esNotificacionAutomatica(texto),
          };
        })()
      : null,
  };

  const json = JSON.stringify(cuerpo);

  await Promise.all(
    destinos
      .filter((d) => d.eventos.includes(params.evento))
      .map((d) => enviarA(d, json, supa)),
  );
}

async function enviarA(
  destino: Integracion,
  json: string,
  supa: SupabaseClient,
): Promise<void> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const ahora = new Date().toISOString();

  try {
    const res = await fetch(destino.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-respondo-firma": firmar(json, destino.secreto),
        "x-respondo-evento": JSON.parse(json).evento as string,
      },
      body: json,
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.ok) {
      await marcar(supa, destino.id, { ultimo_ok_en: ahora });
      return;
    }
    const detalle = (await res.text().catch(() => "")).slice(0, 300);
    console.warn(`[puenteSalida] ${destino.url} respondió ${res.status}`);
    await marcar(supa, destino.id, {
      ultimo_error: `HTTP ${res.status}: ${detalle}`,
      ultimo_error_en: ahora,
    });
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? `timeout ${TIMEOUT_MS}ms` : (e as Error).message;
    console.warn(`[puenteSalida] no se pudo avisar a ${destino.url}: ${msg}`);
    await marcar(supa, destino.id, { ultimo_error: msg.slice(0, 300), ultimo_error_en: ahora });
  } finally {
    clearTimeout(t);
  }
}

/**
 * Deja constancia de si el último envío llegó o falló.
 *
 * Es best-effort dentro de algo que ya es best-effort: si esta escritura falla,
 * se ignora. Existe para poder responder "¿está llegando?" sin abrir los logs de
 * Vercel — la misma pregunta que costó 21 horas de silencio en el apagón de WAHA
 * del 6-ago, cuando `/api/salud` no miraba lo que había que mirar.
 */
async function marcar(
  supa: SupabaseClient,
  id: string,
  campos: Record<string, string>,
): Promise<void> {
  await supa.from("ed_integraciones").update(campos).eq("id", id);
}
