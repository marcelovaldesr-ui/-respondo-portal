import { db } from "@/lib/db";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { enviarTexto, type ConfigWhatsApp } from "@/lib/whatsapp";
import { etiquetasDesdeMotor } from "@/lib/etiquetas";
import { guardarMensaje } from "@/lib/mensajes";
import { avisarACliente, resumirParaAviso } from "@/lib/push";
import { modoDe, setModo } from "@/lib/estadoChat";
import { notificarHQ } from "@/lib/hqBridge";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  contextoAgenda,
  ejecutarAccionAgenda,
  confirmacionRapida,
  encuestaRapida,
  type CitaDelMotor,
} from "@/lib/agendaBot";

/**
 * Cerebro de Tino sobre WhatsApp real (Opción B, Fase 2).
 *
 * Es el equivalente de "Probar ahora" pero para un chat real: toma el historial
 * del chat, arma el MISMO prompt del motor, llama a Gemini, responde por la
 * Cloud API y guarda todo. Respeta ed_chat_estado: si el chat NO está en modo
 * bot (hay un humano o está pausado), no hace nada.
 */

type RespuestaMotor = {
  respuesta?: string;
  escalar?: boolean;
  trigger?: string | null;
  resumen_para_humano?: string | null;
  accion?: string | null;
  lead?: { clasificacion?: string } | null;
  /** F2 (agenda): tokens elegidos por el modelo desde el bloque AGENDA REAL. */
  cita?: CitaDelMotor | null;
};

/**
 * Un fallo de transporte no puede quedar como una respuesta fantasma. Se deja
 * el chat esperando a una persona y se registra el incidente sin guardar como
 * conversación un texto que el cliente nunca recibió.
 */
async function derivarPorFalloDeEnvio(
  supa: SupabaseClient,
  params: { clienteId: string; empleadoId: string; chatId: string; detalle: string },
): Promise<void> {
  await setModo(params.empleadoId, params.chatId, "humano", supa);
  const { data: pendiente } = await supa
    .from("ed_escalaciones")
    .select("id")
    .eq("empleado_id", params.empleadoId)
    .eq("chat_id", params.chatId)
    .is("atendida_en", null)
    .limit(1)
    .maybeSingle();
  if (!pendiente) {
    await supa.from("ed_escalaciones").insert({
      empleado_id: params.empleadoId,
      chat_id: params.chatId,
      trigger: "incertidumbre",
      resumen:
        "El asistente no pudo entregar su respuesta por un fallo del canal. La conversación quedó esperando a una persona.",
      notificado_a: [],
    });
  }
  console.error("[responderBot] fallo de entrega:", params.detalle);
  notificarHQ({
    tipo: "error",
    clientePortalId: params.clienteId,
    detalle: `fallo de entrega: ${params.detalle}`,
  });
}

/**
 * Suma etiquetas automáticas a la conversación según lo que detectó el motor.
 * Defensivo: si la columna etiquetas (migración 211) no está, no rompe nada.
 */
async function autoEtiquetar(
  clienteId: string,
  chatId: string,
  datos: RespuestaMotor,
) {
  const nuevas = etiquetasDesdeMotor(datos);
  if (nuevas.length === 0) return;
  try {
    const supa = db();
    const { data, error } = await supa
      .from("ed_contactos")
      .select("etiquetas")
      .eq("cliente_id", clienteId)
      .eq("chat_id", chatId)
      .maybeSingle();
    if (error) return; // 211 no aplicada
    const actuales = (data?.etiquetas as string[] | null) ?? [];
    const union = Array.from(new Set([...actuales, ...nuevas]));
    await supa
      .from("ed_contactos")
      .upsert(
        { cliente_id: clienteId, chat_id: chatId, etiquetas: union, etiqueta: "lead" },
        { onConflict: "cliente_id,chat_id" },
      );
  } catch {
    /* no romper la respuesta por un fallo de etiquetado */
  }
}

/** Trae el historial reciente del chat como lo espera armarPrompt. */
async function historial(
  empleadoId: string,
  chatId: string,
): Promise<MensajePrueba[]> {
  const { data } = await db()
    .from("ed_mensajes")
    .select("rol, texto, creado_en")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .order("creado_en", { ascending: false })
    .limit(20);

  // Vienen del más nuevo al más viejo: invertir. Se conserva el rol 'humano'
  // (mensajes que escribió una persona del equipo) para que el prompt los marque
  // como decisiones tomadas y Tino no las contradiga ni repregunte lo ya resuelto.
  return (data ?? [])
    .reverse()
    .map((m) => ({
      rol: (m.rol === "cliente"
        ? "cliente"
        : m.rol === "humano"
          ? "humano"
          : "empleado") as MensajePrueba["rol"],
      texto: m.texto as string,
    }));
}

/**
 * Genera y envía la respuesta del asistente si corresponde.
 * Devuelve un resumen de lo que hizo (útil para logs/pruebas).
 */
export async function responderSiBot(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  /** Transporte oficial (Opción B). Si se pasa `enviar`, tiene prioridad. */
  cfg?: ConfigWhatsApp;
  /**
   * Transporte de envío pluggable. Opción A (Evolution) pasa su propio sender;
   * si no se pasa, se usa `cfg` con la Cloud API oficial. Así el MISMO cerebro
   * sirve para los dos canales sin duplicar lógica.
   */
  enviar?: (
    chatId: string,
    texto: string,
  ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  /**
   * Guardia de vigencia, evaluada JUSTO ANTES de enviar (tras la llamada al
   * modelo). Devuelve false si la respuesta ya quedó obsoleta — típicamente
   * porque el cliente escribió otro mensaje mientras el modelo pensaba.
   * Ver el comentario de la anti-carrera más abajo.
   */
  sigueVigente?: () => Promise<boolean>;
  /**
   * Por dónde entró la conversación. Se guarda en cada mensaje del asistente.
   *
   * Estaba escrito "whatsapp" a firme en tres lugares, cosa que fue correcta
   * mientras existió un solo canal. Con Instagram deja de serlo, y de la peor
   * manera: no rompe nada visible: las respuestas salen bien y el chat se ve
   * normal, pero la analítica atribuye a WhatsApp conversaciones que llegaron
   * por Instagram. Un dato equivocado que nadie va a cuestionar es peor que un
   * error que se cae.
   */
  canal?: string;
  /**
   * Timestamp absoluto hasta el que se puede consultar al modelo, calculado por
   * el manejador del webhook con lib/presupuesto.ts.
   *
   * Existe para que la RED DE SEGURIDAD de más abajo (avisarle al cliente y
   * derivar a una persona) siempre alcance a ejecutarse. Sin este tope, un
   * Gemini saturado consumía los 60 s de la función y Vercel la mataba ANTES de
   * la red — el cliente no recibía nada y nadie se enteraba.
   */
  fechaLimiteModelo?: number;
}): Promise<{ accion: string; detalle?: string }> {
  const { clienteId, empleadoId, chatId, cfg } = params;
  const canal = params.canal ?? "whatsapp";

  const modo = await modoDe(empleadoId, chatId);
  if (modo !== "bot") return { accion: "silencio", detalle: `modo ${modo}` };

  const hist = await historial(empleadoId, chatId);
  if (hist.length === 0) return { accion: "sin_historial" };

  // ── AGENDA (F2) ────────────────────────────────────────────────────────────
  // Solo existe si el cliente tiene agenda configurada (migración 220 aplicada
  // + servicios activos). Para un cliente SIN agenda (ej. Impresora Color)
  // `agenda` es null y TODO este flujo queda idéntico al de siempre.
  const agenda = await contextoAgenda(clienteId, chatId).catch(() => null);

  const ultimo = hist[hist.length - 1];

  // Confirmación rápida de cita: si el último mensaje es un "SÍ" inequívoco y
  // hay una confirmación pendiente, se confirma POR CÓDIGO (sin modelo).
  if (agenda) {
    if (ultimo?.rol === "cliente") {
      const rapida = await confirmacionRapida(clienteId, chatId, ultimo.texto);
      if (rapida) {
        const supaC = db();
        const envioC = params.enviar
          ? await params.enviar(chatId, rapida)
          : cfg
            ? await enviarTexto(cfg, chatId, rapida)
            : { ok: false as const, error: "sin transporte" };
        if (!envioC.ok) {
          await derivarPorFalloDeEnvio(supaC, {
            clienteId,
            empleadoId,
            chatId,
            detalle: envioC.error ?? "sin transporte",
          });
          return { accion: "error_envio_derivado", detalle: envioC.error ?? "sin transporte" };
        }
        const guardadoC = await guardarMensaje(supaC, {
          empleadoId,
          chatId,
          rol: "empleado",
          texto: rapida,
          waId: "waId" in envioC ? (envioC as { waId?: string }).waId : undefined,
          canal,
        });
        if (!guardadoC.ok) {
          await derivarPorFalloDeEnvio(supaC, {
            clienteId,
            empleadoId,
            chatId,
            detalle: "confirmación enviada pero no registrada",
          });
          return { accion: "envio_sin_registro_derivado" };
        }
        return {
          accion: "confirmacion_cita",
          detalle: "enviado",
        };
      }
    }
  }

  // Encuesta postventa de Vera: si el último mensaje es una nota clara de 1 a
  // 5 y hay una encuesta pendiente, se cierra el círculo POR CÓDIGO (sin
  // modelo) — escribe el resultado, cierra la cita como "completada" y, si la
  // nota es mala, deriva a una persona de inmediato. Ver lib/agendaBot.ts.
  // Independiente de `agenda`: no necesita el bloque de cupos, solo que exista
  // una encuesta enviada para este chat.
  if (ultimo?.rol === "cliente") {
    const rapidaEncuesta = await encuestaRapida(clienteId, empleadoId, chatId, ultimo.texto);
    if (rapidaEncuesta) {
      const supaE = db();
      const envioE = params.enviar
        ? await params.enviar(chatId, rapidaEncuesta)
        : cfg
          ? await enviarTexto(cfg, chatId, rapidaEncuesta)
          : { ok: false as const, error: "sin transporte" };
      if (!envioE.ok) {
        await derivarPorFalloDeEnvio(supaE, {
          clienteId,
          empleadoId,
          chatId,
          detalle: envioE.error ?? "sin transporte",
        });
        return { accion: "error_envio_derivado", detalle: envioE.error ?? "sin transporte" };
      }
      const guardadoE = await guardarMensaje(supaE, {
        empleadoId,
        chatId,
        rol: "empleado",
        texto: rapidaEncuesta,
        waId: "waId" in envioE ? (envioE as { waId?: string }).waId : undefined,
        canal,
      });
      if (!guardadoE.ok) {
        await derivarPorFalloDeEnvio(supaE, {
          clienteId,
          empleadoId,
          chatId,
          detalle: "respuesta de encuesta enviada pero no registrada",
        });
        return { accion: "envio_sin_registro_derivado" };
      }
      return { accion: "encuesta_cerro_cita", detalle: "enviado" };
    }
  }

  const prompt = await armarPrompt(clienteId, empleadoId, hist, agenda?.texto);
  if (!prompt) return { accion: "sin_prompt" };

  let datos: RespuestaMotor;
  try {
    datos = JSON.parse(
      await generarJSON(prompt, { fechaLimite: params.fechaLimiteModelo }),
    );
  } catch (e) {
    // ── RED DE SEGURIDAD (auditoría 30-jul): el cliente NUNCA queda en silencio ──
    // Antes, si el modelo fallaba (caído, saturado, timeout), la función salía
    // acá y el cliente que acababa de escribir NO recibía absolutamente nada,
    // y nadie del negocio se enteraba. Es el peor fallo posible: peor que una
    // respuesta mediocre, porque parece que el negocio lo ignora.
    // Ahora: se le responde con honestidad, se deriva a una persona y queda
    // registrada la escalación para que aparezca en "Te esperan".
    const supaF = db();
    const aviso =
      "Disculpa, se me complicó revisar eso en este momento 🙈 Le aviso al equipo para que te responda a la brevedad.";
    const envioF = params.enviar
      ? await params.enviar(chatId, aviso)
      : cfg
        ? await enviarTexto(cfg, chatId, aviso)
        : { ok: false as const, error: "sin transporte" };

    if (envioF.ok) {
      await guardarMensaje(supaF, {
        empleadoId,
        chatId,
        rol: "empleado",
        texto: aviso,
        waId: "waId" in envioF ? (envioF as { waId?: string }).waId : undefined,
        canal,
      });
    }
    await setModo(empleadoId, chatId, "humano", supaF);
    await supaF.from("ed_escalaciones").insert({
      empleado_id: empleadoId,
      chat_id: chatId,
      trigger: "incertidumbre",
      resumen:
        "El asistente no pudo responder por un problema técnico momentáneo. La conversación quedó esperando a una persona.",
      notificado_a: [],
    });
    console.error("[responderBot] fallo del modelo:", (e as Error).message);
    notificarHQ({
      tipo: "error",
      clientePortalId: clienteId,
      detalle: `fallo del modelo: ${(e as Error).message}`,
    });
    return { accion: "error_llm_derivado", detalle: (e as Error).message };
  }

  let texto =
    datos.respuesta?.trim() ||
    "Prefiero confirmar eso con el equipo para no darte un dato malo 👍";

  const supa = db();

  // ANTI-CARRERA: Gemini tardó unos segundos; si en ese lapso una persona tomó
  // el control (o se pausó), NO se envía la respuesta ya obsoleta. Se re-lee el
  // modo justo antes de mandar. Esto evita que Tino "hable encima" del humano.
  const modoAhora = await modoDe(empleadoId, chatId, supa);
  if (modoAhora !== "bot") {
    return { accion: "silencio_carrera", detalle: `modo cambió a ${modoAhora}` };
  }

  // ANTI-CARRERA 2 (bug real visto en producción el 30-jul, primer día de Tino
  // con el número de la imprenta): el debounce agrupa mensajes rápidos ANTES de
  // llamar al modelo, pero el modelo tarda ~9s. Si el cliente escribe de nuevo
  // en esa ventana, arranca un segundo ciclo y el cliente recibe DOS respuestas
  // seguidas (se vio: "Cotizar" a las 23:14:36 → respuestas a las :41 y :50).
  // Solución: revalidar aquí, ya con la respuesta en mano. Si llegó un mensaje
  // más nuevo, esta respuesta se descarta: la del ciclo más reciente contesta
  // con el historial completo y queda mejor.
  if (params.sigueVigente && !(await params.sigueVigente())) {
    return { accion: "silencio_obsoleto", detalle: "llegó un mensaje más nuevo" };
  }

  // ── AGENDA (F2): ejecutar la acción que eligió el modelo ──────────────────
  // Va DESPUÉS de las anti-carreras a propósito: una respuesta que no se va a
  // enviar jamás debe crear una cita. La cita la valida y la crea CÓDIGO
  // (tokens de la lista ofrecida + constraint anti doble-reserva en Postgres);
  // la línea de confirmación final también la redacta código, no el modelo.
  if (agenda) {
    const rAgenda = await ejecutarAccionAgenda({
      ctx: agenda,
      accion: datos.accion,
      cita: datos.cita,
      clienteId,
      empleadoId,
      chatId,
    });
    if (rAgenda.tipo === "cupo_tomado") {
      texto = rAgenda.textoReemplazo;
    } else if ("textoExtra" in rAgenda && rAgenda.textoExtra) {
      texto = `${texto}\n\n${rAgenda.textoExtra}`;
    }
  }

  // Enviar por WhatsApp. Opción A: usa el sender pasado (Evolution). Opción B:
  // usa la Cloud API con cfg. Sin ninguno de los dos, queda solo guardado.
  const envio = params.enviar
    ? await params.enviar(chatId, texto)
    : cfg
      ? await enviarTexto(cfg, chatId, texto)
      : { ok: false, error: "sin transporte configurado" };

  // BUG REAL visto en producción 1-ago-2026 (Impresora Color, mensajes
  // fragmentados "Ese" / "Mismo" / "Es ese mismo"): enviarTextoWaha ya revisa
  // `vigente` justo antes de mandar (después de los ~6s de "escribiendo…") y
  // devuelve envio.ok=false con este error cuando el mensaje quedó obsoleto
  // (llegó algo más nuevo del cliente, o alguien tomó el control). Pero acá
  // abajo se guardaba SIEMPRE en ed_mensajes, sin importar si de verdad se
  // mandó — dejando una respuesta "fantasma" que el cliente nunca vio, pero
  // que sí aparecía en el inbox (parecía que Tino repitió la pregunta) y que
  // además contaminaba el CONTEXTO del siguiente turno (Tino creía haber dicho
  // algo que nunca llegó). El ciclo del mensaje más nuevo es el que responde
  // de verdad, con el historial completo — este no debe dejar rastro.
  if (!envio.ok && envio.error === "obsoleto:llego_mensaje_nuevo") {
    return { accion: "silencio_obsoleto", detalle: "obsoleto durante el envío (typing)" };
  }

  if (!envio.ok) {
    await derivarPorFalloDeEnvio(supa, {
      clienteId,
      empleadoId,
      chatId,
      detalle: envio.error ?? "sin transporte configurado",
    });
    return { accion: "error_envio_derivado", detalle: envio.error ?? "sin transporte" };
  }

  // Guardar la respuesta del asistente con el id que devolvió el envío. Ese id
  // permite reconocer luego su ECO en el webhook y NO tratarlo como intervención
  // humana (ver lib/inboundEvolution.ts). Idempotente: guardarMensaje ignora
  // duplicados por el índice único de la migración 212.
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "empleado",
    texto,
    waId: "waId" in envio ? (envio as { waId?: string }).waId : undefined,
    canal,
  });
  if (!guardado.ok) {
    await derivarPorFalloDeEnvio(supa, {
      clienteId,
      empleadoId,
      chatId,
      detalle: "respuesta enviada pero no registrada",
    });
    return { accion: "envio_sin_registro_derivado" };
  }

  // Escalación: si el motor pide humano, silenciar el bot y registrar.
  if (datos.escalar) {
    await setModo(empleadoId, chatId, "humano", supa);
    await supa.from("ed_escalaciones").insert({
      empleado_id: empleadoId,
      chat_id: chatId,
      trigger: datos.trigger ?? "incertidumbre",
      resumen: datos.resumen_para_humano ?? "El asistente derivó la conversación.",
      notificado_a: [],
    });

    /**
     * COMPLETAR EL MOTOR DE RESULTADOS (1-sep-2026) — punto único.
     *
     * `ed_resultados` tiene diez tipos declarados desde la migración 201 y en
     * producción se escribía solo uno ("agendamiento"). `cliente_molesto` es
     * el más seguro de sumar acá: el trigger "sentimiento_negativo" ya es una
     * señal explícita y bien definida que CUALQUIER empleado (Tino, Rita,
     * Vera) puede emitir, así que conectarla en este único choke point la
     * cubre para los tres sin tocar cada rol por separado. Best-effort: si
     * falla, la escalación ya quedó registrada y es lo que de verdad importa.
     *
     * Los demás tipos (venta_confirmada, cliente_reactivado...) quedan fuera
     * a propósito: la propia auditoría de agosto advierte que "reactivado" ya
     * tiene DOS fuentes de verdad en el portal (este motor y el cálculo de
     * /analitica desde citas+seguimientos) y hay que decidir cuál manda ANTES
     * de sumar una tercera, o dos pantallas del mismo portal mostrarán
     * números distintos.
     */
    if (datos.trigger === "sentimiento_negativo") {
      await supa
        .from("ed_resultados")
        .insert({
          empleado_id: empleadoId,
          chat_id: chatId,
          tipo: "cliente_molesto",
          nota: { resumen: datos.resumen_para_humano ?? null },
          detectado_por: "bot",
        })
        .then(() => undefined, () => undefined);
    }

    /**
     * AVISAR AL TELÉFONO DE LA PERSONA (24-ago-2026).
     *
     * Acá había un TODO desde la Fase 4. Este es EL momento que importa: el
     * asistente acaba de decir "esto lo tiene que ver alguien", y hasta hoy esa
     * señal moría en una tabla que nadie mira si no tiene el portal abierto.
     *
     * Se avisa solo cuando se ESCALA, no en cada mensaje. Tino atiende la
     * mayoría; notificar todo convertiría el aviso en ruido y la persona lo
     * apagaría a la semana — y ahí perderíamos también los que sí importan.
     *
     * Best-effort: si el aviso falla, la escalación ya quedó registrada y la
     * conversación se atiende igual.
     */
    void (async () => {
      // El nombre hace la diferencia entre "alguien te necesita" y "Cristian te
      // necesita". Si no está, el número igual dice más que nada.
      const { data: c } = await supa
        .from("ed_contactos")
        .select("nombre")
        .eq("cliente_id", clienteId)
        .eq("chat_id", chatId)
        .maybeSingle();
      const quien = (c?.nombre as string | null) || `+${chatId}`;
      await avisarACliente(clienteId, {
        titulo: `${quien} necesita ayuda`,
        cuerpo: resumirParaAviso(
          datos.resumen_para_humano || "El asistente derivó la conversación.",
        ),
        url: `/conversaciones?emp=${encodeURIComponent(empleadoId)}&chat=${encodeURIComponent(chatId)}`,
        // Un aviso por conversación: si el mismo chat escala dos veces, se
        // reemplaza en vez de apilarse.
        tag: `chat:${chatId}`,
      });
    })().catch(() => undefined);

    notificarHQ({
      tipo: "human_handoff",
      clientePortalId: clienteId,
      detalle: datos.resumen_para_humano ?? `derivado (${datos.trigger ?? "incertidumbre"})`,
    });
  }

  // Etiquetado automático de la conversación (posible comprador, cotización...).
  await autoEtiquetar(clienteId, chatId, datos);

  // Puente a HQ (ver lib/hqBridge.ts): un mensaje real fue atendido y enviado.
  notificarHQ({ tipo: "mensaje", clientePortalId: clienteId });

  return {
    accion: datos.escalar ? "respondio_y_escalo" : "respondio",
    detalle: "enviado",
  };
}
