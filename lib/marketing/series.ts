import { diaChile, diasEntre, sumarDias } from "@/lib/ads/periodos";
import type { Lead, PuntoDiario } from "@/lib/marketing/tipos";

/**
 * Serie diaria a partir de un subconjunto de leads (una campaña, un anuncio).
 *
 * El gasto por campaña y por día exigiría otra llamada a Meta por cada
 * detalle abierto; no vale la cuota. Acá van los escalones NUESTROS —los que
 * Meta no ve— y el gasto queda en null, que el gráfico entiende como «no
 * disponible», no como cero.
 */
export function serieDeLeads(rango: { desde: string; hasta: string }, leads: Lead[]): PuntoDiario[] {
  const largo = diasEntre(rango.desde, rango.hasta);
  const porDia = new Map<string, PuntoDiario>();
  const serie: PuntoDiario[] = [];
  for (let i = 0; i < largo; i++) {
    const dia = sumarDias(rango.desde, i);
    const p: PuntoDiario = { dia, gasto: null, impresiones: null, clics: null, conversaciones: 0, calificados: 0, ventas: 0, cobrado: 0 };
    serie.push(p);
    porDia.set(dia, p);
  }
  for (const l of leads) {
    const d = new Date(l.llegoEn);
    const p = Number.isNaN(d.getTime()) ? undefined : porDia.get(diaChile(d));
    if (!p) continue;
    p.conversaciones += 1;
    if (l.calificado) p.calificados += 1;
    if (l.compro) {
      p.ventas += 1;
      p.cobrado += l.cobrado;
    }
  }
  return serie;
}
