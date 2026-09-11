import { db } from "@/lib/db";
import { generarInsight, semanaDe } from "@/lib/insights";
import { ZONA } from "@/lib/fechas";
import { limitarDistribuido } from "@/lib/seguridad";

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
 *  - Informe de la última semana CERRADA; se completa cualquier día (antes solo
 *    lunes: un lunes fallido perdía la semana).
 *  - Idempotente: si el informe COMPLETO de esa semana ya existe, no lo
 *    regenera (uno parcial generado a mano a mitad de semana sí se rehace).
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

/**
 * ¿El informe guardado cubre la semana COMPLETA?
 *
 * El botón manual del portal genera el informe de la semana EN CURSO. Si el
 * dueño lo apretó un jueves, queda una fila con ese mismo `periodo_desde` pero
 * con datos de lunes a jueves. Antes el automático del lunes siguiente la veía
 * y daba la semana por "lista": el negocio se quedaba con un informe parcial
 * para siempre, sin aviso. Solo cuenta como completo si se creó cuando la
 * semana ya había terminado (fecha de Chile posterior al domingo `hasta`).
 */
export function informeCompleto(creadoEn: string | null | undefined, hasta: string): boolean {
  if (!creadoEn) return false;
  const t = Date.parse(creadoEn);
  if (!Number.isFinite(t)) return false;
  const diaCreado = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA }).format(new Date(t));
  return diaCreado > hasta;
}

/** Una revisión por negocio y semana cada hora como máximo (ver abajo). */
export const REINTENTO_INFORME_SEG = 3600;

export type ResultadoInformes = {
  generados: number;
  /** Negocios sin informe por un motivo esperable (poca actividad, sin empleados). */
  omitidos: number;
  /** Negocios cuyo intento falló (modelo, guardado, excepción). */
  fallidos: number;
  /** Pendientes que no se intentaron en esta corrida (esperando su reintento o sin tiempo). */
  enEspera: number;
  errores: { clienteId: string; error: string }[];
  detalle: string[];
};

type GenerarInsight = typeof generarInsight;

export async function generarInformesPendientes(opts?: {
  ahora?: Date;
  /** Máximo de informes que llaman al modelo por corrida (cada uno ~25-40 s). */
  maxClientes?: number;
  forzar?: boolean;
  /**
   * Techo absoluto (`Date.now()`) que el cron le pasa (auditoría 3-sep-2026):
   * un informe tarda 25-50 s de modelo, y dos seguidos sin techo se llevaban
   * la función del cron entera los lunes (sin vigilante ni latido). Lo que no
   * alcanza sale en el siguiente latido, 5 minutos después.
   */
  fechaLimite?: number;
  // Inyectables para pruebas.
  supa?: ReturnType<typeof db>;
  generar?: GenerarInsight;
  permitir?: (clave: string) => Promise<boolean>;
}): Promise<ResultadoInformes> {
  const ahora = opts?.ahora ?? new Date();
  const out: ResultadoInformes = {
    generados: 0, omitidos: 0, fallidos: 0, enEspera: 0, errores: [], detalle: [],
  };

  /**
   * CUALQUIER DÍA, NO SOLO LUNES (Fase 0, 11-sep-2026). Antes, si el lunes
   * fallaba (modelo caído, cron sin tiempo), la semana se perdía: el martes ya
   * "no era lunes". Ahora el informe de la última semana cerrada se completa
   * el día que se pueda. `forzar` se conserva por compatibilidad.
   */
  const supa = opts?.supa ?? db();
  const generar = opts?.generar ?? generarInsight;
  const permitir =
    opts?.permitir ??
    (async (clave: string) => (await limitarDistribuido(clave, 1, REINTENTO_INFORME_SEG)).ok);

  // La semana que interesa es la ANTERIOR (ya cerrada).
  const { desde, hasta } = semanaDe(ahora, 1);

  // Orden determinista: sin `order`, la base devuelve los negocios en un orden
  // arbitrario pero estable, y el primero de la lista era siempre el mismo.
  const { data: clientes, error } = await supa
    .from("ed_clientes")
    .select("id, nombre")
    .eq("activo", true)
    .order("id", { ascending: true });
  if (error) {
    out.errores.push({ clienteId: "", error: `no se pudo leer negocios: ${error.message}` });
    return out;
  }

  const { data: hechos, error: errHechos } = await supa
    .from("ed_insights")
    .select("cliente_id, creado_en")
    .eq("periodo_desde", desde);
  if (errHechos) {
    out.errores.push({ clienteId: "", error: `no se pudo leer informes: ${errHechos.message}` });
    return out;
  }
  const yaListos = new Set(
    (hechos ?? [])
      .filter((h) => informeCompleto(h.creado_en as string | null, hasta))
      .map((h) => h.cliente_id as string),
  );

  const pendientes = (clientes ?? []).filter((c) => !yaListos.has(c.id as string));
  if (!pendientes.length) {
    out.detalle.push("todos_al_dia");
    return out;
  }

  const tope = opts?.maxClientes ?? 1;
  let intentosConModelo = 0;
  for (const c of pendientes) {
    const cid = c.id as string;
    if (intentosConModelo >= tope) {
      out.enEspera++;
      continue;
    }
    if (opts?.fechaLimite && opts.fechaLimite - Date.now() < 30_000) {
      out.enEspera++;
      continue;
    }
    /**
     * ANTES: se tomaba SOLO el primer pendiente. Un negocio con "poca actividad"
     * no guarda fila, así que seguía primero en cada corrida y ningún otro
     * negocio recibía su informe — sin error visible. Ahora cada negocio se
     * intenta a lo sumo una vez por hora, y un omitido no ocupa el cupo de la
     * corrida (no llamó al modelo): se sigue con el siguiente.
     */
    if (!(await permitir(`informe_auto:${cid}:${desde}`))) {
      out.enEspera++;
      continue;
    }
    try {
      const r = await generar(cid, { semanasAtras: 1, fechaLimite: opts?.fechaLimite });
      if (r.ok) {
        out.generados++;
        intentosConModelo++;
        out.detalle.push(`${c.nombre}: informe generado`);
      } else if (r.omitido) {
        out.omitidos++;
        out.detalle.push(`${c.nombre}: omitido (${r.motivo})`);
      } else {
        out.fallidos++;
        intentosConModelo++;
        out.errores.push({ clienteId: cid, error: r.motivo ?? "informe no generado" });
        out.detalle.push(`${c.nombre}: error (${r.motivo})`);
      }
    } catch (e) {
      out.fallidos++;
      intentosConModelo++;
      out.errores.push({ clienteId: cid, error: (e as Error).message });
      out.detalle.push(`${c.nombre}: error (${(e as Error).message})`);
    }
  }
  if (out.enEspera) out.detalle.push(`quedan ${out.enEspera} para próximas corridas`);
  return out;
}

/**
 * COBERTURA DEL INFORME SEMANAL — la pregunta que nadie se hacía: "¿todos los
 * negocios con actividad tienen el informe de la semana pasada?".
 *
 * La usa /api/salud. El lunes (hora de Chile) no se evalúa: es el día en que se
 * generan. Desde el martes, un negocio activo con al menos 10 mensajes la semana
 * pasada y sin informe completo es una falla, se haya visto o no un error.
 */
export async function informesFaltantes(opts: {
  ahora?: Date;
  supa?: ReturnType<typeof db>;
} = {}): Promise<{ evaluado: boolean; semana: string; faltantes: string[]; error?: string }> {
  const ahora = opts.ahora ?? new Date();
  const supa = opts.supa ?? db();
  const { desde, hasta } = semanaDe(ahora, 1);
  if (esLunesEnChile(ahora)) return { evaluado: false, semana: desde, faltantes: [] };

  const { data: clientes, error } = await supa.from("ed_clientes").select("id").eq("activo", true);
  if (error) return { evaluado: false, semana: desde, faltantes: [], error: error.message };
  const ids = (clientes ?? []).map((c) => c.id as string);
  if (!ids.length) return { evaluado: true, semana: desde, faltantes: [] };

  const [{ data: hechos, error: e1 }, { data: emps, error: e2 }] = await Promise.all([
    supa.from("ed_insights").select("cliente_id, creado_en").eq("periodo_desde", desde),
    supa.from("ed_empleados").select("id, cliente_id").in("cliente_id", ids),
  ]);
  if (e1 || e2) return { evaluado: false, semana: desde, faltantes: [], error: (e1 ?? e2)?.message };

  const completos = new Set(
    (hechos ?? []).filter((h) => informeCompleto(h.creado_en as string | null, hasta)).map((h) => h.cliente_id as string),
  );
  const empleadosPor = new Map<string, string[]>();
  for (const e of emps ?? []) {
    const cid = e.cliente_id as string;
    empleadosPor.set(cid, [...(empleadosPor.get(cid) ?? []), e.id as string]);
  }

  // Mismo rango que usa generarInsight para decidir "poca actividad".
  const desdeUTC = new Date(`${desde}T00:00:00-04:00`).toISOString();
  const hastaUTC = new Date(`${hasta}T23:59:59-03:00`).toISOString();
  const faltantes: string[] = [];
  for (const cid of ids) {
    if (completos.has(cid)) continue;
    const empleados = empleadosPor.get(cid) ?? [];
    if (!empleados.length) continue;
    const { count, error: e3 } = await supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .in("empleado_id", empleados)
      .gte("creado_en", desdeUTC)
      .lte("creado_en", hastaUTC);
    if (e3) return { evaluado: false, semana: desde, faltantes, error: e3.message };
    if ((count ?? 0) >= 10) faltantes.push(cid);
  }
  return { evaluado: true, semana: desde, faltantes };
}
