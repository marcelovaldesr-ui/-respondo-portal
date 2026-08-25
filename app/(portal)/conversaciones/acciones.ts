"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha } from "@/lib/waha";
import { cuentaIgDeCliente, enviarTextoInstagram } from "@/lib/instagram";
import { guardarMensaje } from "@/lib/mensajes";
import { limitarDistribuido } from "@/lib/seguridad";
import {
  MODOS,
  restaurarControl,
  tomarControlTemporal,
  transporteSalida,
  type Modo,
} from "@/lib/controlChat";

/**
 * Control del cliente sobre una conversación: pausar al asistente, tomar el
 * chat o devolvérselo.
 *
 * Estados de ed_chat_estado:
 *  - bot     → el asistente responde normalmente
 *  - humano  → alguien del negocio tomó la conversación; el asistente calla
 *  - pausado → nadie responde automáticamente (el dueño quiere silencio)
 *
 * SEGURIDAD: el empleado_id llega del navegador, así que se valida que sea de
 * un empleado del cliente logueado antes de escribir. Sin esa validación,
 * cambiar un id en la petición dejaría pausar el bot de otro negocio.
 */

export async function cambiarModo(formData: FormData) {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const modo = String(formData.get("modo") ?? "") as Modo;

  if (!empleadoId || !chatId || !MODOS.includes(modo)) return;

  const supa = db();

  // Barrera de acceso: el empleado tiene que pertenecer a este cliente.
  const { data: empleado } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("id", empleadoId)
    .eq("cliente_id", usuario.clienteId)
    .maybeSingle();
  if (!empleado) return;

  // upsert: puede no existir fila de estado si el chat nunca cambió de modo.
  await supa
    .from("ed_chat_estado")
    .upsert(
      { empleado_id: empleadoId, chat_id: chatId, modo, actualizado_en: new Date().toISOString() },
      { onConflict: "empleado_id,chat_id" },
    );

  // Al devolverle el control al asistente se cierra la escalación pendiente:
  // si no, la conversación seguiría apareciendo como "te espera" para siempre.
  if (modo === "bot") {
    await supa
      .from("ed_escalaciones")
      .update({ atendida_en: new Date().toISOString() })
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .is("atendida_en", null);
  }

  revalidatePath("/conversaciones");
  revalidatePath("/inicio");
}

/**
 * El humano del negocio responde al cliente desde el inbox (Opción B, Fase 3).
 * Pone el chat en modo humano, entrega por el transporte configurado y solo
 * después registra el mensaje y cierra la escalación.
 */
export async function responderComoHumano(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; enviado?: boolean }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const texto = String(formData.get("texto") ?? "").trim();
  if (!empleadoId || !chatId || !texto) return { ok: false, error: "Faltan datos" };
  if (texto.length > 4000) return { ok: false, error: "El mensaje es demasiado largo" };

  // Anti-abuso: si una sesión se ve comprometida, esto impide usar el número de
  // WhatsApp del negocio para spam masivo (y que WhatsApp lo suspenda).
  if (!(await limitarDistribuido(`enviar:${usuario.email}`, 40, 60)).ok) {
    return { ok: false, error: "Demasiados mensajes seguidos. Espera un momento." };
  }

  const supa = db();

  // Barrera de acceso: tanto el empleado como el destinatario deben pertenecer
  // al tenant. Sin validar el contacto, una acción forjada podía usar el número
  // del negocio para escribir a un teléfono arbitrario.
  const [{ data: empleado }, { data: contacto }] = await Promise.all([
    supa
      .from("ed_empleados")
      .select("id")
      .eq("id", empleadoId)
      .eq("cliente_id", usuario.clienteId)
      .maybeSingle(),
    supa
      .from("ed_contactos")
      .select("chat_id")
      .eq("cliente_id", usuario.clienteId)
      .eq("chat_id", chatId)
      .maybeSingle(),
  ]);
  if (!empleado || !contacto) return { ok: false, error: "Sin acceso a este chat" };

  const transporte = await transporteSalida(usuario.clienteId);
  if (transporte.tipo === "error") return { ok: false, error: transporte.error };

  // Silenciar al bot ANTES de esperar a WhatsApp evita que una respuesta IA en
  // vuelo hable encima del humano. Si el envío falla se restaura el modo previo.
  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat" };

  /**
   * ELEGIR EL CANAL ANTES QUE EL TRANSPORTE.
   *
   * `transporteSalida` solo distingue WAHA de Cloud API, y las dos son de
   * WhatsApp. Un chat de Instagram tiene `chat_id = ig:<IGSID>`, que no es un
   * teléfono: mandarlo por cualquiera de esas dos vías es mandarlo a la nada.
   *
   * BUG REAL (17-ago-2026): al tomar el control de una conversación de
   * Instagram, el mensaje escrito por la persona salía hacia WAHA con destino
   * "ig:1436053351910293" y no llegaba nunca. El portal lo daba por enviado y
   * lo mostraba en la bandeja, así que desde adentro parecía haber funcionado.
   * Lo destapó grabar el video de la revisión de Meta.
   */
  const esInstagram = chatId.startsWith("ig:");

  let envio: { ok: boolean; waId?: string; error?: string };
  if (esInstagram) {
    const cuenta = await cuentaIgDeCliente(usuario.clienteId);
    if (!cuenta) {
      await restaurarControl(supa, empleadoId, chatId, control);
      return { ok: false, error: "Este negocio no tiene Instagram conectado" };
    }
    envio = await enviarTextoInstagram(cuenta, chatId.slice(3), texto, { sinEspera: true });
  } else {
    // Cliente marcado como 'cloud' → Meta oficial. Resto → WAHA.
    envio =
      transporte.tipo === "cloud"
        ? // `sinEspera`: lo escribió una PERSONA. La pausa de "escribiendo…"
          // existe para que el bot no parezca bot; acá solo agregaría hasta 6 s
          // de espera a alguien que ya está mirando la pantalla.
          await enviarTexto(transporte.config, chatId, texto, { sinEspera: true })
        : await enviarTextoWaha(chatId, texto);
  }

  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return {
      ok: false,
      error: envio.error || `${esInstagram ? "Instagram" : "WhatsApp"} rechazó el envío`,
    };
  }

  // Guardar el mensaje del humano CON el id del envío. Esto es clave: WhatsApp
  // devuelve por el webhook (fromMe/eco de Coexistencia) el mismo mensaje que
  // acabamos de mandar. Si NO se guarda el id, ese eco no se reconoce y termina
  // insertado OTRA VEZ como mensaje "humano" → aparece duplicado en el inbox y
  // en el contexto de Tino (bug auditoría 1-ago-2026). Con el id, yaProcesado lo
  // reconoce como eco y lo ignora. guardarMensaje tolera que la columna
  // wa_message_id/canal no exista aún (migración 212/210 sin aplicar).
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto,
    waId: envio.ok ? envio.waId : undefined,
    // Estaba fijo en "whatsapp". Sin esto, las respuestas humanas de Instagram
    // quedaban contadas como WhatsApp y la analítica atribuía al canal
    // equivocado, sin ningún síntoma visible.
    canal: esInstagram ? "instagram" : "whatsapp",
  });
  if (!guardado.ok) {
    // El mensaje sí salió, pero sin historial el próximo turno tendría contexto
    // falso. Mantener el chat en humano obliga a revisar el incidente.
    return {
      ok: false,
      enviado: true,
      error: "El mensaje salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }

  // Cerrar la escalación recién DESPUÉS de confirmar envío + persistencia.
  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  revalidatePath("/conversaciones");
  return { ok: true };
}

/*
 * ENVÍO DE ADJUNTOS: se mudó a app/api/whatsapp/adjunto/route.ts (21-ago-2026).
 *
 * Acá vivía `enviarArchivoComoHumano`, una server action que recibía el archivo
 * EN BASE64. Se eliminó, no se dejó "por si acaso", por tres razones:
 *
 *  1. Base64 inflaba el archivo un 33% y el tope real para la persona quedaba en
 *     8 MB sin que el mensaje de error pudiera explicar por qué.
 *  2. No permitía mostrar progreso: una foto grande parecía colgada.
 *  3. **Solo sabía enviar por WAHA.** A los clientes en Cloud API —o sea a todo
 *     cliente nuevo— les respondía "llega en una próxima etapa".
 *
 * Dejar las dos convivendo era garantizar que una se quedara atrás, que es
 * exactamente lo que pasó con la lógica de versiones duplicada.
 */

/**
 * Agrega o quita una etiqueta de una conversación (manual, por el humano).
 * Las etiquetas viven en ed_contactos.etiquetas (arreglo). Se valida que el
 * contacto sea del cliente logueado.
 */
export async function cambiarEtiqueta(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const chatId = String(formData.get("chatId") ?? "");
  const etiqueta = String(formData.get("etiqueta") ?? "").trim();
  const accion = String(formData.get("accion") ?? ""); // "agregar" | "quitar"
  if (!chatId || !etiqueta || !["agregar", "quitar"].includes(accion)) return;

  const supa = db();

  // Traer el contacto (y validar cliente). Si no existe, crearlo con la etiqueta.
  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("etiquetas")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();

  const actuales: string[] = (contacto?.etiquetas as string[] | null) ?? [];
  const nuevas =
    accion === "agregar"
      ? Array.from(new Set([...actuales, etiqueta]))
      : actuales.filter((e) => e !== etiqueta);

  await supa
    .from("ed_contactos")
    .upsert(
      {
        cliente_id: usuario.clienteId,
        chat_id: chatId,
        etiquetas: nuevas,
        etiqueta: "lead",
      },
      { onConflict: "cliente_id,chat_id" },
    );

  revalidatePath("/conversaciones");
}
