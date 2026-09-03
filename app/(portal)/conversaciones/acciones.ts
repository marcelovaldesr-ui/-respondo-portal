"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { MODOS, type Modo } from "@/lib/controlChat";
import { enviarComoHumano, fijarModo } from "@/lib/responderChat";
import { alAgregar } from "@/lib/etiquetasCiclo";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { idsEmpleadosDeCliente } from "@/lib/empleadosCache";
import { notificarYEsperar } from "@/lib/puenteSalida";

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

  // El trabajo real vive en lib/responderChat.ts, compartido con la ruta de
  // API que usa la app de gestión del cliente. Acá solo va la sesión.
  await fijarModo({ clienteId: usuario.clienteId, empleadoId, chatId, modo });

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

  // Igual que arriba: el envío, la toma de control y el registro viven en
  // lib/responderChat.ts. El ritmo se cuenta por persona logueada.
  const r = await enviarComoHumano({
    clienteId: usuario.clienteId,
    empleadoId,
    chatId,
    texto,
    limiteClave: usuario.email,
  });
  if (!r.ok) return r;

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
 *
 * Tres cosas que antes no hacía (auditoría 3-sep-2026):
 *  - UPDATE y no upsert: el upsert creaba contactos para cualquier chat_id
 *    que llegara del navegador (saltando la barrera "contacto del tenant" que
 *    protege el envío) y encima reescribía `etiqueta='lead'` en cada cambio.
 *  - Marcar "resuelto" o quitar "necesita_atencion" a mano CIERRA la
 *    derivación: es lo que la persona está diciendo, y sin esto el "te espera"
 *    seguía encendido aunque la etiqueta ya no estuviera.
 *  - Avisa al sistema del cliente (Gestión) igual que los cambios
 *    automáticos: si no, el espejo de etiquetas quedaba desactualizado hasta
 *    el próximo mensaje.
 */
export async function cambiarEtiqueta(formData: FormData): Promise<void> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) throw new Error("Sesión no válida");

  const chatId = String(formData.get("chatId") ?? "");
  const etiqueta = String(formData.get("etiqueta") ?? "").trim();
  const accion = String(formData.get("accion") ?? ""); // "agregar" | "quitar"
  if (!chatId || !etiqueta || !["agregar", "quitar"].includes(accion)) return;
  // Una etiqueta es una palabra corta; lo demás no es una etiqueta.
  if (etiqueta.length > 40 || !/^[a-z0-9_\-áéíóúñü ]+$/i.test(etiqueta)) return;

  const supa = db();

  const { data: contacto } = await supa
    .from("ed_contactos")
    .select("etiquetas, nombre, etapa, etapa_manual, ultimo_mensaje_en")
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (!contacto) return;

  const actuales: string[] = (contacto.etiquetas as string[] | null) ?? [];
  // Agregar respeta las exclusiones (etiquetasCiclo): marcar "resuelto" cierra
  // el reclamo y la derivación; "cliente" reemplaza a "cliente_nuevo".
  const nuevas =
    accion === "agregar"
      ? alAgregar(actuales, [etiqueta])
      : actuales.filter((e) => e !== etiqueta);

  if (nuevas.length === actuales.length && nuevas.every((e, i) => e === actuales[i])) return;

  const { error } = await supa
    .from("ed_contactos")
    .update({ etiquetas: nuevas })
    .eq("cliente_id", usuario.clienteId)
    .eq("chat_id", chatId);
  if (error) throw new Error("No se pudo guardar la etiqueta");

  const cerroAtencion =
    (accion === "agregar" && etiqueta === "resuelto") ||
    (accion === "quitar" && etiqueta === "necesita_atencion");
  if (cerroAtencion) {
    await cerrarEscalacionesPendientes(supa, {
      empleadoIds: await idsEmpleadosDeCliente(usuario.clienteId),
      chatId,
      clienteId: usuario.clienteId,
    });
  }

  // Espejo en el sistema del cliente. Se espera (con tope corto) porque una
  // server action termina al devolver y un fire-and-forget se perdería.
  await Promise.race([
    notificarYEsperar({
      evento: "etapa",
      clienteId: usuario.clienteId,
      contacto: {
        chatId,
        nombre: (contacto.nombre as string | null) ?? null,
        canal: chatId.startsWith("ig:") ? "instagram" : "whatsapp",
        etapa: (contacto.etapa as string | null) ?? null,
        etapaManual: Boolean(contacto.etapa_manual),
        etiquetas: nuevas,
        ultimoMensajeEn: (contacto.ultimo_mensaje_en as string | null) ?? null,
      },
      supa,
    }).catch((e) => console.warn("[cambiarEtiqueta] puente:", (e as Error).message)),
    new Promise<void>((r) => setTimeout(r, 4_000)),
  ]);

  revalidatePath("/conversaciones");
}
