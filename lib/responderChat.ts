import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { cuentaIgDeCliente, enviarTextoInstagram } from "@/lib/instagram";
import { guardarMensaje } from "@/lib/mensajes";
import { limitarDistribuido } from "@/lib/seguridad";
import { restaurarControl, tomarControlTemporal, transporteSalida, type Modo } from "@/lib/controlChat";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";

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

export type ResultadoEnvio = { ok: boolean; error?: string; enviado?: boolean };

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

/** Cambia el modo del chat y cierra la escalación si se le devuelve a la IA. */
export async function fijarModo(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  modo: Modo;
  supa?: SupabaseClient;
}): Promise<ResultadoEnvio> {
  const { clienteId, empleadoId, chatId, modo } = params;
  const supa = params.supa ?? db();

  // Barrera de acceso: el empleado tiene que ser de este cliente. Sin esto, un
  // id cambiado en la petición dejaría pausar el asistente de otro negocio.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (!empleado) return { ok: false, error: "Sin acceso a este chat" };

  await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo, actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );

  // Devolverle el control al asistente cierra la escalación pendiente: si no,
  // la conversación seguiría apareciendo como "te espera" para siempre.
  if (modo === "bot") {
    await cerrarEscalacionesPendientes(supa, { empleadoIds: [empleadoId], chatId, clienteId });
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
    return { ok: false, error: "Demasiados mensajes seguidos. Espera un momento." };
  }

  // Tanto el empleado como el destinatario tienen que ser de este tenant. Sin
  // validar el contacto, una petición forjada podía usar el número del negocio
  // para escribirle a un teléfono arbitrario.
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa.from("ed_empleados").select("id").eq("id", empleadoId).eq("cliente_id", clienteId).maybeSingle(),
    supa.from("ed_contactos").select("chat_id").eq("cliente_id", clienteId).eq("chat_id", chatId).maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat" };

  const transporte = await transporteSalida(clienteId);
  if (transporte.tipo === "error") return { ok: false, error: transporte.error };

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat" };

  const esInstagram = chatId.startsWith("ig:");

  let envio: { ok: boolean; waId?: string; error?: string };
  if (esInstagram) {
    const cuenta = await cuentaIgDeCliente(clienteId);
    if (!cuenta) {
      await restaurarControl(supa, empleadoId, chatId, control);
      return { ok: false, error: "Este negocio no tiene Instagram conectado" };
    }
    envio = await enviarTextoInstagram(cuenta, chatId.slice(3), texto, { sinEspera: true });
  } else {
    // `sinEspera`: lo escribió una PERSONA. La pausa de "escribiendo…" existe
    // para que el bot no parezca bot; acá solo agregaría segundos de espera a
    // alguien que ya está mirando la pantalla.
    envio =
      transporte.tipo === "cloud"
        ? await enviarTexto(transporte.config, chatId, texto, { sinEspera: true })
        : await enviarTextoWaha(chatId, texto);
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: envio.error || `${esInstagram ? "Instagram" : "WhatsApp"} rechazó el envío` };
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
      error: "El mensaje salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }

  // La escalación se cierra recién DESPUÉS de confirmar envío y persistencia.
  await cerrarEscalacionesPendientes(supa, { empleadoIds: [empleadoId], chatId, clienteId });

  return { ok: true };
}
