import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ZONA } from "@/lib/fechas";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";

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

/**
 * Supuestos del cálculo de ahorro. Se muestran en pantalla, no se esconden.
 *
 * VALOR HORA — se usa el SUELDO MÍNIMO de Chile a propósito: es el piso legal,
 * público y verificable, así nadie puede acusarnos de inflar el beneficio. El
 * ahorro real es mayor (quien atiende suele ganar más que el mínimo, y el costo
 * para el empleador incluye cotizaciones), pero preferimos quedarnos cortos y
 * que el número aguante cualquier cuestionamiento.
 *
 * Cálculo (fórmula de la Dirección del Trabajo):
 *   (sueldo mensual / 30) × 28 / (horas semanales × 4)
 *   (539.000 / 30) × 28 / 168 = $2.994 por hora
 *
 * Datos usados (verificados 31-jul-2026):
 *   · Ingreso Mínimo Mensual: $539.000
 *   · Jornada: 42 h/semana (Ley 40 Horas, vigente desde el 26-abr-2026) → 168 h/mes
 *
 * ⚠ REVISAR cuando cambie el sueldo mínimo (se reajusta por ley) o cuando la
 * jornada baje a 40 h en 2028. Basta con actualizar las dos constantes.
 */
const SUELDO_MINIMO_CLP = 539_000;
const HORAS_MES = 168; // 42 h/semana × 4

export const SUPUESTOS = {
  /**
   * Minutos que le toma a una persona atender un mensaje: leerlo, buscar el
   * dato y escribir la respuesta, incluida la interrupción de lo que estaba
   * haciendo. 2 min es deliberadamente conservador (un mensaje de WhatsApp
   * atendido con calma toma más).
   */
  minutosPorMensaje: 2,
  /** Valor de la hora según el sueldo mínimo vigente (ver cálculo arriba). */
  valorHoraCLP: Math.round((SUELDO_MINIMO_CLP / 30) * 28 / HORAS_MES),
  sueldoMinimoCLP: SUELDO_MINIMO_CLP,
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
  /**
   * Cobertura de las últimas 24 h. Existe porque el promedio del período puede
   * mentir por omisión: si el asistente lleva pocos días, o si se importó el
   * historial anterior (respondido a mano), el promedio lo entierra. Mostrar
   * ambos números es más honesto que elegir el que conviene.
   */
  coberturaReciente: number;
  recientesIA: number;
  recientesHumano: number;
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

  const ids = await idsEmpleadosDeCliente(clienteId);
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
  // Sub-conteo de las últimas 24 h (mismo recorrido, sin consulta extra).
  const corte24h = Date.now() - 86400_000;
  let recientesIA = 0;
  let recientesHumano = 0;

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

      if (new Date(m.creado_en as string).getTime() >= corte24h) {
        if (esIA) recientesIA += 1;
        else recientesHumano += 1;
      }

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
    coberturaReciente:
      recientesIA + recientesHumano
        ? Math.round((recientesIA / (recientesIA + recientesHumano)) * 100)
        : 0,
    recientesIA,
    recientesHumano,
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

/**
 * RESUMEN DE AHORRO — la versión barata de calcularAnalitica.
 *
 * POR QUÉ EXISTE
 * El rediseño pone en la portada los tres números que responden "¿está
 * funcionando esto que pago?": tiempo ahorrado, dinero ahorrado y qué parte de
 * las respuestas escribió el asistente. Son exactamente los de Analítica.
 *
 * Pero calcularAnalitica trae TODOS los mensajes del período para armar además
 * el mapa de calor por hora y la serie diaria. Eso está bien en una pantalla que
 * se abre a propósito; es inaceptable en la portada, que es la página más
 * visitada del portal. Habría puesto el cálculo más caro en la pantalla más
 * abierta.
 *
 * CÓMO SE EVITA
 * Los tres números salen de tres conteos. PostgREST sabe contar en el servidor
 * (`count: "exact", head: true`): Postgres resuelve el conteo por índice y
 * devuelve CERO filas, solo el número en una cabecera. Da igual que el cliente
 * tenga 1.500 mensajes o 600.000 — se transfiere lo mismo.
 *
 * Y como no se transfieren filas, tampoco aplica el tope de 1.000 de PostgREST,
 * que es lo que ya nos hizo mostrar 0% de cobertura teniendo al asistente
 * trabajando a full.
 *
 * IMPORTANTE: usa las MISMAS constantes de SUPUESTOS que Analítica. Si algún día
 * se separan, la portada y Analítica mostrarían cifras distintas del mismo mes y
 * el cliente dejaría de creerle a las dos.
 */
export type ResumenAhorro = {
  dias: number;
  enviadosIA: number;
  enviadosHumano: number;
  recibidos: number;
  /** % de mensajes salientes que escribió el asistente en todo el período. */
  coberturaIA: number;
  /**
   * Lo mismo, pero de las últimas 24 h.
   *
   * NO es un adorno: es la diferencia entre informar y engañar por omisión.
   * Impresora Color tiene meses de historial que respondió Cecilia a mano y
   * Tino lleva días conectado. El promedio de 30 días da 7% y el de las últimas
   * 24 h da 39%. El 7% es cierto y es inútil —describe sobre todo un pasado sin
   * asistente— y el 39% solo también miente, porque un día puede ser atípico.
   *
   * Mostrar los dos es lo único honesto, y de paso es lo que hace creíble el
   * panel: un cliente que ve un número inflado deja de creerle a todos.
   */
  coberturaReciente: number;
  recientesIA: number;
  recientesHumano: number;
  /** Derivados con los supuestos a la vista (los mismos de Analítica). */
  minutosAhorrados: number;
  dineroAhorradoCLP: number;
};

export async function resumenAhorro(
  clienteId: string,
  dias = 30,
  supaOpt?: SupabaseClient,
): Promise<ResumenAhorro | null> {
  const supa = supaOpt ?? db();

  const ids = await idsEmpleadosDeCliente(clienteId);
  if (!ids.length) return null;

  const desde = new Date(Date.now() - dias * 86400_000).toISOString();

  /**
   * Tres conteos en paralelo. head:true = no traer ni una fila.
   *
   * Se cuenta TOTAL, "cliente" y "empleado", y el saliente humano se deduce por
   * resta. No se consulta rol="humano" directo a propósito: arriba, en
   * calcularAnalitica, humano es "todo lo que no es cliente ni empleado" —si el
   * motor algún día escribe otro rol saliente (una nota interna, un reenvío),
   * una consulta por igualdad lo dejaría fuera y los dos números del portal
   * dejarían de cuadrar. La resta no puede desincronizarse.
   */
  const base = () =>
    supa
      .from("ed_mensajes")
      .select("id", { count: "exact", head: true })
      .in("empleado_id", ids)
      .gte("creado_en", desde);

  // Las mismas tres cuentas, acotadas a las últimas 24 h.
  const corte24h = new Date(Date.now() - 86400_000).toISOString();
  const base24 = () => base().gte("creado_en", corte24h);

  const [todos, entrantes, deEmpleado, todos24, entrantes24, deEmpleado24] = await Promise.all([
    base(),
    base().eq("rol", "cliente"),
    base().eq("rol", "empleado"),
    base24(),
    base24().eq("rol", "cliente"),
    base24().eq("rol", "empleado"),
  ]);

  const total = todos.count ?? 0;
  const recibidos = entrantes.count ?? 0;
  const enviadosIA = deEmpleado.count ?? 0;
  const enviadosHumano = Math.max(0, total - recibidos - enviadosIA);
  const salientes = enviadosIA + enviadosHumano;

  const recientesIA = deEmpleado24.count ?? 0;
  const recientesHumano = Math.max(
    0,
    (todos24.count ?? 0) - (entrantes24.count ?? 0) - recientesIA,
  );
  const salientes24 = recientesIA + recientesHumano;

  // El ahorro se cuenta sobre los mensajes que el asistente respondió, no sobre
  // todos: si lo escribió una persona, no hubo ahorro que reportar.
  const minutosAhorrados = enviadosIA * SUPUESTOS.minutosPorMensaje;

  return {
    dias,
    enviadosIA,
    enviadosHumano,
    recibidos,
    coberturaIA: salientes ? Math.round((enviadosIA / salientes) * 100) : 0,
    coberturaReciente: salientes24 ? Math.round((recientesIA / salientes24) * 100) : 0,
    recientesIA,
    recientesHumano,
    minutosAhorrados,
    dineroAhorradoCLP: Math.round((minutosAhorrados / 60) * SUPUESTOS.valorHoraCLP),
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
