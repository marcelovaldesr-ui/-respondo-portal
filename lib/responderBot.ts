import { db } from "@/lib/db";
import { armarPrompt, type MensajePrueba } from "@/lib/promptEmpleado";
import { generarJSON } from "@/lib/gemini";
import { enviarTexto, type ConfigWhatsApp } from "@/lib/whatsapp";
import { etiquetasDesdeMotor } from "@/lib/etiquetas";
import { guardarMensaje } from "@/lib/mensajes";
import { modoDe, setModo } from "@/lib/estadoChat";

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

  // ANTI-CARRERA: Gemini tardó unos segundos; si en ese lapso una persona tomó
  // el control (o se pausó), NO se envía la respuesta ya obsoleta. Se re-lee el
  // modo justo antes de mandar. Esto evita que Tino "hable encima" del humano.
  const modoAhora = await modoDe(empleadoId, chatId, supa);
  if (modoAhora !== "bot") {
    return { accion: "silencio_carrera", detalle: `modo cambió a ${modoAhora}` };
  }

  // Enviar por WhatsApp. Opción A: usa el sender pasado (Evolution). Opción B:
  // usa la Cloud API con cfg. Sin ninguno de los dos, queda solo guardado.
  const envio = params.enviar
    ? await params.enviar(chatId, texto)
    : cfg
      ? await enviarTexto(cfg, chatId, texto)
      : { ok: false, error: "sin transporte configurado" };

  // Guardar la respuesta del asistente con el id que devolvió el envío. Ese id
  // permite reconocer luego su ECO en el webhook y NO tratarlo como intervención
  // humana (ver lib/inboundEvolution.ts). Idempotente: guardarMensaje ignora
  // duplicados por el índice único de la migración 212.
  await guardarMensaje(supa, {
    empleadoId,
    chatId,
    rol: "empleado",
    texto,
    waId: "waId" in envio ? (envio as { waId?: string }).waId : undefined,
    canal: "whatsapp",
  });

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
