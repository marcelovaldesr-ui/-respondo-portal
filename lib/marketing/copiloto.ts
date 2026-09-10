import { generarJSON } from "@/lib/gemini";
import { resolverRango } from "@/lib/ads/periodos";
import { contextoDeMarca, contextoEnTexto } from "@/lib/marketing/contextoMarca";
import {
  parsearRespuestaCopiloto,
  promptCopiloto,
  type RespuestaCopiloto,
  type TurnoCopiloto,
} from "@/lib/marketing/copilotoCore";
import { cargarMarketing } from "@/lib/marketing/datos";

/**
 * EL COPILOTO — orquestación. La lógica pura está en copilotoCore.ts.
 *
 *   pregunta → cargar Panorama (deterministas) → correr herramientas →
 *   Gemini interpreta → respuesta con evidencia y acciones.
 *
 * El modelo recibe SOLO lo que devuelven las herramientas. Nunca la base,
 * nunca cifras que no estén ahí. Y si no alcanza el dato, lo dice.
 */
export async function preguntarAlCopiloto(entrada: {
  clienteId: string;
  pregunta: string;
  periodo?: string;
  hilo?: TurnoCopiloto[];
  demo?: boolean;
}): Promise<{ ok: true; datos: RespuestaCopiloto } | { ok: false; motivo: string }> {
  const rango = resolverRango(entrada.periodo ?? "30d");
  const [panorama, marca] = await Promise.all([
    cargarMarketing(entrada.clienteId, rango, { demo: entrada.demo }),
    contextoDeMarca(entrada.clienteId, entrada.demo),
  ]);

  const prompt = promptCopiloto({
    pregunta: entrada.pregunta,
    panorama,
    contextoMarca: contextoEnTexto(marca),
    hilo: entrada.hilo ?? [],
  });

  try {
    const crudo = await generarJSON(prompt, { timeoutMs: 35_000, thinkingBudget: 1024 });
    const datos = parsearRespuestaCopiloto(crudo);
    if (!datos) return { ok: false, motivo: "El copiloto devolvió una respuesta que no se pudo leer. Prueba de nuevo." };
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, motivo: `No se pudo consultar al copiloto: ${(e as Error).message}` };
  }
}
