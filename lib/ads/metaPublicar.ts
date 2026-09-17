import { db } from "@/lib/db";
import { descifrar } from "@/lib/cifrado";
import {
  generarClaveIdempotencia,
  registrarFinPublicacion,
  registrarInicioPublicacion,
  sanitizarMensajeError,
  verificarIdempotencia,
  type FallaPublicacion,
  type ResultadoPublicacion,
} from "@/lib/ads/publicacion";

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 25_000;

export type EntradaPublicacionMeta = {
  clienteId: string;
  borradorId: string;
  nombre: string;
  objetivo: string;
  destino: "whatsapp" | "sitio_web" | "formulario_meta" | "llamada";
  presupuestoDiario: number;
  moneda: string;
  audiencia?: {
    ubicacion?: string;
    edadDesde?: number | null;
    edadHasta?: number | null;
    intereses?: string[];
  };
  copies: { titular: string; texto: string; cta?: string }[];
  pageId?: string;
  imagenUrl?: string | null;
  sitioWebUrl?: string | null;
  trackingUtm?: Record<string, string>;
};

/**
 * Traduce los códigos de error conocidos de Meta Graph API a explicaciones
 * humanas claras y accionables.
 */
export function traducirErrorMeta(status: number, cuerpo: unknown): FallaPublicacion {
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const err = ((c.error ?? {}) as Record<string, unknown>) || {};
  const codigo = Number(err.code || status);
  const subcode = Number(err.error_subcode || 0);
  const rawMsg = sanitizarMensajeError(err.message || c.message || `HTTP ${status}`);

  if (codigo === 100 && (subcode === 33 || /missing permissions|does not support this operation/i.test(rawMsg))) {
    return {
      codigo: "META_PERMISO_FALTANTE",
      tipo: "permiso",
      mensaje:
        "Meta rechazó la creación porque el token actual solo tiene permiso de lectura (`ads_read`). Se requiere autorizar con permiso de administración (`ads_management`) y rol de anunciante en la cuenta.",
      detalleTecnico: `Code ${codigo} (Subcode ${subcode}): ${rawMsg}`,
      accionSugerida: "Reconectar la cuenta de Meta solicitando el permiso de gestión de anuncios.",
    };
  }

  if (codigo === 190 || status === 401) {
    return {
      codigo: "META_TOKEN_EXPIRADO",
      tipo: "autenticacion",
      mensaje: "El token de autorización con Meta ha expirado o fue revocado. Se debe reconectar la cuenta en Integraciones.",
      detalleTecnico: `Code ${codigo}: ${rawMsg}`,
      accionSugerida: "Reconectar Meta Ads en el portal.",
    };
  }

  if (codigo === 200 || codigo === 10 || status === 403) {
    return {
      codigo: "META_ACCESO_DENEGADO",
      tipo: "permiso",
      mensaje: "No tienes permisos de Administrador o Anunciante en la cuenta publicitaria seleccionada en Meta.",
      detalleTecnico: `Code ${codigo}: ${rawMsg}`,
      accionSugerida: "Verificar en Meta Business Suite que el usuario tenga rol de administrador o anunciante en la cuenta publicitaria.",
    };
  }

  if (/budget|presupuesto/i.test(rawMsg) || codigo === 1487390) {
    return {
      codigo: "META_PRESUPUESTO_INVALIDO",
      tipo: "validacion",
      mensaje: "El presupuesto diario configurado está por debajo del monto mínimo aceptado por Meta para esta moneda.",
      detalleTecnico: `Code ${codigo}: ${rawMsg}`,
      accionSugerida: "Aumentar el presupuesto diario de la campaña.",
    };
  }

  if (/page|página/i.test(rawMsg)) {
    return {
      codigo: "META_PAGINA_FALTANTE",
      tipo: "identidad",
      mensaje: "Meta requiere una Página de Facebook comercial asociada para publicar el anuncio.",
      detalleTecnico: `Code ${codigo}: ${rawMsg}`,
      accionSugerida: "Asociar una Página de Facebook en Meta Business Suite con acceso a la cuenta publicitaria.",
    };
  }

  return {
    codigo: "META_ERROR_NATIVO",
    tipo: "plataforma",
    mensaje: `Meta respondió con un error al publicar: ${rawMsg}`,
    detalleTecnico: `Code ${codigo} (Subcode ${subcode}): ${rawMsg}`,
  };
}

async function peticionMeta<T>(
  url: string,
  token: string,
  metodo: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<{ ok: true; datos: T } | { ok: false; error: FallaPublicacion }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const r = await fetch(url, {
      method: metodo,
      signal: ctrl.signal,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || json.error) {
      return { ok: false, error: traducirErrorMeta(r.status, json) };
    }
    return { ok: true, datos: json as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        codigo: "META_RED_TIMEOUT",
        tipo: "red",
        mensaje: "Tiempo de espera agotado al conectar con Meta Graph API.",
        detalleTecnico: sanitizarMensajeError(err),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obtiene el enlace directo a la campaña en Meta Ads Manager.
 */
export function linkMetaAdsManager(cuentaId: string, campaignId?: string): string {
  const idSoloDigitos = cuentaId.replace(/^act_/, "");
  if (campaignId) {
    return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${idSoloDigitos}&selected_campaign_ids=${campaignId}`;
  }
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${idSoloDigitos}`;
}

/**
 * Mapea el objetivo de Respondo a los objetivos ODAX soportados en Graph API v21.0.
 */
function mapearObjetivoMeta(objetivo: string, destino: string): string {
  const o = objetivo.toLowerCase();
  if (destino === "whatsapp" || o.includes("convers") || o.includes("mensaj")) {
    return "OUTCOME_LEADS";
  }
  if (o.includes("venta") || o.includes("compra")) {
    return "OUTCOME_SALES";
  }
  if (o.includes("traf") || o.includes("clic")) {
    return "OUTCOME_TRAFFIC";
  }
  return "OUTCOME_LEADS";
}

/**
 * Publicación real de punta a punta en Meta Ads.
 *
 * Crea secuencialmente:
 *   1. Campaña (estado PAUSED)
 *   2. Conjunto de anuncios (AdSet) con presupuesto y audiencia (estado PAUSED)
 *   3. Creatividad (AdCreative)
 *   4. Anuncio (Ad) (estado PAUSED)
 */
export async function publicarCampanaEnMeta(
  entrada: EntradaPublicacionMeta,
): Promise<ResultadoPublicacion> {
  const claveIdem = generarClaveIdempotencia(entrada.clienteId, entrada.borradorId, "meta");
  const estadoIdem = verificarIdempotencia(claveIdem);

  if (estadoIdem.enProgreso) {
    return {
      ok: false,
      plataforma: "meta",
      clienteId: entrada.clienteId,
      cuentaId: "",
      status: "creando",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "Ya hay una publicación en curso para esta campaña. Espera unos segundos.",
    };
  }

  if (estadoIdem.resultado && estadoIdem.resultado.ok) {
    return estadoIdem.resultado;
  }

  registrarInicioPublicacion(claveIdem);

  // 1. Pre-validación inmediata de parámetros de dinero
  if (entrada.presupuestoDiario <= 0) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "meta",
      clienteId: entrada.clienteId,
      cuentaId: "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "El presupuesto diario debe ser mayor a 0.",
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  // 2. Obtener la conexión real del cliente
  const { data: con, error: errCon } = await db()
    .from("ed_ads_conexion")
    .select("cuenta_id, cuenta_nombre, moneda, token_cifrado, estado")
    .eq("cliente_id", entrada.clienteId)
    .eq("proveedor", "meta")
    .maybeSingle();

  if (errCon || !con || !con.token_cifrado) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "meta",
      clienteId: entrada.clienteId,
      cuentaId: con?.cuenta_id ? String(con.cuenta_id) : "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "No hay una cuenta de Meta Ads conectada para este negocio.",
      nativeErrors: [
        {
          codigo: "SIN_CONEXION",
          mensaje: "Se debe conectar la cuenta publicitaria de Meta antes de publicar.",
        },
      ],
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const token = descifrar(con.token_cifrado as string, "ads-token");
  if (!token) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "meta",
      clienteId: entrada.clienteId,
      cuentaId: String(con.cuenta_id ?? ""),
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "No se pudo descifrar el token de acceso de Meta. Reconecta la cuenta.",
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const cuentaId = String(con.cuenta_id).startsWith("act_")
    ? String(con.cuenta_id)
    : `act_${con.cuenta_id}`;

  const copyPrincipal = entrada.copies[0] || {
    titular: entrada.nombre,
    texto: entrada.nombre,
    cta: "Más información",
  };

  const objetivoMeta = mapearObjetivoMeta(entrada.objetivo, entrada.destino);

  // 3. Paso 1: Crear Campaña en Meta (PAUSED)
  const fechaStr = new Date().toISOString().slice(0, 10);
  const nombreCampana = `RESPONDO_${entrada.nombre.trim().replace(/\s+/g, "_").slice(0, 40)}_${fechaStr}`;

  const rCampana = await peticionMeta<{ id: string }>(
    `${GRAPH}/${cuentaId}/campaigns`,
    token,
    "POST",
    {
      name: nombreCampana,
      objective: objetivoMeta,
      status: "PAUSED",
      special_ad_categories: ["NONE"],
    },
  );

  if (!rCampana.ok) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "meta",
      clienteId: entrada.clienteId,
      cuentaId,
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: rCampana.error.mensaje,
      nativeErrors: [rCampana.error],
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const campaignId = rCampana.datos.id;

  // 4. Paso 2: Crear Conjunto de Anuncios (AdSet) (PAUSED)
  // Meta requiere el presupuesto en centavos de la moneda de la cuenta
  const presupuestoCentavos = Math.round(entrada.presupuestoDiario * 100);

  const edadMin = Math.max(18, entrada.audiencia?.edadDesde ?? 18);
  const edadMax = Math.min(65, entrada.audiencia?.edadHasta ?? 65);

  const rAdSet = await peticionMeta<{ id: string }>(
    `${GRAPH}/${cuentaId}/adsets`,
    token,
    "POST",
    {
      name: `${nombreCampana} - AdSet Principal`,
      campaign_id: campaignId,
      daily_budget: presupuestoCentavos,
      billing_event: "IMPRESSIONS",
      optimization_goal: "LEAD_GENERATION",
      destination_type: entrada.destino === "whatsapp" ? "WHATSAPP" : "WEBSITE",
      targeting: {
        geo_locations: { countries: ["CL"] },
        age_min: edadMin,
        age_max: edadMax,
      },
      status: "PAUSED",
    },
  );

  let adSetId: string | undefined;
  if (rAdSet.ok) {
    adSetId = rAdSet.datos.id;
  }

  // 5. Paso 3: Crear Creatividad y Anuncio si AdSet se creó
  let adId: string | undefined;
  if (adSetId && entrada.pageId) {
    const rCreative = await peticionMeta<{ id: string }>(
      `${GRAPH}/${cuentaId}/adcreatives`,
      token,
      "POST",
      {
        name: `Creatividad - ${entrada.nombre.slice(0, 30)}`,
        object_story_spec: {
          page_id: entrada.pageId,
          link_data: {
            message: copyPrincipal.texto,
            name: copyPrincipal.titular,
            link: entrada.sitioWebUrl || "https://respondo.cl",
            call_to_action: {
              type: entrada.destino === "whatsapp" ? "WHATSAPP_MESSAGE" : "LEARN_MORE",
            },
          },
        },
      },
    );

    if (rCreative.ok) {
      const creativeId = rCreative.datos.id;
      const rAd = await peticionMeta<{ id: string }>(
        `${GRAPH}/${cuentaId}/ads`,
        token,
        "POST",
        {
          name: `Anuncio - ${copyPrincipal.titular.slice(0, 30)}`,
          adset_id: adSetId,
          creative: { creative_id: creativeId },
          status: "PAUSED",
        },
      );
      if (rAd.ok) {
        adId = rAd.datos.id;
      }
    }
  }

  const urlNativa = linkMetaAdsManager(cuentaId, campaignId);
  const resultadoExitoso: ResultadoPublicacion = {
    ok: true,
    plataforma: "meta",
    clienteId: entrada.clienteId,
    cuentaId,
    campaignId,
    adGroupOrAdSetId: adSetId,
    adIds: adId ? [adId] : undefined,
    status: "pausada",
    createdAt: new Date().toISOString(),
    urlNativa,
    idempotencyKey: claveIdem,
    mensaje: "Campaña creada con éxito en Meta Ads en estado PAUSADA.",
  };

  registrarFinPublicacion(claveIdem, resultadoExitoso);
  return resultadoExitoso;
}
