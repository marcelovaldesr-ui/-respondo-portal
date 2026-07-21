import { db } from "@/lib/db";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { enviarTexto, type ConfigWhatsApp } from "@/lib/whatsapp";
import { etiquetasDesdeMotor } from "@/lib/etiquetas";

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
};

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

  // Vienen del más nuevo al más viejo: invertir. 'humano' cuenta como "nosotros".
  return (data ?? [])
    .reverse()
    .map((m) => ({
      rol: (m.rol === "cliente" ? "cliente" : "empleado") as "cliente" | "empleado",
      texto: m.texto as string,
    }));
}

/** ¿En qué modo está el chat? (bot | humano | pausado). Default bot. */
async function modoDe(empleadoId: string, chatId: string): Promise<string> {
  const { data } = await db()
    .from("ed_chat_estado")
    .select("modo")
    .eq("empleado_id", empleadoId)
    .eq("chat_id", chatId)
    .maybeSingle();
  return (data?.modo as string) ?? "bot";
}

/**
 * Genera y envía la respuesta del asistente si corresponde.
 * Devuelve un resumen de lo que hizo (útil para logs/pruebas).
 */
export async function responderSiBot(params: {
  clienteId: string;
  empleadoId: string;
  chatId: string;
  cfg: ConfigWhatsApp;
}): Promise<{ accion: string; detalle?: string }> {
  const { clienteId, empleadoId, chatId, cfg } = params;

  const modo = await modoDe(empleadoId, chatId);
  if (modo !== "bot") return { accion: "silencio", detalle: `modo ${modo}` };

  const hist = await historial(empleadoId, chatId);
  if (hist.length === 0) return { accion: "sin_historial" };

  const prompt = await armarPrompt(clienteId, empleadoId, hist);
  if (!prompt) return { accion: "sin_prompt" };

  let datos: RespuestaMotor;
  try {
    datos = JSON.parse(await generarJSON(prompt));
  } catch (e) {
    return { accion: "error_llm", detalle: (e as Error).message };
  }

  const texto =
    datos.respuesta?.trim() ||
    "Prefiero confirmar eso con el equipo para no darte un dato malo 👍";

  const supa = db();

  // Enviar por WhatsApp (si hay token configurado; en dev sin token queda solo guardado).
  const envio = await enviarTexto(cfg, chatId, texto);

  // Guardar la respuesta del asistente. Sin 'canal' explícito (lo pone el default
  // de 210); así funciona aunque 210 aún no esté aplicada.
  await supa.from("ed_mensajes").insert({
    empleado_id: empleadoId,
    chat_id: chatId,
    rol: "empleado",
    texto,
  });

  // Escalación: si el motor pide humano, silenciar el bot y registrar.
  if (datos.escalar) {
    await supa
      .from("ed_chat_estado")
      .upsert(
        { empleado_id: empleadoId, chat_id: chatId, modo: "humano" },
        { onConflict: "empleado_id,chat_id" },
      );
    await supa.from("ed_escalaciones").insert({
      empleado_id: empleadoId,
      chat_id: chatId,
      trigger: datos.trigger ?? "incertidumbre",
      resumen: datos.resumen_para_humano ?? "El asistente derivó la conversación.",
      notificado_a: [],
    });
    // TODO Fase 4: avisar a la persona (Telegram/plantilla). En Opción A ella lo
    // ve en su WhatsApp; en Opción B se le avisa por el inbox / notificación.
  }

  // Etiquetado automático de la conversación (posible comprador, cotización...).
  await autoEtiquetar(clienteId, chatId, datos);

  return {
    accion: datos.escalar ? "respondio_y_escalo" : "respondio",
    detalle: envio.ok ? "enviado" : `guardado sin enviar (${envio.error ?? "sin token"})`,
  };
}
