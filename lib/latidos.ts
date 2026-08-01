import { db } from "./db";

/**
 * LATIDOS: "este proceso corrió, y a esta hora".
 *
 * Existe por un caso concreto: el cron de seguimientos. Si deja de correr no
 * falla nada visible — los recordatorios de cita simplemente no salen y el
 * negocio se entera cuando un cliente no llega. Sin un latido, "¿está andando?"
 * no tiene respuesta: una base sin pendientes vencidos se ve igual esté el cron
 * vivo o muerto.
 *
 * Todo aquí es DEFENSIVO a propósito: si la migración 260 no está aplicada, o
 * la base no responde, no debe romperse el proceso que estaba latiendo. Un
 * latido perdido es un problema menor; un cron caído por culpa del latido sería
 * el peor resultado posible.
 */

export const LATIDO_CRON_SEGUIMIENTOS = "cron_seguimientos";

/** Deja constancia de que el proceso corrió. Nunca lanza. */
export async function registrarLatido(
  clave: string,
  detalle?: Record<string, unknown>,
): Promise<void> {
  try {
    const supa = db();
    // Se lee el acumulado para poder distinguir "nunca corrió" de "se detuvo".
    const { data } = await supa
      .from("ed_latidos")
      .select("corridas")
      .eq("clave", clave)
      .maybeSingle();
    const corridas = Number((data as { corridas?: number } | null)?.corridas ?? 0) + 1;

    await supa.from("ed_latidos").upsert(
      {
        clave,
        ultimo_en: new Date().toISOString(),
        corridas,
        detalle: detalle ?? null,
      },
      { onConflict: "clave" },
    );
  } catch {
    // Silencio a propósito: ver el comentario de arriba.
  }
}

export type Latido = {
  clave: string;
  ultimoEn: string | null;
  corridas: number;
  detalle: Record<string, unknown> | null;
  /** Minutos desde la última corrida. null si nunca corrió. */
  haceMin: number | null;
  /** true si la tabla no existe todavía (migración 260 pendiente). */
  sinTabla: boolean;
};

export async function leerLatido(clave: string): Promise<Latido> {
  const vacio: Latido = {
    clave, ultimoEn: null, corridas: 0, detalle: null, haceMin: null, sinTabla: false,
  };
  try {
    const { data, error } = await db()
      .from("ed_latidos")
      .select("clave, ultimo_en, corridas, detalle")
      .eq("clave", clave)
      .maybeSingle();
    if (error) return { ...vacio, sinTabla: true };
    if (!data) return vacio;

    const ultimoEn = data.ultimo_en as string;
    return {
      clave,
      ultimoEn,
      corridas: Number(data.corridas ?? 0),
      detalle: (data.detalle as Record<string, unknown> | null) ?? null,
      haceMin: Math.round((Date.now() - Date.parse(ultimoEn)) / 60_000),
      sinTabla: false,
    };
  } catch {
    return { ...vacio, sinTabla: true };
  }
}

/**
 * ¿El cron está sano?
 *
 * TOLERANCIA: 90 minutos. El cron recomendado corre cada 15 min; 90 deja pasar
 * cinco fallos seguidos antes de gritar, que es suficiente margen para un
 * reinicio de Vercel o un hipo del servicio de cron sin generar falsas alarmas.
 *
 * "Nunca corrió" NO se marca como caído: en una instalación recién creada eso
 * es lo normal y no queremos que /api/salud nazca en rojo. Se informa aparte.
 */
export const TOLERANCIA_CRON_MIN = 90;

export function estadoDelCron(l: Latido): { ok: boolean; detalle: string } {
  if (l.sinTabla) return { ok: true, detalle: "sin registro (falta migración 260)" };
  if (l.haceMin === null) return { ok: true, detalle: "nunca ha corrido — falta configurar el cron" };
  if (l.haceMin > TOLERANCIA_CRON_MIN) {
    return { ok: false, detalle: `última corrida hace ${textoDeMinutos(l.haceMin)} (tolerancia ${TOLERANCIA_CRON_MIN} min)` };
  }
  return { ok: true, detalle: `hace ${textoDeMinutos(l.haceMin)} · ${l.corridas} corridas` };
}

export function textoDeMinutos(min: number): string {
  if (min < 1) return "menos de un minuto";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} días`;
}
