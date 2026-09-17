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

const API = "https://googleads.googleapis.com/v25";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 25_000;

export type EntradaPublicacionGoogle = {
  clienteId: string;
  borradorId: string;
  nombre: string;
  objetivo?: string;
  presupuestoDiario: number;
  moneda: string;
  urlFinal: string;
  palabrasClave: { texto: string; concordancia: "exacta" | "frase" | "amplia" }[];
  negativas?: string[];
  titulares: string[];
  descripciones: string[];
  trackingUtm?: Record<string, string>;
};

export function linkGoogleAds(cuentaId: string, campaignId?: string): string {
  const d = cuentaId.replace(/\D+/g, "");
  if (campaignId) {
    return `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&ocid=${d}`;
  }
  return `https://ads.google.com/aw/overview?ocid=${d}`;
}

export function traducirErrorGoogleMutate(status: number, cuerpo: unknown): FallaPublicacion {
  const texto = sanitizarMensajeError(cuerpo);

  if (/DEVELOPER_TOKEN_NOT_APPROVED|ACCESS_LEVEL|NOT_APPROVED/i.test(texto)) {
    return {
      codigo: "GOOGLE_NIVEL_ACCESO",
      tipo: "acceso_api",
      mensaje:
        "El proyecto de Google Cloud todavía tiene nivel de acceso de prueba. Google no permite crear campañas en cuentas reales hasta subir a nivel Explorer o Basic.",
      detalleTecnico: texto,
      accionSugerida: "Subir el nivel de acceso en la consola de Google Cloud (página Google Ads API > Apply for access).",
    };
  }

  if (/USER_PERMISSION_DENIED|NOT_ADS_USER|CUSTOMER_NOT_ENABLED/i.test(texto)) {
    return {
      codigo: "GOOGLE_PERMISO_DENEGADO",
      tipo: "permiso",
      mensaje: "No tienes permisos de administrador o edición en esta cuenta de Google Ads.",
      detalleTecnico: texto,
      accionSugerida: "Verificar en ads.google.com que el usuario conectado tenga rol estándar o administrativo.",
    };
  }

  if (/STRING_LENGTH_TOO_LONG|MAX_LENGTH/i.test(texto)) {
    return {
      codigo: "GOOGLE_LONGITUD_TEXTO",
      tipo: "validacion",
      mensaje: "Uno de los titulares supera los 30 caracteres o una descripción supera los 90 caracteres exigidos por Google.",
      detalleTecnico: texto,
      accionSugerida: "Recortar titulares a 30 caracteres y descripciones a 90 caracteres.",
    };
  }

  if (/BUDGET|AMOUNT_TOO_LOW/i.test(texto)) {
    return {
      codigo: "GOOGLE_PRESUPUESTO_INVALIDO",
      tipo: "validacion",
      mensaje: "El presupuesto diario configurado es inferior al mínimo permitido por Google Ads.",
      detalleTecnico: texto,
      accionSugerida: "Aumentar el presupuesto diario.",
    };
  }

  if (status === 401 || /invalid_grant|AUTHENTICATION_ERROR/i.test(texto)) {
    return {
      codigo: "GOOGLE_TOKEN_EXPIRADO",
      tipo: "autenticacion",
      mensaje: "El permiso concedido a Google Ads venció o fue revocado. Se debe volver a conectar.",
      detalleTecnico: texto,
      accionSugerida: "Reconectar Google Ads en Integraciones.",
    };
  }

  return {
    codigo: "GOOGLE_ERROR_NATIVO",
    tipo: "plataforma",
    mensaje: `Google Ads rechazó la mutación: ${texto.slice(0, 300)}`,
    detalleTecnico: texto,
  };
}

async function renovarAccessToken(refreshToken: string): Promise<string | null> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;

  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return j.access_token ? String(j.access_token) : null;
  } catch {
    return null;
  }
}

/**
 * Publicación real de una campaña Search en Google Ads API v25.
 *
 * Utiliza el endpoint atómico `customers/{id}/googleAds:mutate` con IDs
 * temporales negativos para garantizar consistencia transaccional:
 *   - CampaignBudget (status: ENABLED, amount_micros)
 *   - Campaign (status: PAUSED, SEARCH)
 *   - AdGroup (status: PAUSED, SEARCH_STANDARD)
 *   - AdGroupCriterion (Keywords con concordancia)
 *   - AdGroupAd (Responsive Search Ad, status: PAUSED)
 */
export async function publicarCampanaEnGoogle(
  entrada: EntradaPublicacionGoogle,
): Promise<ResultadoPublicacion> {
  const claveIdem = generarClaveIdempotencia(entrada.clienteId, entrada.borradorId, "google");
  const estadoIdem = verificarIdempotencia(claveIdem);

  if (estadoIdem.enProgreso) {
    return {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId: "",
      status: "creando",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "Ya hay una publicación en curso para esta campaña en Google Ads.",
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
      plataforma: "google",
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

  // 2. Obtener conexión del cliente en Supabase
  const { data: con, error: errCon } = await db()
    .from("ed_ads_conexion")
    .select("cuenta_id, cuenta_nombre, cuenta_padre_id, moneda, token_cifrado, estado")
    .eq("cliente_id", entrada.clienteId)
    .eq("proveedor", "google")
    .maybeSingle();

  if (errCon || !con || !con.token_cifrado) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId: con?.cuenta_id ? String(con.cuenta_id) : "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "No hay una cuenta de Google Ads conectada para este negocio.",
      nativeErrors: [
        {
          codigo: "SIN_CONEXION",
          mensaje: "Se debe conectar la cuenta publicitaria de Google Ads antes de publicar.",
        },
      ],
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const refreshToken = descifrar(con.token_cifrado as string, "ads-google-token");
  if (!refreshToken) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId: String(con.cuenta_id ?? ""),
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "No se pudo descifrar el token de autorización de Google. Reconecta la cuenta.",
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const cuentaId = String(con.cuenta_id).replace(/\D+/g, "");
  if (!cuentaId) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId: "",
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "El ID de la cuenta de Google Ads está vacío o es inválido.",
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  const titularesLimpios = (entrada.titulares.length ? entrada.titulares : [entrada.nombre])
    .map((t) => t.trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 15);

  while (titularesLimpios.length < 3) {
    titularesLimpios.push(`Consulta ${entrada.nombre.slice(0, 20)}`);
  }

  const descripcionesLimpias = (
    entrada.descripciones.length ? entrada.descripciones : ["Atención rápida y personalizada. Contáctanos hoy."]
  )
    .map((d) => d.trim().slice(0, 90))
    .filter(Boolean)
    .slice(0, 4);

  while (descripcionesLimpias.length < 2) {
    descripcionesLimpias.push("Escríbenos directamente para cotizar y resolver todas tus dudas.");
  }

  // 3. Renovar access token
  const token = await renovarAccessToken(refreshToken);
  if (!token) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId,
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje:
        "Faltan credenciales de Google Cloud (GOOGLE_ADS_CLIENT_ID / CLIENT_SECRET) o el token expiró.",
      nativeErrors: [
        {
          codigo: "CONFIG_FALTANTE",
          mensaje: "Variables de entorno de Google Ads no configuradas en el servidor.",
        },
      ],
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  }

  // 4. Preparar payload atómico en Google Ads API v25
  const fechaStr = new Date().toISOString().slice(0, 10);
  const nombreCampana = `RESPONDO_${entrada.nombre.trim().replace(/\s+/g, "_").slice(0, 40)}_${fechaStr}`;
  const budgetMicros = Math.round(entrada.presupuestoDiario * 1_000_000);

  const tempBudgetId = `customers/${cuentaId}/campaignBudgets/-1`;
  const tempCampaignId = `customers/${cuentaId}/campaigns/-2`;
  const tempAdGroupId = `customers/${cuentaId}/adGroups/-3`;

  const operations: Record<string, unknown>[] = [
    // Operación 1: Crear Presupuesto
    {
      campaignBudgetOperation: {
        create: {
          resourceName: tempBudgetId,
          name: `Presupuesto ${nombreCampana}`,
          amountMicros: budgetMicros,
          deliveryMethod: "STANDARD",
          explicitlyShared: false,
        },
      },
    },
    // Operación 2: Crear Campaña (Search, PAUSED)
    {
      campaignOperation: {
        create: {
          resourceName: tempCampaignId,
          name: nombreCampana,
          advertisingChannelType: "SEARCH",
          status: "PAUSED",
          campaignBudget: tempBudgetId,
          manualCpc: { enhancedCpcEnabled: false },
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
          },
        },
      },
    },
    // Operación 3: Crear Grupo de Anuncios (PAUSED)
    {
      adGroupOperation: {
        create: {
          resourceName: tempAdGroupId,
          name: `${nombreCampana} - Grupo 1`,
          campaign: tempCampaignId,
          status: "PAUSED",
          type: "SEARCH_STANDARD",
        },
      },
    },
  ];

  // Operaciones 4+: Palabras Clave
  for (const kw of entrada.palabrasClave.slice(0, 20)) {
    const matchType =
      kw.concordancia === "exacta"
        ? "EXACT"
        : kw.concordancia === "amplia"
          ? "BROAD"
          : "PHRASE";

    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: tempAdGroupId,
          keyword: {
            text: kw.texto.slice(0, 80),
            matchType,
          },
          status: "ENABLED",
        },
      },
    });
  }

  // Operación Final: Responsive Search Ad (PAUSED)
  operations.push({
    adGroupAdOperation: {
      create: {
        adGroup: tempAdGroupId,
        status: "PAUSED",
        ad: {
          responsiveSearchAd: {
            headlines: titularesLimpios.map((t) => ({ text: t })),
            descriptions: descripcionesLimpias.map((d) => ({ text: d })),
          },
          finalUrls: [entrada.urlFinal || "https://respondo.cl"],
        },
      },
    },
  });

  // 5. Ejecutar mutación atómica contra Google Ads
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (process.env.GOOGLE_ADS_DEVELOPER_TOKEN) {
    headers["developer-token"] = process.env.GOOGLE_ADS_DEVELOPER_TOKEN.trim();
  }
  const loginCustomerId = con.cuenta_padre_id || process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  if (loginCustomerId) {
    headers["login-customer-id"] = String(loginCustomerId).replace(/\D+/g, "");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(`${API}/customers/${cuentaId}/googleAds:mutate`, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: JSON.stringify({ mutateOperations: operations }),
      cache: "no-store",
    });

    const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || json.error) {
      const falla = traducirErrorGoogleMutate(r.status, json);
      const res: ResultadoPublicacion = {
        ok: false,
        plataforma: "google",
        clienteId: entrada.clienteId,
        cuentaId,
        status: "error",
        createdAt: new Date().toISOString(),
        idempotencyKey: claveIdem,
        mensaje: falla.mensaje,
        nativeErrors: [falla],
      };
      registrarFinPublicacion(claveIdem, res);
      return res;
    }

    // Extraer resource names reales de la respuesta atómica
    const respuestas = Array.isArray(json.mutateOperationResponses)
      ? (json.mutateOperationResponses as Record<string, unknown>[])
      : [];

    let campaignId: string | undefined;
    let adGroupId: string | undefined;
    let adId: string | undefined;

    for (const resp of respuestas) {
      if (resp.campaignResult && typeof resp.campaignResult === "object") {
        const rn = String((resp.campaignResult as Record<string, unknown>).resourceName ?? "");
        campaignId = rn.split("/").pop();
      } else if (resp.adGroupResult && typeof resp.adGroupResult === "object") {
        const rn = String((resp.adGroupResult as Record<string, unknown>).resourceName ?? "");
        adGroupId = rn.split("/").pop();
      } else if (resp.adGroupAdResult && typeof resp.adGroupAdResult === "object") {
        const rn = String((resp.adGroupAdResult as Record<string, unknown>).resourceName ?? "");
        adId = rn.split("~").pop() || rn.split("/").pop();
      }
    }

    const resultadoExitoso: ResultadoPublicacion = {
      ok: true,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId,
      campaignId,
      adGroupOrAdSetId: adGroupId,
      adIds: adId ? [adId] : undefined,
      status: "pausada",
      createdAt: new Date().toISOString(),
      urlNativa: linkGoogleAds(cuentaId, campaignId),
      idempotencyKey: claveIdem,
      mensaje: "Campaña Search creada con éxito en Google Ads en estado PAUSADA.",
    };

    registrarFinPublicacion(claveIdem, resultadoExitoso);
    return resultadoExitoso;
  } catch (err) {
    const res: ResultadoPublicacion = {
      ok: false,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId,
      status: "error",
      createdAt: new Date().toISOString(),
      idempotencyKey: claveIdem,
      mensaje: "Error de red o timeout al comunicar con Google Ads API.",
      nativeErrors: [
        {
          codigo: "RED_TIMEOUT",
          mensaje: sanitizarMensajeError(err),
        },
      ],
    };
    registrarFinPublicacion(claveIdem, res);
    return res;
  } finally {
    clearTimeout(timer);
  }
}
