import { db } from "@/lib/db";
import { generarInsight, semanaDe } from "@/lib/insights";
import { ZONA } from "@/lib/fechas";

/**
 * GENERACIÓN AUTOMÁTICA DEL INFORME SEMANAL.
 *
 * Idea: el lunes por la mañana el informe de la semana pasada ya tiene que
 * estar listo. Que el dueño tenga que apretar un botón y esperar medio minuto
 * es fricción; que esté esperándolo cuando abre el portal es un producto.
 *
 * Se engancha al cron que ya existe (/api/cron/seguimientos) en vez de crear
 * otro: un solo disparador externo que mantener.
 *
 * Cuidados:
 *  - Solo los LUNES (hora de Chile). El resto de la semana no hace nada.
 *  - Idempotente: si el informe de esa semana ya existe, no lo regenera.
 *  - Tope de clientes por corrida: generar toma ~17 s cada uno y la función
 *    muere a los 60 s. Se procesan pocos por vez; como el cron corre seguido,
 *    los pendientes se completan en las corridas siguientes.
 *  - Nunca revienta: cualquier error se registra y devuelve, sin afectar el
 *    envío de seguimientos que corre en el mismo endpoint.
 */

/** ¿Es lunes en Chile? */
export function esLunesEnChile(d = new Date()): boolean {
  return (
    new Intl.DateTimeFormat("en-US", { timeZone: ZONA, weekday: "short" }).format(d) === "Mon"
  );
}

export async function generarInformesPendientes(opts?: {
  ahora?: Date;
  maxClientes?: number;
  forzar?: boolean;
  /**
   * Techo absoluto (`Date.now()`) que el cron le pasa (auditoría 3-sep-2026):
   * un informe tarda 25-50 s de modelo, y dos seguidos sin techo se llevaban
   * la función del cron entera los lunes (sin vigilante ni latido). Lo que no
   * alcanza sale en el siguiente latido, 5 minutos después.
   */
  fechaLimite?: number;
}): Promise<{ generados: number; detalle: string[] }> {
  const ahora = opts?.ahora ?? new Date();
  const detalle: string[] = [];

  if (!opts?.forzar && !esLunesEnChile(ahora)) {
    return { generados: 0, detalle: ["no_es_lunes"] };
  }

  const supa = db();
  // La semana que interesa el lunes es la ANTERIOR (ya cerrada).
  const { desde } = semanaDe(ahora, 1);

  const { data: clientes, error } = await supa
    .from("ed_clientes")
    .select("id, nombre")
    .eq("activo", true);
  if (error) return { generados: 0, detalle: [`error_clientes: ${error.message}`] };

  // Los que ya tienen el informe de esa semana quedan fuera de inmediato.
  const { data: hechos } = await supa
    .from("ed_insights")
    .select("cliente_id")
    .eq("periodo_desde", desde);
  const yaListos = new Set((hechos ?? []).map((h) => h.cliente_id as string));

  const pendientes = (clientes ?? []).filter((c) => !yaListos.has(c.id as string));
  if (!pendientes.length) return { generados: 0, detalle: ["todos_al_dia"] };

  let generados = 0;
  const tope = opts?.maxClientes ?? 1;
  for (const c of pendientes.slice(0, tope)) {
    if (opts?.fechaLimite && opts.fechaLimite - Date.now() < 20_000) {
      detalle.push("sin tiempo: el resto sale en el siguiente latido");
      break;
    }
    try {
      const r = await generarInsight(c.id as string, { semanasAtras: 1, fechaLimite: opts?.fechaLimite });
      if (r.ok) {
        generados += 1;
        detalle.push(`${c.nombre}: informe generado`);
      } else {
        // Motivo esperable y frecuente: "poca actividad". No es un fallo.
        detalle.push(`${c.nombre}: omitido (${r.motivo})`);
      }
    } catch (e) {
      detalle.push(`${c.nombre}: error (${(e as Error).message})`);
    }
  }

  if (pendientes.length > tope) {
    detalle.push(`quedan ${pendientes.length - tope} para la próxima corrida`);
  }
  return { generados, detalle };
}
