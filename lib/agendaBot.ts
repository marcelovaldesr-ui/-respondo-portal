import { db } from "@/lib/db";
import { proximasClases, inscribirEnClase } from "@/lib/clases";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listarServicios,
  disponibilidad,
  reservarCupo,
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
  encuestaPendiente,
} from "@/lib/agendaSeguimientos";
import { detectarNota, esNotaMala, textoRespuestaEncuesta } from "@/lib/encuestaCore";
import { avisarACliente, resumirParaAviso } from "@/lib/push";
import { setModo } from "@/lib/estadoChat";
import {
  resolverContactoId,
  construirBloqueCommercePrompt,
} from "@/lib/whatsapp/commerceBookingBot";
import {
  inscribirConCredito,
  cancelarInscripcionCredito,
} from "@/lib/classes/atomicBooking";
import {
  iniciarRenovacionMembresiaFlow,
  obtenerPlanes,
} from "@/lib/memberships/membershipsCore";
import { crearHoldReserva } from "@/lib/booking/bookingAnticipos";

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
  cupos: Map<
    string,
    {
      servicioId: string;
      /** Primer profesional disponible (compatibilidad). */
      profesionalId: string;
      /** TODOS los que pueden tomar ese cupo (Fase 2): el servidor elige. */
      profesionales: { id: string; nombre: string }[];
      inicio: string;
      servicioNombre: string;
    }
  >;
  citas: Map<string, Cita>;
  servicios: Servicio[];
  /**
   * CLASES GRUPALES, con token propio (K1, K2…).
   *
   * Van en el MISMO mecanismo que los cupos 1:1 y no en uno paralelo: el modelo
   * sigue sin poder inventar nada, solo elegir de una lista que armó el código.
   * La letra distinta evita que confunda "la hora de las 19:00 con Marcelo" con
   * "la clase de pilates de las 19:00", que en un gimnasio pueden coexistir.
   */
  clases: Map<string, { claseId: string; servicioNombre: string; inicio: string; lugaresLibres: number }>;
};

export type CitaDelMotor = {
  servicio?: string | null; // token svc (solo informativo; el cupo ya lo trae)
  profesional?: string | null; // nombre pedido por el cliente («con Marcelo»)
  cupo?: string | null;     // token del cupo elegido (C1, C2, ...)
  clase?: string | null;    // token de la clase grupal elegida (K1, K2, ...)
  cita?: string | null;     // token de cita vigente (V1, ...) para reagendar/cancelar
  nombre?: string | null;
};

// ---------------------------------------------------------------------------
// Construcción del bloque (pura, testeable sin BD)
// ---------------------------------------------------------------------------

export type ServicioConCupos = {
  servicio: Servicio;
  slots: Slot[];
  /** Nombres de los profesionales elegibles, para el caso «con Marcelo». */
  profesionales?: { id: string; nombre: string }[];
};

export function construirBloqueAgenda(
  serviciosConCupos: ServicioConCupos[],
  citasVigentes: Cita[],
  nombreServicioDeCita: (c: Cita) => string,
  clasesDisponibles: {
    id: string;
    servicioNombre: string;
    inicio: string;
    lugaresLibres: number;
  }[] = [],
): {
  texto: string;
  cupos: ContextoAgenda["cupos"];
  citas: ContextoAgenda["citas"];
  clases: ContextoAgenda["clases"];
} {
  const cupos: ContextoAgenda["cupos"] = new Map();
  const citas: ContextoAgenda["citas"] = new Map();
  const clases: ContextoAgenda["clases"] = new Map();

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
    const nombreDe = new Map((sc.profesionales ?? []).map((p) => [p.id, p.nombre]));
    for (const slot of sc.slots) {
      n += 1;
      const token = `C${n}`;
      const quienes = (slot.profesionales ?? [slot.profesionalId]).map((id) => ({
        id,
        nombre: nombreDe.get(id) ?? "",
      }));
      cupos.set(token, {
        servicioId: sc.servicio.id,
        profesionalId: slot.profesionalId,
        profesionales: quienes,
        inicio: slot.inicio,
        servicioNombre: sc.servicio.nombre,
      });
      /**
       * (Fase 2) Un cupo por HORA, no por profesional. Cuando hay varios que
       * pueden atenderla, el prompt dice con quiénes: así el cliente puede
       * pedir «con Marcelo» y el token sigue siendo uno solo. Antes la misma
       * hora aparecía repetida con tokens distintos y nada que las distinguiera.
       */
      const conQuien =
        quienes.length > 1 && quienes.every((q) => q.nombre)
          ? ` (con ${quienes.map((q) => q.nombre).join(" o ")})`
          : "";
      lineasCupos.push(`- [${token}] ${sc.servicio.nombre}: ${formatearSlot(slot.inicio)}${conQuien}`);
    }
  }

  // Clases con cupo. Token K para que no se confundan con los cupos 1:1.
  const lineasClases: string[] = [];
  clasesDisponibles.forEach((c, i) => {
    const token = `K${i + 1}`;
    clases.set(token, {
      claseId: c.id,
      servicioNombre: c.servicioNombre,
      inicio: c.inicio,
      lugaresLibres: c.lugaresLibres,
    });
    const quedan = c.lugaresLibres === 1 ? "queda 1 lugar" : `quedan ${c.lugaresLibres} lugares`;
    lineasClases.push(`- [${token}] ${c.servicioNombre}: ${formatearSlot(c.inicio)} (${quedan})`);
  });

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
${lineasClases.length ? `\nClases con cupo disponible — SOLO puedes ofrecer y elegir de esta lista:\n${lineasClases.join("\n")}` : ""}
${lineasVigentes.length ? `\nCitas vigentes de ESTE cliente:\n${lineasVigentes.join("\n")}` : ""}

REGLAS DE AGENDA (se suman a tus reglas; NO reemplazan el formato de salida):
- Ofrece máximo 2–3 cupos concretos por mensaje, de la lista de arriba, mencionando día y hora.
- NUNCA inventes un horario que no esté en la lista. Si piden un día/hora que no aparece, di qué cupos cercanos SÍ tienes.
- Para cerrar una reserva necesitas: el cupo elegido + el nombre de la persona. El teléfono ya lo tienes (es este chat).
- Cuando el cliente CONFIRME un cupo y tengas su nombre, responde confirmando en tu texto y agrega en el JSON: "accion":"agendar" y "cita":{"cupo":"<token>","nombre":"<nombre>"}. NO digas que quedó agendado como definitivo hasta que el sistema confirme; di algo natural tipo "te lo dejo reservado".
- Si quiere CAMBIAR una cita vigente: elige el token de su cita y un cupo nuevo → "accion":"reagendar_cita", "cita":{"cita":"<tokenV>","cupo":"<tokenC>"}.
- Si quiere CANCELAR una cita vigente → "accion":"cancelar_cita", "cita":{"cita":"<tokenV>"}. Confirma con empatía y ofrece reagendar.
- Si la persona no da su nombre, pídelo con naturalidad antes de reservar (una sola pregunta).
- Si el cupo dice "(con X o Y)" y a la persona le da lo mismo, no preguntes con quién: reserva y el sistema asigna. Si pide a alguien en concreto, agrega "profesional":"<nombre tal como aparece>" dentro de "cita".
${lineasClases.length ? `
REGLAS DE CLASES (cuando la persona quiere una clase grupal, no una hora personal):
- Las clases son grupales: varias personas en el mismo horario. Ofrece 2-3 de la lista [K…], diciendo día, hora y cuántos lugares quedan.
- Menciona los lugares que quedan SOLO cuando son 3 o menos ("quedan 2 lugares"). Con más, no lo digas: suena a presión y no aporta.
- Para inscribir necesitas la clase elegida + el nombre. El teléfono ya lo tienes.
- Cuando confirme, agrega en el JSON: "accion":"agendar" y "cita":{"clase":"<tokenK>","nombre":"<nombre>"}.
- NUNCA prometas un lugar antes de que el sistema confirme: alguien más puede estar inscribiéndose en ese mismo momento. Di "te dejo el cupo" y espera.
- Si la clase se llenó justo, discúlpate en una línea y ofrece de inmediato otra de la lista, sin dramatizar.` : ""}`;

  return { texto, cupos, citas, clases };
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
      // (Fase 2) Se piden POCOS días y pocos cupos por día: al prompt van 8
      // como mucho, así que generar 40 era trabajo (y llamadas a Google) tirado.
      const disp = await disponibilidad(clienteId, servicio.id, {
        supa,
        dias: 14,
        maxPorDia: 3,
        maxSlots: 24,
      });
      if (!disp.ok) continue;
      conCupos.push({
        servicio,
        slots: slotsParaPrompt(disp.slots, 4, 2),
        profesionales: disp.profesionales,
      });
    }
    if (conCupos.length === 0) return null; // hay servicios pero nada calculable

    const vigentes = await citasDe(clienteId, chatId, supa);
    const nombrePorId = new Map(servicios.map((s) => [s.id, s.nombre]));

    /**
     * Clases con cupo. Si el negocio no las usa, la lista viene vacía y el
     * prompt no menciona una sola palabra de clases — una clínica sigue
     * comportándose exactamente igual que antes.
     */
    const clasesDisp = (await proximasClases(clienteId, { dias: 14, limite: 12, supa })).map(
      (c) => ({
        id: c.id,
        servicioNombre: c.servicioNombre,
        inicio: c.inicio,
        lugaresLibres: c.lugaresLibres,
      }),
    );

    const { texto, cupos, citas, clases } = construirBloqueAgenda(
      conCupos,
      vigentes,
      (c) => nombrePorId.get(c.servicio_id) ?? "tu hora",
      clasesDisp,
    );

    const bloqueCommerce = await construirBloqueCommercePrompt(clienteId, chatId, supa).catch(() => null);
    const textoFinal = bloqueCommerce ? `${texto}\n\n${bloqueCommerce}` : texto;
    return { texto: textoFinal, cupos, citas, clases, servicios };
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
  // Agendar cubre las dos formas de reservar: una hora personal (token de cupo)
  // o un lugar en una clase grupal (token de clase). Cuál de las dos es lo
  // decide después ejecutarAccionAgenda mirando qué token vino.
  if (accion === "agendar" && (cita.cupo || cita.clase)) return { op: "agendar" };
  if (accion === "reagendar_cita" && cita.cita && cita.cupo) return { op: "reagendar" };
  if (accion === "cancelar_cita" && cita.cita) return { op: "cancelar" };
  return { op: null };
}

/**
 * «Quiero con Marcelo»: el modelo manda el nombre tal como lo vio, y acá se
 * traduce a un id REAL de los que pueden tomar ese cupo. Si no calza con
 * ninguno, devuelve null y la reserva sigue como «cualquiera» — nunca se
 * inventa un profesional.
 */
export function profesionalPedido(
  disponibles: { id: string; nombre: string }[],
  pedido: string | null | undefined,
): string | null {
  const busca = String(pedido ?? "").trim().toLowerCase();
  if (!busca) return null;
  const normal = (t: string) => t.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const exacto = disponibles.find((p) => normal(p.nombre) === normal(busca));
  if (exacto) return exacto.id;
  const parcial = disponibles.find(
    (p) => p.nombre && (normal(p.nombre).startsWith(normal(busca)) || normal(busca).startsWith(normal(p.nombre))),
  );
  return parcial?.id ?? null;
}

async function cuposAlternativos(
  clienteId: string,
  servicioId: string,
  supa: SupabaseClient,
): Promise<string> {
  const disp = await disponibilidad(clienteId, servicioId, { supa, dias: 7, maxPorDia: 3, maxSlots: 9 });
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
      /**
       * INSCRIPCIÓN A UNA CLASE. Va primero porque si el modelo eligió un token
       * K, la reserva 1:1 no aplica en absoluto.
       *
       * El resultado se traduce al MISMO vocabulario que usa la agenda de horas
       * ("cupo_tomado"), así el resto del flujo —el texto de disculpa, el
       * reintento— no necesita aprender un caso nuevo.
       */
      const tokenClase = String(params.cita?.clase ?? "").trim().toUpperCase();
      if (tokenClase) {
        const clase = ctx.clases.get(tokenClase);
        if (!clase) return { tipo: "ninguna" }; // token inválido: no se inscribe a nadie
        const nombre = String(params.cita?.nombre ?? "").trim();
        if (nombre.length < 2) return { tipo: "ninguna" }; // sin nombre no se reserva

        const { data: tenantClase } = await supa
          .from("ed_clientes")
          .select("commerce_booking_v1_activo")
          .eq("id", params.clienteId)
          .maybeSingle();

        if (tenantClase?.commerce_booking_v1_activo) {
          const contactoId = await resolverContactoId(params.clienteId, params.chatId, supa);
          if (contactoId) {
            const rCred = await inscribirConCredito({
              claseId: clase.claseId,
              clienteId: params.clienteId,
              contactoId,
              nombre,
              telefono: `+${params.chatId}`,
              chatId: params.chatId,
              origen: "whatsapp",
              empleadoId: params.empleadoId,
              supa,
            });

            if (!rCred.ok) {
              if (rCred.motivo === "cupo_agotado") {
                return {
                  tipo: "cupo_tomado",
                  textoReemplazo:
                    "Uf, justo se tomaron el último lugar de esa clase mientras conversábamos 😅 " +
                    "¿Te sirve alguno de los otros horarios? Te dejo el cupo al tiro.",
                };
              }
              if (rCred.motivo === "sin_creditos" || rCred.motivo === "membresia_vencida" || rCred.motivo === "sin_membresia") {
                const planes = await obtenerPlanes(params.clienteId, supa);
                const planDefault = planes[0];
                const renovacion = planDefault
                  ? await iniciarRenovacionMembresiaFlow({
                      clienteId: params.clienteId,
                      contactoId,
                      planId: planDefault.id,
                      chatId: params.chatId,
                      supa,
                    }).catch(() => null)
                  : null;
                const link = renovacion?.ok && renovacion.url
                  ? `\n\n💳 Puedes renovar tu plan aquí: ${renovacion.url}`
                  : "";
                return {
                  tipo: "error",
                  textoExtra: `⚠️ No tienes créditos disponibles en tu membresía para reservar esta clase.${link}`,
                };
              }
              if (rCred.motivo === "ya_inscrito") {
                return {
                  tipo: "error",
                  textoExtra: "Ya te encuentras inscrito/a en esta clase. ¡Te esperamos!",
                };
              }
              return { tipo: "ninguna" };
            }

            return {
              tipo: "agendada",
              textoExtra: `✅ Listo, quedaste inscrito: ${clase.servicioNombre} · ${formatearSlot(clase.inicio)}. Te quedan ${rCred.saldoRestante} créditos disponibles 🙌`,
            };
          }
        }

        const r = await inscribirEnClase({
          claseId: clase.claseId,
          clienteId: params.clienteId,
          nombre,
          telefono: `+${params.chatId}`,
          chatId: params.chatId,
          origen: "whatsapp",
          empleadoId: params.empleadoId,
          supa,
        });

        if (!r.ok) {
          if (r.motivo !== "cupo_tomado") return { tipo: "ninguna" };
          /**
           * El último lugar se lo llevó otra persona mientras conversaban.
           * El texto lo escribe CÓDIGO y no el modelo: es el único momento en
           * que hay que desdecirse de algo que se acaba de ofrecer, y ahí no
           * conviene improvisar. Se reconoce el error, se explica en una línea
           * y se devuelve la conversación a elegir otra.
           */
          return {
            tipo: "cupo_tomado",
            textoReemplazo:
              "Uf, justo se tomaron el último lugar de esa clase mientras conversábamos 😅 " +
              "¿Te sirve alguno de los otros horarios? Te dejo el cupo al tiro.",
          };
        }
        return {
          tipo: "agendada",
          // (Fase 2) Las clases NO programan recordatorio hoy: prometerlo era
          // mentir. Se dice lo que sí es cierto.
          textoExtra: `✅ Listo, quedaste inscrito: ${clase.servicioNombre} · ${formatearSlot(clase.inicio)}. Te esperamos 🙌`,
        };
      }

      const cupo = ctx.cupos.get(String(params.cita?.cupo).trim().toUpperCase());
      if (!cupo) return { tipo: "ninguna" }; // token inválido: no se agenda nada
      const nombre = String(params.cita?.nombre ?? "").trim() || "Cliente WhatsApp";
      const preferido = profesionalPedido(cupo.profesionales, params.cita?.profesional);

      const { data: tenantSvc } = await supa
        .from("ed_clientes")
        .select("commerce_booking_v1_activo")
        .eq("id", params.clienteId)
        .maybeSingle();

      const { data: svcObj } = await supa
        .from("ed_servicios")
        .select("requiere_anticipo, anticipo_monto_fijo")
        .eq("id", cupo.servicioId)
        .maybeSingle();

      if (tenantSvc?.commerce_booking_v1_activo && svcObj?.requiere_anticipo && (svcObj.anticipo_monto_fijo ?? 0) > 0) {
        const hold = await crearHoldReserva({
          clienteId: params.clienteId,
          servicioId: cupo.servicioId,
          profesionalId: preferido ?? cupo.profesionalId,
          inicioIso: cupo.inicio,
          nombreContacto: nombre,
          telefono: `+${params.chatId}`,
          chatId: params.chatId,
          email: "cliente@respondo.cl",
          empleadoId: params.empleadoId,
          supa,
        });

        if (hold.ok && hold.checkoutUrl) {
          return {
            tipo: "agendada",
            textoExtra:
              `⏳ *Reserva en espera de confirmación:* ${cupo.servicioNombre} · ${formatearSlot(cupo.inicio)}.\n` +
              `Tienes 15 minutos para asegurar tu cupo abonando el anticipo de $${(hold.montoAnticipo ?? 0).toLocaleString("es-CL")} CLP:\n` +
              `👉 ${hold.checkoutUrl}\n` +
              `¡Apenas pagues, tu cita quedará confirmada al 100%! 🙌`,
          };
        }
      }

      /**
       * (Fase 2) Pasa por `reservarCupo`: revalida el cupo contra la agenda de
       * AHORA, elige profesional cuando da lo mismo y reintenta con el
       * siguiente si justo se lo tomaron. Antes se insertaba directo con el
       * profesional que venía pegado al token.
       */
      const r = await reservarCupo(
        {
          clienteId: params.clienteId,
          servicioId: cupo.servicioId,
          profesionalId: preferido,
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

      // Se mantiene al profesional de la cita si puede tomar la hora nueva;
      // si no, se asigna a quien sí esté libre (antes se movía a ciegas).
      const puedeElMismo = cupo.profesionales.some((p) => p.id === vigente.profesional_id);
      const nuevoProf = puedeElMismo
        ? (vigente.profesional_id as string)
        : (profesionalPedido(cupo.profesionales, params.cita?.profesional) ?? cupo.profesionales[0]?.id ?? null);
      const r = await reagendar(params.clienteId, vigente.id, cupo.inicio, supa, { profesionalId: nuevoProf });
      if (r.ok) {
        await anularSeguimientosDeCita(vigente.id, params.clienteId, supa);
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

    if (vigente.clase_id) {
      const contactoId = await resolverContactoId(params.clienteId, params.chatId, supa);
      if (contactoId) {
        const rCred = await cancelarInscripcionCredito({
          clienteId: params.clienteId,
          contactoId,
          citaId: vigente.id,
          supa,
        });
        if (rCred.ok) {
          await anularSeguimientosDeCita(vigente.id, params.clienteId, supa);
          const dev = rCred.creditoDevuelto
            ? `\nComo cancelaste con más de 2 horas de anticipación, tu crédito fue devuelto a tu saldo (+1). Te quedan ${rCred.saldoResultante ?? 0} créditos.`
            : `\nAl cancelar con menos de 2 horas de anticipación, las políticas no permiten reembolsar el crédito utilizado.`;
          return {
            tipo: "cancelada",
            textoExtra: `Tu inscripción a la clase del ${formatearSlot(vigente.inicio)} quedó cancelada ✅${dev}`,
          };
        }
      }
    }

    const r = await cambiarEstado(params.clienteId, vigente.id, "cancelada", supa);
    if (!r.ok) return { tipo: "error" };
    await anularSeguimientosDeCita(vigente.id, params.clienteId, supa);
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

/**
 * Si Vera tiene una encuesta postventa pendiente en este chat y el cliente
 * contestó con una nota clara de 1 a 5, cierra el círculo POR CÓDIGO — el
 * modelo no participa. Devuelve null si no aplica (nada cambia respecto a hoy;
 * Vera sigue la conversación normal).
 *
 * Tres efectos, en este orden:
 *  1. Escribe `ed_resultados` (tipo "encuesta_respondida") — es la fila que
 *     hoy simplemente no existe (bloqueo 3 de la auditoría del 26-ago).
 *  2. Cierra la cita como "completada" — es EL cierre real del bloqueo 1: solo
 *     pasa cuando el cliente confirma que lo atendieron, nunca porque la hora
 *     ya pasó (eso infla el retorno y esconde la inasistencia real).
 *  3. Si la nota es mala (1-3), deriva a una persona de inmediato: silencia a
 *     Vera en ese chat, registra la escalación y avisa al teléfono del equipo
 *     — igual que cualquier otra escalación, pero garantizado en vez de
 *     depender de que el modelo recuerde la regla.
 *
 * Best-effort en cada paso: si uno falla, los demás igual se intentan y el
 * cliente de todas formas recibe una respuesta humana. Nunca deja al cliente
 * sin nada por un error de base de datos.
 */
export async function encuestaRapida(
  clienteId: string,
  empleadoId: string,
  chatId: string,
  textoEntrante: string,
  supa: SupabaseClient = db(),
): Promise<string | null> {
  try {
    const nota = detectarNota(textoEntrante);
    if (nota === null) return null;
    const pend = await encuestaPendiente(clienteId, chatId, supa);
    if (!pend) return null;

    await supa
      .from("ed_resultados")
      .insert({
        empleado_id: empleadoId,
        chat_id: chatId,
        tipo: "encuesta_respondida",
        nota: { puntaje: nota, cita_id: pend.citaId },
        detectado_por: "bot",
      })
      .then(() => undefined, () => undefined);

    await cambiarEstado(clienteId, pend.citaId, "completada", supa).catch(() => ({ ok: false as const }));

    if (esNotaMala(nota)) {
      await setModo(empleadoId, chatId, "humano", supa).catch(() => undefined);
      await supa
        .from("ed_escalaciones")
        .insert({
          empleado_id: empleadoId,
          chat_id: chatId,
          trigger: "sentimiento_negativo",
          resumen: `Contestó la encuesta postventa con nota ${nota}/5. Conviene llamarlo.`,
          notificado_a: [],
        })
        .then(() => undefined, () => undefined);
      // Mismo tipo que usa el choke point de responderBot.ts para cualquier
      // escalación con trigger "sentimiento_negativo" — este camino no pasa
      // por ahí (es un atajo por código, sin modelo), así que se escribe acá.
      await supa
        .from("ed_resultados")
        .insert({
          empleado_id: empleadoId,
          chat_id: chatId,
          tipo: "cliente_molesto",
          nota: { resumen: `Encuesta postventa con nota ${nota}/5` },
          detectado_por: "bot",
        })
        .then(() => undefined, () => undefined);
      void (async () => {
        const { data: c } = await supa
          .from("ed_contactos")
          .select("nombre")
          .eq("cliente_id", clienteId)
          .eq("chat_id", chatId)
          .maybeSingle();
        const quien = (c?.nombre as string | null) || `+${chatId}`;
        await avisarACliente(clienteId, {
          titulo: `${quien} quedó insatisfecho (nota ${nota}/5)`,
          cuerpo: resumirParaAviso("Contestó la encuesta postventa con una nota baja. Conviene llamarlo."),
          url: `/conversaciones?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`,
          tag: `chat:${chatId}`,
        });
      })().catch(() => undefined);
    }

    return textoRespuestaEncuesta(nota);
  } catch {
    return null;
  }
}
