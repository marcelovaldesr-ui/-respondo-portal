import { db } from "@/lib/db";
import { COL_DESCARTADO } from "@/lib/seguimientosCore";
import { contarEsperando, leerTodo, leerTodoParalelo, unaPorChat } from "@/lib/metricas";

/**
 * Capa de datos del portal. TODO se filtra por clienteId — es la única barrera
 * que impide que un cliente vea datos de otro.
 *
 * Los agregados se calculan en JS (no en SQL) a propósito: así se pueden probar
 * de punta a punta sin depender de vistas creadas a mano en Supabase. El volumen
 * de una pyme (miles de mensajes al mes) lo aguanta de sobra. Si algún cliente
 * pasa de ~50.000 mensajes, mover esto a una vista materializada.
 *
 * REGLA: solo se muestra lo que realmente se puede contar. Nada de estimar.
 */

/** Tipos de resultado que registra el motor en ed_resultados. */
export type TipoResultado =
  | "lead_capturado"
  | "cotizacion_enviada"
  | "agendamiento"
  | "venta_confirmada"
  | "cotizacion_retomada"
  | "cliente_reactivado"
  | "venta_recuperada"
  | "encuesta_respondida"
  | "resena_conseguida"
  | "cliente_molesto";

export type ResumenEmpleado = {
  empleadoId: string;
  rol: string;
  nombrePublico: string;
  conversaciones: number;
  mensajesEnviados: number;
  escalaciones: number;
  /**
   * Conversaciones DISTINTAS de este empleado con una derivación sin atender,
   * de cualquier fecha (antes: filas creadas este mes, que ocultaba lo viejo y
   * contaba dos veces un chat con dos derivaciones).
   */
  escalacionesPendientes: number;
  /** Seguimientos que de verdad salieron (sin los descartados) este mes. */
  seguimientosEnviados: number;
  seguimientosConRespuesta: number;
  /** Los mismos envíos reales, por tipo (encuesta_postventa, cotizacion_sin_respuesta…). */
  seguimientosPorTipo: Record<string, number>;
  /** false si alguna lectura quedó incompleta: la tarjeta no debe afirmar ceros. */
  completo: boolean;
  ultimaActividad: string | null;
  /** Conteo por tipo de resultado. Lo que no ocurrió, no aparece. */
  resultados: Partial<Record<TipoResultado, number>>;
  /** Suma de valor_clp de las ventas recuperadas (el número que más pesa). */
  montoRecuperado: number;
};

export type MetricaPeriodo = {
  periodo: string;
  esBasal: boolean;
  conversaciones: number | null;
  leadsCapturados: number | null;
  escalaciones: number | null;
  resueltasSinHumanoPct: number | null;
  tiempoRespuestaSeg: number | null;
};

// La ventana "este mes" se calcula con el calendario chileno, no con UTC.
import { inicioDeMesChile } from "@/lib/fechas";

// Se re-exporta para no tocar los imports de las páginas.
export { nombreMes } from "@/lib/fechas";

/** Actividad real de cada empleado del cliente, en el mes en curso. */
export async function resumenEmpleados(
  clienteId: string,
  supaOpt?: ReturnType<typeof db>,
): Promise<ResumenEmpleado[]> {
  const supa = supaOpt ?? db();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id, rol, nombre_publico")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("rol");

  if (!empleados?.length) return [];

  const ids = empleados.map((e) => e.id as string);
  const desde = inicioDeMesChile();

  /**
   * PAGINADO (Fase 0). Antes los mensajes del mes se leían en UNA consulta y
   * PostgREST corta en 1.000 filas sin avisar: un negocio con 3.000 mensajes en
   * lo que va del mes veía un tercio de sus conversaciones en la portada.
   */
  const [mensajesR, escMesR, abiertasR, seguimientosR, resultadosR] = await Promise.all([
    leerTodoParalelo<{ empleado_id: string; chat_id: string; rol: string; creado_en: string }>(
      () =>
        supa
          .from("ed_mensajes")
          .select("id", { count: "exact", head: true })
          .in("empleado_id", ids)
          .gte("creado_en", desde),
      (a, z) =>
        supa
          .from("ed_mensajes")
          .select("empleado_id, chat_id, rol, creado_en")
          .in("empleado_id", ids)
          .gte("creado_en", desde)
          // Orden total (creado_en + id): con solo creado_en, dos mensajes del
          // mismo instante podían repetirse o faltar entre páginas.
          .order("creado_en", { ascending: true })
          .order("id", { ascending: true })
          .range(a, z),
      { concurrencia: 4, tope: 30_000 },
    ),
    leerTodo<{ empleado_id: string; creado_en: string }>((a, z) =>
      supa
        .from("ed_escalaciones")
        .select("empleado_id, creado_en")
        .in("empleado_id", ids)
        .gte("creado_en", desde)
        .order("creado_en", { ascending: true })
        .range(a, z),
    ),
    leerTodo<{ empleado_id: string; chat_id: string }>((a, z) =>
      supa
        .from("ed_escalaciones")
        .select("empleado_id, chat_id")
        .in("empleado_id", ids)
        .is("atendida_en", null)
        .order("creado_en", { ascending: true })
        .range(a, z),
    ),
    leerTodo<{ empleado_id: string; tipo: string; respuesta_recibida: boolean | null }>((a, z) =>
      supa
        .from("ed_seguimientos")
        .select("empleado_id, tipo, respuesta_recibida")
        .in("empleado_id", ids)
        .not("enviado_en", "is", null)
        // Un descartado (cita vencida, no_contactar…) no salió: no se cuenta.
        .is(COL_DESCARTADO, null)
        .gte("enviado_en", desde)
        .order("enviado_en", { ascending: true })
        .range(a, z),
    ),
    leerTodo<{ empleado_id: string; tipo: string; valor_clp: number | null }>((a, z) =>
      supa
        .from("ed_resultados")
        .select("empleado_id, tipo, valor_clp")
        .in("empleado_id", ids)
        .gte("creado_en", desde)
        .order("creado_en", { ascending: true })
        .range(a, z),
    ),
  ]);
  const completo = [mensajesR, escMesR, abiertasR, seguimientosR, resultadosR].every((r) => r.completo);
  const mensajes = { data: mensajesR.filas };
  const escalaciones = { data: escMesR.filas };
  const seguimientos = { data: seguimientosR.filas };
  const resultados = { data: resultadosR.filas };

  return empleados.map((e) => {
    const id = e.id as string;
    const msgs = (mensajes.data ?? []).filter((m) => m.empleado_id === id);
    const esc = (escalaciones.data ?? []).filter((x) => x.empleado_id === id);
    const seg = (seguimientos.data ?? []).filter((s) => s.empleado_id === id);
    const pendientesChats = new Set(
      abiertasR.filas.filter((x) => x.empleado_id === id).map((x) => x.chat_id),
    );
    const porTipo: Record<string, number> = {};
    for (const s of seg) porTipo[s.tipo] = (porTipo[s.tipo] ?? 0) + 1;

    const chats = new Set(msgs.map((m) => m.chat_id as string));
    const fechas = msgs
      .map((m) => m.creado_en as string)
      .sort()
      .reverse();

    const res = (resultados.data ?? []).filter((r) => r.empleado_id === id);
    const conteo: Partial<Record<TipoResultado, number>> = {};
    let montoRecuperado = 0;
    for (const r of res) {
      const tipo = r.tipo as TipoResultado;
      conteo[tipo] = (conteo[tipo] ?? 0) + 1;
      if (tipo === "venta_recuperada") montoRecuperado += Number(r.valor_clp ?? 0);
    }

    return {
      empleadoId: id,
      rol: e.rol as string,
      nombrePublico: (e.nombre_publico as string) ?? "",
      conversaciones: chats.size,
      mensajesEnviados: msgs.filter((m) => m.rol === "empleado").length,
      escalaciones: esc.length,
      escalacionesPendientes: pendientesChats.size,
      seguimientosEnviados: seg.length,
      seguimientosConRespuesta: seg.filter((s) => s.respuesta_recibida).length,
      seguimientosPorTipo: porTipo,
      completo,
      ultimaActividad: fechas[0] ?? null,
      resultados: conteo,
      montoRecuperado,
    };
  });
}

/** $229.500 — formato chileno, sin decimales. */
export function formatearCLP(monto: number): string {
  return "$" + monto.toLocaleString("es-CL", { maximumFractionDigits: 0 });
}

/** Métricas mensuales del cliente (incluye el mes basal, previo a activar). */
export async function metricasCliente(
  clienteId: string,
): Promise<{ actual: MetricaPeriodo | null; comparacion: MetricaPeriodo | null }> {
  const { data } = await db()
    .from("ed_metricas")
    .select(
      "periodo, es_basal, conversaciones, leads_capturados, escalaciones, resueltas_sin_humano_pct, tiempo_respuesta_seg",
    )
    .eq("cliente_id", clienteId)
    .order("periodo", { ascending: false });

  const filas: MetricaPeriodo[] = (data ?? []).map((m) => ({
    periodo: m.periodo as string,
    esBasal: Boolean(m.es_basal),
    conversaciones: m.conversaciones as number | null,
    leadsCapturados: m.leads_capturados as number | null,
    escalaciones: m.escalaciones as number | null,
    resueltasSinHumanoPct: m.resueltas_sin_humano_pct as number | null,
    tiempoRespuestaSeg: m.tiempo_respuesta_seg as number | null,
  }));

  const actual = filas.find((f) => !f.esBasal) ?? null;
  // Comparamos contra el mes basal (cómo se atendía antes de Respondo); si no
  // hay basal, contra el período inmediatamente anterior al actual.
  const basal = filas.find((f) => f.esBasal) ?? null;
  const anterior = actual
    ? filas.find((f) => f.periodo < actual.periodo) ?? null
    : null;

  return { actual, comparacion: basal ?? anterior };
}

/**
 * QUIÉN ESTÁ ESPERANDO — las conversaciones que el asistente derivó y nadie ha
 * tomado todavía.
 *
 * La portada antes mostraba solo el número ("3 conversaciones te están
 * esperando"). Un número no permite actuar: obliga a ir a la bandeja, buscar
 * cuáles son y recién ahí decidir. Con nombre, antigüedad y enlace directo, la
 * portada deja de informar y empieza a servir.
 *
 * Se consulta ed_escalaciones directo, filtrando por los empleados del cliente
 * —la barrera de acceso de siempre— y se resuelve el nombre del contacto en una
 * segunda consulta acotada a esos chats. Dos consultas chicas: no depende del
 * resumen de contacto (migración 250) ni recorre mensajes.
 */
export type ItemEsperando = {
  empleadoId: string;
  chatId: string;
  contacto: string;
  motivo: string;
  resumen: string;
  desde: string;
};

export async function esperandoHumano(
  clienteId: string,
  limite = 4,
): Promise<{ items: ItemEsperando[]; total: number }> {
  const supa = db();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId);
  const ids = (empleados ?? []).map((e) => e.id as string);
  if (!ids.length) return { items: [], total: 0 };

  /**
   * Total = CONVERSACIONES esperando, con la misma función que el menú y la
   * bandeja (Fase 0: antes eran filas de escalaciones, 53 vs 52). La lista se
   * deduplica por chat: un chat con dos derivaciones abiertas aparece una vez,
   * con la más antigua.
   */
  const [total, { data }] = await Promise.all([
    contarEsperando(clienteId, ids, supa),
    supa
      .from("ed_escalaciones")
      .select("empleado_id, chat_id, trigger, resumen, creado_en")
      .in("empleado_id", ids)
      .is("atendida_en", null)
      .order("creado_en", { ascending: true }) // la más antigua primero: es la que peor está
      .limit(limite * 5),
  ]);

  const filas = unaPorChat((data ?? []) as { empleado_id: string; chat_id: string; trigger: string | null; resumen: string | null; creado_en: string }[]).slice(0, limite);
  if (!filas.length) return { items: [], total };

  // Nombre del contacto, solo para los chats que se van a mostrar.
  const chats = [...new Set(filas.map((f) => f.chat_id as string))];
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("chat_id, nombre")
    .eq("cliente_id", clienteId)
    .in("chat_id", chats);
  const nombre = new Map<string, string>(
    (contactos ?? []).map((c) => [c.chat_id as string, (c.nombre as string | null) ?? ""]),
  );

  return {
    total: Math.max(total, filas.length),
    items: filas.map((f) => ({
      empleadoId: f.empleado_id as string,
      chatId: f.chat_id as string,
      contacto: nombre.get(f.chat_id as string) || `+${f.chat_id}`,
      motivo: (f.trigger as string) ?? "",
      resumen: (f.resumen as string) ?? "",
      desde: f.creado_en as string,
    })),
  };
}

/** "90 min", "25 s" — el número que más impresiona al dueño. */
export function formatearDuracion(seg: number | null): string {
  if (seg === null || seg === undefined) return "—";
  if (seg < 60) return `${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** formatearCLP y nombreMes viven arriba / en lib/fechas.ts respectivamente. */
