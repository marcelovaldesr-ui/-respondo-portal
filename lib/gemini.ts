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

async function llamar(
  modelo: string,
  prompt: string,
  timeoutMs = TIMEOUT_MS,
  thinkingBudget?: number,
): Promise<Response> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const generationConfig: Record<string, unknown> = {
    temperature: 0.7,
    responseMimeType: "application/json",
  };
  // Tope de "pensamiento". Sin tope, en tareas analíticas largas el modelo se
  // toma entre 25 y más de 43 s de forma impredecible (medido 31-jul), lo que
  // puede pasarse del límite de la función en Vercel. Con tope baja a ~11 s sin
  // perder calidad. Solo se usa donde hace falta; el chat en vivo no lo pasa.
  if (typeof thinkingBudget === "number") {
    generationConfig.thinkingConfig = { thinkingBudget };
  }
  try {
    return await fetch(`${BASE}/${modelo}:generateContent?key=${key}`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig,
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
export async function generarJSON(
  prompt: string,
  /**
   * Ajustes para usos que NO son una conversación en vivo. El default (20s, 2
   * intentos) está pensado para que un cliente en WhatsApp no espere: si el
   * modelo se cuelga, mejor derivar. Pero una tarea de fondo —como el informe
   * semanal, que razona sobre cientos de mensajes y demora ~25s— necesita más
   * aire y no gana nada reintentando.
   */
  opciones?: { timeoutMs?: number; intentosPorModelo?: number; thinkingBudget?: number },
): Promise<string> {
  const principal = process.env.GEMINI_MODEL || MODELO_RESPALDO;
  const modelos = principal === MODELO_RESPALDO ? [principal] : [principal, MODELO_RESPALDO];
  const timeoutMs = opciones?.timeoutMs ?? TIMEOUT_MS;
  const maxIntentos = opciones?.intentosPorModelo ?? 2;

  let ultimoError = "";
  for (const modelo of modelos) {
    for (let intento = 1; intento <= maxIntentos; intento++) {
      try {
        const r = await llamar(modelo, prompt, timeoutMs, opciones?.thinkingBudget);
        if (!r.ok) {
          ultimoError = `${modelo}: HTTP ${r.status}`;
          if (esTransitorio(r.status) && intento < maxIntentos) {
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
        if (intento < maxIntentos) {
          await new Promise((s) => setTimeout(s, 900));
          continue; // timeout o red: un reintento
        }
      }
    }
  }
  throw new Error(ultimoError || "No se pudo generar la respuesta");
}
