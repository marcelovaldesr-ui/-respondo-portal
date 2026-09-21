import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { proximasClases } from "@/lib/clases";
import {
  inscribirConCredito,
  cancelarInscripcionCredito,
} from "@/lib/classes/atomicBooking";
import {
  obtenerMembresiaActiva,
  iniciarRenovacionMembresiaFlow,
  obtenerPlanes,
  type Membresia,
} from "@/lib/memberships/membershipsCore";
import { crearHoldReserva } from "@/lib/booking/bookingAnticipos";
import { formatearSlot } from "@/lib/agendaCore";

export type IntencionCommerce =
  | "CONSULTAR_CLASES_CUPOS"
  | "CONSULTAR_CREDITOS"
  | "RESERVAR_CLASE"
  | "CANCELAR_RESERVA"
  | "RENOVAR_MEMBRESIA"
  | "PAGAR_ANTICIPO";

export type ParametrosAccionCommerce = {
  clienteId: string;
  empleadoId?: string;
  chatId: string;
  texto: string;
  nombreContacto?: string;
  supa?: SupabaseClient;
  claseId?: string;
  citaId?: string;
  planId?: string;
  servicioId?: string;
  profesionalId?: string;
  inicioIso?: string;
};

export type ResultadoCommerceWhatsApp = {
  accion: IntencionCommerce;
  ejecutado: boolean;
  respuestaTexto: string;
  datosExtra?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Detección de intenciones determinísticas
// ---------------------------------------------------------------------------

const REGEX_CONSULTAR_CREDITOS =
  /(?:cu[aá]nt[ao]s?\s+(?:clases?|sesiones?|cr[eé]ditos?)\s+(?:me\s+quedan?|tengo)|mis?\s+cr[eé]ditos?|mi\s+saldo|saldo\s+de\s+(?:mis\s+)?(?:clases?|cr[eé]ditos?)|estado\s+de\s+mi\s+membres[ií]a|consultar\s+cr[eé]ditos?|me\s+quedan\s+clases)/i;

const REGEX_RENOVAR_MEMBRESIA =
  /(?:renovar\s+(?:mi\s+)?(?:plan|membres[ií]a|suscripci[oó]n|pase)|comprar\s+(?:m[aá]s\s+)?(?:clases?|cr[eé]ditos?|plan)|cargar\s+cr[eé]ditos?|recargar\s+clases?|pagar\s+(?:mi\s+)?plan|link\s+(?:de\s+)?pago\s+(?:del\s+)?plan)/i;

const REGEX_CONSULTAR_CLASES =
  /(?:hay\s+(?:clases?|cupos?|pilates|spinning|crossfit|yoga|entrenamiento|clase)|clases?\s+disponibles?|horarios?\s+de\s+clases?|qu[eé]\s+clases?\s+hay|pr[oó]ximas?\s+clases?|quedan?\s+cupos?|clases?\s+ma[ñn]ana|clases?\s+hoy)/i;

const REGEX_CANCELAR_RESERVA =
  /(?:no\s+podr[eé]\s+ir|cancela(?:r|me)?\s+(?:mi\s+)?(?:reserva|clase|cita|hora)|no\s+voy\s+a\s+poder\s+asistir|no\s+alcanzo\s+a\s+llegar|dar\s+de\s+baja\s+mi\s+reserva)/i;

const REGEX_RESERVAR_CLASE =
  /(?:reserva(?:r|me)?|inscr[ií]be(?:r|me)?|an[oó]ta(?:r|me)?|aseg[uú]ra(?:r|me)?)\s+(?:en\s+)?(?:la\s+(?:de\s+|clase\s+de\s+)?|para\s+)?/i;

const REGEX_PAGAR_ANTICIPO =
  /(?:pagar\s+(?:el\s+)?anticipo|link\s+(?:de\s+)?anticipo|pagar\s+la\s+reserva|comprobante\s+de\s+anticipo)/i;

/**
 * Detecta si el texto entrante coincide de forma determinística con una de las 6 intenciones de Commerce.
 */
export function detectarIntencionCommerce(texto: string): IntencionCommerce | null {
  const t = texto.trim();
  if (t.length < 3) return null;

  // Orden de precedencia estricto para evitar falsos positivos
  if (REGEX_CANCELAR_RESERVA.test(t)) return "CANCELAR_RESERVA";
  if (REGEX_RENOVAR_MEMBRESIA.test(t)) return "RENOVAR_MEMBRESIA";
  if (REGEX_CONSULTAR_CREDITOS.test(t)) return "CONSULTAR_CREDITOS";
  if (REGEX_PAGAR_ANTICIPO.test(t)) return "PAGAR_ANTICIPO";
  if (REGEX_RESERVAR_CLASE.test(t)) return "RESERVAR_CLASE";
  if (REGEX_CONSULTAR_CLASES.test(t)) return "CONSULTAR_CLASES_CUPOS";

  return null;
}

// ---------------------------------------------------------------------------
// Helpers de resolución y formateo
// ---------------------------------------------------------------------------

export async function resolverContactoId(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<string | null> {
  const { data } = await supa
    .from("ed_contactos")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();

  return (data?.id as string) ?? null;
}

async function obtenerNombrePlan(
  clienteId: string,
  planId: string,
  supa: SupabaseClient,
): Promise<string> {
  const { data } = await supa
    .from("ed_planes")
    .select("nombre")
    .eq("id", planId)
    .eq("cliente_id", clienteId)
    .maybeSingle();

  return (data?.nombre as string) ?? "Plan de Membresía";
}

function formatearFechaLegible(fechaIso: string): string {
  try {
    const d = new Date(fechaIso);
    return d.toLocaleDateString("es-CL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Santiago",
    });
  } catch {
    return fechaIso;
  }
}

// ---------------------------------------------------------------------------
// Ejecución de acciones determinísticas
// ---------------------------------------------------------------------------

export async function ejecutarAccionCommerce(
  params: ParametrosAccionCommerce,
): Promise<ResultadoCommerceWhatsApp> {
  const supa = params.supa ?? db();
  const intencion = detectarIntencionCommerce(params.texto) ?? "CONSULTAR_CREDITOS";
  const contactoId = await resolverContactoId(params.clienteId, params.chatId, supa);

  switch (intencion) {
    case "CONSULTAR_CREDITOS": {
      if (!contactoId) {
        return {
          accion: "CONSULTAR_CREDITOS",
          ejecutado: true,
          respuestaTexto:
            "Aún no tienes una membresía o plan activo asociado a este número de teléfono.\n\n" +
            "Si deseas adquirir un plan de clases, ¡avísame y te cuento las opciones disponibles! 🙌",
        };
      }

      const membresia: Membresia | null = await obtenerMembresiaActiva(
        params.clienteId,
        contactoId,
        supa,
      );

      if (!membresia) {
        return {
          accion: "CONSULTAR_CREDITOS",
          ejecutado: true,
          respuestaTexto:
            "Aún no tienes una membresía o plan activo asociado a este número de teléfono.\n\n" +
            "Si deseas adquirir un plan de clases, ¡avísame y te cuento las opciones disponibles! 🙌",
        };
      }

      const planNombre = await obtenerNombrePlan(params.clienteId, membresia.plan_id, supa);

      if (membresia.creditos_saldo > 0) {
        const clasesTexto = membresia.creditos_saldo === 1 ? "1 clase disponible" : `${membresia.creditos_saldo} clases disponibles`;
        return {
          accion: "CONSULTAR_CREDITOS",
          ejecutado: true,
          respuestaTexto:
            `🎟️ *Estado de tu Membresía:*\n` +
            `• *Plan:* ${planNombre}\n` +
            `• *Créditos:* ${clasesTexto}\n` +
            `• *Vigencia hasta:* ${formatearFechaLegible(membresia.fin)}\n\n` +
            `¿Deseas que te reserve un cupo en alguna de nuestras próximas clases?`,
          datosExtra: { saldo: membresia.creditos_saldo, plan: planNombre },
        };
      }

      // Saldo 0: ofrecer renovación con link Flow
      const renovacion = await iniciarRenovacionMembresiaFlow({
        clienteId: params.clienteId,
        contactoId,
        planId: membresia.plan_id,
        chatId: params.chatId,
        supa,
      }).catch(() => null);

      if (renovacion?.ok && renovacion.url) {
        return {
          accion: "CONSULTAR_CREDITOS",
          ejecutado: true,
          respuestaTexto:
            `🎟️ *Estado de tu Membresía:*\n` +
            `Actualmente *no te quedan créditos disponibles* en tu plan ${planNombre}.\n\n` +
            `💳 Para renovar y seguir reservando, puedes pagar aquí vía Flow / Webpay:\n` +
            `👉 ${renovacion.url}\n\n` +
            `¡Apenas se confirme tu pago, tus créditos se habilitarán automáticamente! 🙌`,
          datosExtra: { saldo: 0, urlPago: renovacion.url },
        };
      }

      return {
        accion: "CONSULTAR_CREDITOS",
        ejecutado: true,
        respuestaTexto:
          `🎟️ *Estado de tu Membresía:*\n` +
          `Actualmente *no te quedan créditos disponibles* en tu plan ${planNombre}.\n\n` +
          `Si deseas renovar tu membresía, dime y te paso las opciones para reactivarla de inmediato.`,
        datosExtra: { saldo: 0 },
      };
    }

    case "CONSULTAR_CLASES_CUPOS": {
      const clases = await proximasClases(params.clienteId, { dias: 7, limite: 6, supa });
      if (clases.length === 0) {
        return {
          accion: "CONSULTAR_CLASES_CUPOS",
          ejecutado: true,
          respuestaTexto:
            "Por el momento no tenemos clases con cupos disponibles para los próximos días. 📅\n\n" +
            "¿Te gustaría que te avisemos en cuanto se abra un nuevo horario?",
        };
      }

      const lineas = clases.map((c) => {
        const quedan = c.lugaresLibres === 1 ? "queda 1 cupo" : `quedan ${c.lugaresLibres} cupos`;
        return `• *${c.servicioNombre}*: ${formatearSlot(c.inicio)} (${quedan})`;
      });

      return {
        accion: "CONSULTAR_CLASES_CUPOS",
        ejecutado: true,
        respuestaTexto:
          `📅 *Próximas clases disponibles:*\n\n` +
          lineas.join("\n") +
          `\n\n¿Cuál horario te acomoda para reservarte un cupo?`,
        datosExtra: { totalClases: clases.length },
      };
    }

    case "RESERVAR_CLASE": {
      if (!contactoId) {
        return {
          accion: "RESERVAR_CLASE",
          ejecutado: false,
          respuestaTexto:
            "Para reservar una clase con tus créditos necesitamos asociar tu perfil. ¿Me podrías indicar tu nombre completo por favor?",
        };
      }

      // Si no viene claseId explícito, buscar la primera clase disponible
      let targetClaseId = params.claseId;
      if (!targetClaseId) {
        const proximas = await proximasClases(params.clienteId, { dias: 7, limite: 1, supa });
        if (proximas.length > 0) {
          targetClaseId = proximas[0].id;
        }
      }

      if (!targetClaseId) {
        return {
          accion: "RESERVAR_CLASE",
          ejecutado: false,
          respuestaTexto:
            "No encontré clases disponibles con cupo en este momento. ¿Te gustaría revisar los horarios de la próxima semana?",
        };
      }

      const r = await inscribirConCredito({
        clienteId: params.clienteId,
        contactoId,
        claseId: targetClaseId,
        nombre: params.nombreContacto ?? "Cliente WhatsApp",
        telefono: `+${params.chatId}`,
        chatId: params.chatId,
        origen: "whatsapp",
        empleadoId: params.empleadoId,
        supa,
      });

      if (r.ok) {
        return {
          accion: "RESERVAR_CLASE",
          ejecutado: true,
          respuestaTexto:
            `✅ *¡Inscripción confirmada con éxito!*\n` +
            `• *Horario:* Reserva asegurada\n` +
            `• *Crédito consumido:* 1 clase (te quedan *${r.saldoRestante} créditos*).\n\n` +
            `¡Te esperamos con todo el ánimo! 🙌`,
          datosExtra: { citaId: r.citaId, saldoRestante: r.saldoRestante },
        };
      }

      if (r.motivo === "sin_creditos" || r.motivo === "membresia_vencida" || r.motivo === "sin_membresia") {
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

        const linkTexto = renovacion?.ok && renovacion.url
          ? `\n\n💳 Puedes renovar tu membresía aquí:\n👉 ${renovacion.url}\n\nApenas pagues, tu crédito se cargará al instante.`
          : `\n\nSi deseas renovar tu plan de clases, avísame y te ayudo al tiro.`;

        return {
          accion: "RESERVAR_CLASE",
          ejecutado: false,
          respuestaTexto: `⚠️ No tienes créditos vigentes disponibles para reservar esta clase.${linkTexto}`,
          datosExtra: { motivo: r.motivo, urlPago: renovacion?.ok ? renovacion.url : undefined },
        };
      }

      if (r.motivo === "cupo_agotado") {
        return {
          accion: "RESERVAR_CLASE",
          ejecutado: false,
          respuestaTexto:
            "¡Uf! Se acaban de agotar los cupos para esa clase 😅. " +
            "¿Te acomoda revisar alguno de los otros horarios disponibles?",
          datosExtra: { motivo: "cupo_agotado" },
        };
      }

      if (r.motivo === "ya_inscrito") {
        return {
          accion: "RESERVAR_CLASE",
          ejecutado: false,
          respuestaTexto: "Ya te encuentras inscrito/a en esta sesión. ¡Te esperamos!",
          datosExtra: { motivo: "ya_inscrito" },
        };
      }

      return {
        accion: "RESERVAR_CLASE",
        ejecutado: false,
        respuestaTexto:
          "Hubo un inconveniente al procesar tu inscripción. Por favor intenta en unos momentos o consúltanos directamente.",
        datosExtra: { motivo: r.motivo },
      };
    }

    case "CANCELAR_RESERVA": {
      // Buscar la cita más próxima del contacto
      const ahoraIso = new Date().toISOString();
      const { data: citas } = await supa
        .from("ed_citas")
        .select("id, inicio, servicio_id, clase_id, estado, ed_servicios(nombre)")
        .eq("cliente_id", params.clienteId)
        .or(`chat_id.eq.${params.chatId}${contactoId ? `,contacto_id.eq.${contactoId}` : ""}`)
        .gte("inicio", ahoraIso)
        .in("estado", ["agendada", "confirmada", "reagendada"])
        .order("inicio", { ascending: true })
        .limit(1);

      const cita = citas?.[0];
      if (!cita) {
        return {
          accion: "CANCELAR_RESERVA",
          ejecutado: false,
          respuestaTexto:
            "No encontré ninguna reserva o cita activa próxima registrada a este número. " +
            "¿Deseas que lo revise con el equipo?",
        };
      }

      if (cita.clase_id && contactoId) {
        const r = await cancelarInscripcionCredito({
          clienteId: params.clienteId,
          contactoId,
          citaId: cita.id,
          motivo: "cancelacion_cliente_whatsapp",
          supa,
        });

        if (r.ok && r.creditoDevuelto) {
          return {
            accion: "CANCELAR_RESERVA",
            ejecutado: true,
            respuestaTexto:
              `✅ *Tu reserva fue cancelada con éxito.*\n\n` +
              `Como cancelaste con más de 2 horas de anticipación, tu crédito fue devuelto a tu cuenta (+1 clase).\n` +
              `🎟️ *Saldo actual:* ${r.saldoResultante ?? 0} créditos disponibles.\n\n` +
              `¡Esperamos verte en tu próxima sesión! 🙌`,
            datosExtra: { devuelto: true, saldo: r.saldoResultante },
          };
        } else if (r.ok && !r.creditoDevuelto) {
          const mem = await obtenerMembresiaActiva(params.clienteId, contactoId, supa);
          const saldoActual = r.saldoResultante ?? mem?.creditos_saldo ?? 0;
          return {
            accion: "CANCELAR_RESERVA",
            ejecutado: true,
            respuestaTexto:
              `⚠️ *Tu reserva fue cancelada.*\n\n` +
              `Al cancelar con menos de 2 horas de anticipación, las políticas de asistencia no permiten reembolsar el crédito de la clase.\n` +
              `🎟️ Saldo disponible: ${saldoActual} créditos.\n\n` +
              `¡Nos vemos pronto en tu siguiente entrenamiento!`,
            datosExtra: { devuelto: false, saldo: saldoActual },
          };
        }
      }

      // Cita 1:1 estándar
      await supa
        .from("ed_citas")
        .update({ estado: "cancelada", cancelada_en: new Date().toISOString() })
        .eq("id", cita.id);

      return {
        accion: "CANCELAR_RESERVA",
        ejecutado: true,
        respuestaTexto:
          `✅ *Tu cita fue cancelada correctamente.*\n\n` +
          `Si deseas reagendar para otro momento, sólo indícame qué día te acomoda. 🙌`,
      };
    }

    case "RENOVAR_MEMBRESIA": {
      if (!contactoId) {
        return {
          accion: "RENOVAR_MEMBRESIA",
          ejecutado: false,
          respuestaTexto:
            "Para generar tu link de renovación necesitamos registrar tu ficha de contacto. ¿Me indicas tu nombre por favor?",
        };
      }

      const planes = await obtenerPlanes(params.clienteId, supa);
      const planElegido = planes[0];

      if (!planElegido) {
        return {
          accion: "RENOVAR_MEMBRESIA",
          ejecutado: false,
          respuestaTexto:
            "No tenemos planes de suscripción configurados en este momento. Por favor consúltanos directamente con el equipo.",
        };
      }

      const renovacion = await iniciarRenovacionMembresiaFlow({
        clienteId: params.clienteId,
        contactoId,
        planId: planElegido.id,
        chatId: params.chatId,
        supa,
      }).catch((e) => {
        console.error("[commerceWhatsApp] Error iniciando Flow:", (e as Error).message);
        return null;
      });

      if (!renovacion?.ok || !renovacion.url) {
        return {
          accion: "RENOVAR_MEMBRESIA",
          ejecutado: false,
          respuestaTexto:
            `💳 *Plan:* ${planElegido.nombre}\n` +
            `• Valor: $${planElegido.precio_clp.toLocaleString("es-CL")} CLP (${planElegido.creditos_totales} clases)\n\n` +
            `En este momento no pudimos generar el link directo de Flow. Un miembro del equipo te contactará de inmediato para facilitarte el pago.`,
        };
      }

      return {
        accion: "RENOVAR_MEMBRESIA",
        ejecutado: true,
        respuestaTexto:
          `💳 *Renovación de Membresía:*\n` +
          `• *Plan:* ${planElegido.nombre}\n` +
          `• *Valor:* $${planElegido.precio_clp.toLocaleString("es-CL")} CLP\n` +
          `• *Beneficio:* ${planElegido.creditos_totales} clases válidas por ${planElegido.vigencia_dias} días.\n\n` +
          `Paga de forma rápida y segura vía Flow / Webpay aquí:\n` +
          `👉 ${renovacion.url}\n\n` +
          `¡Apenas se confirme tu pago tus clases se cargarán al instante! 🙌`,
        datosExtra: { urlPago: renovacion.url, planId: planElegido.id },
      };
    }

    case "PAGAR_ANTICIPO": {
      let profesionalId = params.profesionalId;
      if (!profesionalId && params.servicioId) {
        const { data: sp } = await supa
          .from("ed_servicio_profesional")
          .select("profesional_id")
          .eq("servicio_id", params.servicioId)
          .limit(1)
          .maybeSingle();
        profesionalId = sp?.profesional_id as string | undefined;
      }

      if (!params.servicioId || !params.inicioIso || !profesionalId) {
        return {
          accion: "PAGAR_ANTICIPO",
          ejecutado: false,
          respuestaTexto:
            "Para generar el anticipo primero debemos elegir el servicio y el horario que prefieras. ¿Cuál servicio te gustaría agendar?",
        };
      }

      const hold = await crearHoldReserva({
        clienteId: params.clienteId,
        servicioId: params.servicioId,
        profesionalId,
        inicioIso: params.inicioIso,
        nombreContacto: params.nombreContacto ?? "Cliente WhatsApp",
        telefono: `+${params.chatId}`,
        chatId: params.chatId,
        email: "contacto@respondo.cl",
        empleadoId: params.empleadoId,
        supa,
      });

      if (hold.ok && hold.checkoutUrl) {
        return {
          accion: "PAGAR_ANTICIPO",
          ejecutado: true,
          respuestaTexto:
            `⏳ *Reserva en Espera de Confirmación:*\n` +
            `• *Horario:* ${formatearSlot(params.inicioIso)}\n` +
            `• *Anticipo requerido:* $${(hold.montoAnticipo ?? 0).toLocaleString("es-CL")} CLP\n\n` +
            `Tu cupo queda reservado por 15 minutos mientras completas el pago aquí:\n` +
            `👉 ${hold.checkoutUrl}\n\n` +
            `Una vez acreditado en Flow, tu cita quedará confirmada al 100% de inmediato. ✅`,
          datosExtra: { urlPago: hold.checkoutUrl, citaId: hold.citaId },
        };
      }

      return {
        accion: "PAGAR_ANTICIPO",
        ejecutado: false,
        respuestaTexto:
          "No fue posible generar el link de anticipo para este horario. Por favor revisemos otro cupo disponible.",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Fast-path para procesar WhatsApp en el bot sin llamar al LLM
// ---------------------------------------------------------------------------

export async function procesarCommerceWhatsAppRapido(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  textoEntrante: string;
  supa?: SupabaseClient;
}): Promise<string | null> {
  const supa = params.supa ?? db();

  // Verificar si el tenant tiene activo Commerce & Booking V1
  const { data: cliente } = await supa
    .from("ed_clientes")
    .select("commerce_booking_v1_activo")
    .eq("id", params.clienteId)
    .maybeSingle();

  if (!cliente?.commerce_booking_v1_activo) {
    return null; // Cero interferencia para tenants sin la funcionalidad activa
  }

  const intencion = detectarIntencionCommerce(params.textoEntrante);
  if (!intencion) return null;

  // Solo resolver determinísticamente las consultas claras y directas
  if (
    intencion === "CONSULTAR_CREDITOS" ||
    intencion === "RENOVAR_MEMBRESIA" ||
    intencion === "CANCELAR_RESERVA"
  ) {
    const res = await ejecutarAccionCommerce({
      clienteId: params.clienteId,
      empleadoId: params.empleadoId,
      chatId: params.chatId,
      texto: params.textoEntrante,
      supa,
    });
    return res.respuestaTexto;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Constructor de bloque de contexto para el prompt del LLM (Tino)
// ---------------------------------------------------------------------------

export async function construirBloqueCommercePrompt(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<string | null> {
  try {
    const contactoId = await resolverContactoId(clienteId, chatId, supa);
    if (!contactoId) return null;

    const membresia = await obtenerMembresiaActiva(clienteId, contactoId, supa);
    if (!membresia) {
      return (
        `## MEMBRESÍA Y CRÉDITOS DEL CLIENTE:\n` +
        `- Estado: Sin membresía activa ni créditos.\n` +
        `- REGLA ESTRICTA: Si pregunta por clases o créditos, NUNCA inventes saldo. Dile amablemente que no tiene plan activo y ofrécele información sobre cómo adquirir uno.`
      );
    }

    const planNombre = await obtenerNombrePlan(clienteId, membresia.plan_id, supa);

    return (
      `## MEMBRESÍA Y CRÉDITOS DEL CLIENTE:\n` +
      `- Plan: ${planNombre}\n` +
      `- Créditos disponibles: ${membresia.creditos_saldo} clases\n` +
      `- Vigencia: hasta ${formatearFechaLegible(membresia.fin)}\n` +
      `- REGLA ESTRICTA: NUNCA inventes créditos. Informa exactamente ${membresia.creditos_saldo} créditos disponibles. Si tiene 0 créditos, indícalo amablemente y ofrece renovar su plan vía Flow.`
    );
  } catch {
    return null;
  }
}
