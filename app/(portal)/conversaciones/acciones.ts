"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { configPorCliente, enviarTexto } from "@/lib/whatsapp";
import { enviarTextoWaha, enviarMediaWaha } from "@/lib/waha";
import { guardarMensaje } from "@/lib/mensajes";
import { limitarDistribuido } from "@/lib/seguridad";
import type { SupabaseClient } from "@supabase/supabase-js";
import { validarArchivoBase64 } from "@/lib/archivos";

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

const MODOS = ["bot", "humano", "pausado"] as const;
type Modo = (typeof MODOS)[number];

/**
 * TIPOS DE ARCHIVO PERMITIDOS (lista blanca).
 *
 * El navegador ya filtra con accept="image/*,application/pdf", pero eso es solo
 * una sugerencia de la UI: una petición manipulada (o una sesión robada) puede
 * mandar cualquier cosa. Si dejáramos pasar ejecutables o HTML, el número de
 * WhatsApp del NEGOCIO podría usarse para distribuir malware — y WhatsApp
 * suspende números por eso. La lista blanca se valida en el servidor.
 */
const MIME_PERMITIDOS = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

/** Nombre de archivo seguro: sin rutas, sin caracteres raros, con largo acotado. */
function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[/\\]/).pop() ?? "archivo"; // corta cualquier ruta
  const limpio = base.replace(/[^\w.\- ]/g, "_").slice(0, 120);
  return limpio || "archivo";
}

/**
 * Decide el transporte de SALIDA de un cliente para las respuestas del inbox.
 *
 * Regla: un cliente sale por Meta (Cloud API) SOLO si está marcado explícitamente
 * como transporte 'cloud'. Por defecto — y mientras dure la migración — todo sale
 * por WAHA. Tener credenciales de Meta cargadas NO alcanza: durante la migración
 * un cliente puede tener Meta ya preparado pero seguir ATENDIENDO por WAHA (es el
 * caso de Impresora Color). Basarse solo en "¿tiene token de Meta?" mandaba las
 * respuestas por el canal equivocado.
 *
 * Devuelve la config de Cloud API si corresponde usar Meta; null → usar WAHA.
 *
 * Defensivo: si la columna ed_clientes.transporte todavía no existe, la consulta
 * falla y se asume 'waha' (el comportamiento correcto hoy), así que esto funciona
 * aunque no se haya aplicado la migración.
 */
type TransporteSalida =
  | { tipo: "waha" }
  | { tipo: "cloud"; config: import("@/lib/whatsapp").ConfigWhatsApp }
  | { tipo: "error"; error: string };

async function transporteSalida(clienteId: string): Promise<TransporteSalida> {
  const { data, error } = await db()
    .from("ed_clientes")
    .select("transporte")
    .eq("id", clienteId)
    .maybeSingle();
  if (error) {
    return { tipo: "error", error: "No se pudo determinar el canal de salida." };
  }
  const transporte = (data?.transporte as string | null) ?? "waha";
  if (transporte !== "cloud") return { tipo: "waha" };
  const config = await configPorCliente(clienteId);
  // Nunca caer a la sesión WAHA global si un cliente Cloud quedó sin token.
  // Son transportes distintos y usar el fallback equivocado puede enviar desde
  // el número de otro negocio.
  if (!config) return { tipo: "error", error: "El número de Meta no tiene credenciales válidas." };
  return { tipo: "cloud", config };
}

type ControlTemporal = { marca: string; modoAnterior: Modo; existia: boolean };

/** Silencia al bot durante el envío y permite revertir sin pisar cambios concurrentes. */
async function tomarControlTemporal(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
): Promise<ControlTemporal | null> {
  const { data: anterior, error: lecturaError } = await supa
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();
  if (lecturaError) return null;

  const marca = new Date().toISOString();
  const { error } = await supa.from("ed_chat_estado").upsert(
    { empleado_id: empleadoId, chat_id: chatId, modo: "humano", actualizado_en: marca },
    { onConflict: "empleado_id,chat_id" },
  );
  if (error) return null;
  return {
    marca,
    modoAnterior: MODOS.includes(anterior?.modo as Modo) ? (anterior?.modo as Modo) : "bot",
    existia: Boolean(anterior),
  };
}

/** Revierte solo si nadie cambió el modo después de nuestra toma temporal. */
async function restaurarControl(
  supa: SupabaseClient,
  empleadoId: string,
  chatId: string,
  control: ControlTemporal,
): Promise<void> {
  if (control.existia) {
    await supa
      .from("ed_chat_estado")
      .update({ modo: control.modoAnterior, actualizado_en: new Date().toISOString() })
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .eq("actualizado_en", control.marca);
  } else {
    await supa
      .from("ed_chat_estado")
      .delete()
      .eq("empleado_id", empleadoId)
      .eq("chat_id", chatId)
      .eq("actualizado_en", control.marca);
  }
}

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

  // Enviar por WhatsApp, eligiendo el transporte SEGÚN EL CLIENTE:
  //  - Cliente marcado como 'cloud' → Meta oficial.
  //  - Resto (por defecto) → WAHA, que es el caso de Impresora Color.
  // (Antes SIEMPRE usaba Cloud API → el texto de la persona no llegaba cuando el
  // cliente está en WAHA.)
  const envio =
    transporte.tipo === "cloud"
      ? await enviarTexto(transporte.config, chatId, texto)
      : await enviarTextoWaha(chatId, texto);
  if (!envio.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: envio.error || "WhatsApp rechazó el envío" };
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
    canal: "whatsapp",
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

/**
 * La persona del negocio envía una IMAGEN o un PDF al cliente desde el inbox.
 * Igual que responderComoHumano: toma el control (el bot calla), manda por WAHA y
 * deja registro en el historial. `data` llega en base64 (sin prefijo) desde el
 * navegador. Devuelve {ok} para que el compositor muestre el error si lo hay.
 *
 * Límite: 8MB de archivo antes de codificar. El tope real lo fija también
 * `serverActions.bodySizeLimit` en next.config.mjs; si falta, un archivo grande
 * falla con "Body exceeded limit" antes de llegar acá.
 */
export async function enviarArchivoComoHumano(
  formData: FormData,
): Promise<{ ok: boolean; error?: string; enviado?: boolean }> {
  const usuario = await obtenerUsuarioConPermiso("operar_conversaciones");
  if (!usuario) return { ok: false, error: "Sesión no válida" };

  const empleadoId = String(formData.get("empleadoId") ?? "");
  const chatId = String(formData.get("chatId") ?? "");
  const filename = nombreSeguro(String(formData.get("filename") ?? "archivo"));
  const mimetype = String(formData.get("mimetype") ?? "application/octet-stream");
  const data = String(formData.get("data") ?? "");
  const caption = String(formData.get("caption") ?? "").trim();
  if (!empleadoId || !chatId || !data) {
    return { ok: false, error: "Faltan datos del archivo" };
  }

  // ── VALIDACIÓN DEL ARCHIVO EN EL SERVIDOR (no confiar en el navegador) ──────
  if (!MIME_PERMITIDOS.has(mimetype)) {
    return {
      ok: false,
      error: "Solo se pueden enviar imágenes (JPG, PNG, WEBP, GIF) o archivos PDF.",
    };
  }
  const archivo = validarArchivoBase64(data, mimetype);
  if (!archivo.ok) {
    return {
      ok: false,
      error:
        archivo.error === "Archivo demasiado grande"
          ? "El archivo supera los 8 MB. Prueba con uno más liviano."
          : "El contenido del archivo no coincide con un formato permitido.",
    };
  }

  const supa = db();

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

  // Transporte por cliente (mismo criterio que el texto). El envío de media por
  // Cloud API todavía no está implementado; los clientes marcados como 'cloud'
  // reciben un aviso claro en vez de un envío silencioso por el canal equivocado.
  const transporte = await transporteSalida(usuario.clienteId);
  if (transporte.tipo === "error") return { ok: false, error: transporte.error };
  if (transporte.tipo === "cloud") {
    return {
      ok: false,
      error:
        "Por ahora los archivos solo se pueden enviar en los números conectados por WAHA. En Meta (Cloud API) llega en una próxima etapa.",
    };
  }

  const control = await tomarControlTemporal(supa, empleadoId, chatId);
  if (!control) return { ok: false, error: "No se pudo tomar el control del chat" };

  // Enviar por WAHA (imagen inline o documento según el mimetype).
  const r = await enviarMediaWaha(chatId, {
    data,
    mimetype,
    filename,
    caption: caption || undefined,
  });
  if (!r.ok) {
    await restaurarControl(supa, empleadoId, chatId, control);
    return { ok: false, error: r.error || "No se pudo enviar el archivo" };
  }

  // Registro en el historial CON el id del envío (ver responderComoHumano): sin
  // el id, el eco de este archivo se guardaría de nuevo como mensaje humano
  // duplicado. El portal todavía no renderiza media saliente en la línea de
  // tiempo, así que el texto es descriptivo (y el caption si lo hubo).
  const etiqueta = mimetype.startsWith("image/")
    ? "📷 Imagen enviada"
    : `📎 Archivo enviado: ${filename}`;
  const guardado = await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "humano",
    texto: caption ? `${etiqueta} — ${caption}` : etiqueta,
    waId: r.waId,
    canal: "whatsapp",
  });
  if (!guardado.ok) {
    return {
      ok: false,
      enviado: true,
      error: "El archivo salió, pero no se pudo registrar. Revisa el chat antes de continuar.",
    };
  }
  await supa
    .from("ed_escalaciones")
    .update({ atendida_en: new Date().toISOString() })
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .is("atendida_en", null);

  revalidatePath("/conversaciones");
  return { ok: true };
}

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
