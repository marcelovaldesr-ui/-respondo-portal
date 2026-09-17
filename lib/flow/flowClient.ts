import {
  firmarParametrosFlow,
  FLOW_URL_PRODUCCION,
  FLOW_URL_SANDBOX,
  type FlowModo,
} from "@/lib/flow/flowCore";

/**
 * CLIENTE HTTP SERVER-SIDE PARA LA API OFICIAL DE FLOW.CL.
 *
 * Solo ejecuta llamadas autenticadas con la API de Flow.
 * CERO exposición de secrets en logs o respuestas.
 */

export type CredencialesFlow = {
  apiKey: string;
  secretKey: string;
  modo: FlowModo;
};

export type RespuestaCrearPagoFlow = {
  url: string;
  token: string;
  flowOrder: number;
};

export type RespuestaEstadoPagoFlow = {
  flowOrder: number;
  commerceOrder: string;
  requestDate: string;
  status: number; // 1 = pendiente, 2 = pagada, 3 = rechazada, 4 = anulada
  subject: string;
  currency: string;
  amount: number;
  payer: string;
  optional?: string;
  pending_info?: Record<string, unknown>;
  paymentData?: {
    date?: string;
    media?: string;
    conversionDate?: string;
    conversionRate?: number;
    amount?: number;
    currency?: string;
    fee?: number;
    balance?: number;
    transferDate?: string;
  };
  merchantId?: string;
};

const TIMEOUT_FETCH_MS = 10_000;

function obtenerBaseUrl(modo: FlowModo): string {
  return modo === "produccion" ? FLOW_URL_PRODUCCION : FLOW_URL_SANDBOX;
}

/**
 * Crea una orden de pago en Flow (`POST /payment/create`).
 */
export async function crearPagoFlowApi(
  credenciales: CredencialesFlow,
  params: {
    commerceOrder: string;
    subject: string;
    currency: "CLP";
    amount: number;
    email: string;
    urlConfirmation: string;
    urlReturn: string;
    timeout?: number;
    optional?: string;
    paymentMethod?: number;
  },
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; data: RespuestaCrearPagoFlow } | { ok: false; error: string; statusHttp?: number }> {
  try {
    const baseUrl = obtenerBaseUrl(credenciales.modo);
    const url = `${baseUrl}/payment/create`;

    const bodyParams: Record<string, string | number> = {
      apiKey: credenciales.apiKey,
      commerceOrder: params.commerceOrder,
      subject: params.subject,
      currency: params.currency,
      amount: params.amount,
      email: params.email,
      urlConfirmation: params.urlConfirmation,
      urlReturn: params.urlReturn,
    };

    if (params.timeout) bodyParams.timeout = params.timeout;
    if (params.optional) bodyParams.optional = params.optional;
    if (params.paymentMethod) bodyParams.paymentMethod = params.paymentMethod;

    // Firma HMAC-SHA256 obligatoria
    const firma = firmarParametrosFlow(bodyParams, credenciales.secretKey);
    bodyParams.s = firma;

    const formBody = new URLSearchParams();
    for (const [k, v] of Object.entries(bodyParams)) {
      formBody.append(k, String(v));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_FETCH_MS);

    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorTexto = await res.text().catch(() => "");
      let msg = `Error Flow HTTP ${res.status}`;
      try {
        const jsonErr = JSON.parse(errorTexto) as { message?: string; code?: number };
        if (jsonErr.message) msg = `Flow: ${jsonErr.message} (código ${jsonErr.code ?? res.status})`;
      } catch {
        if (errorTexto) msg = `Flow: ${errorTexto.slice(0, 150)}`;
      }
      return { ok: false, error: msg, statusHttp: res.status };
    }

    const data = (await res.json()) as RespuestaCrearPagoFlow;
    if (!data.url || !data.token) {
      return { ok: false, error: "Respuesta de Flow incompleta (falta url o token)" };
    }

    return { ok: true, data };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Fallo de conexión con Flow";
    return { ok: false, error: `Error de red al conectar con Flow: ${errorMsg}` };
  }
}

/**
 * Consulta el estado real de un pago en Flow (`GET /payment/getStatus`).
 */
export async function obtenerEstadoPagoFlowApi(
  credenciales: CredencialesFlow,
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true; data: RespuestaEstadoPagoFlow } | { ok: false; error: string; statusHttp?: number }> {
  try {
    const baseUrl = obtenerBaseUrl(credenciales.modo);
    const queryParams: Record<string, string> = {
      apiKey: credenciales.apiKey,
      token,
    };

    const firma = firmarParametrosFlow(queryParams, credenciales.secretKey);
    queryParams.s = firma;

    const search = new URLSearchParams(queryParams).toString();
    const url = `${baseUrl}/payment/getStatus?${search}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_FETCH_MS);

    const res = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errorTexto = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Flow getStatus falló (${res.status}): ${errorTexto.slice(0, 100)}`,
        statusHttp: res.status,
      };
    }

    const data = (await res.json()) as RespuestaEstadoPagoFlow;
    if (typeof data.status !== "number") {
      return { ok: false, error: "Respuesta de Flow getStatus sin campo status" };
    }

    return { ok: true, data };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Fallo de conexión con Flow";
    return { ok: false, error: `Error de red al consultar estado en Flow: ${errorMsg}` };
  }
}
