import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarServicios,
  disponibilidad,
  crearCita,
  reagendar,
  cambiarEstado,
  citasDe,
  type Servicio,
  type Cita,
} from "@/lib/agenda";
import { slotsParaPrompt, formatearSlot, type Slot } from "@/lib/agendaCore";
import {
  programarSeguimientosCita,
  anularSeguimientosDeCita,
  confirmacionPendiente,
} from "@/lib/agendaSeguimientos";

/**
 * PUENTE ENTRE LOS EMPLEADOS IA Y LA AGENDA (F2).
 *
 * Diseño (SPEC_MODULO_AGENDA §3): NO hay function-calling. Se inyecta un
 * bloque "AGENDA REAL" al prompt con cupos REALES identificados por tokens
 * cortos, y el modelo solo puede ELEGIR un token — nunca inventar un horario.
 * La ejecución (crear/reagendar/cancelar la cita) y el texto de confirmación
 * final los hace CÓDIGO, con la garantía anti doble-reserva de Postgres.
 *
 * TOTALMENTE INOFENSIVO PARA LOS CLIENTES SIN AGENDA (ej. Impresora Color):
 * `contextoAgenda` devuelve null si el cliente no tiene servicios activos (o
 * si la migración 220 no está aplicada), y en ese caso responderBot no cambia
 * absolutamente nada de su comportamiento actual.
 */

export type ContextoAgenda = {
  texto: string; // bloque para el prompt
  cupos: Map<string, { servicioId: string; profesionalId: string; inicio: string; servicioNombre: string }>;
  citas: Map<string, Cita>;
  servicios: Servicio[];
};

export type CitaDelMotor = {
  servicio?: string | null; // token svc (solo informativo; el cupo ya lo trae)
  cupo?: string | null;     // token del cupo elegido (C1, C2, ...)
  cita?: string | null;     // token de cita vigente (V1, ...) para reagendar/cancelar
  nombre?: string | null;
};

// ---------------------------------------------------------------------------
// Construcción del bloque (pura, testeable sin BD)
// ---------------------------------------------------------------------------

export type ServicioConCupos = { servicio: Servicio; slots: Slot[] };

export function construirBloqueAgenda(
  serviciosConCupos: ServicioConCupos[],
  citasVigentes: Cita[],
  nombreServicioDeCita: (c: Cita) => string,
): { texto: string; cupos: ContextoAgenda["cupos"]; citas: ContextoAgenda["citas"] } {
  const cupos: ContextoAgenda["cupos"] = new Map();
  const citas: ContextoAgenda["citas"] = new Map();

  const lineasServicios: string[] = [];
  const lineasCupos: string[] = [];
  let n = 0;

  for (const sc of serviciosConCupos) {
    const precio =
      sc.servicio.precio_clp != null
        ? `$${sc.servicio.precio_clp.toLocaleString("es-CL")}`
        : "valor según evaluación";
    lineasServicios.push(
      `- ${sc.servicio.nombre} · ${sc.servicio.duracion_min} min · ${precio}`,
    );
    for (const slot of sc.slots) {
      n += 1;
      const token = `C${n}`;
      cupos.set(token, {
        servicioId: sc.servicio.id,
        profesionalId: slot.profesionalId,
        inicio: slot.inicio,
        servicioNombre: sc.servicio.nombre,
      });
      lineasCupos.push(`- [${token}] ${sc.servicio.nombre}: ${formatearSlot(slot.inicio)}`);
    }
  }

  const lineasVigentes: string[] = [];
  citasVigentes.forEach((c, i) => {
    const token = `V${i + 1}`;
    citas.set(token, c);
    lineasVigentes.push(
      `- [${token}] ${nombreServicioDeCita(c)}: ${formatearSlot(c.inicio)} (${c.estado})`,
    );
  });

  const texto = `## AGENDA REAL (usa SOLO estos datos para agendar)
Servicios reservables:
${lineasServicios.join("\n")}

Cupos disponibles (hora de Chile) — SOLO puedes ofrecer y elegir de esta lista:
${lineasCupos.length ? lineasCupos.join("\n") : "- (por ahora no hay cupos disponibles: ofrece derivar con el equipo)"}
${lineasVigentes.length ? `\nCitas vigentes de ESTE cliente:\n${lineasVigentes.join("\n")}` : ""}

REGLAS DE AGENDA (se suman a tus reglas; NO reemplazan el formato de salida):
- Ofrece máximo 2–3 cupos concretos por mensaje, de la lista de arriba, mencionando día y hora.
- NUNCA inventes un horario que no esté en la lista. Si piden un día/hora que no aparece, di qué cupos cercanos SÍ tienes.
- Para cerrar una reserva necesitas: el cupo elegido + el nombre de la persona. El teléfono ya lo tienes (es este chat).
- Cuando el cliente CONFIRME un cupo y tengas su nombre, responde confirmando en tu texto y agrega en el JSON: "accion":"agendar" y "cita":{"cupo":"<token>","nombre":"<nombre>"}. NO digas que quedó agendado como definitivo hasta que el sistema confirme; di algo natural tipo "te lo dejo reservado".
- Si quiere CAMBIAR una cita vigente: elige el token de su cita y un cupo nuevo → "accion":"reagendar_cita", "cita":{"cita":"<tokenV>","cupo":"<tokenC>"}.
- Si quiere CANCELAR una cita vigente → "accion":"cancelar_cita", "cita":{"cita":"<tokenV>"}. Confirma con empatía y ofrece reagendar.
- Si la persona no da su nombre, pídelo con naturalidad antes de reservar (una sola pregunta).`;

  return { texto, cupos, citas };
}

// ---------------------------------------------------------------------------
// Contexto (con BD) — null = cliente sin agenda: cero cambios de conducta
// ---------------------------------------------------------------------------

const MAX_SERVICIOS_EN_PROMPT = 4;

export async function contextoAgenda(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<ContextoAgenda | null> {
  try {
    const servicios = await listarServicios(clienteId, supa);
    if (servicios.length === 0) return null; // sin agenda configurada (o sin migración 220)

    const conCupos: ServicioConCupos[] = [];
    for (const servicio of servicios.slice(0, MAX_SERVICIOS_EN_PROMPT)) {
      const disp = await disponibilidad(clienteId, servicio.id, { supa, maxSlots: 40 });
      if (!disp.ok) continue;
      conCupos.push({ servicio, slots: slotsParaPrompt(disp.slots, 4, 2) });
    }
    if (conCupos.length === 0) return null; // hay servicios pero nada calculable

    const vigentes = await citasDe(clienteId, chatId, supa);
    const nombrePorId = new Map(servicios.map((s) => [s.id, s.nombre]));

    const { texto, cupos, citas } = construirBloqueAgenda(
      conCupos,
      vigentes,
      (c) => nombrePorId.get(c.servicio_id) ?? "tu hora",
    );
    return { texto, cupos, citas, servicios };
  } catch (e) {
    // Migración no aplicada u otro problema: la agenda jamás rompe al bot.
    console.error("[agendaBot] contexto falló (se sigue sin agenda):", (e as Error).message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Ejecución de la acción que eligió el modelo
// ---------------------------------------------------------------------------

export type ResultadoAgendaBot =
  | { tipo: "ninguna" }
  | { tipo: "agendada"; textoExtra: string }
  | { tipo: "reagendada"; textoExtra: string }
  | { tipo: "cancelada"; textoExtra: string }
  | { tipo: "cupo_tomado"; textoReemplazo: string }
  | { tipo: "error"; textoExtra?: string };

/** Interpreta la salida del motor (pura, testeable). */
export function interpretarAccionAgenda(
  accion: string | null | undefined,
  cita: CitaDelMotor | null | undefined,
): { op: "agendar" | "reagendar" | "cancelar" | null } {
  if (!cita) return { op: null };
  if (accion === "agendar" && cita.cupo) return { op: "agendar" };
  if (accion === "reagendar_cita" && cita.cita && cita.cupo) return { op: "reagendar" };
  if (accion === "cancelar_cita" && cita.cita) return { op: "cancelar" };
  return { op: null };
}

async function cuposAlternativos(
  clienteId: string,
  servicioId: string,
  supa: SupabaseClient,
): Promise<string> {
  const disp = await disponibilidad(clienteId, servicioId, { supa, maxSlots: 10 });
  if (!disp.ok || disp.slots.length === 0) return "";
  return slotsParaPrompt(disp.slots, 3, 2)
    .map((s) => `• ${formatearSlot(s.inicio)}`)
    .join("\n");
}

export async function ejecutarAccionAgenda(params: {
  ctx: ContextoAgenda;
  accion: string | null | undefined;
  cita: CitaDelMotor | null | undefined;
  clienteId: string;
  empleadoId: string;
  chatId: string;
  nombreNegocio?: string;
  supa?: SupabaseClient;
}): Promise<ResultadoAgendaBot> {
  const supa = params.supa ?? db();
  const { ctx } = params;
  const { op } = interpretarAccionAgenda(params.accion, params.cita);
  if (!op) return { tipo: "ninguna" };

  try {
    if (op === "agendar") {
      const cupo = ctx.cupos.get(String(params.cita?.cupo).trim().toUpperCase());
      if (!cupo) return { tipo: "ninguna" }; // token inválido: no se agenda nada
      const nombre = String(params.cita?.nombre ?? "").trim() || "Cliente WhatsApp";

      const r = await crearCita(
        {
          clienteId: params.clienteId,
          servicioId: cupo.servicioId,
          profesionalId: cupo.profesionalId,
          inicioIso: cupo.inicio,
          nombreContacto: nombre,
          chatId: params.chatId,
          origen: "whatsapp",
          empleadoId: params.empleadoId,
        },
        supa,
      );

      if (r.ok) {
        // Seguimientos (F3) + resultado para las métricas — best-effort.
        await programarSeguimientosCita({
          cita: r.cita,
          servicioNombre: cupo.servicioNombre,
          clienteId: params.clienteId,
          supa,
        }).catch(() => 0);
        await supa
          .from("ed_resultados")
          .insert({
            empleado_id: params.empleadoId,
            chat_id: params.chatId,
            tipo: "agendamiento",
            nota: { cita_id: r.cita.id, servicio: cupo.servicioNombre },
            detectado_por: "bot",
          })
          .then(() => undefined, () => undefined);
        return {
          tipo: "agendada",
          textoExtra: `✅ Listo, quedó reservado: ${cupo.servicioNombre} · ${formatearSlot(cupo.inicio)}. Te llegará un recordatorio por aquí 🙌`,
        };
      }
      if (r.motivo === "cupo_tomado") {
        const alternativas = await cuposAlternativos(params.clienteId, cupo.servicioId, supa);
        return {
          tipo: "cupo_tomado",
          textoReemplazo: alternativas
            ? `¡Uy! Ese cupo se acaba de tomar 🙈 Te dejo los más cercanos que sí están libres:\n${alternativas}\n¿Cuál te acomoda?`
            : `¡Uy! Ese cupo se acaba de tomar 🙈 Déjame revisar con el equipo qué otros horarios tenemos y te escribo altiro.`,
        };
      }
      return { tipo: "error" };
    }

    if (op === "reagendar") {
      const vigente = ctx.citas.get(String(params.cita?.cita).trim().toUpperCase());
      const cupo = ctx.cupos.get(String(params.cita?.cupo).trim().toUpperCase());
      if (!vigente || !cupo) return { tipo: "ninguna" };

      const r = await reagendar(params.clienteId, vigente.id, cupo.inicio, supa);
      if (r.ok) {
        await anularSeguimientosDeCita(vigente.id, supa);
        await programarSeguimientosCita({
          cita: r.cita,
          servicioNombre: cupo.servicioNombre,
          clienteId: params.clienteId,
          supa,
        }).catch(() => 0);
        return {
          tipo: "reagendada",
          textoExtra: `✅ Cambio listo: quedó para ${formatearSlot(cupo.inicio)}.`,
        };
      }
      if (r.motivo === "cupo_tomado") {
        const alternativas = await cuposAlternativos(params.clienteId, vigente.servicio_id, supa);
        return {
          tipo: "cupo_tomado",
          textoReemplazo: alternativas
            ? `¡Uy! Ese horario se acaba de ocupar 🙈 Estos sí están libres:\n${alternativas}\n¿Cuál prefieres? Tu hora actual sigue reservada mientras tanto.`
            : `¡Uy! Ese horario se acaba de ocupar 🙈 Tu hora actual sigue reservada; te propongo alternativas en un momento.`,
        };
      }
      return { tipo: "error" };
    }

    // cancelar
    const vigente = ctx.citas.get(String(params.cita?.cita).trim().toUpperCase());
    if (!vigente) return { tipo: "ninguna" };
    const r = await cambiarEstado(params.clienteId, vigente.id, "cancelada", supa);
    if (!r.ok) return { tipo: "error" };
    await anularSeguimientosDeCita(vigente.id, supa);
    return {
      tipo: "cancelada",
      textoExtra: `Tu hora del ${formatearSlot(vigente.inicio)} quedó cancelada ✅ Cuando quieras retomamos.`,
    };
  } catch (e) {
    console.error("[agendaBot] ejecución falló:", (e as Error).message);
    return { tipo: "error" };
  }
}

// ---------------------------------------------------------------------------
// Confirmación rápida por texto ("SÍ") — sin pasar por el modelo
// ---------------------------------------------------------------------------

const REGEX_CONFIRMA = /^\s*(s[ií]+|si po|confirmo|confirmado|ok(ey)?|dale|listo|vale|de acuerdo|voy|ah[ií] estar[eé])\s*[.!]*\s*$/i;

/** ¿El texto es una confirmación corta e inequívoca? (pura, testeable) */
export function esTextoDeConfirmacion(texto: string): boolean {
  return texto.length <= 30 && REGEX_CONFIRMA.test(texto.trim());
}

/**
 * Si hay una confirmación de cita pendiente en este chat y el cliente
 * respondió "sí" (o similar), confirma la cita POR CÓDIGO y devuelve el texto
 * de respuesta — el modelo no participa. Devuelve null si no aplica (y el
 * flujo sigue 100% igual que hoy).
 */
export async function confirmacionRapida(
  clienteId: string,
  chatId: string,
  textoEntrante: string,
  supa: SupabaseClient = db(),
): Promise<string | null> {
  try {
    if (!esTextoDeConfirmacion(textoEntrante)) return null;
    const pend = await confirmacionPendiente(clienteId, chatId, supa);
    if (!pend) return null;
    const r = await cambiarEstado(clienteId, pend.citaId, "confirmada", supa);
    if (!r.ok) return null;
    return `¡Perfecto! Tu hora del ${formatearSlot(pend.inicio)} quedó confirmada ✅ Te esperamos 🙌`;
  } catch {
    return null;
  }
}
