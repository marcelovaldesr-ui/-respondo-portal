import {
  generarClaveIdempotencia,
  registrarFinPublicacion,
  registrarInicioPublicacion,
  sanitizarMensajeError,
  verificarIdempotencia,
  type FallaPublicacion,
  type ResultadoPublicacion,
} from "@/lib/ads/publicacion";

/**
 * PUBLICADOR DE GOOGLE ADS — campaña de Búsqueda completa, SIEMPRE EN PAUSA.
 *
 * Un solo `googleAds:mutate` atómico con IDs temporales negativos:
 *   CampaignBudget → Campaign (SEARCH, PAUSED) → criterios de campaña (país e
 *   idioma) → AdGroup (PAUSED) → Keywords → Responsive Search Ad (PAUSED).
 * Si una operación falla, Google no crea NINGUNA: no quedan presupuestos
 * huérfanos ni campañas a medias.
 *
 * Credenciales: las mismas que la lectura (`sesionGoogleDe` en google.ts), o
 * sea el cliente OAuth del proyecto de Cloud dueño de GOOGLE_ADS_CLIENT_ID.
 * No hay un camino aparte «de prueba»: con nivel Test sólo responden las
 * cuentas de prueba de Google Ads, con Explorer también las reales — el mismo
 * código en los dos casos.
 *
 * Correcciones del 22-sep-2026 (encontradas revisando contra la documentación
 * de Google y contra el flujo real, antes de la primera llamada de verdad):
 *  1. `containsEuPoliticalAdvertising` es OBLIGATORIO al crear campañas
 *     (FieldError.REQUIRED sin él) — faltaba.
 *  2. El presupuesto en micros tiene que ser múltiplo de la unidad mínima de
 *     la moneda: en CLP, pesos enteros. `2000.5 * 1e6` era rechazable.
 *  3. Sin segmentación geográfica la campaña, al activarse, se muestra en el
 *     mundo entero. Ahora sale con país (Chile por omisión) e idioma español.
 *  4. La URL final caía a un dominio fijo que no es nuestro
 *     ni del negocio. Ahora sin URL válida NO se publica.
 *  5. Idempotencia que sobrevive a otra instancia del servidor: se mira lo
 *     guardado en el borrador y, si no hay, Google mismo (campaña con el mismo
 *     nombre no eliminada) antes de crear nada.
 *  6. No se inventan titulares ni descripciones: si faltan, se dice.
 */

const API = "https://googleads.googleapis.com/v25";
const TIMEOUT_MS = 25_000;

/** Chile. Constante de Google, no un ID de cliente: geoTargetConstants/2152. */
export const GEO_CHILE = "2152";
/** Español: languageConstants/1003. */
export const IDIOMA_ESPANOL = "1003";

/** Monedas cuya unidad mínima es el entero (Google exige múltiplos de ella). */
const MONEDAS_SIN_DECIMALES = new Set(["CLP", "JPY", "KRW", "PYG", "COP", "HUF", "ISK", "TWD", "VND", "UGX", "XAF", "XOF"]);

export type EntradaPublicacionGoogle = {
  clienteId: string;
  borradorId: string;
  nombre: string;
  objetivo?: string;
  presupuestoDiario: number;
  moneda: string;
  urlFinal: string | null | undefined;
  palabrasClave: { texto: string; concordancia: "exacta" | "frase" | "amplia" }[];
  negativas?: string[];
  titulares: string[];
  descripciones: string[];
  trackingUtm?: Record<string, string>;
  /** Países (geoTargetConstants). Por omisión, Chile. */
  paises?: string[];
  /** El `plan` guardado del borrador, para no publicar dos veces lo mismo. */
  planGuardado?: unknown;
};

export function linkGoogleAds(cuentaId: string, campaignId?: string): string {
  const d = cuentaId.replace(/\D+/g, "");
  if (campaignId) {
    return `https://ads.google.com/aw/campaigns?campaignId=${campaignId}&ocid=${d}`;
  }
  return `https://ads.google.com/aw/overview?ocid=${d}`;
}

/** Presupuesto diario → micros, redondeado a la unidad mínima de la moneda. */
export function microsPresupuesto(monto: number, moneda: string): number {
  const unidad = MONEDAS_SIN_DECIMALES.has(String(moneda).toUpperCase()) ? 1_000_000 : 10_000;
  return Math.round((monto * 1_000_000) / unidad) * unidad;
}

/** Sólo http(s) con host. Devuelve la URL normalizada o null. */
export function validarUrlFinal(url: string | null | undefined): string | null {
  const t = String(url ?? "").trim();
  if (!t) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Nombre de campaña: sin comillas (van dentro de GAQL) y con la fecha. */
export function nombreCampanaGoogle(nombre: string, fecha: string): string {
  const base = nombre.trim().replace(/['"\\]/g, "").replace(/\s+/g, "_").slice(0, 40);
  return `RESPONDO_${base}_${fecha}`;
}

function unicos(textos: string[], max: number, largo: number): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const t of textos) {
    const limpio = String(t ?? "").trim().slice(0, largo);
    const clave = limpio.toLowerCase();
    if (!limpio || vistos.has(clave)) continue;
    vistos.add(clave);
    out.push(limpio);
    if (out.length >= max) break;
  }
  return out;
}

export type PlanOperacionesGoogle = {
  nombreCampana: string;
  budgetMicros: number;
  operaciones: Record<string, unknown>[];
};

/**
 * Arma las operaciones del mutate. PURA: se prueba sin red.
 * Devuelve un error legible en vez de operaciones cuando falta algo que Google exige.
 */
export function construirOperacionesGoogle(
  entrada: EntradaPublicacionGoogle,
  cuentaId: string,
  fecha: string,
): { ok: true; plan: PlanOperacionesGoogle } | { ok: false; mensaje: string; codigo: string } {
  const url = validarUrlFinal(entrada.urlFinal);
  if (!url) {
    return {
      ok: false,
      codigo: "SIN_URL_FINAL",
      mensaje:
        "Falta el sitio web del negocio: el anuncio de Google tiene que llevar a una página suya. Agrégalo en el perfil de Marketing.",
    };
  }
  const titulares = unicos(entrada.titulares, 15, 30);
  const descripciones = unicos(entrada.descripciones, 4, 90);
  if (titulares.length < 3) {
    return {
      ok: false,
      codigo: "FALTAN_TITULARES",
      mensaje: `Google exige al menos 3 titulares distintos para un anuncio adaptable; la campaña tiene ${titulares.length}.`,
    };
  }
  if (descripciones.length < 2) {
    return {
      ok: false,
      codigo: "FALTAN_DESCRIPCIONES",
      mensaje: `Google exige al menos 2 descripciones distintas; la campaña tiene ${descripciones.length}.`,
    };
  }
  const palabras = entrada.palabrasClave
    .map((k) => ({ ...k, texto: String(k.texto ?? "").trim().slice(0, 80) }))
    .filter((k) => k.texto)
    .slice(0, 20);
  if (!palabras.length) {
    return { ok: false, codigo: "SIN_PALABRAS_CLAVE", mensaje: "Una campaña de Búsqueda necesita al menos una palabra clave." };
  }
  const budgetMicros = microsPresupuesto(entrada.presupuestoDiario, entrada.moneda);
  if (budgetMicros <= 0) {
    return { ok: false, codigo: "PRESUPUESTO_INVALIDO", mensaje: "El presupuesto diario debe ser mayor a 0." };
  }

  const nombreCampana = nombreCampanaGoogle(entrada.nombre, fecha);
  const c = `customers/${cuentaId}`;
  const tBudget = `${c}/campaignBudgets/-1`;
  const tCampana = `${c}/campaigns/-2`;
  const tGrupo = `${c}/adGroups/-3`;

  const operaciones: Record<string, unknown>[] = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: tBudget,
          name: `Presupuesto ${nombreCampana}`,
          amountMicros: String(budgetMicros),
          deliveryMethod: "STANDARD",
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: tCampana,
          name: nombreCampana,
          advertisingChannelType: "SEARCH",
          status: "PAUSED",
          campaignBudget: tBudget,
          // Maximizar clics: no exige pujas por grupo.
          targetSpend: {},
          // Obligatorio desde la regulación de anuncios políticos de la UE.
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          networkSettings: {
            targetGoogleSearch: true,
            targetSearchNetwork: true,
            targetContentNetwork: false,
            targetPartnerSearchNetwork: false,
          },
        },
      },
    },
  ];

  for (const pais of entrada.paises?.length ? entrada.paises : [GEO_CHILE]) {
    operaciones.push({
      campaignCriterionOperation: {
        create: { campaign: tCampana, location: { geoTargetConstant: `geoTargetConstants/${pais}` } },
      },
    });
  }
  operaciones.push({
    campaignCriterionOperation: {
      create: { campaign: tCampana, language: { languageConstant: `languageConstants/${IDIOMA_ESPANOL}` } },
    },
  });

  operaciones.push({
    adGroupOperation: {
      create: {
        resourceName: tGrupo,
        name: `${nombreCampana} - Grupo 1`,
        campaign: tCampana,
        status: "PAUSED",
        type: "SEARCH_STANDARD",
      },
    },
  });

  for (const kw of palabras) {
    operaciones.push({
      adGroupCriterionOperation: {
        create: {
          adGroup: tGrupo,
          status: "ENABLED",
          keyword: {
            text: kw.texto,
            matchType: kw.concordancia === "exacta" ? "EXACT" : kw.concordancia === "amplia" ? "BROAD" : "PHRASE",
          },
        },
      },
    });
  }

  operaciones.push({
    adGroupAdOperation: {
      create: {
        adGroup: tGrupo,
        status: "PAUSED",
        ad: {
          finalUrls: [url],
          responsiveSearchAd: {
            headlines: titulares.map((text) => ({ text })),
            descriptions: descripciones.map((text) => ({ text })),
          },
        },
      },
    },
  });

  return { ok: true, plan: { nombreCampana, budgetMicros, operaciones } };
}

/** Lee los IDs reales de la respuesta del mutate. PURA. */
export function extraerIdsMutacion(json: unknown): {
  budgetId?: string;
  campaignId?: string;
  adGroupId?: string;
  adIds: string[];
  keywordIds: string[];
} {
  const out = { adIds: [] as string[], keywordIds: [] as string[] } as {
    budgetId?: string;
    campaignId?: string;
    adGroupId?: string;
    adIds: string[];
    keywordIds: string[];
  };
  const respuestas = Array.isArray((json as Record<string, unknown>)?.mutateOperationResponses)
    ? ((json as Record<string, unknown>).mutateOperationResponses as Record<string, unknown>[])
    : [];
  const rn = (o: unknown) => String((o as Record<string, unknown> | undefined)?.resourceName ?? "");
  for (const r of respuestas) {
    if (r.campaignBudgetResult) out.budgetId = rn(r.campaignBudgetResult).split("/").pop();
    else if (r.campaignResult) out.campaignId = rn(r.campaignResult).split("/").pop();
    else if (r.adGroupResult) out.adGroupId = rn(r.adGroupResult).split("/").pop();
    else if (r.adGroupCriterionResult) {
      const id = rn(r.adGroupCriterionResult).split("~").pop();
      if (id) out.keywordIds.push(id);
    } else if (r.adGroupAdResult) {
      const id = rn(r.adGroupAdResult).split("~").pop();
      if (id) out.adIds.push(id);
    }
  }
  return out;
}

/**
 * ¿Este borrador ya se publicó en Google? Lee `plan.publicacion` (lo que guarda
 * `registrarPublicacionCampana`). PURA. Es la idempotencia que sobrevive a un
 * reinicio o a otra instancia del servidor, que la memoria no cubre.
 */
export function publicacionPreviaGoogle(plan: unknown, clienteId: string): ResultadoPublicacion | null {
  const p = (plan as Record<string, unknown> | null)?.publicacion as Record<string, unknown> | undefined;
  if (!p || p.plataforma !== "google" || !p.campaignId) return null;
  return {
    ok: true,
    plataforma: "google",
    clienteId,
    cuentaId: String(p.cuentaId ?? ""),
    campaignId: String(p.campaignId),
    adGroupOrAdSetId: p.adGroupOrAdSetId ? String(p.adGroupOrAdSetId) : undefined,
    adIds: Array.isArray(p.adIds) ? (p.adIds as string[]) : undefined,
    budgetId: p.budgetId ? String(p.budgetId) : undefined,
    keywordIds: Array.isArray(p.keywordIds) ? (p.keywordIds as string[]) : undefined,
    status: "pausada",
    createdAt: String(p.publicadoEn ?? new Date().toISOString()),
    urlNativa: p.urlNativa ? String(p.urlNativa) : undefined,
    idempotencyKey: String(p.idempotencyKey ?? ""),
    mensaje: "Esta campaña ya estaba publicada en Google Ads: no se creó de nuevo.",
  };
}

/** El primer mensaje humano que trae Google, sin JSON ni rutas internas. */
function primerMensajeGoogle(cuerpo: unknown): string {
  const e = (cuerpo as Record<string, unknown> | null)?.error as Record<string, unknown> | undefined;
  const detalles = Array.isArray(e?.details) ? (e!.details as Record<string, unknown>[]) : [];
  for (const d of detalles) {
    const errs = Array.isArray(d.errors) ? (d.errors as Record<string, unknown>[]) : [];
    if (errs[0]?.message) return String(errs[0].message);
  }
  return e?.message ? String(e.message) : "";
}

/** request-id de Google, para soporte. Viene en details[].requestId. */
export function requestIdGoogle(cuerpo: unknown): string | null {
  const e = (cuerpo as Record<string, unknown> | null)?.error as Record<string, unknown> | undefined;
  const detalles = Array.isArray(e?.details) ? (e!.details as Record<string, unknown>[]) : [];
  for (const d of detalles) if (d.requestId) return String(d.requestId);
  return null;
}

export function traducirErrorGoogleMutate(status: number, cuerpo: unknown): FallaPublicacion {
  const texto = sanitizarMensajeError(cuerpo);
  const humano = sanitizarMensajeError(primerMensajeGoogle(cuerpo)).slice(0, 240);
  const base = (f: Omit<FallaPublicacion, "detalleTecnico">): FallaPublicacion => ({ ...f, detalleTecnico: texto });

  if (/CLOUD_PROJECT_NOT_APPROVED|DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED|ACCESS_LEVEL|NOT_APPROVED/i.test(texto)) {
    return base({
      codigo: "GOOGLE_NIVEL_ACCESO",
      tipo: "acceso_api",
      mensaje:
        "El proyecto de Google Cloud todavía tiene nivel de acceso de prueba. Google no permite crear campañas en cuentas reales hasta subir a nivel Explorer o Basic.",
      accionSugerida: "Subir el nivel de acceso en la consola de Google Cloud (página Google Ads API > Apply for access).",
    });
  }
  if (/USER_PERMISSION_DENIED|NOT_ADS_USER/i.test(texto)) {
    return base({
      codigo: "GOOGLE_PERMISO_DENEGADO",
      tipo: "permiso",
      mensaje: "No tienes permisos de administrador o edición en esta cuenta de Google Ads.",
      accionSugerida: "Verificar en ads.google.com que el usuario conectado tenga rol estándar o administrativo.",
    });
  }
  if (/CUSTOMER_NOT_FOUND|INVALID_CUSTOMER_ID|CUSTOMER_NOT_ENABLED/i.test(texto)) {
    return base({
      codigo: "GOOGLE_CUENTA_INVALIDA",
      tipo: "cuenta",
      mensaje: "La cuenta de Google Ads guardada ya no está disponible (no existe, está cancelada o sin terminar de crear).",
      accionSugerida: "Reconectar Google Ads en Integraciones y elegir otra cuenta.",
    });
  }
  if (/AUTHORIZATION_ERROR/i.test(texto)) {
    return base({
      codigo: "GOOGLE_AUTORIZACION",
      tipo: "permiso",
      mensaje: "Google rechazó la autorización para operar esta cuenta. No se creó nada.",
      accionSugerida: "Revisar el acceso del usuario conectado y el nivel del proyecto de Cloud.",
    });
  }
  if (status === 401 || /invalid_grant|AUTHENTICATION_ERROR|UNAUTHENTICATED/i.test(texto)) {
    return base({
      codigo: "GOOGLE_TOKEN_EXPIRADO",
      tipo: "autenticacion",
      mensaje: "El permiso concedido a Google Ads venció o fue revocado. Se debe volver a conectar.",
      accionSugerida: "Reconectar Google Ads en Integraciones.",
    });
  }
  if (/DUPLICATE_CAMPAIGN_NAME|DUPLICATE_NAME/i.test(texto)) {
    return base({
      codigo: "GOOGLE_NOMBRE_DUPLICADO",
      tipo: "validacion",
      mensaje: "Ya existe en Google Ads una campaña con ese nombre. No se creó otra.",
      accionSugerida: "Revisar la campaña existente en Google Ads o cambiar el nombre del borrador.",
    });
  }
  if (/POLICY_FINDING|POLICY_VIOLATION|policyFindingDetails|policyViolationDetails/i.test(texto)) {
    return base({
      codigo: "GOOGLE_POLITICA",
      tipo: "politica",
      mensaje: `Google rechazó un texto o una palabra clave por sus políticas publicitarias.${humano ? ` Detalle: ${humano}` : ""}`,
      accionSugerida: "Cambiar el texto señalado y volver a publicar.",
    });
  }
  if (/INVALID_KEYWORD|KEYWORD_HAS_INVALID_CHARS|KEYWORD_TEXT|criterionError/i.test(texto)) {
    return base({
      codigo: "GOOGLE_PALABRA_INVALIDA",
      tipo: "validacion",
      mensaje: `Google no aceptó una de las palabras clave.${humano ? ` Detalle: ${humano}` : ""}`,
      accionSugerida: "Quitar símbolos o palabras sueltas no permitidas de las palabras clave.",
    });
  }
  if (/STRING_LENGTH_TOO_LONG|MAX_LENGTH|TOO_LONG/i.test(texto)) {
    return base({
      codigo: "GOOGLE_LONGITUD_TEXTO",
      tipo: "validacion",
      mensaje: "Uno de los titulares supera los 30 caracteres o una descripción supera los 90 caracteres exigidos por Google.",
      accionSugerida: "Recortar titulares a 30 caracteres y descripciones a 90 caracteres.",
    });
  }
  if (/campaignBudgetError|BUDGET_(ERROR|BELOW|TOO)|AMOUNT_TOO_(SMALL|LOW)|NON_MULTIPLE_OF_MINIMUM_CURRENCY_UNIT/i.test(texto)) {
    return base({
      codigo: "GOOGLE_PRESUPUESTO_INVALIDO",
      tipo: "validacion",
      mensaje: "Google no aceptó el presupuesto diario (muy bajo o con decimales que la moneda no admite).",
      accionSugerida: "Usar un presupuesto diario en pesos enteros y por sobre el mínimo de Google.",
    });
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA_ERROR/i.test(texto)) {
    return base({
      codigo: "GOOGLE_LIMITE",
      tipo: "plataforma",
      mensaje: "Google pidió esperar antes de volver a operar esta cuenta. No se creó nada.",
      accionSugerida: "Reintentar en unos minutos.",
    });
  }
  if (/REQUIRED/i.test(texto) && /fieldError/i.test(texto)) {
    return base({
      codigo: "GOOGLE_CAMPO_REQUERIDO",
      tipo: "interno",
      mensaje: "Google pidió un dato que Respondo no mandó. Es un error nuestro, no de tu cuenta; no se creó nada.",
    });
  }
  if (status >= 500) {
    return base({
      codigo: "GOOGLE_NO_DISPONIBLE",
      tipo: "plataforma",
      mensaje: "Google Ads no respondió bien en este momento. No se creó nada; reintenta en unos minutos.",
    });
  }
  return base({
    codigo: "GOOGLE_ERROR_NATIVO",
    tipo: "plataforma",
    mensaje: `Google Ads rechazó la operación y no se creó nada.${humano ? ` Detalle: ${humano}` : ""}`,
  });
}

function fallaDe(
  entrada: EntradaPublicacionGoogle,
  clave: string,
  cuentaId: string,
  mensaje: string,
  nativeErrors?: FallaPublicacion[],
): ResultadoPublicacion {
  return {
    ok: false,
    plataforma: "google",
    clienteId: entrada.clienteId,
    cuentaId,
    status: "error",
    createdAt: new Date().toISOString(),
    idempotencyKey: clave,
    mensaje,
    nativeErrors,
  };
}

async function llamarGoogle(
  sesion: { token: string; login: string | null },
  ruta: string,
  cuerpo: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sesion.token}`,
    "Content-Type": "application/json",
  };
  const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (devToken) headers["developer-token"] = devToken;
  if (sesion.login) headers["login-customer-id"] = sesion.login.replace(/\D+/g, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${API}/${ruta}`, {
      method: "POST",
      signal: ctrl.signal,
      headers,
      body: JSON.stringify(cuerpo),
      cache: "no-store",
    });
    const json = (await r.json().catch(() => ({}))) as unknown;
    return { status: r.status, json: (Array.isArray(json) ? { trozos: json } : json) as Record<string, unknown> };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ¿Ya existe en la cuenta una campaña NO eliminada con este nombre? Cubre el
 * caso en que Google creó todo pero el guardado en Respondo falló: sin esto,
 * reintentar crearía una segunda campaña (o chocaría con DUPLICATE_NAME).
 */
async function campanaExistente(
  sesion: { token: string; cuentaId: string; login: string | null },
  nombre: string,
): Promise<{ campaignId: string; budgetId?: string; estado: string } | null> {
  const gaql = `SELECT campaign.id, campaign.status, campaign_budget.id FROM campaign
                WHERE campaign.name = '${nombre}' AND campaign.status != 'REMOVED' LIMIT 1`;
  const r = await llamarGoogle(sesion, `customers/${sesion.cuentaId}/googleAds:search`, { query: gaql });
  const fila = Array.isArray(r.json.results) ? (r.json.results as Record<string, unknown>[])[0] : undefined;
  if (!fila) return null;
  const c = fila.campaign as Record<string, unknown> | undefined;
  const b = fila.campaignBudget as Record<string, unknown> | undefined;
  return c?.id ? { campaignId: String(c.id), budgetId: b?.id ? String(b.id) : undefined, estado: String(c.status ?? "") } : null;
}

/**
 * Publicación real de una campaña Search en Google Ads API v25, en PAUSA.
 */
export async function publicarCampanaEnGoogle(entrada: EntradaPublicacionGoogle): Promise<ResultadoPublicacion> {
  const clave = generarClaveIdempotencia(entrada.clienteId, entrada.borradorId, "google");

  // 0. Idempotencia persistente: lo guardado en el borrador manda.
  const previa = publicacionPreviaGoogle(entrada.planGuardado, entrada.clienteId);
  if (previa) return previa;

  // 1. Idempotencia en memoria: doble clic dentro de la misma instancia.
  const estadoIdem = verificarIdempotencia(clave);
  if (estadoIdem.enProgreso) {
    return { ...fallaDe(entrada, clave, "", "Ya hay una publicación en curso para esta campaña en Google Ads."), status: "creando" };
  }
  if (estadoIdem.resultado?.ok) return estadoIdem.resultado;
  registrarInicioPublicacion(clave);
  const terminar = (res: ResultadoPublicacion) => {
    registrarFinPublicacion(clave, res);
    return res;
  };

  if (!(entrada.presupuestoDiario > 0)) {
    return terminar(fallaDe(entrada, clave, "", "El presupuesto diario debe ser mayor a 0."));
  }

  // 2. Sesión: la MISMA que usa la lectura.
  const { sesionGoogleDe } = await import("@/lib/ads/google");
  const s = await sesionGoogleDe(entrada.clienteId);
  if (!s.ok) {
    const sinConexion = s.error.codigo === "sin_conexion";
    return terminar(
      fallaDe(
        entrada,
        clave,
        "",
        sinConexion ? "No hay una cuenta de Google Ads conectada para este negocio." : s.error.mensaje,
        [{ codigo: sinConexion ? "SIN_CONEXION" : `GOOGLE_${s.error.codigo.toUpperCase()}`, mensaje: s.error.mensaje, detalleTecnico: sanitizarMensajeError(s.error.detalle ?? "") }],
      ),
    );
  }
  const sesion = s.datos;

  // 3. Operaciones (validación de URL, textos, palabras y presupuesto).
  const fecha = new Date().toISOString().slice(0, 10);
  const armado = construirOperacionesGoogle(entrada, sesion.cuentaId, fecha);
  if (!armado.ok) {
    return terminar(fallaDe(entrada, clave, sesion.cuentaId, armado.mensaje, [{ codigo: armado.codigo, mensaje: armado.mensaje }]));
  }

  try {
    // 4. ¿Ya existe en Google? (el guardado anterior pudo fallar después del mutate)
    const ya = await campanaExistente(sesion, armado.plan.nombreCampana).catch(() => null);
    if (ya) {
      return terminar({
        ok: true,
        plataforma: "google",
        clienteId: entrada.clienteId,
        cuentaId: sesion.cuentaId,
        campaignId: ya.campaignId,
        budgetId: ya.budgetId,
        status: ya.estado === "ENABLED" ? "activa" : "pausada",
        createdAt: new Date().toISOString(),
        urlNativa: linkGoogleAds(sesion.cuentaId, ya.campaignId),
        idempotencyKey: clave,
        mensaje: "La campaña ya existía en Google Ads con este nombre: no se creó otra.",
      });
    }

    // 5. Mutación atómica.
    const r = await llamarGoogle(sesion, `customers/${sesion.cuentaId}/googleAds:mutate`, {
      mutateOperations: armado.plan.operaciones,
    });
    if (r.status >= 400 || r.json.error) {
      const falla = traducirErrorGoogleMutate(r.status, r.json);
      const rid = requestIdGoogle(r.json);
      if (rid) falla.detalleTecnico = `request-id ${rid} · ${falla.detalleTecnico ?? ""}`;
      return terminar(fallaDe(entrada, clave, sesion.cuentaId, falla.mensaje, [falla]));
    }

    const ids = extraerIdsMutacion(r.json);
    return terminar({
      ok: true,
      plataforma: "google",
      clienteId: entrada.clienteId,
      cuentaId: sesion.cuentaId,
      campaignId: ids.campaignId,
      adGroupOrAdSetId: ids.adGroupId,
      adIds: ids.adIds.length ? ids.adIds : undefined,
      budgetId: ids.budgetId,
      keywordIds: ids.keywordIds.length ? ids.keywordIds : undefined,
      status: "pausada",
      createdAt: new Date().toISOString(),
      urlNativa: linkGoogleAds(sesion.cuentaId, ids.campaignId),
      idempotencyKey: clave,
      mensaje: "Campaña de Búsqueda creada en Google Ads en estado PAUSADA.",
    });
  } catch (err) {
    return terminar(
      fallaDe(entrada, clave, sesion.cuentaId, "Error de red o timeout al comunicar con Google Ads API. Revisa en Google Ads antes de reintentar.", [
        { codigo: "RED_TIMEOUT", mensaje: sanitizarMensajeError(err) },
      ]),
    );
  }
}
