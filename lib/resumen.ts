import { db } from "@/lib/db";

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
  escalacionesPendientes: number;
  seguimientosEnviados: number;
  seguimientosConRespuesta: number;
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
): Promise<ResumenEmpleado[]> {
  const supa = db();

  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id, rol, nombre_publico")
    .eq("cliente_id", clienteId)
    .eq("activo", true)
    .order("rol");

  if (!empleados?.length) return [];

  const ids = empleados.map((e) => e.id as string);
  const desde = inicioDeMesChile();

  const [mensajes, escalaciones, seguimientos, resultados] = await Promise.all([
    supa
      .from("ed_mensajes")
      .select("empleado_id, chat_id, rol, creado_en")
      .in("empleado_id", ids)
      .gte("creado_en", desde),
    supa
      .from("ed_escalaciones")
      .select("empleado_id, atendida_en, creado_en")
      .in("empleado_id", ids)
      .gte("creado_en", desde),
    supa
      .from("ed_seguimientos")
      .select("empleado_id, enviado_en, respuesta_recibida")
      .in("empleado_id", ids)
      .not("enviado_en", "is", null)
      .gte("enviado_en", desde),
    supa
      .from("ed_resultados")
      .select("empleado_id, tipo, valor_clp")
      .in("empleado_id", ids)
      .gte("creado_en", desde),
  ]);

  return empleados.map((e) => {
    const id = e.id as string;
    const msgs = (mensajes.data ?? []).filter((m) => m.empleado_id === id);
    const esc = (escalaciones.data ?? []).filter((x) => x.empleado_id === id);
    const seg = (seguimientos.data ?? []).filter((s) => s.empleado_id === id);

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
      escalacionesPendientes: esc.filter((x) => !x.atendida_en).length,
      seguimientosEnviados: seg.length,
      seguimientosConRespuesta: seg.filter((s) => s.respuesta_recibida).length,
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
