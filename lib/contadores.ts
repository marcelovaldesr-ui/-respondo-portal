import { db } from "@/lib/db";

/**
 * CONTADORES DEL MENÚ — los dos números que van al lado de Conversaciones y de
 * Embudo en la barra lateral.
 *
 * POR QUÉ VIVEN EN SU PROPIO ARCHIVO
 * Los pide el layout, o sea que se calculan en CADA navegación del portal. Eso
 * obliga a que sean baratos de verdad, y a que nadie los "reutilice" llamando
 * de paso a una función pesada. Teniéndolos aparte, la restricción queda
 * explícita: acá adentro solo entran consultas que la base resuelve sin
 * devolver filas.
 *
 * CÓMO SE CUENTAN
 * Con `count: "exact", head: true`. Postgres cuenta por índice y PostgREST
 * devuelve el número en una cabecera, cero filas de datos. Da lo mismo que el
 * cliente tenga 40 conversaciones o 4.000: se transfiere lo mismo.
 *
 * SI FALLA, DEVUELVE CERO
 * Un contador es un adorno útil, no información crítica. Si la consulta falla
 * —columna que todavía no existe, permiso, lo que sea— el menú se dibuja sin
 * número. Nunca puede tumbar el layout, porque el layout envuelve TODAS las
 * pantallas: un error acá dejaría al cliente sin portal por un badge.
 */

export type ContadoresMenu = {
  /** Conversaciones derivadas a una persona y todavía sin atender. */
  esperando: number;
  /** Oportunidades abiertas en el embudo (interesado + cotizado). */
  porCerrar: number;
};

export async function contadoresMenu(clienteId: string): Promise<ContadoresMenu> {
  try {
    const supa = db();

    const { data: empleados } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", clienteId);
    const ids = (empleados ?? []).map((e) => e.id as string);
    if (!ids.length) return { esperando: 0, porCerrar: 0 };

    const [escalaciones, embudo] = await Promise.all([
      supa
        .from("ed_escalaciones")
        .select("id", { count: "exact", head: true })
        .in("empleado_id", ids)
        .is("atendida_en", null),
      supa
        .from("ed_contactos")
        .select("chat_id", { count: "exact", head: true })
        .eq("cliente_id", clienteId)
        .in("etapa", ["interesado", "cotizado"]),
    ]);

    return {
      esperando: escalaciones.count ?? 0,
      porCerrar: embudo.count ?? 0,
    };
  } catch {
    return { esperando: 0, porCerrar: 0 };
  }
}
