import type { Lead } from "@/lib/marketing/tipos";

/**
 * LOS FILTROS DE PERSONAS — lógica pura, fuera del componente.
 *
 * Viven acá y no en `TablaLeads.tsx` por una razón concreta: son la misma
 * definición que usan los escalones del embudo, y si no se pueden probar sin
 * montar React, nadie se entera cuando dejan de coincidir. Pasó: el escalón
 * «Cotizaron o reservaron» enlazaba a un filtro que excluía a quien solo
 * reservó, así que se hacía clic en un 86 y la lista traía 61 personas.
 *
 * REGLA: cada filtro tiene que contar exactamente lo mismo que el escalón o el
 * KPI que lo enlaza. Si uno cambia, cambian los dos.
 */
export const FILTROS_LEADS: { clave: string; texto: string; f: (l: Lead) => boolean }[] = [
  { clave: "todos", texto: "Todos", f: () => true },
  { clave: "nuevos", texto: "Sin avanzar", f: (l) => !l.calificado && l.etapa !== "perdido" },
  { clave: "calificados", texto: "Calificados", f: (l) => l.calificado },
  { clave: "cotizados", texto: "Cotizaron", f: (l) => l.cotizo },
  { clave: "reservaron", texto: "Reservaron", f: (l) => l.agendo },
  /** Lo que enlaza el escalón «Cotizaron o reservaron»: cotizó, reservó o ambas. */
  { clave: "avanzaron", texto: "Avanzaron", f: (l) => l.cotizo || l.agendo },
  { clave: "compraron", texto: "Compraron", f: (l) => l.compro },
  /** Quien pagó no está perdido, diga lo que diga la etapa del embudo. */
  { clave: "perdidos", texto: "Perdidos", f: (l) => l.etapa === "perdido" && !l.compro },
];
