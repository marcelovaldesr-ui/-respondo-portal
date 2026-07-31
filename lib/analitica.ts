import { db } from "@/lib/db";
import { ZONA } from "@/lib/fechas";

/**
 * ANALÍTICA DEL PORTAL — la pantalla que justifica la mensualidad.
 *
 * Todo sale de ed_mensajes (rol + creado_en). No inventa datos ni requiere
 * migración: si hay mensajes, hay métricas.
 *
 * REGLA DE LA CASA (misma de resumen.ts): solo se muestra lo que se puede
 * contar. Lo único derivado es el ahorro de tiempo/dinero, y por eso va SIEMPRE
 * acompañado de sus supuestos a la vista — el cliente tiene que poder rehacer
 * la cuenta en una servilleta. Eso es lo contrario de vender humo.
 *
 * Zona horaria: los mensajes se guardan en UTC y Vercel corre en UTC. Todos los
 * cortes por hora/día se hacen en hora de Chile con Intl (maneja el cambio de
 * horario de septiembre y abril solo).
 */

/** Supuestos del cálculo de ahorro. Se muestran en pantalla, no se esconden. */
export const SUPUESTOS = {
  /**
   * Minutos que le toma a una persona atender un mensaje: leerlo, buscar el
   * dato y escribir la respuesta, incluida la interrupción de lo que estaba
   * haciendo. 2 min es deliberadamente conservador (un mensaje de WhatsApp
   * atendido con calma toma más).
   */
  minutosPorMensaje: 2,
  /**
   * Valor de una hora de trabajo de quien atiende, en pesos.
   * ⚠ Es un valor por defecto y debe confirmarse con el cliente: cambia según
   * quién atienda (dueño, vendedor, administrativo).
   */
  valorHoraCLP: 5000,
} as const;

/** Horario laboral de referencia para "carga fuera de horario". */
export const HORARIO = {
  desde: 9, // 09:00
  hasta: 18, // 18:00 (exclusivo)
  diasHabiles: [1, 2, 3, 4, 5], // lunes a viernes (0 = domingo)
} as const;

export type Analitica = {
  desde: string;
  hasta: string;
  dias: number;
  /** Conteos base */
  recibidos: number;
  enviadosIA: number;
  enviadosHumano: number;
  contactosActivos: number;
  conversaciones: number;
  /** Cobertura */
  coberturaIA: number; // % de mensajes salientes que escribió la IA
  convSoloIA: number;
  convMixtas: number;
  convSoloHumano: number;
  /** Fuera de horario */
  recibidosFueraHorario: number;
  porcentajeFueraHorario: number;
  /** Ahorro (derivado — con supuestos a la vista) */
  minutosAhorrados: number;
  dineroAhorradoCLP: number;
  /** Mapa de calor: 7 días × 24 horas, en hora de Chile */
  heatmap: number[][];
  /** Máximo del heatmap, para escalar los colores */
  heatmapMax: number;
  /** Serie diaria: [fecha corta, IA, humano] */
  serie: { dia: string; ia: number; humano: number }[];
};

/** Partes de una fecha en hora de Chile (día de semana 0-6 y hora 0-23). */
function partesChile(iso: string): { dow: number; hora: number; dia: string } {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA,
    weekday: "short",
    hour: "numeric",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const mapaDow: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  // "24" aparece a medianoche en algunos entornos: se normaliza a 0.
  const h = Number(get("hour")) % 24;
  return {
    dow: mapaDow[get("weekday")] ?? 0,
    hora: Number.isFinite(h) ? h : 0,
    dia: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

/**
 * Calcula la analítica del cliente para los últimos `dias` días.
 * Devuelve null si el cliente no tiene empleados (nada que medir).
 */
export async function calcularAnalitica(
  clienteId: string,
  dias = 30,
): Promise<Analitica | null> {
  const supa = db();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) return null;

  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 86400_000);

  // Se traen solo las columnas necesarias; el agregado se hace en JS (mismo
  // criterio que resumen.ts: testeable sin vistas en Supabase).
  //
  // ⚠ PAGINACIÓN OBLIGATORIA (bug real 31-jul): PostgREST corta toda respuesta
  // en 1.000 filas por configuración del servidor, y `.limit(n)` mayor NO la
  // sube. Sin paginar, la analítica leía solo los 1.000 mensajes MÁS ANTIGUOS
  // y reportaba 0% de cobertura de IA con el bot funcionando a todo dar. Un
  // error silencioso: números creíbles pero falsos, que es lo peor que puede
  // mostrar un panel que el cliente usa para decidir si sigue pagando.
  const PAGINA = 1000;
  const filas: { chat_id: string; rol: string; creado_en: string }[] = [];
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await supa
      .from("ed_mensajes")
      .select("chat_id, rol, creado_en")
      .in("empleado_id", ids)
      .gte("creado_en", desde.toISOString())
      .order("creado_en", { ascending: true })
      .range(inicio, inicio + PAGINA - 1);
    if (error || !data?.length) break;
    filas.push(...(data as typeof filas));
    if (data.length < PAGINA) break; // última página
    if (inicio > 100_000) break; // tope de seguridad
  }

  let recibidos = 0;
  let enviadosIA = 0;
  let enviadosHumano = 0;
  let recibidosFueraHorario = 0;

  const contactos = new Set<string>();
  const rolesPorChat = new Map<string, { ia: boolean; humano: boolean }>();
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const porDia = new Map<string, { ia: number; humano: number }>();

  for (const m of filas) {
    const rol = m.rol as string;
    const chat = m.chat_id as string;
    const { dow, hora, dia } = partesChile(m.creado_en as string);

    if (rol === "cliente") {
      recibidos += 1;
      contactos.add(chat);
      heatmap[dow][hora] += 1;
      const enHorario =
        (HORARIO.diasHabiles as readonly number[]).includes(dow) &&
        hora >= HORARIO.desde &&
        hora < HORARIO.hasta;
      if (!enHorario) recibidosFueraHorario += 1;
    } else {
      const esIA = rol === "empleado";
      if (esIA) enviadosIA += 1;
      else enviadosHumano += 1;

      const r = rolesPorChat.get(chat) ?? { ia: false, humano: false };
      if (esIA) r.ia = true;
      else r.humano = true;
      rolesPorChat.set(chat, r);

      const d = porDia.get(dia) ?? { ia: 0, humano: 0 };
      if (esIA) d.ia += 1;
      else d.humano += 1;
      porDia.set(dia, d);
    }
  }

  let convSoloIA = 0;
  let convMixtas = 0;
  let convSoloHumano = 0;
  for (const r of rolesPorChat.values()) {
    if (r.ia && r.humano) convMixtas += 1;
    else if (r.ia) convSoloIA += 1;
    else if (r.humano) convSoloHumano += 1;
  }

  const salientes = enviadosIA + enviadosHumano;
  const minutosAhorrados = enviadosIA * SUPUESTOS.minutosPorMensaje;

  return {
    desde: desde.toISOString(),
    hasta: hasta.toISOString(),
    dias,
    recibidos,
    enviadosIA,
    enviadosHumano,
    contactosActivos: contactos.size,
    conversaciones: rolesPorChat.size,
    coberturaIA: salientes ? Math.round((enviadosIA / salientes) * 100) : 0,
    convSoloIA,
    convMixtas,
    convSoloHumano,
    recibidosFueraHorario,
    porcentajeFueraHorario: recibidos
      ? Math.round((recibidosFueraHorario / recibidos) * 1000) / 10
      : 0,
    minutosAhorrados,
    dineroAhorradoCLP: Math.round((minutosAhorrados / 60) * SUPUESTOS.valorHoraCLP),
    heatmap,
    heatmapMax: Math.max(1, ...heatmap.flat()),
    serie: [...porDia.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([dia, v]) => ({ dia, ia: v.ia, humano: v.humano })),
  };
}

/** "27 d 6 h" · "6 h 30 min" · "45 min" — formato humano de duración. */
export function formatearDuracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) {
    const m = minutos % 60;
    return m ? `${horas} h ${m} min` : `${horas} h`;
  }
  const d = Math.floor(horas / 24);
  const h = horas % 24;
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** "$1.779.200" — pesos chilenos con separador de miles. */
export function formatearCLP(monto: number): string {
  return "$" + monto.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}
