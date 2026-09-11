import { db } from "@/lib/db";
import {
  evaluarProceso,
  fusionarDetalle,
  type EvaluacionProceso,
  type ResultadoPaso,
} from "@/lib/procesosCore";

/**
 * Registro de procesos del cron sobre `ed_latidos` (ver lib/procesosCore.ts).
 *
 * Igual que los latidos, es DEFENSIVO: nunca lanza. Un registro perdido es un
 * problema menor; un cron que se cae por culpa del registro sería el peor
 * resultado posible. Dos viajes a la base por corrida, no uno por paso.
 */

export const PREFIJO_PROCESO = "proceso:";

type Supa = ReturnType<typeof db>;

export async function registrarProcesos(
  resultados: ResultadoPaso[],
  opts: { supa?: Supa; ahora?: Date } = {},
): Promise<void> {
  if (!resultados.length) return;
  try {
    const supa = opts.supa ?? db();
    const ahora = opts.ahora ?? new Date();
    const claves = resultados.map((r) => PREFIJO_PROCESO + r.nombre);
    const { data, error } = await supa
      .from("ed_latidos")
      .select("clave, corridas, detalle")
      .in("clave", claves);
    if (error) return; // migración 260 sin aplicar: no hay dónde escribir

    const previos = new Map<string, { corridas: number; detalle: unknown }>();
    for (const f of (data ?? []) as { clave: string; corridas: number | null; detalle: unknown }[]) {
      previos.set(f.clave, { corridas: Number(f.corridas ?? 0), detalle: f.detalle });
    }

    const filas = resultados.map((r) => {
      const clave = PREFIJO_PROCESO + r.nombre;
      const p = previos.get(clave);
      return {
        clave,
        ultimo_en: ahora.toISOString(),
        corridas: (p?.corridas ?? 0) + 1,
        detalle: fusionarDetalle(p?.detalle ?? null, r, ahora),
      };
    });
    await supa.from("ed_latidos").upsert(filas, { onConflict: "clave" });
  } catch {
    // Silencio a propósito.
  }
}

export type ProcesoLeido = EvaluacionProceso & {
  ultimoEn: string | null;
  detalle: Record<string, unknown> | null;
};

/** Todos los procesos registrados, evaluados. `null` si no se pudo leer. */
export async function leerProcesos(supa: Supa = db(), ahora = new Date()): Promise<ProcesoLeido[] | null> {
  try {
    const { data, error } = await supa
      .from("ed_latidos")
      .select("clave, ultimo_en, detalle")
      .like("clave", `${PREFIJO_PROCESO}%`)
      .order("clave", { ascending: true });
    if (error) return null;
    return ((data ?? []) as { clave: string; ultimo_en: string | null; detalle: unknown }[]).map((f) => {
      const nombre = f.clave.slice(PREFIJO_PROCESO.length);
      return {
        ...evaluarProceso(nombre, f.detalle, f.ultimo_en, ahora),
        ultimoEn: f.ultimo_en,
        detalle: (f.detalle as Record<string, unknown> | null) ?? null,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Ejecuta un paso del cron midiendo tiempo y atrapando la excepción. El paso
 * devuelve su resultado "de negocio" y un traductor lo convierte en
 * `ResultadoPaso`. Si lanza, queda registrado como fallo con el mensaje.
 */
export async function correrPaso<T>(
  nombre: string,
  fn: () => Promise<T>,
  traducir: (r: T) => Omit<ResultadoPaso, "nombre" | "duracionMs">,
  registro: ResultadoPaso[],
): Promise<T | undefined> {
  const t0 = Date.now();
  try {
    const r = await fn();
    registro.push({ nombre, ...traducir(r), duracionMs: Date.now() - t0 });
    return r;
  } catch (e) {
    console.error(`[cron] paso ${nombre} falló (no afecta los demás)`, (e as Error)?.message ?? e);
    registro.push({
      nombre,
      ok: false,
      errores: [{ clienteId: null, error: (e as Error)?.message ?? String(e) }],
      duracionMs: Date.now() - t0,
    });
    return undefined;
  }
}
