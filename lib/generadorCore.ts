/**
 * Aritmética pura del generador de seguimientos.
 *
 * Vive separada de lib/generadorSeguimientos.ts por la misma razón que
 * lib/agendaCore.ts vive separado de lib/agenda.ts: acá no se importa nada del
 * proyecto, así que los tests pueden cargarlo directo con `node --test` sin
 * arrastrar Supabase ni el alias "@/" (que Node no resuelve al importar un .ts).
 */

/** Resta meses en UTC. Enero menos 2 da noviembre del año anterior. */
export function mesesAntes(d: Date, meses: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() - meses);
  return x;
}

export const soloFecha = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * La ventana de "le toca la mantención ahora", como par de fechas.
 *
 * Es la única aritmética del generador que puede estar mal en silencio: si los
 * márgenes se dan vuelta, la consulta devuelve un rango vacío y el cron no
 * programa nada — que desde afuera se ve idéntico a "no hay candidatos".
 *
 * Con intervalo 6, antes 1 y después 2, un día de agosto de 2026:
 * desde = hace 8 meses (dic-2025), hasta = hace 5 meses (mar-2026).
 */
export function ventanaMantencion(
  ahora: Date,
  intervaloMeses: number,
  margenAntesMeses: number,
  margenDespuesMeses: number,
): { desde: string; hasta: string } {
  return {
    desde: soloFecha(mesesAntes(ahora, intervaloMeses + margenDespuesMeses)),
    hasta: soloFecha(mesesAntes(ahora, intervaloMeses - margenAntesMeses)),
  };
}
