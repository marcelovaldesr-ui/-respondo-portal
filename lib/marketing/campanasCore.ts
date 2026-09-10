import type { BorradorCampana } from "@/lib/marketing/tipos";

/**
 * La configuración en texto plano, para pegarla en el Administrador de
 * Anuncios. Es el «botón» que sí podemos ofrecer hoy: dos minutos de copiar
 * en vez de veinte de pensar.
 */
export function borradorEnTexto(b: BorradorCampana, cta = "Enviar mensaje"): string {
  const L: string[] = [];
  L.push(`CAMPAÑA: ${b.nombre}`);
  L.push(`Objetivo en Meta: Interacción → Aplicaciones de mensajes → WhatsApp`);
  L.push(`Oferta: ${b.oferta}`);
  L.push("");
  L.push("CONJUNTO DE ANUNCIOS");
  L.push(`  Ubicación: ${b.audiencia.ubicacion || "(definir)"}`);
  if (b.audiencia.edadDesde || b.audiencia.edadHasta)
    L.push(`  Edad: ${b.audiencia.edadDesde ?? 18} a ${b.audiencia.edadHasta ?? 65}`);
  if (b.audiencia.intereses.length) L.push(`  Intereses: ${b.audiencia.intereses.join(", ")}`);
  if (b.audiencia.nota) L.push(`  Nota: ${b.audiencia.nota}`);
  L.push(
    `  Presupuesto: ${b.presupuestoDiario ? `$${b.presupuestoDiario.toLocaleString("es-CL")} diarios` : "(definir)"}${
      b.presupuestoTotal ? ` · tope $${b.presupuestoTotal.toLocaleString("es-CL")}` : ""
    }`,
  );
  L.push(`  Destino: WhatsApp del negocio`);
  L.push("");
  b.copies.forEach((c, i) => {
    L.push(`ANUNCIO ${i + 1}`);
    L.push(`  Titular: ${c.titular}`);
    L.push(`  Texto principal: ${c.texto}`);
    L.push(`  Botón: ${c.cta || cta}`);
    L.push("");
  });
  if (b.notas) L.push(`NOTAS: ${b.notas}`);
  return L.join("\n").trimEnd();
}

/**
 * Qué le falta a un borrador para estar completo, en palabras. Sirve para
 * la pantalla de revisión: en vez de un estado opaco, una lista de lo que
 * queda por hacer, con el paso al que ir.
 */
export function faltantesDeBorrador(b: {
  nombre: string;
  oferta: string;
  audiencia: { ubicacion: string };
  presupuestoDiario: number | null;
  creatividadIds: string[];
  copies: { titular: string; texto: string }[];
}): { texto: string; paso: number }[] {
  const f: { texto: string; paso: number }[] = [];
  if (!b.nombre.trim()) f.push({ texto: "Ponerle nombre a la campaña", paso: 1 });
  if (!b.oferta.trim()) f.push({ texto: "Definir la oferta", paso: 2 });
  if (!b.audiencia.ubicacion.trim()) f.push({ texto: "Elegir la ubicación de la audiencia", paso: 3 });
  if (!((b.presupuestoDiario ?? 0) > 0)) f.push({ texto: "Fijar un presupuesto diario", paso: 4 });
  if (b.creatividadIds.length === 0) f.push({ texto: "Elegir al menos una creatividad", paso: 5 });
  if (!b.copies.some((c) => c.titular.trim() && c.texto.trim())) f.push({ texto: "Escribir al menos un copy completo", paso: 6 });
  return f;
}
