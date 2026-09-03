import { db } from "@/lib/db";
import {
  parsearWaha,
  parsearAckWaha,
  clientePorInstanciaWaha,
  enviarTextoWaha,
  resolverContacto,
  nombreDeContacto,
} from "@/lib/waha";
import { tinoDe } from "@/lib/whatsapp";
import {
  guardarMensaje,
  yaProcesado,
  esEcoReciente,
  actualizarEstadoEnvio,
  enviosUltimoMinuto,
} from "@/lib/mensajes";
import { modoDe, setModo, tocarVentanaEntrante } from "@/lib/estadoChat";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { asegurarContacto } from "@/lib/contactoEntrante";
import { responderSiBot } from "@/lib/responderBot";
import { empleadoParaEntrante } from "@/lib/seguimientos";
import { notificarSistemaDelCliente } from "@/lib/puenteSalida";
import { fechaLimiteModelo } from "@/lib/presupuesto";
import { transporteDe } from "@/lib/transporte";
import { ventanaDeEspera } from "@/lib/ritmoHumano";

export type ResultadoEntrante = { accion: string; detalle?: string };

/**
 * El ritmo de la conversación (cuánto esperar antes de responder, cuánto
 * "escribir") vive en lib/ritmoHumano.ts, compartido con el camino de Meta.
 *
 * Estaba solo acá y por eso Cloud API —el transporte de TODO cliente nuevo—
 * respondía al instante y con un debounce fijo. Se re-exporta para no romper a
 * quien ya lo importaba desde este módulo.
 */
export { ventanaDeEspera };

/**
 * Orquesta un evento entrante de WAHA (WhatsApp Opción A — motor GOWS).
 * Gemelo de lib/inboundEvolution.ts: MISMO cerebro, MISMA convivencia
 * Tino+persona, MISMO tracking de ACKs. Solo cambia el parser del transporte.
 *
 * IDENTIDAD ESTABLE (23-jul-2026): la clave de la conversación (chatId) es
 * SIEMPRE el número real del contacto, resuelto desde el LID si hace falta
 * (resolverContacto). Así la misma persona NO se fragmenta en varios chats,
 * aunque a veces entre como @lid y a veces como @c.us. El ENVÍO se hace a la
 * dirección original (m.jid), que es la que WhatsApp espera y ya entrega bien.
 *
 *  0) ACK (message.ack) → actualizar estado_envio y salir.
 *  1) Parsear message. Si no hay texto / es grupo → ignorar.
 *  2) Resolver cliente (por instancia) y Tino.
 *  2b) Resolver identidad estable del contacto (número real).
 *  3) Idempotencia por id (cubre reenvíos y eco de Tino).
 *  4) fromMe con id desconocido = persona → toma de control humana.
 *  5) Mensaje del cliente → guardar, tocar ventana, responder.
 */
export async function manejarEntranteWaha(
  payload: unknown,
  opts?: {
    enviar?: (
      chatId: string,
      texto: string,
    ) => Promise<{ ok: boolean; waId?: string; error?: string }>;
  },
): Promise<ResultadoEntrante> {
  // Presupuesto de tiempo de ESTA invocación: se captura al entrar, antes del
  // debounce (que puede comerse hasta 20 s). Ver lib/presupuesto.ts.
  const fechaLimite = fechaLimiteModelo(Date.now());

  // 0) ACK de entrega.
  const ack = parsearAckWaha(payload);
  if (ack) {
    const clienteId = await clientePorInstanciaWaha(ack.instancia);
    if (!clienteId) return { accion: "ack_sin_cliente", detalle: ack.instancia };
    const empleadoId = await tinoDe(clienteId);
    if (!empleadoId) return { accion: "ack_sin_tino" };
    const r = await actualizarEstadoEnvio(db(), empleadoId, ack.waId, ack.estado);
    if (ack.estado === "error") console.error("[waha ack] envío no entregado");
    return {
      accion: "ack",
      detalle: `${ack.estado}${r.encontrado === false ? " (ajeno)" : ""}`,
    };
  }

  const m = parsearWaha(payload);
  if (!m) return { accion: "ignorado" };

  const supa = db();

  const clienteId = await clientePorInstanciaWaha(m.instancia);
  if (!clienteId) return { accion: "sin_cliente", detalle: m.instancia };

  // ¿Este cliente todavía manda por WAHA? Si ya migró a la Cloud API, la sesión
  // de WAHA sigue vinculada y su webhook sigue llegando: sin esta guardia el
  // cliente recibiría DOS respuestas y cada canal creería que una persona tomó
  // el control. Ver lib/transporte.ts para el detalle del fallo.
  if ((await transporteDe(clienteId, supa)) !== "waha") {
    return { accion: "otro_transporte", detalle: "cliente en cloud" };
  }

  const tinoId = await tinoDe(clienteId);
  if (!tinoId) return { accion: "sin_tino" };

  // 2b) Identidad estable: la clave del chat es el NÚMERO REAL (resuelto del LID).
  const contacto = await resolverContacto(m.jid);
  const chatId = contacto.chatId; // ← clave única de la conversación en la BD

  // 2c) RUTEO: si este chat tiene un seguimiento activo (Beto/Vera le
  // escribieron hace <72h), la conversación es de ESE empleado — la respuesta
  // no debe caer en Tino ni partir el hilo. Sin seguimiento → Tino (fallback).
  const empleadoId = (await empleadoParaEntrante(clienteId, chatId, tinoId, supa)) ?? tinoId;

  // 3) Idempotencia + eco de Tino.
  if (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) {
    return { accion: "duplicado" };
  }

  // 4) fromMe con id desconocido = mensaje humano → toma de control.
  if (m.fromMe) {
    // Detección de ECO (mensaje del propio Tino que WhatsApp devuelve):
    //  a) por id ya guardado, o b) por texto reciente igual (rol=empleado).
    if (
      (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, m.texto))
    ) {
      return { accion: "eco" };
    }
    // ANTI-CARRERA (riesgo B de la auditoría): el eco de Tino llega como un
    // webhook APARTE y puede adelantarse a que se guarde el id/mensaje del envío.
    // Antes de concluir "toma humana" (que silenciaría a Tino por error),
    // esperamos un momento y re-verificamos. Un mensaje humano REAL no calzará
    // ni por id ni por texto reciente, así que esto no lo bloquea.
    await new Promise((r) => setTimeout(r, 2500));
    if (
      (m.waId && (await yaProcesado(supa, empleadoId, m.waId))) ||
      (await esEcoReciente(supa, empleadoId, chatId, m.texto))
    ) {
      return { accion: "eco" };
    }
    await guardarMensaje(supa, {
      empleadoId,
      chatId,
      rol: "humano",
      texto: m.texto,
      waId: m.waId,
      canal: "whatsapp",
    });
    await setModo(empleadoId, chatId, "humano", supa);
    /**
     * Una PERSONA le escribió al cliente: eso ES atender. La escalación se
     * cierra acá igual que cuando responde desde el portal; si no, "te
     * espera" quedaba encendido para siempre (2-sep-2026, ver escalaciones.ts).
     * Por chat, no por empleado: la derivación pudo abrirla Beto o Vera.
     */
    await cerrarEscalacionesPendientes(supa, {
      empleadoIds: await idsEmpleadosDeCliente(clienteId),
      chatId,
      clienteId,
    });
    return { accion: "toma_humana" };
  }

  // 5) Mensaje del cliente.
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "cliente",
    texto: m.texto,
    waId: m.waId,
    canal: "whatsapp",
    // Adjunto (foto/PDF/audio): se persisten sus metadatos para que la persona
    // pueda VERLO en el inbox (vía proxy autenticado), no solo leer "[imagen]".
    // Best-effort: si la migración 270 no está, guardarMensaje lo omite solo.
    media: m.adjunto
      ? {
          url: m.adjunto.url ?? null,
          mime: m.adjunto.mime ?? null,
          tipo: m.adjunto.tipo,
          nombre: m.adjunto.nombre ?? null,
        }
      : null,
  });
  // ANTI-DOBLE-RESPUESTA (fix 24-jul): si el índice único (empleado_id,
  // wa_message_id) rechazó el insert, este webhook es una ENTREGA DUPLICADA del
  // mismo mensaje (WAHA a veces reenvía el evento, o el webhook quedó suscrito
  // dos veces). La entrega que SÍ guardó el mensaje es la que responde; ésta se
  // retira, para no disparar una segunda respuesta de Gemini. Cubre la carrera
  // que la idempotencia por lectura (yaProcesado) no alcanza cuando ambas
  // entregas llegan casi simultáneas.
  if (guardado.dup) return { accion: "duplicado_carrera" };

  // Contacto: guardar con el número real + nombre visible (best-effort).
  const nombre = m.nombre ?? (await nombreDeContacto(m.jid));
  // Se piden de vuelta etiquetas y etapa (`.select()`) porque el puente hacia el
  // sistema del cliente las necesita y ya estamos haciendo este viaje a la base:
  // pedirlas acá evita una consulta extra en el camino de una conversación real.
  // Sin pisar el nombre que una persona editó (ver contactoEntrante.ts).
  const contactoGuardado = await asegurarContacto(supa, {
    clienteId,
    chatId,
    nombre: nombre ?? null,
    telefono: contacto.telefono ?? null,
  });

  await tocarVentanaEntrante(empleadoId, chatId, supa);

  /**
   * PUENTE HACIA EL SISTEMA DEL CLIENTE (agregado 11-ago-2026).
   *
   * Si este cliente tiene su propia app de gestión configurada
   * (`ed_integraciones`, migración 274), se le avisa del mensaje para que sus
   * leads y reportes se llenen solos y la persona que atiende no tenga que
   * mirar dos pantallas.
   *
   * Va ACÁ y no más abajo a propósito: antes del debounce. Las entregas que se
   * retiran por debounce igual guardaron su mensaje en la base, así que también
   * tienen que avisarlo — si no, se perderían los fragmentos intermedios de
   * quien escribe a pedazos.
   *
   * Fire-and-forget: NO se hace await. Que la app del cliente esté caída no
   * puede frenar ni retrasar la respuesta a alguien que está escribiendo.
   */
  notificarSistemaDelCliente({
    evento: "mensaje",
    clienteId,
    contacto: {
      chatId,
      telefono: (contactoGuardado?.telefono as string | null) ?? contacto.telefono ?? null,
      nombre: (contactoGuardado?.nombre as string | null) ?? nombre ?? null,
      canal: "whatsapp",
      etapa: (contactoGuardado?.etapa as string | null) ?? null,
      etapaManual: Boolean(contactoGuardado?.etapa_manual),
      etiquetas: (contactoGuardado?.etiquetas as string[] | null) ?? null,
      ultimoMensajeEn: (contactoGuardado?.ultimo_mensaje_en as string | null) ?? null,
      ultimoMensajeRol: (contactoGuardado?.ultimo_mensaje_rol as string | null) ?? null,
    },
    mensaje: { waId: m.waId, rol: "cliente", texto: m.texto ?? "" },
    supa,
  });

  // DEBOUNCE (fix estabilización 24-jul): agrupar mensajes rápidos seguidos.
  // Esperamos una ventana corta; si en ese lapso el cliente manda un mensaje
  // MÁS NUEVO, esta invocación se retira y deja que la del último responda —
  // su historial ya incluirá todos. Evita respuestas solapadas y desordenadas.
  /**
   * DEBOUNCE ADAPTATIVO.
   *
   * Eran 6 s fijos. Mucha gente escribe en WhatsApp a pedazos —"Ese" … "Mismo"
   * … "Es ese mismo"— con 15 s entre uno y otro, así que cada fragmento caía
   * fuera de la ventana y disparaba su propia respuesta. El asistente terminaba
   * preguntando tres veces lo mismo porque nunca vio la frase completa.
   *
   * Un mensaje corto y sin puntuación final casi siempre está incompleto: el
   * cliente sigue escribiendo. Para esos se espera más. Un mensaje largo o que
   * termina en punto o signo de pregunta ya dice todo lo que iba a decir, y ahí
   * esperar de más solo hace que el asistente parezca lento.
   */
  const DEBOUNCE_MS = ventanaDeEspera(m.texto ?? "");
  if (m.waId) {
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
    const { data: ultimo } = await supa
      .from("ed_mensajes")
      .select("wa_message_id")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .eq("rol", "cliente")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (ultimo?.wa_message_id && ultimo.wa_message_id !== m.waId) {
      // Llegó un mensaje más nuevo: que responda esa invocación, no ésta.
      return { accion: "debounce_superseded" };
    }
  }

  /**
   * ¿Esta respuesta sigue siendo la buena? Deja de serlo por DOS motivos, y
   * ambos hay que revisarlos JUSTO ANTES de mandar (esta guardia se pasa también
   * a enviarTextoWaha, que la evalúa tras los ~6 s de "escribiendo…"):
   *
   *  1) Llegó un mensaje MÁS NUEVO del cliente → el ciclo de ese mensaje
   *     contestará con el historial completo y quedará mejor.
   *  2) Una PERSONA tomó el control (modo salió de "bot") durante ese lapso.
   *     BUG REAL cubierto acá: responderSiBot re-lee el modo ANTES de la espera
   *     de tipeo; si Cecilia toca "Tomar el control" DURANTE esos 6 s, esa
   *     comprobación ya pasó y —sin esta segunda revisión— Tino mandaba su
   *     respuesta ENCIMA del humano. Volver a mirar el modo aquí cierra esa
   *     ventana. Un humano real no genera un mensaje de cliente más nuevo, así
   *     que el chequeo (1) no lo detectaba.
   */
  const sigueVigente = async (): Promise<boolean> => {
    // (2) ¿El chat sigue en manos del bot? Si una persona tomó el control (o se
    // pausó) mientras Tino "escribía", la respuesta ya no debe salir.
    if ((await modoDe(empleadoId, chatId, supa)) !== "bot") return false;
    // (1) ¿Sigue siendo el último mensaje del cliente?
    if (!m.waId) return true;
    const { data } = await supa
      .from("ed_mensajes")
      .select("wa_message_id")
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .eq("rol", "cliente")
      .order("creado_en", { ascending: false })
      .limit(1)
      .maybeSingle();
    return !data?.wa_message_id || data.wa_message_id === m.waId;
  };

  const enviar =
    opts?.enviar ??
    (async (_chatId: string, texto: string) => {
      // Freno de ritmo humano ≥8/min (reutiliza la lógica de la Fase 5).
      const enUltimoMinuto = await enviosUltimoMinuto(supa, empleadoId);
      if (enUltimoMinuto >= 8) {
        const pausa = 8000 + Math.floor(Math.random() * 4000);
        console.warn(`[ritmo] ${enUltimoMinuto} envíos/min → pausa ${pausa}ms`);
        await new Promise((r) => setTimeout(r, pausa));
      }
      // Responder a la dirección ORIGINAL (m.jid): es la que WhatsApp espera y
      // la que ya entrega bien (con @lid o @c.us). La unificación es solo de la
      // CLAVE del chat (chatId = número real), no del transporte.
      // clienteId: barrera anti-fuga entre negocios (ver lib/waha.ts). Acá
      // debería coincidir siempre —el inbound se resolvió por la misma
      // instancia— pero pasarlo hace que un desajuste de configuración falle
      // de forma segura en vez de responder desde el WhatsApp equivocado.
      return enviarTextoWaha(m.jid, texto, { vigente: sigueVigente, clienteId });
    });

  const r = await responderSiBot({
    clienteId,
    empleadoId,
    chatId,
    enviar,
    // Se re-evalúa DESPUÉS de que el modelo respondió; y otra vez justo antes
    // del envío real (ver el parámetro `vigente` de enviarTextoWaha), porque
    // entre medio hay hasta 6 s de "escribiendo…".
    sigueVigente,
    fechaLimiteModelo: fechaLimite,
  });
  return { accion: `cliente:${r.accion}`, detalle: r.detalle };
}
