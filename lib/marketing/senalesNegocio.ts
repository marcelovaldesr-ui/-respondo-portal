import { db } from "@/lib/db";
import { estadoDeCanales } from "@/lib/ads/canales";
import { detectarSenales, type Senales } from "@/lib/ads/senales";
import type { Proveedor } from "@/lib/ads/canal";

/**
 * LAS SEÑALES, EN BARATO — para la navegación.
 *
 * El riel tiene que decidir si existe la sección «Personas» ANTES de cargar el
 * Panorama, y cargar el Panorama entero en el layout sería pedirle a Meta y a
 * Google el rendimiento del período en cada clic de navegación.
 *
 * Esto responde la misma pregunta con dos consultas baratas: ¿hay algún canal
 * conectado? y ¿alguna vez entró alguien por un anuncio? Es deliberadamente
 * MENOS preciso que `detectarSenales` sobre el período —acá no importa si este
 * mes hubo conversaciones, sino si este negocio las tiene— porque una sección
 * que aparece y desaparece según el período elegido sería peor que cualquiera
 * de los dos errores.
 *
 * ⚠️ Nunca lanza: una integración sin configurar o una migración sin aplicar
 * tienen que dar «no hay señal», no tumbar la navegación entera.
 */
export async function senalesDeNegocio(clienteId: string): Promise<Senales> {
  return (await estadoParaNavegacion(clienteId)).senales;
}

/**
 * Lo mismo, pero devolviendo TAMBIÉN qué canales están conectados.
 *
 * El riel necesita las dos cosas —las señales para decidir «Personas», y los
 * canales para decidir «Búsqueda», que solo existe con Google— y pedirlas por
 * separado duplicaría las mismas dos consultas en cada navegación.
 */
export async function estadoParaNavegacion(
  clienteId: string,
): Promise<{ senales: Senales; canales: Proveedor[] }> {
  const [canales, atribuidas, cobros] = await Promise.all([
    estadoDeCanales(clienteId).catch(() => []),
    contar(() =>
      db()
        .from("ed_contactos")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", clienteId)
        .not("datos->campana", "is", null),
    ),
    contar(() =>
      db()
        .from("ed_pagos")
        .select("id", { count: "exact", head: true })
        .eq("cliente_id", clienteId)
        .eq("estado", "pagado"),
    ),
  ]);

  const conectados = canales.filter((c) => c.conectado).map((c) => c.proveedor);

  const senales = detectarSenales({
    hayCuentaPublicitaria: canales.some((c) => c.conectado),
    /**
     * A esta altura no se sabe si la plataforma reporta resultados: haría falta
     * pedirle el período. Se asume que sí cuando hay canal conectado —es lo
     * habitual— y el Panorama lo corrige con el dato real. La única decisión
     * que depende de esto en el riel es ninguna, así que el error es inocuo.
     */
    plataformaReportaResultados: canales.some((c) => c.conectado),
    hayConversacionesAtribuidas: atribuidas > 0,
    hayIngresosAtribuidos: atribuidas > 0 && cobros > 0,
  });

  return { senales, canales: conectados };
}

async function contar(consulta: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await consulta();
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}
