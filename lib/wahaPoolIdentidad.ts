import { db } from "@/lib/db";
import { notificarHQ } from "@/lib/hqBridge";

/**
 * RESOLUCIÓN DE IDENTIDAD PARA LIDs DE WHATSAPP (GOWS) Y DETECCIÓN SEGURA DE BAJA.
 *
 * WhatsApp (especialmente con el motor GOWS) puede entregar el remitente como
 * un Linked ID anónimo (`...N@lid`) en lugar de su número de teléfono real.
 *
 * Este módulo implementa:
 *  1. Resolución tolerante por múltiples caminos (payload alt -> caché -> API WAHA -> correlación 72h).
 *  2. Regla estricta de seguridad: si no se resuelve el teléfono, NUNCA se registra BAJA
 *     ni se responde automático.
 *  3. Detección robusta de BAJA normalizando texto, diferenciando comando unívoco de frase ambigua.
 */

export type ResultadoIdentidad =
  | {
      ok: true;
      telefono: string;
      metodo: "directo" | "payload_alt" | "cache_lid" | "waha_api" | "correlacion";
      lid?: string;
      chatIdOriginal: string;
    }
  | {
      ok: false;
      resultado: "no_resuelto";
      lid: string;
      chatIdOriginal: string;
      motivo: string;
    };

export type ResultadoBaja =
  | { esBaja: true; posibleBaja: false }
  | { esBaja: false; posibleBaja: true; motivo: string }
  | { esBaja: false; posibleBaja: false };

// Cache de alertas a HQ para no inundar (máx 1 aviso por hora por LID o tipo)
const ultimasAlertasHQ = new Map<string, number>();

export function alertarHqLidNoResuelto(
  sesion: string,
  lid: string,
  esIntentoBaja: boolean,
  clienteId?: string | null,
): void {
  const clave = `lid_${sesion}_${lid}_${esIntentoBaja ? "baja" : "msg"}`;
  const ahora = Date.now();
  const previa = ultimasAlertasHQ.get(clave) || 0;
  if (ahora - previa < 3600_000) {
    return; // Suprimir por rate limit de 1h
  }
  ultimasAlertasHQ.set(clave, ahora);

  const descripcion = esIntentoBaja
    ? `ALERTA POOL WAHA: Solicitud de BAJA recibida desde LID no resuelto (${lid}) en sesión ${sesion}. Requiere revisión manual urgente.`
    : `Aviso Pool WAHA: Mensaje entrante recibido desde LID no resuelto (${lid}) en sesión ${sesion}. Guardado sin teléfono para revisión manual.`;

  console.warn(`[wahaPoolIdentidad] ${descripcion}`);
  try {
    notificarHQ({
      tipo: esIntentoBaja ? "error" : "info",
      clientePortalId: clienteId ?? undefined,
      detalle: descripcion,
    });
  } catch (e) {
    console.warn("[wahaPoolIdentidad] error al notificar HQ:", (e as Error).message);
  }
}

/**
 * Normaliza y analiza un texto para determinar si es una orden de BAJA unívoca
 * o si es una frase ambigua que debe marcarse como 'posible_baja'.
 */
export function analizarIntencionBaja(texto: string = ""): ResultadoBaja {
  if (!texto) return { esBaja: false, posibleBaja: false };

  const limpio = texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Comandos unívocos y directos de baja
  const COMANDOS_BAJA = new Set([
    "baja",
    "dar de baja",
    "darme de baja",
    "darse de baja",
    "no mas",
    "no mas avisos",
    "no mas mensajes",
    "no enviar mas",
    "no me envien mas",
    "no me escriban mas",
    "no me manden mas",
    "stop",
    "cancelar",
    "cancelar suscripcion",
    "desuscribir",
    "desuscribirme",
    "desuscribase",
    "salir",
    "unsubscribe",
    "basta",
    "parar",
  ]);

  if (COMANDOS_BAJA.has(limpio)) {
    return { esBaja: true, posibleBaja: false };
  }

  // Palabras clave en frases complejas / ambiguas -> posible_baja
  const PALABRAS_CLAVE = [
    "baja",
    "desuscrib",
    "cancelar",
    "no me envien",
    "no me escriban",
    "no quiero recibir",
  ];

  for (const kw of PALABRAS_CLAVE) {
    if (limpio.includes(kw)) {
      return {
        esBaja: false,
        posibleBaja: true,
        motivo: `Palabra clave '${kw}' en frase compleja: "${texto.slice(0, 80)}"`,
      };
    }
  }

  return { esBaja: false, posibleBaja: false };
}

/**
 * Consulta la API de WAHA para resolver un LID a número de teléfono.
 * Endpoint oficial: GET /api/{session}/lids/{lid}
 */
export async function consultarWahaLidApi(
  sesion: string,
  lid: string,
): Promise<string | null> {
  if (
    !process.env.WAHA_POOL_URL ||
    !process.env.WAHA_POOL_API_KEY ||
    process.env.RESPONDO_POOL_SIMULADO === "1"
  ) {
    return null;
  }
  const base = process.env.WAHA_POOL_URL.replace(/\/+$/, "");
  const key = process.env.WAHA_POOL_API_KEY;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`${base}/api/${sesion}/lids/${lid}`, {
      headers: { "X-Api-Key": key },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { phoneNumber?: string; pn?: string; id?: string };
    const raw = j?.phoneNumber || j?.pn || j?.id || "";
    const digits = String(raw).split("@")[0].replace(/\D/g, "");
    return digits.length >= 8 ? digits : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Guarda en caché `ed_waha_lids` la asociación entre sesión, LID y teléfono.
 */
export async function cachearLid(
  sesion: string,
  lid: string,
  telefono: string,
  supa = db(),
): Promise<void> {
  try {
    await supa.from("ed_waha_lids").upsert(
      { sesion, lid, telefono },
      { onConflict: "sesion,lid" },
    );
  } catch (e) {
    console.warn("[wahaPoolIdentidad] error al guardar en ed_waha_lids:", (e as Error).message);
  }
}

/**
 * Correlaciona el último envío en la sesión hacia un único contacto en las últimas 72 horas.
 * Si hay 0 o >1 candidatos, es ambiguo y devuelve null.
 */
async function correlacionarUltimoEnvio(
  sesion: string,
  supa = db(),
): Promise<string | null> {
  try {
    const { data: numData } = await supa
      .from("ed_waha_numeros")
      .select("id, cliente_id")
      .eq("sesion", sesion)
      .maybeSingle();

    if (!numData?.id) return null;

    const hace72h = new Date(Date.now() - 72 * 3600_000).toISOString();

    const { data: envios } = await supa
      .from("ed_envios_api")
      .select("telefono_hash")
      .eq("numero_id", numData.id)
      .gte("enviado_en", hace72h);

    if (!envios || envios.length === 0) return null;

    const hashes = new Set(envios.map((e) => e.telefono_hash).filter(Boolean));
    if (hashes.size !== 1) {
      return null; // Ambiguo o sin hashes
    }

    // Un único candidato en 72h: buscar su teléfono en ed_contactos
    const { data: contactos } = await supa
      .from("ed_contactos")
      .select("chat_id, telefono")
      .eq("cliente_id", numData.cliente_id)
      .not("telefono", "is", null)
      .limit(10);

    // Si coincide de manera unívoca con un contacto registrado
    if (contactos && contactos.length === 1) {
      const tel = contactos[0].telefono || contactos[0].chat_id;
      const digits = String(tel).replace(/\D/g, "");
      return digits.length >= 8 ? digits : null;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resuelve la identidad y teléfono real de un mensaje entrante de WAHA.
 *
 * Jerarquía:
 *  1. Remitente directo si no es @lid.
 *  2. Campo alterno en el payload (_data.key.remoteJidAlt, Info.SenderAlt, etc.).
 *  3. Caché de ed_waha_lids en Supabase.
 *  4. Consulta a la API de WAHA (/api/{session}/lids/{lid}).
 *  5. Correlación de último envío de 72h (solo si es estrictamente unívoco).
 *  6. Si no resuelve -> { ok: false, resultado: 'no_resuelto' }.
 */
export async function resolverTelefonoEntrante(
  payload: Record<string, unknown>,
  sesion: string,
  supa = db(),
): Promise<ResultadoIdentidad> {
  const fromRaw = String(
    payload?.from ||
      (payload?._data as Record<string, unknown> | undefined)?.from ||
      (payload?.id as Record<string, unknown> | undefined)?.remote ||
      payload?.participant ||
      "",
  ).trim();

  const isLid = fromRaw.endsWith("@lid") || fromRaw.includes("@lid");

  // 1. Remitente directo si es formato tradicional (@c.us, @s.whatsapp.net o puro número)
  if (!isLid && fromRaw) {
    const telDigits = fromRaw.split("@")[0].replace(/\D/g, "");
    if (telDigits.length >= 8) {
      return {
        ok: true,
        telefono: telDigits,
        metodo: "directo",
        chatIdOriginal: fromRaw,
      };
    }
  }

  // Si no hay información de remitente
  if (!fromRaw) {
    return {
      ok: false,
      resultado: "no_resuelto",
      lid: "desconocido",
      chatIdOriginal: "",
      motivo: "payload_sin_from",
    };
  }

  const lidClean = fromRaw.split("@")[0].replace(/\D/g, "") || fromRaw;

  // 2. Extraer de campos alternativos presentes en el payload
  const camposAlternos = [
    payload?._data?.key?.remoteJidAlt,
    payload?._data?.remoteJidAlt,
    payload?._data?.Info?.SenderAlt,
    payload?.remoteJidAlt,
    payload?.senderAlt,
    payload?._data?.senderAlt,
    payload?._data?.key?.remoteJid,
    payload?.participant,
    payload?._data?.participant,
  ];

  for (const alt of camposAlternos) {
    if (!alt) continue;
    const strAlt = String(alt).trim();
    if (strAlt && !strAlt.includes("@lid")) {
      const altDigits = strAlt.split("@")[0].replace(/\D/g, "");
      if (altDigits.length >= 8) {
        await cachearLid(sesion, lidClean, altDigits, supa);
        return {
          ok: true,
          telefono: altDigits,
          metodo: "payload_alt",
          lid: lidClean,
          chatIdOriginal: fromRaw,
        };
      }
    }
  }

  // 3. Consultar caché ed_waha_lids
  try {
    const { data: cacheRow } = await supa
      .from("ed_waha_lids")
      .select("telefono")
      .eq("sesion", sesion)
      .eq("lid", lidClean)
      .maybeSingle();

    if (cacheRow?.telefono) {
      return {
        ok: true,
        telefono: cacheRow.telefono,
        metodo: "cache_lid",
        lid: lidClean,
        chatIdOriginal: fromRaw,
      };
    }
  } catch (e) {
    console.warn("[wahaPoolIdentidad] error al consultar ed_waha_lids:", (e as Error).message);
  }

  // 4. Consultar API de WAHA para resolver LID
  const telApi = await consultarWahaLidApi(sesion, lidClean);
  if (telApi) {
    await cachearLid(sesion, lidClean, telApi, supa);
    return {
      ok: true,
      telefono: telApi,
      metodo: "waha_api",
      lid: lidClean,
      chatIdOriginal: fromRaw,
    };
  }

  // 5. Correlación de último envío (único candidato en 72h)
  const telCorrelacion = await correlacionarUltimoEnvio(sesion, supa);
  if (telCorrelacion) {
    await cachearLid(sesion, lidClean, telCorrelacion, supa);
    return {
      ok: true,
      telefono: telCorrelacion,
      metodo: "correlacion",
      lid: lidClean,
      chatIdOriginal: fromRaw,
    };
  }

  // 6. No resuelto
  return {
    ok: false,
    resultado: "no_resuelto",
    lid: lidClean,
    chatIdOriginal: fromRaw,
    motivo: "sin_coincidencia_en_fuentes",
  };
}
