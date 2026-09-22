import { db } from "@/lib/db";
import { descifrar } from "@/lib/cifrado";
import {
  fallo,
  type CuentaPublicitaria,
  type PaginaMeta,
  type ProveedorAds,
  type RendimientoAnuncio,
  type ResultadoAds,
} from "@/lib/ads/proveedor";
import type {
  EstadoEntidad,
  FilaRendimiento,
  Nivel,
  Resultado,
  TipoResultado,
} from "@/lib/ads/canal";
import { decimalesDe, type Monto } from "@/lib/ads/moneda";

/**
 * META COMO PROVEEDOR DE ANUNCIOS — el único archivo que sabe de la Graph API.
 *
 * ALCANCE, A PROPÓSITO: **solo lectura.**
 * Este adaptador lee cuentas y rendimiento. No crea campañas, no cambia
 * presupuestos y no pausa nada, y esa no es una limitación técnica: es la
 * decisión de producto documentada en `estrategia-comercial/PLAN_ADS`. El
 * Administrador de Anuncios de Meta ya hace eso gratis y mejor; lo que nadie
 * más puede hacer es cruzar ese gasto con lo que pasó después en WhatsApp.
 * Escribir en Meta exige `ads_management` y una revisión de app entera, para
 * agregar un botón que ningún cliente pidió.
 *
 * LO QUE SÍ ESTÁ RESUELTO ACÁ, PORQUE ROMPE EN PRODUCCIÓN SI NO:
 *  · **Versión de la API fija** (v21.0). Meta rota versiones y deja de
 *    responder a las viejas; que el número esté en una constante es lo que
 *    permite subirla en un solo lugar cuando toque.
 *  · **Timeout.** Una llamada colgada congela la función de Vercel hasta que la
 *    matan, y en pantalla se ve como «Pauta no carga».
 *  · **Paginación.** `insights` a nivel de anuncio pagina de a 25: sin seguir
 *    `paging.next`, un negocio con 40 anuncios ve solo los primeros y las
 *    cifras quedan mudas sin ningún error.
 *  · **Límite de uso.** Meta responde 4/17/80004 y además manda el encabezado
 *    `x-business-use-case-usage`. Reintentar ahí empeora el bloqueo: se
 *    devuelve `limite_api` y la pantalla muestra la última sincronización.
 *  · **Token vencido (código 190).** Es EL error más común y el único que el
 *    dueño puede resolver solo. Se traduce a «reconectar», no a «error 190».
 *  · **La moneda sale de la CUENTA**, nunca se asume CLP: una cuenta que
 *    factura en dólares con cifras rotuladas en pesos es un error de decisión
 *    de plata, no de formato.
 *
 * ⚠️ Sin conexión guardada, todo devuelve `sin_conexion`. **Nunca datos falsos
 * ni ceros.** Esa es la regla que hace que se le pueda creer a esta pantalla.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 15_000;
/** Tope de páginas por consulta. Una cuenta grande no puede colgar la función. */
const MAX_PAGINAS = 20;

export type ConexionAds = {
  clienteId: string;
  cuentaId: string;
  cuentaNombre: string;
  moneda: string;
  zonaHoraria: string;
  token: string;
  estado: string;
  ultimaSync: string | null;
  ultimoError: string | null;
  /** Página de Facebook vinculada (descubierta en el callback de OAuth). null si aún no hay ninguna. */
  paginaId: string | null;
  paginaNombre: string | null;
  /** Instagram profesional vinculado a esa Página. null si la Página no tiene uno. */
  instagramId: string | null;
  instagramUsuario: string | null;
  /** Portafolio empresarial dueño de la cuenta publicitaria. */
  negocioId: string | null;
  negocioNombre: string | null;
};

/**
 * ¿Está habilitada la conexión con Meta en esta instalación?
 *
 * Las TRES variables son obligatorias, incluido el ajuste. Sin `CONFIG_ID` el
 * diálogo de Meta abre igual —no da error— pero solo pide el nombre y la foto
 * de perfil: el token vuelve sin acceso a ninguna cuenta publicitaria y la
 * pantalla diría «conectado» sin poder leer un peso de gasto. Verificado a mano
 * el 10-sep-2026 contra la app real.
 */
export function metaAdsConfigurado(): boolean {
  return Boolean(
    process.env.META_ADS_APP_ID &&
      process.env.META_ADS_APP_SECRET &&
      process.env.META_ADS_CONFIG_ID,
  );
}

/**
 * La conexión guardada del cliente, con el token ya descifrado.
 *
 * Devuelve null —y no lanza— cuando la migración 302 no está aplicada: la
 * pantalla tiene que poder decir «no hay conexión» en vez de caerse.
 */
export async function conexionDe(clienteId: string): Promise<ConexionAds | null> {
  try {
    const { data, error } = await db()
      .from("ed_ads_conexion")
      .select(
        "cuenta_id, cuenta_nombre, moneda, zona_horaria, token_cifrado, estado, ultima_sync, ultimo_error, datos",
      )
      .eq("cliente_id", clienteId)
      .eq("proveedor", "meta")
      .maybeSingle();
    if (error || !data?.token_cifrado) return null;

    const token = descifrar(data.token_cifrado as string, "ads-token");
    if (!token) return null;

    const datos = (data.datos ?? {}) as Record<string, unknown>;
    return {
      clienteId,
      cuentaId: String(data.cuenta_id ?? ""),
      cuentaNombre: String(data.cuenta_nombre ?? ""),
      moneda: String(data.moneda ?? "CLP"),
      zonaHoraria: String(data.zona_horaria ?? "America/Santiago"),
      token,
      estado: String(data.estado ?? "conectada"),
      ultimaSync: (data.ultima_sync as string | null) ?? null,
      ultimoError: (data.ultimo_error as string | null) ?? null,
      paginaId: (datos.paginaId as string | undefined) || null,
      paginaNombre: (datos.paginaNombre as string | undefined) || null,
      instagramId: (datos.instagramId as string | undefined) || null,
      instagramUsuario: (datos.instagramUsuario as string | undefined) || null,
      negocioId: (datos.businessId as string | undefined) || null,
      negocioNombre: (datos.businessNombre as string | undefined) || null,
    };
  } catch {
    return null;
  }
}

type RespuestaGraph = {
  ok: boolean;
  status: number;
  cuerpo: Record<string, unknown>;
};

async function pedir(url: string, token: string): Promise<RespuestaGraph | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const cuerpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, cuerpo };
  } catch {
    return null; // timeout o red
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Traduce un error de Meta a algo que una persona puede resolver.
 *
 * Los códigos salen de la documentación de la Graph API y de lo que se ve en
 * producción: el 190 (token vencido) es más del 90% de los casos reales.
 */
function traducirError<T>(r: RespuestaGraph | null): ResultadoAds<T> {
  if (!r) return fallo("red", "timeout o fallo de red");

  const err = (r.cuerpo.error ?? {}) as Record<string, unknown>;
  const codigo = Number(err.code);
  const sub = Number(err.error_subcode);
  const mensaje = String(err.message ?? `HTTP ${r.status}`);

  if (codigo === 190 || r.status === 401) return fallo("token_vencido", mensaje);
  // El 403 sin código reconocible también es permiso: caía en «respuesta rara»
  // y le decía al dueño «Meta respondió algo que no supimos interpretar»
  // cuando lo que pasaba era que le sacaron el acceso a la cuenta.
  if (codigo === 200 || codigo === 10 || codigo === 299 || r.status === 403) return fallo("sin_permiso", mensaje);
  if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613 || sub === 2446079) {
    return fallo("limite_api", mensaje);
  }
  if (r.status === 429) return fallo("limite_api", mensaje);
  if (codigo === 100 && /act_|does not exist|Unsupported/i.test(mensaje)) {
    return fallo("cuenta_invalida", mensaje);
  }
  if (r.status >= 500) return fallo("red", mensaje);
  return fallo("respuesta_rara", mensaje);
}

/** Sigue `paging.next` hasta agotar o llegar al tope. */
async function pedirTodo(
  primeraUrl: string,
  token: string,
): Promise<ResultadoAds<Record<string, unknown>[]>> {
  const filas: Record<string, unknown>[] = [];
  let url: string | null = primeraUrl;

  for (let pagina = 0; url && pagina < MAX_PAGINAS; pagina++) {
    const r: RespuestaGraph | null = await pedir(url, token);
    if (!r || !r.ok) return traducirError(r);

    const datos = r.cuerpo.data;
    if (!Array.isArray(datos)) return fallo("respuesta_rara", "el campo data no es una lista");
    filas.push(...(datos as Record<string, unknown>[]));

    const paging = (r.cuerpo.paging ?? {}) as Record<string, unknown>;
    const siguiente = paging.next;
    /**
     * La URL de `next` viene de Meta y se usa para hacer una petición. Se
     * verifica el host antes de seguirla: es la misma regla que ya aplica
     * lib/whatsapp.ts a las URLs de media. Un `next` apuntando a otro dominio
     * sería un SSRF con nuestro token en el encabezado.
     */
    url = null;
    if (typeof siguiente === "string") {
      try {
        const u = new URL(siguiente);
        if (u.hostname === "graph.facebook.com") url = siguiente;
      } catch {
        url = null;
      }
    }
  }

  return { ok: true, datos: filas };
}

function numero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Las cuentas publicitarias a las que llega el token guardado.
 *
 * También se usa en la pantalla de conexión para que el dueño ELIJA cuál, en
 * vez de que adivinemos: quien administra dos negocios ve las dos, y tomar la
 * primera de la lista sería mostrarle las cifras del otro.
 */
async function cuentasConToken(token: string): Promise<ResultadoAds<CuentaPublicitaria[]>> {
  const url =
    `${GRAPH}/me/adaccounts?limit=50&fields=` +
    encodeURIComponent("account_id,name,currency,timezone_name,account_status,business{id,name}");

  const r = await pedirTodo(url, token);
  if (!r.ok) return r;

  return {
    ok: true,
    datos: r.datos.map((f) => ({
      // `id` viene como «act_123»; se guarda así porque así se consulta después.
      id: String(f.id ?? `act_${f.account_id ?? ""}`),
      nombre: String(f.name ?? "Cuenta sin nombre"),
      moneda: String(f.currency ?? "CLP").toUpperCase(),
      zonaHoraria: String(f.timezone_name ?? "America/Santiago"),
      // 1 = ACTIVE en la tabla de Meta. Cualquier otro estado es «no publica».
      activa: numero(f.account_status) === 1,
      // Requiere business_management: es el portafolio dueño de la cuenta.
      negocioId: (f.business as { id?: unknown } | undefined)?.id
        ? String((f.business as { id: unknown }).id)
        : null,
      negocioNombre: (f.business as { name?: unknown } | undefined)?.name
        ? String((f.business as { name: unknown }).name)
        : null,
    })),
  };
}

/**
 * Las Páginas de Facebook a las que llega el token, con su Instagram
 * profesional vinculado (si tiene uno).
 *
 * Requiere que la Configuración de «Inicio de sesión con Facebook para
 * empresas» pida el activo «Páginas» además de «Cuentas publicitarias» — sin
 * eso, Meta devuelve una lista vacía aunque el negocio sí administre Páginas,
 * y no es un error: es que no se pidió el activo.
 *
 * `instagram_business_account` solo viene si la Página tiene una cuenta de
 * Instagram profesional (no personal) vinculada desde la propia Meta Business
 * Suite. Una Página sin Instagram vinculado es un caso normal, no un error.
 */
async function paginasConToken(token: string): Promise<ResultadoAds<PaginaMeta[]>> {
  const url =
    `${GRAPH}/me/accounts?limit=50&fields=` +
    encodeURIComponent("id,name,instagram_business_account{id,username}");

  const r = await pedirTodo(url, token);
  if (!r.ok) return r;

  return {
    ok: true,
    datos: r.datos.map((f) => {
      const ig = f.instagram_business_account as
        | { id?: unknown; username?: unknown }
        | undefined;
      return {
        id: String(f.id ?? ""),
        nombre: String(f.name ?? "Página sin nombre"),
        instagramId: ig?.id != null ? String(ig.id) : null,
        instagramUsuario: ig?.username != null ? String(ig.username) : null,
      };
    }),
  };
}

export const proveedorMeta: ProveedorAds & {
  cuentasConToken: typeof cuentasConToken;
  paginasConToken: typeof paginasConToken;
} = {
  nombre: "Meta",
  cuentasConToken,
  paginasConToken,

  async cuentas(clienteId: string) {
    if (!metaAdsConfigurado()) return fallo("no_configurado");
    const con = await conexionDe(clienteId);
    if (!con) return fallo("sin_conexion");
    return cuentasConToken(con.token);
  },

  async rendimiento(clienteId, rango, opciones) {
    if (!metaAdsConfigurado()) return fallo("no_configurado");
    const con = await conexionDe(clienteId);
    if (!con) return fallo("sin_conexion");
    if (!con.cuentaId) return fallo("cuenta_invalida", "no hay cuenta elegida");

    /**
     * `time_range` va en la ZONA DE LA CUENTA, no en la nuestra. Meta corta los
     * días con el huso horario que tiene configurada la cuenta publicitaria: si
     * mandáramos las fechas asumiendo Chile y la cuenta estuviera en otra zona,
     * el gasto del primer y del último día quedaría corrido y nadie sabría por
     * qué el total no cuadra con el Administrador de Anuncios.
     *
     * Por eso se mandan las fechas tal cual (AAAA-MM-DD) y se muestra la zona
     * de la cuenta en la pantalla de conexión.
     */
    /**
     * `porDia` pide una fila por anuncio y por día (`time_increment=1`) en vez
     * del total del período. Es lo que alimenta el gráfico de tendencia. Vale
     * hasta 30× más filas, así que solo se pide cuando la pantalla lo dibuja.
     */
    const params = new URLSearchParams({
      level: "ad",
      limit: opciones?.porDia ? "500" : "100",
      time_increment: opciones?.porDia ? "1" : "all_days",
      time_range: JSON.stringify({ since: rango.desde, until: rango.hasta }),
      fields: [
        "ad_id",
        "ad_name",
        "adset_id",
        "adset_name",
        "campaign_id",
        "campaign_name",
        "impressions",
        "clicks",
        "spend",
      ].join(","),
    });

    const r = await pedirTodo(`${GRAPH}/${con.cuentaId}/insights?${params}`, con.token);
    if (!r.ok) return r;

    const filas: RendimientoAnuncio[] = r.datos
      .filter((f) => f.ad_id)
      .map((f) => ({
        anuncioId: String(f.ad_id),
        anuncioNombre: String(f.ad_name ?? "Anuncio sin nombre"),
        campanaId: String(f.campaign_id ?? ""),
        campanaNombre: String(f.campaign_name ?? ""),
        conjuntoId: String(f.adset_id ?? ""),
        conjuntoNombre: String(f.adset_name ?? ""),
        impresiones: numero(f.impressions),
        clics: numero(f.clicks),
        // La moneda es la de la CUENTA. Meta no la repite en cada fila.
        gasto: { valor: numero(f.spend), moneda: con.moneda },
        // Solo viene con `porDia`; Meta lo entrega en la zona de la cuenta.
        dia: typeof f.date_start === "string" ? f.date_start : undefined,
      }));

    return { ok: true, datos: filas };
  },
};

/* ── OAuth ─────────────────────────────────────────────────────────────────
 * Login de Facebook con `ads_read` y `business_management`. Solo lectura: pedir
 * `ads_management` obligaría a una revisión de app mucho más larga para una
 * capacidad que decidimos no construir.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ LOS PERMISOS NO VIAJAN EN LA URL. Viven en el «ajuste» (configuration) de
 * Inicio de sesión con Facebook para empresas, y la URL solo lo referencia por
 * su `config_id`. Esta constante queda como DOCUMENTACIÓN de qué pide ese
 * ajuste; cambiarla acá no cambia nada en Meta.
 *
 * El ajuste de Respondo pide `ads_read` + `business_management` sobre el activo
 * «cuentas publicitarias» con el permiso de tarea **ANALYZE** (acceder a
 * informes y ver anuncios). No MANAGE, que es el que Meta pone por defecto.
 */
export const SCOPES_ADS = ["ads_read", "business_management"];

/**
 * La URL pública del portal.
 *
 * ⚠️ MISMA CONVENCIÓN QUE `googleOAuth.ts` E `instagramOAuth.ts`, y no es un
 * detalle de estilo: `NEXT_PUBLIC_SITE_URL` vale `http://localhost:3000` en
 * desarrollo, así que el valor por defecto a producción es lo que hace que el
 * `redirect_uri` salga completo igual. Sin él queda la ruta relativa
 * «/api/ads/callback» y Meta responde «No se puede cargar la URL: el dominio no
 * está incluido en los dominios de la aplicación» — que fue exactamente lo que
 * pasó la primera vez que se probó, el 10-sep-2026.
 */
const URL_PORTAL = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://respondo-portal.vercel.app"
).replace(/\/+$/, "");
export const REDIRECT_URI_ADS = `${URL_PORTAL}/api/ads/callback`;

/**
 * El `state` va FIRMADO, igual que en Instagram (lib/instagramOAuth.ts).
 *
 * Sin firma, cualquiera podría inducir un callback con el cliente_id de otro
 * negocio y dejarle una conexión ajena guardada. Es el mismo ataque que un
 * CSRF, y la firma es lo que lo cierra.
 */
export function urlAutorizacionAds(estadoFirmado: string): string {
  /**
   * ⚠️ VA `config_id`, NO `scope`. Este es el detalle que costó una prueba a
   * mano: con `scope=ads_read,business_management` el diálogo de Meta **abre
   * sin error** y muestra «Respondo Ads recibirá tu nombre y foto de perfil».
   * No falla: simplemente ignora los permisos y devuelve un token inútil. Con
   * `config_id` aparece la pantalla correcta —elegir portafolio y cuenta
   * publicitaria— que es la que hace falta.
   *
   * Un fallo que no da error es peor que uno que sí: la conexión quedaría
   * guardada, la pantalla diría «conectada» y el gasto nunca aparecería.
   */
  const p = new URLSearchParams({
    client_id: process.env.META_ADS_APP_ID ?? "",
    config_id: process.env.META_ADS_CONFIG_ID ?? "",
    redirect_uri: REDIRECT_URI_ADS,
    state: estadoFirmado,
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

/**
 * Cambia el `code` del callback por el token.
 *
 * El ajuste está configurado como **usuario del sistema, sin caducidad**: el
 * token que vuelve no vence. Es a propósito — un token de 60 días obliga a cada
 * negocio a reconectar cada dos meses, y entre medio la columna «Invertido» se
 * apaga sin que nadie se entere hasta que mira.
 */
export async function intercambiarCodigoAds(codigo: string): Promise<ResultadoAds<string>> {
  if (!metaAdsConfigurado()) return fallo("no_configurado");

  const p = new URLSearchParams({
    client_id: process.env.META_ADS_APP_ID ?? "",
    client_secret: process.env.META_ADS_APP_SECRET ?? "",
    redirect_uri: REDIRECT_URI_ADS,
    code: codigo,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${GRAPH}/oauth/access_token?${p}`, {
      signal: ctrl.signal,
      cache: "no-store",
    });
    const cuerpo = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || !cuerpo.access_token) {
      return traducirError({ ok: r.ok, status: r.status, cuerpo });
    }
    return { ok: true, datos: String(cuerpo.access_token) };
  } catch {
    return fallo("red", "timeout al canjear el código");
  } finally {
    clearTimeout(timer);
  }
}

/* ── Marketing Fase 6: Meta en el vocabulario multicanal ─────────────────────
 *
 * Lo de arriba (`proveedorMeta.rendimiento`) sigue igual y sigue siendo lo que
 * alimenta la atribución: filas por ANUNCIO con gasto, impresiones y clics.
 * Lo de acá abajo agrega lo que faltaba para poder ANALIZAR Meta por sí sola,
 * sin conversaciones de por medio: alcance, frecuencia, el resultado que la
 * campaña declara y la jerarquía con estado y objetivo.
 *
 * Se agregó sin tocar lo anterior a propósito: la atribución es el camino
 * probado de tres clientes y no se toca para construir uno nuevo.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * ⭐⭐ QUÉ CUENTA COMO «RESULTADO» EN META, Y POR QUÉ ESTA LISTA ES CORTA.
 *
 * `actions` de Meta trae entre veinte y cuarenta tipos por anuncio: vistas de
 * página, clics en el enlace, reproducciones de video de 3 segundos, «me
 * gusta», guardados, y las de verdad. Volcarlas todas a la pantalla es la sopa
 * de métricas que nadie lee; peor, elegir «la primera» produce un número que
 * cambia de significado entre dos campañas.
 *
 * Se normalizan SOLO las que sabemos definir sin ambigüedad, y el orden de esta
 * lista ES la prioridad: si una campaña reporta compras y además mensajes, el
 * resultado principal es la compra. Todo lo demás se ignora a propósito.
 *
 * Nombres verificados contra la Graph API v21 (campos de `actions[].action_type`).
 */
const RESULTADOS_META: { accion: string; tipo: TipoResultado }[] = [
  { accion: "offsite_conversion.fb_pixel_purchase", tipo: "compras" },
  { accion: "purchase", tipo: "compras" },
  { accion: "onsite_conversion.purchase", tipo: "compras" },
  { accion: "offsite_conversion.fb_pixel_lead", tipo: "leads" },
  { accion: "lead", tipo: "leads" },
  { accion: "onsite_conversion.lead_grouped", tipo: "leads" },
  { accion: "onsite_conversion.messaging_conversation_started_7d", tipo: "mensajes" },
  { accion: "onsite_conversion.total_messaging_connection", tipo: "mensajes" },
  { accion: "onsite_conversion.messaging_first_reply", tipo: "mensajes" },
  { accion: "offsite_conversion.fb_pixel_complete_registration", tipo: "conversiones_web" },
  { accion: "onsite_conversion.flow_complete", tipo: "conversiones_web" },
  { accion: "call_confirm", tipo: "llamadas" },
  { accion: "click_to_call_call_confirm", tipo: "llamadas" },
];

/** Extrae el resultado principal de `actions`, con su tipo. null si no hay. */
export function resultadoDeAcciones(acciones: unknown): Resultado | null {
  if (!Array.isArray(acciones)) return null;
  const porTipo = new Map<string, number>();
  for (const a of acciones as Record<string, unknown>[]) {
    const tipo = String(a?.action_type ?? "");
    const valor = Number(a?.value ?? 0);
    if (!tipo || !Number.isFinite(valor)) continue;
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + valor);
  }
  for (const { accion, tipo } of RESULTADOS_META) {
    const cantidad = porTipo.get(accion);
    if (cantidad && cantidad > 0) return { cantidad, tipo };
  }
  return null;
}

/** Suma el valor declarado (`action_values`) de las acciones de compra. */
export function valorDeAcciones(valores: unknown, moneda: string): Monto | null {
  if (!Array.isArray(valores)) return null;
  let total = 0;
  for (const a of valores as Record<string, unknown>[]) {
    const tipo = String(a?.action_type ?? "");
    if (!/purchase/i.test(tipo)) continue;
    const v = Number(a?.value ?? 0);
    if (Number.isFinite(v)) total += v;
  }
  return total > 0 ? { valor: total, moneda } : null;
}

/** El objetivo de Meta, en palabras del dueño. */
const OBJETIVO_META: Record<string, string> = {
  OUTCOME_ENGAGEMENT: "Interacción",
  OUTCOME_LEADS: "Clientes potenciales",
  OUTCOME_SALES: "Ventas",
  OUTCOME_TRAFFIC: "Tráfico",
  OUTCOME_AWARENESS: "Reconocimiento",
  OUTCOME_APP_PROMOTION: "Promoción de app",
  MESSAGES: "Mensajes",
  CONVERSIONS: "Conversiones",
  LINK_CLICKS: "Clics en el enlace",
  LEAD_GENERATION: "Clientes potenciales",
};

export function objetivoMetaLegible(v: unknown): string | null {
  const s = String(v ?? "").toUpperCase();
  if (!s) return null;
  return OBJETIVO_META[s] ?? s.replace(/^OUTCOME_/, "").toLowerCase().replace(/_/g, " ");
}

function estadoMeta(v: unknown): EstadoEntidad {
  const s = String(v ?? "").toUpperCase();
  if (s === "ACTIVE") return "activa";
  if (s === "PAUSED") return "pausada";
  if (s === "DELETED" || s === "ARCHIVED" || s === "CAMPAIGN_PAUSED" || s === "ADSET_PAUSED") return "terminada";
  return "desconocido";
}

const NIVEL_META: Record<string, "campaign" | "adset" | "ad"> = {
  campana: "campaign",
  conjunto: "adset",
  anuncio: "ad",
};

/**
 * Rendimiento de Meta en el vocabulario común, por nivel.
 *
 * UNA consulta de insights por nivel pedido (en paralelo), más UNA consulta de
 * entidades de campaña para traer estado, objetivo y presupuesto —que insights
 * no entrega—. Con tres niveles son cuatro viajes, no uno por campaña.
 */
export async function rendimientoMetaMulti(
  clienteId: string,
  rango: { desde: string; hasta: string },
  niveles: Nivel[] = ["campana"],
): Promise<ResultadoAds<FilaRendimiento[]>> {
  if (!metaAdsConfigurado()) return fallo("no_configurado");
  const con = await conexionDe(clienteId);
  if (!con) return fallo("sin_conexion");
  if (!con.cuentaId) return fallo("cuenta_invalida", "no hay cuenta elegida");

  const pedidos = niveles.filter((n) => NIVEL_META[n]);
  if (!pedidos.length) return { ok: true, datos: [] };

  const campos = [
    "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name",
    "impressions", "clicks", "spend", "reach", "frequency", "actions", "action_values", "objective",
  ].join(",");

  const consultas = pedidos.map(async (nivel) => {
    const params = new URLSearchParams({
      level: NIVEL_META[nivel],
      limit: "200",
      time_increment: "all_days",
      time_range: JSON.stringify({ since: rango.desde, until: rango.hasta }),
      fields: campos,
    });
    return { nivel, r: await pedirTodo(`${GRAPH}/${con.cuentaId}/insights?${params}`, con.token) };
  });

  /**
   * Los datos de la entidad (estado, objetivo, presupuesto) NO vienen en
   * insights: una campaña pausada ayer aparece igual que una activa. Y
   * recomendar «pausa esta campaña» sobre una que ya está pausada es la forma
   * más rápida de que el dueño deje de leer las recomendaciones.
   */
  const entidades = pedirTodo(
    `${GRAPH}/${con.cuentaId}/campaigns?limit=200&fields=` +
      encodeURIComponent("id,name,status,effective_status,objective,daily_budget,lifetime_budget"),
    con.token,
  );

  const [resultados, campanas] = await Promise.all([Promise.all(consultas), entidades]);

  const meta = new Map<string, { estado: EstadoEntidad; objetivo: string | null; presupuesto: Monto | null }>();
  if (campanas.ok) {
    for (const c of campanas.datos) {
      const diario = Number(c.daily_budget ?? 0);
      meta.set(String(c.id), {
        estado: estadoMeta(c.effective_status ?? c.status),
        objetivo: objetivoMetaLegible(c.objective),
        // Meta entrega el presupuesto en la unidad mínima de la moneda de la
        // cuenta: centavos en USD, pesos enteros en CLP (no hay que dividir).
        presupuesto: diario > 0 ? { valor: diario / 10 ** decimalesDe(con.moneda), moneda: con.moneda } : null,
      });
    }
  }

  const filas: FilaRendimiento[] = [];
  let primerError: ResultadoAds<FilaRendimiento[]> | null = null;

  for (const { nivel, r } of resultados) {
    if (!r.ok) {
      if (!primerError) primerError = { ok: false, error: r.error };
      continue;
    }
    for (const f of r.datos) {
      const campanaId = String(f.campaign_id ?? "");
      const datosCampana = meta.get(campanaId);
      const id =
        nivel === "campana" ? campanaId : nivel === "conjunto" ? String(f.adset_id ?? "") : String(f.ad_id ?? "");
      if (!id) continue;

      const frecuencia = Number(f.frequency ?? 0);
      filas.push({
        proveedor: "meta",
        nivel,
        id,
        nombre: String(
          nivel === "campana" ? f.campaign_name : nivel === "conjunto" ? f.adset_name : f.ad_name,
        ) || "Sin nombre",
        campanaId: campanaId || undefined,
        campanaNombre: f.campaign_name ? String(f.campaign_name) : undefined,
        grupoId: f.adset_id ? String(f.adset_id) : undefined,
        grupoNombre: f.adset_name ? String(f.adset_name) : undefined,
        estado: nivel === "campana" ? (datosCampana?.estado ?? "desconocido") : "desconocido",
        objetivo: datosCampana?.objetivo ?? objetivoMetaLegible(f.objective),
        presupuestoDiario: nivel === "campana" ? (datosCampana?.presupuesto ?? null) : null,
        impresiones: numero(f.impressions),
        clics: numero(f.clicks),
        gasto: { valor: numero(f.spend), moneda: con.moneda },
        alcance: f.reach === undefined ? null : numero(f.reach),
        frecuencia: Number.isFinite(frecuencia) && frecuencia > 0 ? frecuencia : null,
        resultados: resultadoDeAcciones(f.actions),
        valorResultados: valorDeAcciones(f.action_values, con.moneda),
      });
    }
  }

  if (!filas.length && primerError) return primerError;
  return { ok: true, datos: filas };
}
