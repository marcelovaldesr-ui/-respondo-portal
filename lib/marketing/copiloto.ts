import { generarJSON } from "@/lib/gemini";
import { resolverRango } from "@/lib/ads/periodos";
import { obtenerPerfilMarketing, proyeccionCopiloto } from "@/lib/marketing/perfilMarketing";
import {
  parsearRespuestaCopiloto,
  promptCopiloto,
  type RespuestaCopiloto,
  type TurnoCopiloto,
} from "@/lib/marketing/copilotoCore";
import { cargarMarketing } from "@/lib/marketing/datos";
import { traducirFalla } from "@/lib/marketing/fallas";

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
  const [panorama, perfil] = await Promise.all([
    cargarMarketing(entrada.clienteId, rango, { demo: entrada.demo }),
    obtenerPerfilMarketing(entrada.clienteId, { demo: entrada.demo }),
  ]);

  const proy = proyeccionCopiloto(perfil);
  const prompt = promptCopiloto({
    pregunta: entrada.pregunta,
    panorama,
    contextoMarca: proy.contextoTexto,
    hilo: entrada.hilo ?? [],
  });

  try {
    const crudo = await generarJSON(prompt, { timeoutMs: 35_000, thinkingBudget: 1024 });
    const datos = parsearRespuestaCopiloto(crudo);
    if (!datos) return { ok: false, motivo: "El copiloto devolvió una respuesta que no se pudo leer. Prueba de nuevo." };
    return { ok: true, datos };
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "ia", operacion: "copiloto", clienteId: entrada.clienteId, crudo: e }) };
  }
}
