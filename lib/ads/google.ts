import { db } from "@/lib/db";
import { cifrar, descifrar } from "@/lib/cifrado";
import { origenCanonico } from "@/lib/origenes";
import { fallo, type ResultadoAds } from "@/lib/ads/proveedor";
import type { FilaRendimiento, Nivel } from "@/lib/ads/canal";
import { MONEDA_DESCONOCIDA, normalizarMoneda, sumarPorMoneda, type Monto } from "@/lib/ads/moneda";
import { composicionDesdeFilas, fusionarComposicion, gaqlComposicion } from "@/lib/ads/googleConversiones";

/**
 * GOOGLE ADS — LECTURA (GAQL) y la sesión compartida con la escritura.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ALCANCE (corregido el 22-sep-2026 — antes decía «solo lectura» y dejó de
 * ser cierto cuando entró el publicador):
 *   · ESTE archivo lee: cuentas, campañas, grupos, anuncios, palabras clave y
 *     términos de búsqueda, con sus métricas.
 *   · `googlePublicar.ts` CREA, con autorización del negocio y a pedido de una
 *     persona, una campaña de Búsqueda completa (presupuesto, campaña, grupo,
 *     palabras clave y anuncio adaptable) SIEMPRE en PAUSA.
 *   · `googleGestion.ts` lee la estructura de esas campañas y las pausa; sólo
 *     reactiva en cuentas de PRUEBA de Google Ads.
 * Nada de esto toca campañas que Respondo no creó, ni pujas, ni facturación.
 * La frase de producto es: «Respondo lee el rendimiento de tu publicidad y,
 * con tu autorización, puede crear y gestionar campañas de Búsqueda».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️⚠️ POR QUÉ ESTO TIENE SU PROPIO PROYECTO DE GOOGLE CLOUD
 *
 * Respondo YA tiene un OAuth de Google aprobado: el de la Agenda
 * (`lib/googleOAuth.ts`, scopes de Calendar). Agregarle el scope `adwords` a
 * ESE proyecto **reabre la verificación de Google** sobre una integración que
 * ya pasó revisión y que hoy es la que usan los clientes para su agenda.
 * Perder semanas de Calendar por sumar un scope de anuncios sería un
 * autogol.
 *
 * Por eso Google Ads usa credenciales propias:
 *   GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET   (proyecto Cloud aparte)
 *   GOOGLE_ADS_DEVELOPER_TOKEN                        (OPCIONAL — ver abajo)
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID                      (opcional: MCC nuestro)
 *
 * Sin las DOS primeras, `googleAdsConfigurado()` da false y el producto NO
 * ofrece el botón: dice «no está activada» y sigue funcionando con lo demás.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * VERIFICADO EN LA DOCUMENTACIÓN OFICIAL (14-sep-2026, no de memoria):
 *  · Versión vigente de la API: **v25** — `https://googleads.googleapis.com/v25`.
 *  · Scope OAuth: `https://www.googleapis.com/auth/adwords`.
 *  · Encabezados: `Authorization: Bearer` siempre, y `login-customer-id`
 *    **cuando se entra por una cuenta administradora** (sin guiones).
 *  · `searchStream` devuelve un **array de trozos** (`[{results:[…]}, …]`), no
 *    un objeto: parsearlo como objeto devuelve vacío sin error, que es la peor
 *    forma de fallar.
 *
 * ⭐ EL TOKEN DE DESARROLLADOR SE APAGÓ EL 9 DE SEPTIEMBRE DE 2026.
 *    Cinco días antes de escribir esto. La documentación oficial dice que el
 *    encabezado `developer-token` se puede seguir mandando pero que **los
 *    servidores lo ignoran**, y que el nivel de acceso ahora es una propiedad
 *    del **proyecto de Google Cloud** que emitió las credenciales OAuth, no de
 *    una cadena de texto.
 *    Por eso acá: la variable es opcional, se manda sólo si está —no cuesta
 *    nada y evita sorpresas con proyectos antiguos— y **no se exige para
 *    habilitar la integración**. Exigirla dejaría el botón apagado para
 *    siempre por un requisito que Google eliminó.
 *
 *  · Niveles de acceso, asignados al proyecto de Cloud:
 *      Test      — sólo cuentas de prueba. Es lo que hay al habilitar la API.
 *      Explorer  — cuentas reales, 2.880 operaciones/día. Sin verificación de
 *                  marca. Alcanza de sobra para leer unas pocas cuentas.
 *      Basic     — cuentas reales, 15.000 operaciones/día. Exige verificación
 *                  de marca; se aprueba en minutos.
 *      Standard  — sin tope. Revisión manual, ~10 días hábiles.
 *    **Con acceso de prueba, una llamada a una cuenta real falla**: por eso el
 *    error se traduce a un mensaje que dice qué hacer y dónde.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const API = "https://googleads.googleapis.com/v25";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/adwords";
const TIMEOUT_MS = 20_000;

/** El host al que se le manda el token. Cualquier otro se rechaza (anti-SSRF). */
const HOST_API = "googleads.googleapis.com";

export type CredencialesGoogleAds = {
  clientId: string;
  clientSecret: string;
  /**
   * Heredado. Google apagó los tokens de desarrollador el 9-sep-2026 y ahora
   * ignora el encabezado. Se conserva como opcional porque mandarlo no cuesta
   * nada y algún proyecto viejo podría seguir mirándolo.
   */
  developerToken: string | null;
  /** MCC propio, si las cuentas de los clientes cuelgan de él. Opcional. */
  loginCustomerId: string | null;
};

function credenciales(): CredencialesGoogleAds | null {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || null,
    loginCustomerId: soloDigitos(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || null,
  };
}

/**
 * ¿Está habilitada la integración de Google Ads en esta instalación?
 *
 * Obligatorias sólo las DOS del cliente OAuth. El token de desarrollador NO se
 * exige: Google lo apagó el 9-sep-2026 y el nivel de acceso pasó a ser una
 * propiedad del proyecto de Cloud. Exigir una variable que Google eliminó
 * dejaría el botón apagado para siempre por un requisito que ya no existe.
 */
export function googleAdsConfigurado(): boolean {
  return credenciales() !== null;
}

/**
 * Los encabezados de identificación de la app. `developer-token` sólo viaja si
 * quedó configurado; la API lo ignora desde el 9-sep-2026.
 */
function encabezadosApp(cred: CredencialesGoogleAds): Record<string, string> {
  return cred.developerToken ? { "developer-token": cred.developerToken } : {};
}

/** Google identifica las cuentas por dígitos. «123-456-7890» y «1234567890» son la misma. */
export function soloDigitos(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
}

/** Cómo se muestra un id de cuenta: 123-456-7890. */
export function formatearIdCuenta(id: string): string {
  const d = soloDigitos(id);
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
}

/* ── La conexión guardada ─────────────────────────────────────────────────── */

export type ConexionGoogle = {
  clienteId: string;
  /** Customer id de la cuenta que se lee (solo dígitos). */
  cuentaId: string;
  cuentaNombre: string;
  /** Administradora por la que se entra, cuando corresponde. */
  cuentaPadreId: string | null;
  moneda: string;
  zonaHoraria: string;
  /** El refresh token, ya descifrado. NUNCA sale de este módulo. */
  refreshToken: string;
  estado: string;
  ultimoError: string | null;
};

/**
 * Lee la conexión de Google del negocio.
 *
 * Devuelve null —y no lanza— cuando la migración 309 no está aplicada o no hay
 * fila: la pantalla tiene que poder decir «no conectado» en vez de caerse.
 *
 * ⚠️ `cuenta_padre_id` puede no existir como columna (309 sin aplicar). Igual
 * que en `lib/ads/estado.ts`: PostgREST NO lanza, devuelve `{data:null,error}`
 * y **falla el select entero**, así que hay un segundo intento sin esa columna.
 */
export async function conexionGoogleDe(clienteId: string): Promise<ConexionGoogle | null> {
  const base = "cuenta_id, cuenta_nombre, moneda, zona_horaria, token_cifrado, estado, ultimo_error";
  const leer = async (columnas: string) =>
    db()
      .from("ed_ads_conexion")
      .select(columnas)
      .eq("cliente_id", clienteId)
      .eq("proveedor", "google")
      .maybeSingle();

  try {
    let fila: Record<string, unknown> | null = null;
    let padre: string | null = null;

    /**
     * El `as unknown as` no es pereza de tipos: con `select()` de columnas
     * dinámicas, el cliente de Supabase tipa `data` como un error de cadena
     * genérico, y lo que de verdad vuelve es una fila. Se acota a
     * `Record<string, unknown>` y se lee campo por campo con `String(...)`.
     */
    const comoFila = (d: unknown) => d as Record<string, unknown>;

    const conPadre = await leer(`${base}, cuenta_padre_id`);
    if (!conPadre.error && conPadre.data) {
      fila = comoFila(conPadre.data);
      padre = (fila.cuenta_padre_id as string | null) ?? null;
    } else if (conPadre.error) {
      const sinPadre = await leer(base);
      if (sinPadre.error || !sinPadre.data) return null;
      fila = comoFila(sinPadre.data);
    }
    if (!fila?.token_cifrado) return null;

    const refreshToken = descifrar(String(fila.token_cifrado), "ads-google-token");
    if (!refreshToken) return null;

    return {
      clienteId,
      cuentaId: soloDigitos(String(fila.cuenta_id ?? "")),
      cuentaNombre: String(fila.cuenta_nombre ?? ""),
      cuentaPadreId: padre ? soloDigitos(padre) : null,
      /**
       * ⚠️ Sin `?? "CLP"`. La columna tiene `default 'CLP'` de cuando el
       * producto era solo chileno, pero una fila vieja o un dato que no sea un
       * código ISO no puede convertirse en una afirmación: lo que sabemos es
       * que no sabemos, y así viaja.
       */
      moneda: normalizarMoneda(fila.moneda),
      zonaHoraria: String(fila.zona_horaria ?? "America/Santiago"),
      refreshToken,
      estado: String(fila.estado ?? "conectada"),
      ultimoError: (fila.ultimo_error as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

/* ── OAuth ────────────────────────────────────────────────────────────────── */

export const REDIRECT_URI_GOOGLE_ADS = `${origenCanonico()}/api/ads/google/callback`;

/**
 * La URL a la que se manda al dueño.
 *
 * `access_type=offline` + `prompt=consent` son obligatorios y no son opcionales
 * de estilo: sin los dos, Google **no devuelve `refresh_token`** en una
 * reconexión, y como el access token dura una hora, la conexión se apagaría
 * sola esa misma tarde. Es exactamente el bug que ya documenta
 * `lib/googleOAuth.ts`, y se repite acá a propósito.
 */
export function urlAutorizacionGoogleAds(estadoFirmado: string): string {
  const cred = credenciales();
  if (!cred) throw new Error("GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET no configurados");
  const p = new URLSearchParams({
    client_id: cred.clientId,
    redirect_uri: REDIRECT_URI_GOOGLE_ADS,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: estadoFirmado,
  });
  return `${AUTH_URL}?${p}`;
}

/** Canjea el `code` del callback por el refresh token. Se llama UNA vez. */
export async function intercambiarCodigoGoogleAds(codigo: string): Promise<ResultadoAds<string>> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: codigo,
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
        redirect_uri: REDIRECT_URI_GOOGLE_ADS,
        grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || !j.refresh_token) {
      // El CÓDIGO (`invalid_client`, `invalid_grant`…) va primero: es lo que
      // distingue un secreto mal cargado de un código vencido.
      return fallo("respuesta_rara", `${String(j.error ?? `HTTP ${r.status}`)}: ${String(j.error_description ?? "")}`);
    }
    return { ok: true, datos: String(j.refresh_token) };
  } catch {
    return fallo("red", "timeout al canjear el código de Google");
  } finally {
    clearTimeout(timer);
  }
}

/** Cifra el refresh token para guardarlo. Separado para poder probarlo. */
export function cifrarRefreshToken(token: string): string {
  return cifrar(token, "ads-google-token");
}

/**
 * Access tokens en memoria del proceso.
 *
 * Duran una hora y cada consulta necesita uno: sin caché, una carga del panel
 * que pide cinco niveles gastaría cinco canjes. Se guarda por refresh token
 * —nunca por cliente— así que dos negocios nunca comparten entrada, y con
 * 5 minutos de margen para no usar uno que vence a mitad de la llamada.
 */
const tokensVivos = new Map<string, { token: string; vence: number }>();

async function accessToken(refreshToken: string): Promise<ResultadoAds<string>> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");

  const guardado = tokensVivos.get(refreshToken);
  if (guardado && guardado.vence > Date.now() + 300_000) return { ok: true, datos: guardado.token };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(TOKEN_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cred.clientId,
        client_secret: cred.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok || !j.access_token) {
      /**
       * `invalid_grant` es EL error frecuente. Tiene TRES causas, y conviene
       * tenerlas escritas porque llevan a lugares distintos:
       *
       *  1. ⚠️ **La app de OAuth está en estado «Prueba».** Google emite
       *     refresh tokens que VENCEN A LOS 7 DÍAS cuando el proyecto tiene
       *     tipo de usuario externo y estado de publicación «Testing»
       *     —documentado por Google, no es un rumor—. Es la causa más probable
       *     durante el montaje de una instalación nueva, y no se arregla
       *     reconectando: se arregla publicando la app. Reconectar compra otros
       *     siete días.
       *  2. El dueño revocó el acceso desde su cuenta de Google.
       *  3. Se borró o se rotó el cliente OAuth del proyecto.
       *
       * Se traduce a «reconectar» y no a «error de red» porque reconectar es lo
       * único que el dueño puede hacer solo en los tres casos, aunque en el
       * primero sea un parche.
       */
      const codigo = String(j.error ?? "");
      if (codigo === "invalid_grant") return fallo("token_vencido", codigo);
      return fallo("respuesta_rara", String(j.error_description ?? codigo ?? `HTTP ${r.status}`));
    }
    const token = String(j.access_token);
    const duraSeg = Number(j.expires_in ?? 3600);
    tokensVivos.set(refreshToken, { token, vence: Date.now() + duraSeg * 1000 });
    return { ok: true, datos: token };
  } catch {
    return fallo("red", "timeout al renovar el token de Google");
  } finally {
    clearTimeout(timer);
  }
}

/** Para los tests y para forzar una renovación tras un 401. */
export function olvidarTokens(): void {
  tokensVivos.clear();
}

/**
 * La sesión de un negocio contra la API: token vigente + a qué cuenta se habla
 * + por qué administradora se entra. Es lo MISMO que arma `rendimientoGoogle`,
 * expuesto para `googleGestion.ts` y el publicador, para que lectura, gestión
 * y escritura usen un único camino de credenciales (el del proyecto de Cloud
 * dueño de GOOGLE_ADS_CLIENT_ID) y no tres copias que se desincronizan.
 */
export async function sesionGoogleDe(clienteId: string): Promise<
  ResultadoAds<{ token: string; cuentaId: string; login: string | null; moneda: string }>
> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");
  const con = await conexionGoogleDe(clienteId);
  if (!con) return fallo("sin_conexion");
  if (!con.cuentaId) return fallo("cuenta_invalida", "no hay cuenta de Google elegida");
  const t = await accessToken(con.refreshToken);
  if (!t.ok) return t;
  return {
    ok: true,
    datos: {
      token: t.datos,
      cuentaId: con.cuentaId,
      login: con.cuentaPadreId || cred.loginCustomerId || null,
      moneda: con.moneda,
    },
  };
}

/** GAQL con la sesión de un negocio. Sin métricas obligatorias: sirve para leer estructura. */
export async function consultarComoNegocio(
  sesion: { token: string; cuentaId: string; login: string | null },
  gaql: string,
): Promise<ResultadoAds<Record<string, unknown>[]>> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");
  return consultar(sesion.cuentaId, gaql, sesion.token, cred, sesion.login);
}

/* ── La llamada ───────────────────────────────────────────────────────────── */

type FilaGAQL = Record<string, unknown>;

/**
 * Traduce un error de Google a algo que una persona pueda resolver.
 *
 * Los mensajes de la Google Ads API vienen anidados
 * (`error.details[].errors[].errorCode.<familia>`) y en inglés técnico. Lo que
 * importa es distinguir las cuatro situaciones que se resuelven distinto:
 * permiso, token, cuota y «tu token es de prueba».
 */
function traducirErrorGoogle<T>(status: number, cuerpo: unknown): ResultadoAds<T> {
  const texto = JSON.stringify(cuerpo ?? {}).slice(0, 2000);

  // El nivel de acceso vive en el proyecto de Cloud desde el 9-sep-2026. Los
  // códigos con «DEVELOPER_TOKEN» siguen apareciendo por compatibilidad, pero
  // lo que hay que arreglar ya no es un token: es el nivel del proyecto.
  if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED|ACCESS_LEVEL|NOT_APPROVED/i.test(texto)) {
    return fallo(
      "nivel_acceso",
      "El proyecto de Google Cloud todavía tiene acceso de prueba: Google no deja consultar cuentas reales con ese nivel. " +
        "Se sube en la consola de Cloud, en la página «Google Ads API», con «Apply for access».",
    );
  }
  if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|NOT_ADS_USER/i.test(texto)) {
    return fallo("sin_permiso", texto);
  }
  if (/CUSTOMER_NOT_FOUND|INVALID_CUSTOMER_ID/i.test(texto)) {
    return fallo("cuenta_invalida", texto);
  }
  if (status === 401 || /AUTHENTICATION_ERROR|invalid_grant/i.test(texto)) {
    return fallo("token_vencido", texto);
  }
  if (status === 403) return fallo("sin_permiso", texto);
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA_ERROR/i.test(texto)) return fallo("limite_api", texto);
  if (status >= 500) return fallo("red", texto);
  return fallo("respuesta_rara", texto);
}

/**
 * Corre una consulta GAQL contra una cuenta y devuelve las filas.
 *
 * ⭐ `searchStream` entrega TODO el resultado en una respuesta —no hay
 * paginación que seguir— y viene como un **array de trozos**. Ese detalle es
 * la trampa del endpoint: tratarlo como objeto no da error, da cero filas.
 */
async function consultar(
  cuentaId: string,
  gaql: string,
  token: string,
  cred: CredencialesGoogleAds,
  loginCustomerId: string | null,
): Promise<ResultadoAds<FilaGAQL[]>> {
  const id = soloDigitos(cuentaId);
  if (!id) return fallo("cuenta_invalida", "customer id vacío");

  const url = `${API}/customers/${id}/googleAds:searchStream`;
  // Defensa en profundidad: la URL se arma acá, pero si alguna vez se
  // construyera desde un dato guardado, el token no sale hacia otro host.
  if (new URL(url).hostname !== HOST_API) return fallo("respuesta_rara", "host inesperado");

  const cabeceras: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...encabezadosApp(cred),
    "Content-Type": "application/json",
  };
  if (loginCustomerId) cabeceras["login-customer-id"] = soloDigitos(loginCustomerId);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: cabeceras,
      body: JSON.stringify({ query: gaql }),
      cache: "no-store",
    });
    const cuerpo = (await r.json().catch(() => null)) as unknown;
    if (!r.ok) return traducirErrorGoogle(r.status, cuerpo);

    if (!Array.isArray(cuerpo)) {
      return fallo("respuesta_rara", "searchStream no devolvió un arreglo de trozos");
    }
    const filas: FilaGAQL[] = [];
    for (const trozo of cuerpo as Record<string, unknown>[]) {
      const res = trozo?.results;
      if (Array.isArray(res)) filas.push(...(res as FilaGAQL[]));
    }
    return { ok: true, datos: filas };
  } catch {
    return fallo("red", "timeout o fallo de red con Google Ads");
  } finally {
    clearTimeout(timer);
  }
}

/* ── Lecturas de negocio ──────────────────────────────────────────────────── */

export type CuentaGoogle = {
  id: string;
  nombre: string;
  moneda: string;
  zonaHoraria: string;
  /** true = es administradora (MCC): no tiene campañas propias. */
  administradora: boolean;
  /** Por qué cuenta hay que entrar para leerla. */
  padreId: string | null;
};

/**
 * Las cuentas a las que llega el refresh token.
 *
 * DOS PASOS, y el segundo es el que la mayoría olvida:
 *   1. `customers:listAccessibleCustomers` devuelve solo los IDs de las cuentas
 *      que el usuario administra DIRECTAMENTE. Si entró con una administradora,
 *      son una o dos, no las de sus clientes.
 *   2. Por cada una, `customer_client` baja el árbol completo. Para una cuenta
 *      suelta se devuelve a sí misma, así que el mismo camino sirve para los
 *      dos casos y no hay que preguntarle a nadie si «tiene MCC».
 *
 * Se piden en paralelo: con tres administradoras eran tres viajes en serie.
 */
export async function cuentasDeGoogle(refreshToken: string): Promise<ResultadoAds<CuentaGoogle[]>> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");
  const t = await accessToken(refreshToken);
  if (!t.ok) return t;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let accesibles: string[];
  try {
    const r = await fetch(`${API}/customers:listAccessibleCustomers`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${t.datos}`, ...encabezadosApp(cred) },
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) return traducirErrorGoogle(r.status, j);
    const nombres = Array.isArray(j.resourceNames) ? (j.resourceNames as string[]) : [];
    accesibles = nombres.map((n) => soloDigitos(n.split("/").pop() ?? "")).filter(Boolean);
  } catch {
    return fallo("red", "timeout listando cuentas de Google");
  } finally {
    clearTimeout(timer);
  }

  if (!accesibles.length) {
    return fallo("sin_permiso", "la cuenta de Google autorizada no administra ninguna cuenta publicitaria");
  }

  const GAQL_ARBOL = `
    SELECT customer_client.id,
           customer_client.descriptive_name,
           customer_client.currency_code,
           customer_client.time_zone,
           customer_client.manager,
           customer_client.status
    FROM customer_client
    WHERE customer_client.status = 'ENABLED'`;

  const ramas = await Promise.all(
    accesibles.map(async (raiz) => {
      const r = await consultar(raiz, GAQL_ARBOL, t.datos, cred, raiz);
      if (!r.ok) return { raiz, filas: [] as FilaGAQL[], error: r.error };
      return { raiz, filas: r.datos, error: null };
    }),
  );

  const cuentas = new Map<string, CuentaGoogle>();
  for (const rama of ramas) {
    for (const f of rama.filas) {
      const c = (f.customerClient ?? {}) as Record<string, unknown>;
      const id = soloDigitos(String(c.id ?? ""));
      if (!id || cuentas.has(id)) continue;
      cuentas.set(id, {
        id,
        nombre: String(c.descriptiveName ?? `Cuenta ${formatearIdCuenta(id)}`),
        /**
         * ⚠️ Si Google no devolvió `currency_code`, la cuenta se lista SIN
         * moneda. Antes se listaba como CLP y una cuenta que factura en dólares
         * aparecía en el selector con sus cifras en pesos.
         */
        moneda: normalizarMoneda(c.currencyCode),
        zonaHoraria: String(c.timeZone ?? "America/Santiago"),
        administradora: Boolean(c.manager),
        // Si la cuenta ES la raíz, se entra directo; si cuelga, por la raíz.
        padreId: id === rama.raiz ? null : rama.raiz,
      });
    }
  }

  if (!cuentas.size) {
    const primerError = ramas.find((r) => r.error)?.error;
    if (primerError) return { ok: false, error: primerError };
    return fallo("sin_permiso", "no se encontró ninguna cuenta activa");
  }

  // Las administradoras al final: no tienen campañas y nadie quiere elegirlas.
  return {
    ok: true,
    datos: [...cuentas.values()].sort((a, b) => Number(a.administradora) - Number(b.administradora) || a.nombre.localeCompare(b.nombre)),
  };
}

const micros = (v: unknown): number => Number(v ?? 0) / 1_000_000;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Google nombra sus estados en mayúsculas; acá se hablan tres palabras. */
function estadoDe(v: unknown): "activa" | "pausada" | "terminada" | "desconocido" {
  const s = String(v ?? "").toUpperCase();
  if (s === "ENABLED") return "activa";
  if (s === "PAUSED") return "pausada";
  if (s === "REMOVED" || s === "ENDED") return "terminada";
  return "desconocido";
}

/**
 * El tipo de campaña, en palabras del dueño.
 *
 * ⚠️ `PERFORMANCE_MAX` y `SMART` importan de verdad y no son un adorno del
 * rótulo: en esas campañas casi nada es editable y **no hay términos de
 * búsqueda ni palabras clave que analizar**. Recomendar «revisa los términos»
 * sobre una Performance Max es mandar al dueño a buscar una pantalla que no
 * existe. El motor de análisis lee este campo antes de proponer nada.
 */
const TIPO_CAMPANA: Record<string, string> = {
  SEARCH: "Búsqueda",
  DISPLAY: "Display",
  SHOPPING: "Shopping",
  VIDEO: "Video",
  PERFORMANCE_MAX: "Máximo rendimiento",
  SMART: "Smart",
  LOCAL: "Local",
  DEMAND_GEN: "Generación de demanda",
};

export function tipoCampanaLegible(v: unknown): string {
  const s = String(v ?? "").toUpperCase();
  return TIPO_CAMPANA[s] ?? (s ? s.toLowerCase().replace(/_/g, " ") : "Campaña");
}

/** ¿Este tipo de campaña deja ver términos y palabras clave? */
export function tienePalabrasClave(tipoCampana: unknown): boolean {
  const s = String(tipoCampana ?? "").toUpperCase();
  return s === "SEARCH" || s === "SHOPPING";
}

const fechas = (rango: { desde: string; hasta: string }) =>
  `segments.date BETWEEN '${rango.desde}' AND '${rango.hasta}'`;

/**
 * Las consultas, una por nivel. Se piden SOLO las que la pantalla necesita.
 *
 * ⭐ NADA de «una campaña → una consulta por cada grupo». Cada nivel es UNA
 * consulta que trae todas sus filas con el id de su padre, y el cruce se hace
 * en memoria. Ese es el error de rendimiento clásico contra esta API: con 20
 * campañas y 5 grupos cada una serían 100 viajes y un panel de 40 segundos.
 */
function gaqlDe(nivel: Nivel, rango: { desde: string; hasta: string }): string | null {
  const m = "metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value";
  switch (nivel) {
    case "campana":
      return `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
                     campaign_budget.amount_micros, ${m}
              FROM campaign WHERE ${fechas(rango)}`;
    case "grupo":
      return `SELECT ad_group.id, ad_group.name, ad_group.status,
                     campaign.id, campaign.name, campaign.advertising_channel_type, ${m}
              FROM ad_group WHERE ${fechas(rango)}`;
    case "anuncio":
      return `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
                     ad_group.id, ad_group.name, campaign.id, campaign.name, ${m}
              FROM ad_group_ad WHERE ${fechas(rango)}`;
    case "palabra":
      return `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
                     ad_group_criterion.keyword.match_type, ad_group_criterion.status,
                     ad_group.id, ad_group.name, campaign.id, campaign.name, ${m}
              FROM keyword_view WHERE ${fechas(rango)}`;
    case "termino":
      return `SELECT search_term_view.search_term, search_term_view.status,
                     segments.keyword.info.text, segments.keyword.info.match_type,
                     ad_group.id, ad_group.name, campaign.id, campaign.name, ${m}
              FROM search_term_view WHERE ${fechas(rango)}`;
    default:
      return null;
  }
}

/**
 * Convierte una fila de GAQL en nuestra fila normalizada.
 *
 * ⭐ `metrics.conversions` y NO `all_conversions`. Es la lección más cara de la
 * cuenta de Impresora Color: `all_conversions` incluye acciones blandas del
 * perfil de Google Maps —vistas, «cómo llegar», llamadas del perfil— y en una
 * revisión de 14 días **428 «conversiones» eran cero cotizaciones reales**. Un
 * CPA calculado sobre eso recomienda exactamente al revés de lo que conviene.
 *
 * El tipo de resultado queda en `conversiones_web`: son las acciones de
 * conversión configuradas en la cuenta (etiqueta del sitio, clic a WhatsApp
 * desde la web, formulario). NUNCA `mensajes`, que es lo que Meta cuenta en las
 * campañas de mensajería: son cosas distintas y el producto no las suma.
 */
function aFila(nivel: Nivel, f: FilaGAQL, moneda: string): FilaRendimiento | null {
  const met = (f.metrics ?? {}) as Record<string, unknown>;
  const camp = (f.campaign ?? {}) as Record<string, unknown>;
  const grupo = (f.adGroup ?? {}) as Record<string, unknown>;
  const gasto: Monto = { valor: micros(met.costMicros), moneda };
  const conversiones = num(met.conversions);
  const valor = num(met.conversionsValue);

  const comun = {
    proveedor: "google" as const,
    nivel,
    impresiones: num(met.impressions),
    clics: num(met.clicks),
    gasto,
    /**
     * ⚠️ Acá decía `tipo: "conversiones_web"` a secas, para TODA conversión de
     * Google. Una compra, una llamada desde el anuncio y un formulario se
     * rotulaban igual, y desde ahí el producto comparaba una venta con un clic.
     *
     * El tipo honesto en este punto es `desconocido`: lo único que sabemos de
     * `metrics.conversions` sin segmentar es su cantidad. `fusionarComposicion`
     * lo refina después con la consulta de composición, y si esa consulta no
     * está disponible el producto dice «resultados» en vez de afirmar que son
     * del sitio web. `desconocido` no se compara con nada —ver `sonComparables`—
     * que es exactamente la protección que hacía falta.
     */
    resultados: conversiones > 0 ? { cantidad: conversiones, tipo: "desconocido" as const } : null,
    valorResultados: valor > 0 ? { valor, moneda } : null,
    campanaId: camp.id ? String(camp.id) : undefined,
    campanaNombre: camp.name ? String(camp.name) : undefined,
    grupoId: grupo.id ? String(grupo.id) : undefined,
    grupoNombre: grupo.name ? String(grupo.name) : undefined,
  };

  switch (nivel) {
    case "campana": {
      if (!camp.id) return null;
      const presupuesto = (f.campaignBudget ?? {}) as Record<string, unknown>;
      return {
        ...comun,
        id: String(camp.id),
        nombre: String(camp.name ?? "Campaña sin nombre"),
        estado: estadoDe(camp.status),
        objetivo: tipoCampanaLegible(camp.advertisingChannelType),
        presupuestoDiario: presupuesto.amountMicros ? { valor: micros(presupuesto.amountMicros), moneda } : null,
        extra: { tipoCrudo: String(camp.advertisingChannelType ?? "") },
      };
    }
    case "grupo": {
      if (!grupo.id) return null;
      return {
        ...comun,
        id: String(grupo.id),
        nombre: String(grupo.name ?? "Grupo sin nombre"),
        estado: estadoDe(grupo.status),
        objetivo: camp.advertisingChannelType ? tipoCampanaLegible(camp.advertisingChannelType) : null,
      };
    }
    case "anuncio": {
      const ad = ((f.adGroupAd ?? {}) as Record<string, unknown>).ad as Record<string, unknown> | undefined;
      const estadoAd = ((f.adGroupAd ?? {}) as Record<string, unknown>).status;
      if (!ad?.id) return null;
      return {
        ...comun,
        id: String(ad.id),
        // Los anuncios adaptables casi nunca tienen `name`: se rotulan por id,
        // que es lo que se ve también en el Administrador de Google.
        nombre: String(ad.name ?? `Anuncio ${ad.id}`),
        estado: estadoDe(estadoAd),
      };
    }
    case "palabra": {
      const crit = (f.adGroupCriterion ?? {}) as Record<string, unknown>;
      const kw = (crit.keyword ?? {}) as Record<string, unknown>;
      if (!kw.text) return null;
      return {
        ...comun,
        id: String(crit.criterionId ?? kw.text),
        nombre: String(kw.text),
        estado: estadoDe(crit.status),
        extra: { concordancia: String(kw.matchType ?? "") },
      };
    }
    case "termino": {
      const stv = (f.searchTermView ?? {}) as Record<string, unknown>;
      const seg = ((f.segments ?? {}) as Record<string, unknown>).keyword as Record<string, unknown> | undefined;
      const info = (seg?.info ?? {}) as Record<string, unknown>;
      if (!stv.searchTerm) return null;
      return {
        ...comun,
        id: String(stv.searchTerm),
        nombre: String(stv.searchTerm),
        estado: "desconocido",
        extra: {
          /** Ya agregado, ya excluido o todavía ninguno de los dos. */
          estadoTermino: String(stv.status ?? ""),
          palabraQueLoDisparo: String(info.text ?? ""),
          concordancia: String(info.matchType ?? ""),
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Rendimiento de Google en los niveles pedidos.
 *
 * Los niveles van en PARALELO y cada uno falla por su cuenta: que los términos
 * de búsqueda no estén disponibles (pasa en cuentas sin campañas de Búsqueda)
 * no puede dejar sin campañas a la pantalla.
 */
export async function rendimientoGoogle(
  clienteId: string,
  rango: { desde: string; hasta: string },
  niveles: Nivel[] = ["campana"],
): Promise<ResultadoAds<FilaRendimiento[]>> {
  const cred = credenciales();
  if (!cred) return fallo("no_configurado");
  const con = await conexionGoogleDe(clienteId);
  if (!con) return fallo("sin_conexion");
  if (!con.cuentaId) return fallo("cuenta_invalida", "no hay cuenta de Google elegida");

  const t = await accessToken(con.refreshToken);
  if (!t.ok) return t;

  /**
   * Por qué cuenta se entra: la administradora del cliente si la hay, si no la
   * nuestra, si no ninguna. Mandar `login-customer-id` cuando no corresponde es
   * tan error como omitirlo cuando sí.
   */
  const login = con.cuentaPadreId || cred.loginCustomerId || null;

  const pedidos = niveles.map((n) => ({ nivel: n, gaql: gaqlDe(n, rango) })).filter((p) => p.gaql);
  /**
   * ⭐ La composición de conversiones viaja como UNA CONSULTA MÁS, en paralelo
   * y fallando sola —igual que cada nivel—. Si la cuenta no la soporta o Google
   * la rechaza, el rendimiento se muestra completo y lo único que se pierde es
   * el desglose: un panel no se cae por no saber de qué tipo son las
   * conversiones. Ver `googleConversiones.ts` para por qué es una consulta
   * aparte y no un segmento de la principal.
   */
  const [respuestas, rComposicion] = await Promise.all([
    Promise.all(
      pedidos.map(async (p) => ({
        nivel: p.nivel,
        r: await consultar(con.cuentaId, p.gaql!, t.datos, cred, login),
      })),
    ),
    consultar(con.cuentaId, gaqlComposicion(rango), t.datos, cred, login),
  ]);

  const filas: FilaRendimiento[] = [];
  let primerError: ResultadoAds<FilaRendimiento[]> | null = null;
  for (const { nivel, r } of respuestas) {
    if (!r.ok) {
      if (!primerError) primerError = { ok: false, error: r.error };
      continue;
    }
    for (const f of r.datos) {
      const fila = aFila(nivel, f, con.moneda);
      if (fila) filas.push(fila);
    }
  }

  // Si NADA se pudo leer, se devuelve el error real; si algo vino, se muestra.
  if (!filas.length && primerError) return primerError;

  /**
   * Se agrupa PRIMERO y se refina el tipo DESPUÉS. El orden importa: agrupar
   * suma cantidades de filas que ya traen el tipo crudo, y recién sobre el
   * total se decide si esta campaña mide compras, llamadas o una mezcla.
   */
  const agrupadas = agruparPorId(filas);
  if (!rComposicion.ok) return { ok: true, datos: agrupadas };
  return {
    ok: true,
    datos: fusionarComposicion(agrupadas, composicionDesdeFilas(rComposicion.datos as unknown as Record<string, unknown>[])),
  };
}

/**
 * GAQL devuelve una fila por entidad Y POR SEGMENTO. Con `segments.date` en el
 * WHERE no se segmenta por día, pero los términos de búsqueda sí llegan
 * repetidos por palabra clave que los disparó. Se agrupan acá para que la
 * pantalla no muestre el mismo término tres veces con el gasto partido.
 */
function agruparPorId(filas: FilaRendimiento[]): FilaRendimiento[] {
  const mapa = new Map<string, FilaRendimiento>();
  for (const f of filas) {
    const clave = `${f.nivel}|${f.id}|${f.campanaId ?? ""}|${f.grupoId ?? ""}`;
    const previa = mapa.get(clave);
    if (!previa) {
      mapa.set(clave, { ...f });
      continue;
    }
    previa.impresiones += f.impresiones;
    previa.clics += f.clics;
    /**
     * ⚠️ Dos filas de la misma entidad SIEMPRE vienen de la misma cuenta y por
     * lo tanto de la misma moneda; pero eso es un supuesto sobre la API, y un
     * supuesto que no se comprueba es el que un día deja de ser cierto en
     * silencio. Si las monedas no calzan, no se suma: se deja el monto previo y
     * la moneda se marca desconocida, que es exactamente lo que sabríamos.
     */
    if (normalizarMoneda(previa.gasto.moneda) === normalizarMoneda(f.gasto.moneda)) {
      previa.gasto = { valor: previa.gasto.valor + f.gasto.valor, moneda: previa.gasto.moneda };
    } else {
      previa.gasto = { valor: previa.gasto.valor + f.gasto.valor, moneda: MONEDA_DESCONOCIDA };
    }
    if (f.resultados) {
      previa.resultados = {
        tipo: f.resultados.tipo,
        cantidad: (previa.resultados?.cantidad ?? 0) + f.resultados.cantidad,
      };
    }
    if (f.valorResultados) {
      previa.valorResultados = {
        moneda: f.valorResultados.moneda,
        valor: (previa.valorResultados?.valor ?? 0) + f.valorResultados.valor,
      };
    }
  }
  return [...mapa.values()];
}

/**
 * Prueba de vida para la pantalla de conexión: ¿esta cuenta responde y con
 * cuánto? Igual que en Meta, «conectada» sin una cifra al lado es una
 * afirmación, no un hecho.
 */
export async function pruebaDeLecturaGoogle(
  clienteId: string,
  rango: { desde: string; hasta: string },
): Promise<ResultadoAds<{ campanas: number; gasto: Monto }>> {
  const r = await rendimientoGoogle(clienteId, rango, ["campana"]);
  if (!r.ok) return r;
  /**
   * ⚠️ El total se arma con `sumarPorMoneda`, no con un `reduce` sobre el valor
   * y la moneda de la primera fila. Con una sola moneda —el caso normal de una
   * cuenta— da exactamente lo mismo; con más de una, antes salía un total
   * mentiroso rotulado con la moneda que apareciera primero, y ahora sale sin
   * moneda, que es lo que sabemos.
   */
  const totales = sumarPorMoneda(r.datos.map((f) => f.gasto));
  const gasto: Monto =
    totales.size === 1
      ? [...totales.values()][0]
      : { valor: r.datos.reduce((a, f) => a + f.gasto.valor, 0), moneda: MONEDA_DESCONOCIDA };
  return {
    ok: true,
    datos: {
      campanas: r.datos.filter((f) => f.impresiones > 0 || f.gasto.valor > 0).length,
      gasto,
    },
  };
}

/**
 * ⭐ Diagnóstico sin log (22-sep-2026). `respuesta_rara` tiene dos orígenes que
 * se arreglan al revés —el canje (credenciales nuestras) y la API (nivel de
 * acceso)— y el detalle sólo vivía en el log de Vercel. Ahora viajan la ETAPA y,
 * si lo hay, el código de error de Google, pero SÓLO si calza con una lista
 * cerrada de códigos públicos de OAuth/Google Ads: nunca texto libre, nunca un
 * token ni un fragmento de respuesta.
 */
const CODIGOS_PUBLICOS = [
  "invalid_client",
  "unauthorized_client",
  "invalid_grant",
  "redirect_uri_mismatch",
  "invalid_request",
  "access_denied",
  "CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION",
  "DEVELOPER_TOKEN_NOT_APPROVED",
  "USER_PERMISSION_DENIED",
  "NOT_ADS_USER",
  "CUSTOMER_NOT_ENABLED",
  "AUTHORIZATION_ERROR",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
] as const;

export function codigoPublicoGoogle(detalle: string | null | undefined): string | null {
  const t = String(detalle ?? "");
  return CODIGOS_PUBLICOS.find((c) => t.includes(c)) ?? null;
}
