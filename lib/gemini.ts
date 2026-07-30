const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODELO_RESPALDO = "gemini-2.5-flash";

/**
 * Un modelo saturado a veces NO responde 503: se queda colgado. Sin timeout ese
 * cuelgue congela la función serverless hasta que Vercel la mata, y en una demo
 * frente a un cliente eso se ve como "el asistente no responde". El timeout lo
 * convierte en un error reintentable que gatilla el modelo de respaldo.
 * (Mismo criterio que respondo-hq, aprendido en producción.)
 */
const TIMEOUT_MS = 20_000;

async function llamar(modelo: string, prompt: string): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${BASE}/${modelo}:generateContent?key=${key}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
        },
      }),
    });
  } finally {
    clearTimeout(timer);
  }
}

function extraerTexto(data: unknown): string {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return d?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

/** ¿El fallo es transitorio (vale la pena reintentar) o definitivo? */
function esTransitorio(status: number): boolean {
  // 429 = cuota momentánea · 500/502/503/504 = saturación del proveedor.
  return status === 429 || status >= 500;
}

/**
 * Llama al modelo principal y cae al de respaldo si falla.
 *
 * Estrategia de resiliencia (3 capas, aprendidas en producción):
 *  1. Timeout: un modelo colgado no congela la función.
 *  2. Reintento corto ante errores TRANSITORIOS (503/429 son muy comunes en
 *     Gemini a ciertas horas). Un solo reintento con espera breve resuelve la
 *     mayoría sin que el cliente note nada.
 *  3. Modelo de respaldo si el principal sigue sin responder.
 */
export async function generarJSON(prompt: string): Promise<string> {
  const principal = process.env.GEMINI_MODEL || MODELO_RESPALDO;
  const modelos = principal === MODELO_RESPALDO ? [principal] : [principal, MODELO_RESPALDO];

  let ultimoError = "";
  for (const modelo of modelos) {
    for (let intento = 1; intento <= 2; intento++) {
      try {
        const r = await llamar(modelo, prompt);
        if (!r.ok) {
          ultimoError = `${modelo}: HTTP ${r.status}`;
          if (esTransitorio(r.status) && intento === 1) {
            await new Promise((s) => setTimeout(s, 900)); // respiro y reintento
            continue;
          }
          break; // error definitivo: pasar al siguiente modelo
        }
        const texto = extraerTexto(await r.json());
        if (texto) return texto;
        ultimoError = `${modelo}: respuesta vacía`;
        break;
      } catch (e) {
        ultimoError = `${modelo}: ${(e as Error).message}`;
        if (intento === 1) {
          await new Promise((s) => setTimeout(s, 900));
          continue; // timeout o red: un reintento
        }
      }
    }
  }
  throw new Error(ultimoError || "No se pudo generar la respuesta");
}
