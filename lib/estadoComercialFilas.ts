/**
 * De filas de la base a HECHOS del estado comercial (Fase 1). Puro: recibe lo
 * que devolvieron las consultas por lote y arma un `HechosContacto` por chat.
 *
 * Separado del cargador para poder probar el armado (qué modo se toma, qué
 * seguimiento cuenta como descartado, qué cita es activa) sin base de datos.
 */

import { esEtapa } from "@/lib/etapasCore";
import type {
  HechoCita,
  HechoDerivacion,
  HechoPago,
  HechoPropuesta,
  HechoResultado,
  HechoSeguimiento,
  HechosContacto,
  ModoChat,
  RolMensaje,
} from "@/lib/estadoComercialCore";

type Fila = Record<string, unknown>;

/** Columnas de ed_contactos que necesita el estado comercial. */
export const COLUMNAS_CONTACTO =
  "chat_id, nombre, telefono, etapa, etapa_motivo, etapa_en, etapa_manual, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol, ultimo_mensaje_texto, ultimo_empleado_id, primer_mensaje_en, total_mensajes, datos";

/** Estados de cita que todavía están «en pie» (lib/agenda.ts). */
export const CITAS_ACTIVAS = ["agendada", "confirmada", "reagendada"] as const;

/** Resultados que cuentan para pago informado, actividad y encuestas. */
export const TIPOS_RESULTADO_ESTADO = [
  "venta_confirmada",
  "cotizacion_enviada",
  "agendamiento",
  "encuesta_respondida",
  "cliente_molesto",
] as const;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function modoValido(v: unknown): ModoChat {
  return v === "humano" || v === "pausado" ? v : "bot";
}

function rolValido(v: unknown): RolMensaje | null {
  return v === "cliente" || v === "empleado" || v === "humano" ? v : null;
}

function agrupar(filas: readonly Fila[] | null | undefined): Map<string, Fila[]> {
  const m = new Map<string, Fila[]>();
  for (const f of filas ?? []) {
    const c = f.chat_id as string;
    if (!c) continue;
    const lista = m.get(c);
    if (lista) lista.push(f);
    else m.set(c, [f]);
  }
  return m;
}

export type FilasEstado = {
  contactos: readonly Fila[];
  /** ed_chat_estado: empleado_id, chat_id, modo. */
  estados: readonly Fila[];
  /** ed_escalaciones SIN atender: chat_id, trigger, resumen, creado_en. */
  derivaciones: readonly Fila[];
  pagos: readonly Fila[];
  resultados: readonly Fila[];
  propuestas: readonly Fila[];
  seguimientos: readonly Fila[];
  citas: readonly Fila[];
  /** ed_escalaciones YA atendidas (chat_id, atendida_en). Opcional. */
  atendidas?: readonly Fila[];
  /** id → rol, para saber quién envía cada seguimiento y cuál es Tino. */
  empleados: readonly { id: string; rol: string; activo?: boolean }[];
};

/**
 * CON QUÉ EMPLEADO SE ABRE EL CHAT = el criterio de la bandeja (RPC de la
 * migración 293): el último empleado que habló si está activo; si no, Tino;
 * si no, el primer empleado activo. Inicio enlaza a ese empleado y toma SU
 * modo, así la fila de Inicio, la bandeja y la ficha dicen lo mismo.
 */
export function empleadoDelChat(
  ultimoEmpleadoId: string | null,
  empleados: readonly { id: string; rol: string; activo?: boolean }[],
): string | null {
  const activos = empleados.filter((e) => e.activo !== false);
  if (ultimoEmpleadoId && activos.some((e) => e.id === ultimoEmpleadoId)) return ultimoEmpleadoId;
  const orden = [...activos].sort(
    (a, b) => (a.rol === "tino" ? 0 : 1) - (b.rol === "tino" ? 0 : 1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return orden[0]?.id ?? null;
}

/**
 * MODO DEL CHAT: la fila de ed_chat_estado de ESE empleado; sin fila, `bot`
 * (igual que el `coalesce(ce.modo, 'bot')` de la RPC). El modo es por empleado
 * y la conversación por número: otro criterio haría que la ficha y la lista
 * dijeran cosas distintas.
 */
export function modoDelChat(estados: readonly Fila[], empleadoId: string | null): ModoChat {
  if (!empleadoId) return "bot";
  const fila = estados.find((e) => e.empleado_id === empleadoId);
  return fila ? modoValido(fila.modo) : "bot";
}

export function armarHechos(f: FilasEstado): Map<string, HechosContacto> {
  const rolDe = new Map(f.empleados.map((e) => [e.id, e.rol]));

  const estados = agrupar(f.estados);
  const derivaciones = agrupar(f.derivaciones);
  const pagos = agrupar(f.pagos);
  const resultados = agrupar(f.resultados);
  const propuestas = agrupar(f.propuestas);
  const seguimientos = agrupar(f.seguimientos);
  const citas = agrupar(f.citas);
  const atendidaEn = new Map<string, string>();
  for (const a of f.atendidas ?? []) {
    const c = a.chat_id as string;
    const en = str(a.atendida_en);
    if (!c || !en) continue;
    const previa = atendidaEn.get(c);
    if (!previa || Date.parse(en) > Date.parse(previa)) atendidaEn.set(c, en);
  }

  const out = new Map<string, HechosContacto>();
  for (const c of f.contactos) {
    const chatId = c.chat_id as string;
    if (!chatId) continue;
    const etapa = esEtapa(c.etapa) ? c.etapa : "nuevo";
    const empleado = empleadoDelChat(str(c.ultimo_empleado_id), f.empleados);

    out.set(chatId, {
      chatId,
      nombre: str(c.nombre),
      telefono: str(c.telefono),
      etapa,
      etapaMotivo: str(c.etapa_motivo),
      etapaEn: str(c.etapa_en),
      etapaManual: Boolean(c.etapa_manual),
      etiquetas: Array.isArray(c.etiquetas) ? (c.etiquetas as string[]) : [],
      ultimoMensajeEn: str(c.ultimo_mensaje_en),
      ultimoMensajeRol: rolValido(c.ultimo_mensaje_rol),
      primerMensajeEn: str(c.primer_mensaje_en),
      totalMensajes: typeof c.total_mensajes === "number" ? c.total_mensajes : null,
      empleadoId: empleado,
      modo: modoDelChat(estados.get(chatId) ?? [], empleado),
      derivaciones: (derivaciones.get(chatId) ?? []).map(
        (d): HechoDerivacion => ({
          trigger: str(d.trigger),
          resumen: str(d.resumen),
          creadoEn: d.creado_en as string,
        }),
      ),
      pagos: (pagos.get(chatId) ?? []).map(
        (p): HechoPago => ({
          id: p.id as string,
          estado: p.estado === "pagado" || p.estado === "anulado" ? p.estado : "pendiente",
          monto: Number(p.monto) || 0,
          creadoEn: p.creado_en as string,
          pagadoEn: str(p.pagado_en),
        }),
      ),
      resultados: (resultados.get(chatId) ?? []).map((r): HechoResultado => {
        const nota = (r.nota ?? null) as Record<string, unknown> | null;
        const puntaje = nota && typeof nota.puntaje === "number" ? nota.puntaje : null;
        return { tipo: r.tipo as string, creadoEn: r.creado_en as string, puntaje };
      }),
      propuestas: (propuestas.get(chatId) ?? [])
        .map(
          (p): HechoPropuesta => ({
            estado: (p.estado as HechoPropuesta["estado"]) ?? "propuesto",
            creadoEn: p.creado_en as string,
            resueltoEn: str(p.resuelto_en),
            motivo: str(p.motivo_juez),
          }),
        )
        .sort((a, b) => Date.parse(b.creadoEn) - Date.parse(a.creadoEn)),
      seguimientos: (seguimientos.get(chatId) ?? []).map((s): HechoSeguimiento => {
        const variables = (s.variables ?? null) as Record<string, unknown> | null;
        return {
          tipo: s.tipo as string,
          programadoPara: str(s.programado_para),
          enviadoEn: str(s.enviado_en),
          descartado: variables && typeof variables.descartado === "string" ? variables.descartado : null,
          respuestaRecibida: Boolean(s.respuesta_recibida),
          rol: rolDe.get(s.empleado_id as string) ?? null,
        };
      }),
      citas: (citas.get(chatId) ?? [])
        .filter((x) => (CITAS_ACTIVAS as readonly string[]).includes(x.estado as string))
        .map((x): HechoCita => ({ id: x.id as string, inicio: x.inicio as string, fin: x.fin as string, estado: x.estado as string })),
      datos: c.datos && typeof c.datos === "object" ? (c.datos as Record<string, unknown>) : null,
      atendidaEn: atendidaEn.get(chatId) ?? null,
    });
  }
  return out;
}
