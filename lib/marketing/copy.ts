import { generarJSON } from "@/lib/gemini";
import { contextoComercialEnTexto, completitud, type ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import { obtenerPerfilMarketing, proyeccionCreative } from "@/lib/marketing/perfilMarketing";
import {
  ctaValidoPara,
  parsearPaqueteGoogle,
  parsearPaqueteMeta,
  promptEstrategiaYCopy,
  promptReescritura,
  revisarPaquete,
  type Defecto,
  type PaqueteCopy,
  type PedidoCopy,
  type Revision,
} from "@/lib/marketing/copyCore";
import { textoDeFalla, traducirFalla } from "@/lib/marketing/fallas";

/**
 * EL PIPELINE DE COPY — orquestación.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTEXTO → ESTRATEGIA + BORRADOR → CRÍTICA → REESCRITURA (solo si falla)
 *
 * Presupuesto: **una llamada al modelo en el caso bueno, dos en el malo.**
 *
 * La crítica no cuesta una llamada porque es determinista: mide si el texto
 * nombra algo propio del negocio, si afirma cifras que no tenemos, si los tres
 * ángulos son la misma idea y si cabe en la plataforma. Eso no necesita un
 * modelo, y un modelo además lo haría peor: preguntarle «¿está bueno?» devuelve
 * que sí casi siempre.
 *
 * La reescritura sí es una llamada, y recibe los defectos MEDIDOS, no una
 * opinión. Se hace una sola vez: si después de corregir defectos concretos
 * sigue fallando, el problema no es el texto sino el contexto, y eso se
 * resuelve mostrándoselo a la persona, no gastando llamadas.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ResultadoCopy =
  | {
      ok: true;
      paquete: PaqueteCopy;
      revision: Revision;
      /** Qué pasó, para poder medir costo y calidad sin instrumentar aparte. */
      traza: { llamadas: number; ms: number; reescrito: boolean; defectosIniciales: number };
    }
  | { ok: false; motivo: string; faltaContexto?: string };

const TIMEOUT = 45_000;

export async function generarCopy(
  clienteId: string,
  pedido: PedidoCopy,
  opciones: { demo?: boolean; contexto?: ContextoComercial } = {},
): Promise<ResultadoCopy> {
  const t0 = Date.now();

  const c =
    opciones.contexto ??
    proyeccionCreative(await obtenerPerfilMarketing(clienteId, { demo: opciones.demo }));

  /**
   * Si no sabemos qué vende el negocio, no se genera.
   *
   * Es la regla más importante de todo esto. La alternativa —generar igual— es
   * lo que producía anuncios sobre la letra chica del plan: el modelo llena el
   * hueco con lo primero que encuentra, y lo primero que encuentra nunca es lo
   * que el negocio querría anunciar.
   */
  const k = completitud(c);
  if (k.bloqueante && !pedido.producto.trim()) {
    return {
      ok: false,
      motivo: c.aviso
        ? `${c.aviso} Escribe abajo qué quieres promocionar y lo uso tal cual.`
        : "Necesito un poco más de contexto sobre lo que quieres promocionar.",
      faltaContexto: k.bloqueante,
    };
  }

  const contextoTexto = contextoComercialEnTexto(c);
  const cta = ctaValidoPara(pedido.destino);
  let llamadas = 0;

  let crudo: string;
  try {
    crudo = await generarJSON(promptEstrategiaYCopy(c, pedido, contextoTexto), {
      timeoutMs: TIMEOUT,
      thinkingBudget: 1024,
    });
    llamadas++;
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "ia", operacion: "generarCopy", clienteId, crudo: e }) };
  }

  let paquete = pedido.plataforma === "meta" ? parsearPaqueteMeta(crudo, cta) : parsearPaqueteGoogle(crudo);
  if (!paquete) return { ok: false, motivo: textoDeFalla("incompleto") };

  let revision = revisarPaquete(paquete, c, { indicaciones: pedido.indicaciones, destino: pedido.destino });
  const defectosIniciales = revision.defectos.length;
  let reescrito = false;

  /**
   * Hasta DOS reescrituras, y se corta apenas queda aprobado.
   *
   * Dos y no una porque una sola pasada arregla el defecto que se le señala y
   * suele dejar el segundo a medias; dos y no «hasta que salga» porque un bucle
   * sin tope convierte un anuncio en una factura. El caso bueno sigue costando
   * UNA llamada: esto solo corre cuando la revisión encontró algo grave.
   */
  const MAX_REESCRITURAS = 2;
  let ultimo = crudo;
  for (let intento = 0; intento < MAX_REESCRITURAS && !revision.aprobado; intento++) {
    const graves = revision.defectos.filter((d) => d.grave);
    let corregido: string;
    try {
      corregido = await generarJSON(promptReescritura(c, contextoTexto, ultimo, graves), {
        timeoutMs: TIMEOUT,
        thinkingBudget: 1024,
      });
      llamadas++;
    } catch {
      // Se entrega lo que hay con sus defectos señalados: mejor un anuncio con
      // reparos visibles que ninguna respuesta.
      break;
    }
    const nuevo = pedido.plataforma === "meta" ? parsearPaqueteMeta(corregido, cta) : parsearPaqueteGoogle(corregido);
    if (!nuevo) break;
    const nuevaRevision = revisarPaquete(nuevo, c, { indicaciones: pedido.indicaciones, destino: pedido.destino });
    /**
     * Se queda con la reescritura solo si de verdad mejoró. Un modelo que
     * "corrige" puede empeorar, y quedarse con lo peor porque fue lo último que
     * dijo es una forma silenciosa de degradar el producto.
     */
    if (peso(nuevaRevision.defectos) >= peso(revision.defectos)) break;
    paquete = nuevo;
    revision = nuevaRevision;
    reescrito = true;
    ultimo = corregido;
  }

  return {
    ok: true,
    paquete,
    revision,
    traza: { llamadas, ms: Date.now() - t0, reescrito, defectosIniciales },
  };
}

/** Los graves pesan; los leves apenas desempatan. */
function peso(d: Defecto[]): number {
  return d.reduce((n, x) => n + (x.grave ? 10 : 1), 0);
}
