import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { cuentaIgDeCliente, enviarTextoInstagram } from "@/lib/instagram";
import { guardarMensaje } from "@/lib/mensajes";
import { limitarDistribuido } from "@/lib/seguridad";
import {
  conservarPausa,
  restaurarControl,
  tomarControlTemporal,
  transporteSalida,
  type Modo,
} from "@/lib/controlChat";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { ventanaAbierta } from "@/lib/ventana24";
import { explicarErrorMeta } from "@/lib/erroresMeta";

/**
 * RESPONDER Y TOMAR EL CONTROL DE UN CHAT — el núcleo, sin sesión.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Todo esto vivía dentro de las server actions de
 * `app/(portal)/conversaciones/acciones.ts`, atado a la sesión del portal. Al
 * abrir el inbox dentro de la app de gestión del cliente hacía falta lo mismo
 * desde una ruta de API autenticada por secreto, y copiarlo habría creado una
 * segunda implementación del envío humano.
 *
 * Eso ya salió caro tres veces en este repo: el debounce adaptativo (G1), los
 * adjuntos (G4) y el puente hacia el sistema del cliente se arreglaron solo en
 * un camino, y el otro —por donde entra todo cliente nuevo— se quedó con el
 * problema durante semanas. Acá vive UNA sola versión; quien la use pone la
 * autenticación por su cuenta.
 *
 * LO QUE NO HACE, a propósito: no autentica y no invalida caché de pantallas.
 * Eso es de cada llamador.
 */

export type ResultadoEnvio = {
  ok: boolean;
  error?: string;
  enviado?: boolean;
  /**
   * Motivo legible por máquina, para que la interfaz pueda OFRECER algo en vez
   * de solo mostrar el error (p. ej. abrir el selector de plantillas cuando la
   * ventana de 24 h está cerrada).
   */
  codigo?: "ventana_cerrada" | "sin_acceso" | "limite" | "canal" | "proveedor" | "registro";
  /** Id del mensaje guardado (ed_mensajes.id), para que la bandeja reemplace la burbuja temporal. */
  mensajeId?: string;
};

/**
 * Empleado dueño de la conversación.
 *
 * Importa acertar: el modo (bot/humano/pausado) se guarda por
 * (empleado_id, chat_id), así que con el empleado equivocado se silenciaría a
 * un asistente que no es el que está atendiendo, y el que habla seguiría
 * hablando. Se usa el último que atendió el chat y, si no hay, Tino.
 */
export async function empleadoDelChat(
  clienteId: string,
  chatId: string,
  supa: SupabaseClient = db(),
): Promise<string | null> {
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("ultimo_empleado_id")
    .eq("cliente_id", clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (contacto?.ultimo_empleado_id) return contacto.ultimo_empleado_id as string;

  const { data: tino } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .eq("rol", "tino")
    .eq("activo", true)
    .maybeSingle();
  return (tino?.id as string | undefined) ?? null;
}

/**
 * Cambia el modo del chat.
 *
 * Cierra la escalación pendiente tanto al DEVOLVER el chat a la IA como al
 * TOMAR EL CONTROL: en los dos casos una persona se hizo cargo de la
 * derivación, y dejarla abierta mantenía el "te espera" encendido aunque
 * Cecilia ya estuviera atendiendo (auditoría 3-sep-2026; antes solo cerraba
 * con modo="bot"). "pausado" no cierra nada: es silencio, no atención.
 */
export async function fijarModo(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  modo: Modo;
  supa?: SupabaseClient;
}): Promise<ResultadoEnvio> {
  const { clienteId, empleadoId, chatId, modo } = params;
  const supa = params.supa ?? db();

  // Barrera de acceso: el empleado Y el chat tienen que ser de este cliente.
  // Sin esto, un id cambiado en la petición dejaría pausar el asistente de otro
  // negocio, o crear filas de estado para chats que no existen.
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa.from("ed_empleados").select("id").eq("id", empleadoId).eq("cliente_id", clienteId).maybeSingle(),
    supa.from("ed_contactos").select("chat_id").eq("cliente_id", clienteId).eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat", codigo: "sin_acceso" };

  const { error } = await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo, actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );
  if (error) return { ok: false, error: "No se pudo cambiar el modo del chat", codigo: "registro" };

  if (modo === "bot" || modo === "humano") {
    await cerrarEscalacionesPendientes(supa, {
      empleadoIds: await idsEmpleadosDeCliente(clienteId),
      chatId,
      clienteId,
    });
  }

  return { ok: true };
}

/**
 * Una persona del negocio le responde al cliente.
 *
 * El orden de los pasos NO es casual y cada uno viene de un bug real:
 *  1. Silenciar al bot ANTES de esperar a WhatsApp, para que una respuesta de
 *     la IA en vuelo no hable encima de la persona. Si el envío falla, se
 *     restaura el modo anterior.
 *  2. Elegir el CANAL antes que el transporte: un chat de Instagram tiene
 *     `chat_id = ig:<IGSID>`, que no es un teléfono; mandarlo por WhatsApp es
 *     mandarlo a la nada, y el portal lo daba por enviado (bug 17-ago-2026).
 *  3. Guardar el mensaje CON el id del envío: WhatsApp devuelve por el webhook
 *     el mismo mensaje que acabamos de mandar, y sin el id ese eco se inserta
 *     otra vez como mensaje humano — duplicado en el inbox y en el contexto de
 *     la IA (bug auditoría 1-ago-2026).
 */
export async function enviarComoHumano(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  texto: string;
  /** Clave del anti-abuso: identifica a QUIÉN se le cuenta el ritmo. */
  limiteClave: string;
  supa?: SupabaseClient;
}): Promise<ResultadoEnvio> {
  const { clienteId, empleadoId, chatId, limiteClave } = params;
  const texto = params.texto.trim();
  const supa = params.supa ?? db();

  if (!empleadoId || !chatId || !texto) return { ok: false, error: "Faltan datos" };
  if (texto.length > 4000) return { ok: false, error: "El mensaje es demasiado largo" };

  // Anti-abuso: si un acceso se ve comprometido, esto impide usar el número de
  // WhatsApp del negocio para spam masivo (y que WhatsApp lo suspenda).
  if (!(await limitarDistribuido(`enviar:${limiteClave}`, 40, 60)).ok) {
    return { ok: false, error: "Demasiados mensajes seguidos. Espera un momento.", codigo: "limite" };
  }

  // Tanto el empleado como el destinatario tienen que ser de este tenant. Sin
  // validar el contacto, una petición forjada podía usar el número del negocio
  // para escribirle a un teléfono arbitrario.
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa.from("ed_empleados").select("id").eq("id", empleadoId).eq("cliente_id", clienteId).maybeSingle(),
    supa.from("ed_contactos").select("chat_id").eq("cliente_id", clienteId).eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat", codigo: "sin_acceso" };

  const esInstagram = chatId.startsWith("ig:");

  const transporte = esInstagram ? null : await transporteSalida(clienteId);
  if (transporte?.tipo === "error") return { ok: false, error: transporte.error, codigo: "canal" };

  /**
   * VENTANA DE 24 H, ANTES DE MANDAR (auditoría 3-sep-2026).
   *
   * Meta acepta el POST de un texto libre fuera de la ventana y lo rechaza
   * DESPUÉS, por el webhook, con el 131047. O sea que el portal daba el
   * mensaje por enviado (✓, escalación cerrada, historial guardado) y el
   * cliente nunca lo recibía. El cobro ya chequeaba esto; el texto normal, no.
   * Ante la duda `ventanaAbierta` dice false: prefiero pedir una plantilla de
   * más a un mensaje que "salió" y no llegó.
   */
  if (transporte?.tipo === "cloud" && !(await ventanaAbierta({ clienteId, chatId, supa }))) {
    return {
      ok: false,
      codigo: "ventana_cerrada",
      error:
        "Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp no entrega texto libre. " +
        "Retoma la conversación con una plantilla.",
    };
  }

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat", codigo: "registro" };

  let envio: { ok: boolean; waId?: string; error?: string };
  if (esInstagram) {
    const cuenta = await cuentaIgDeCliente(clienteId);
    if (!cuenta) {
      await restaurarControl(supa, empleadoId, chatId, control);
      return { ok: false, error: "Este negocio no tiene Instagram conectado", codigo: "canal" };
    }
    envio = await enviarTextoInstagram(cuenta, chatId.slice(3), texto, { sinEspera: true });
  } else {
    // `sinEspera`: lo escribió una PERSONA. La pausa de "escribiendo…" existe
    // para que el bot no parezca bot; acá solo agregaría segundos de espera a
    // alguien que ya está mirando la pantalla.
    // `clienteId` en WAHA: la sesión es de UN negocio; si este no es el dueño,
    // el envío se rechaza en vez de salir por el WhatsApp ajeno.
    envio =
      transporte!.tipo === "cloud"
        ? await enviarTexto(transporte!.config, chatId, texto, { sinEspera: true })
        : await enviarTextoWaha(chatId, texto, { clienteId, sinEspera: true });
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: explicarErrorMeta(envio.error, "mensaje"), codigo: "proveedor" };
  }

  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto,
    waId: envio.waId,
    canal: esInstagram ? "instagram" : "whatsapp",
  });
  if (!guardado.ok) {
    // El mensaje sí salió, pero sin historial el próximo turno de la IA tendría
    // contexto falso. Se deja el chat en humano para obligar a revisarlo.
    return {
      ok: false,
      enviado: true,
      codigo: "registro",
      error: "El mensaje salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }

  // La escalación se cierra recién DESPUÉS de confirmar envío y persistencia,
  // y por CHAT (todos los empleados del cliente): la derivación pudo haberla
  // abierto Tino aunque quien responde figure bajo Beto o Vera.
  await cerrarEscalacionesPendientes(supa, {
    empleadoIds: await idsEmpleadosDeCliente(clienteId),
    chatId,
    clienteId,
  });

  // Si el dueño lo tenía pausado, sigue pausado (ver conservarPausa).
  await conservarPausa(supa, empleadoId, chatId, control);

  return { ok: true, mensajeId: guardado.id };
}
