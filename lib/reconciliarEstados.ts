import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { ETIQUETAS_ABIERTAS, conEtiqueta, etiquetasTrasCierre, sinEtiqueta } from "@/lib/etiquetasCiclo";
import { notificarSistemaDelCliente } from "@/lib/puenteSalida";
import { ultimaSalidaPorChat } from "@/lib/ultimaSalida";

/**
 * RECONCILIAR LO QUE LAS ETIQUETAS DICEN CON LO QUE DE VERDAD PASÓ.
 *
 * Corre en el cron único, cada 5 minutos. Dos barridos, los dos
 * deterministas (sin modelo), baratos e idempotentes:
 *
 *  1. DERIVACIONES YA ATENDIDAS. Escalaciones abiertas donde una PERSONA le
 *     escribió al cliente después. Desde hoy los caminos de entrada las
 *     cierran al vuelo (escalaciones.ts), pero quedaba el arrastre: 234 en
 *     Impresora Color. Este barrido las cierra con la fecha real en que se
 *     atendieron, así "te esperan" vuelve a decir la verdad.
 *
 *  2. CONVERSACIONES CERRADAS. Contactos en ganado o perdido:
 *       a) PERDIDO que vuelve: si el CLIENTE escribió después del cierre, la
 *          conversación se REABRE en "nuevo" (lo único seguro es que ya no
 *          está perdida; el motor y el detector la hacen avanzar desde ahí).
 *          Antes "perdido" era para siempre aunque la persona escribiera al
 *          día siguiente — Gestión sí lo reabría y los dos sistemas mostraban
 *          cosas distintas. Un GANADO que vuelve con intención nueva lo
 *          reabre el detector de cierres (cierreVentas.ts), porque ahí hay
 *          evidencia fechada; acá no se toca.
 *       b) Se limpian las etiquetas abiertas que quedaron en lo cerrado
 *          ("Cotización" en un ganado de julio) y se avisa por el puente.
 *          Cubre TODOS los caminos por los que una etapa se vuelve terminal:
 *          silencio, movimiento a mano, detector de cierres.
 *
 *  3. "AGENDADO" CONTRA LAS CITAS REALES. La etiqueta significa "tiene una
 *     cita por venir". Se pone cuando el asistente agenda y no se quitaba
 *     nunca: cita completada, cancelada o pasada, y el contacto seguía
 *     "Agendado". Ahora se pone si hay una cita activa futura y se quita si
 *     no la hay — en las dos direcciones, también para citas creadas desde
 *     el portal o la web.
 *
 * Topes por pasada explícitos: lo que no alcanza queda para el siguiente
 * latido. PostgREST corta en 1.000 sin avisar; acá nunca se le pide más.
 */

const MAX_ESCALACIONES = 200;
const MAX_CONTACTOS = 50;

export type ResumenReconciliar = {
  escalacionesCerradas: number;
  contactosLimpiados: number;
  contactosReabiertos: number;
  agendadosCorregidos: number;
};

export async function reconciliarEstados(
  supa: SupabaseClient = db(),
): Promise<ResumenReconciliar> {
  const out: ResumenReconciliar = {
    escalacionesCerradas: 0,
    contactosLimpiados: 0,
    contactosReabiertos: 0,
    agendadosCorregidos: 0,
  };

  try {
    out.escalacionesCerradas = await cerrarDerivacionesAtendidas(supa);
  } catch (e) {
    console.error("[reconciliar] derivaciones:", (e as Error).message);
  }
  try {
    const r = await revisarCerradas(supa);
    out.contactosLimpiados = r.limpiados;
    out.contactosReabiertos = r.reabiertos;
  } catch (e) {
    console.error("[reconciliar] cerradas:", (e as Error).message);
  }
  try {
    out.agendadosCorregidos = await sincronizarAgendado(supa);
  } catch (e) {
    console.error("[reconciliar] agendado:", (e as Error).message);
  }
  return out;
}

async function cerrarDerivacionesAtendidas(supa: SupabaseClient): Promise<number> {
  const { data: abiertas } = await supa
    .from("ed_escalaciones")
    .select("empleado_id, chat_id, creado_en")
    .is("atendida_en", null)
    .order("creado_en", { ascending: true })
    .limit(MAX_ESCALACIONES);
  if (!abiertas?.length) return 0;

  // empleado → cliente, para agrupar por cliente (la barrera de siempre).
  const empIds = [...new Set(abiertas.map((e) => e.empleado_id as string))];
  const { data: emps } = await supa
    .from("ed_empleados")
    .select("id, cliente_id")
    .in("id", empIds);
  const clienteDe = new Map((emps ?? []).map((e) => [e.id as string, e.cliente_id as string]));

  // Por cliente: chats con derivación abierta y la MÁS RECIENTE de cada chat.
  // Una persona "atendió" solo si escribió después de la última derivación;
  // si hay una derivación más nueva que su último mensaje, esa sigue abierta.
  const porCliente = new Map<string, Map<string, string>>();
  for (const e of abiertas) {
    const clienteId = clienteDe.get(e.empleado_id as string);
    if (!clienteId) continue;
    const chats = porCliente.get(clienteId) ?? new Map<string, string>();
    const chatId = e.chat_id as string;
    const creado = e.creado_en as string;
    const prev = chats.get(chatId);
    if (!prev || creado > prev) chats.set(chatId, creado);
    porCliente.set(clienteId, chats);
  }

  let cerradas = 0;
  for (const [clienteId, chats] of porCliente) {
    const { data: empsCli } = await supa
      .from("ed_empleados")
      .select("id")
      .eq("cliente_id", clienteId);
    const idsCli = (empsCli ?? []).map((e) => e.id as string);
    const chatIds = [...chats.keys()];
    const desde = [...chats.values()].sort()[0];
    const salidas = await ultimaSalidaPorChat({ supa, empleadoIds: idsCli, chatIds, desde });

    for (const [chatId, ultimaDerivacion] of chats) {
      const humano = salidas.get(chatId)?.humano ?? null;
      if (!humano || humano < ultimaDerivacion) continue;
      const r = await cerrarEscalacionesPendientes(supa, {
        empleadoIds: idsCli,
        chatId,
        clienteId,
        atendidaEn: humano,
      });
      cerradas += r.cerradas;
    }
  }
  return cerradas;
}

async function revisarCerradas(
  supa: SupabaseClient,
): Promise<{ limpiados: number; reabiertos: number }> {
  const out = { limpiados: 0, reabiertos: 0 };

  // (a) Reabrir perdidos: el cliente escribió DESPUÉS del cierre. Solo lo
  // automático: lo que movió una persona no se toca, ni para reabrirlo.
  const { data: conActividad } = await supa
    .from("ed_contactos")
    .select("cliente_id, chat_id, nombre, etapa, etapa_en, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol")
    .eq("etapa", "perdido")
    .eq("etapa_manual", false)
    .eq("ultimo_mensaje_rol", "cliente")
    .not("etapa_en", "is", null)
    .not("ultimo_mensaje_en", "is", null)
    .order("ultimo_mensaje_en", { ascending: false })
    .limit(MAX_CONTACTOS);

  const reabiertos = new Set<string>();
  for (const c of conActividad ?? []) {
    const etapaEn = c.etapa_en as string;
    const ultimo = c.ultimo_mensaje_en as string;
    if (ultimo <= etapaEn) continue;

    // Las etiquetas abiertas ya se limpiaron al perderla; las que queden son
    // arrastre y se limpian igual al reabrir.
    const etiquetas = etiquetasTrasCierre((c.etiquetas as string[] | null) ?? [], "perdido");
    const { error } = await supa
      .from("ed_contactos")
      .update({
        etapa: "nuevo",
        etapa_motivo: "volvio_a_escribir",
        etapa_en: new Date().toISOString(),
        etiquetas,
      })
      .eq("cliente_id", c.cliente_id)
      .eq("chat_id", c.chat_id);
    if (error) continue;
    out.reabiertos++;
    reabiertos.add(`${c.cliente_id}|${c.chat_id}`);
    avisarPuente(supa, c, "nuevo", etiquetas);
  }

  // (b) Limpiar etiquetas abiertas en lo que sigue cerrado.
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("cliente_id, chat_id, nombre, etapa, etapa_en, etiquetas, ultimo_mensaje_en, ultimo_mensaje_rol")
    .in("etapa", ["ganado", "perdido"])
    .overlaps("etiquetas", [...ETIQUETAS_ABIERTAS])
    .order("ultimo_mensaje_en", { ascending: false })
    .limit(MAX_CONTACTOS);

  for (const c of contactos ?? []) {
    if (reabiertos.has(`${c.cliente_id}|${c.chat_id}`)) continue;
    // Ganado al que el cliente le volvió a escribir: puede ser un ciclo nuevo
    // (la etiqueta fresca es la señal). Lo decide el detector con evidencia;
    // acá no se le borra la señal antes de que la mire.
    if (
      c.etapa === "ganado" &&
      c.ultimo_mensaje_rol === "cliente" &&
      c.etapa_en &&
      (c.ultimo_mensaje_en as string) > (c.etapa_en as string)
    ) {
      continue;
    }
    const actuales = (c.etiquetas as string[] | null) ?? [];
    const limpias = etiquetasTrasCierre(actuales, c.etapa as string);
    if (limpias === actuales) continue;

    const { error } = await supa
      .from("ed_contactos")
      .update({ etiquetas: limpias })
      .eq("cliente_id", c.cliente_id)
      .eq("chat_id", c.chat_id);
    if (error) continue;
    out.limpiados++;
    avisarPuente(supa, c, c.etapa as string, limpias);
  }
  return out;
}

/** Citas que todavía cuentan como "por venir". */
const CITA_ACTIVA = ["agendada", "confirmada", "reagendada"];

async function sincronizarAgendado(supa: SupabaseClient): Promise<number> {
  const ahora = new Date().toISOString();

  // Chats con una cita activa futura, por cliente.
  const { data: citas } = await supa
    .from("ed_citas")
    .select("cliente_id, chat_id")
    .in("estado", CITA_ACTIVA)
    .gte("fin", ahora)
    .not("chat_id", "is", null)
    .limit(1000);
  const conCita = new Set((citas ?? []).map((c) => `${c.cliente_id}|${c.chat_id}`));

  let corregidos = 0;

  // Tienen la etiqueta y ya no tienen cita → quitar.
  const { data: etiquetados } = await supa
    .from("ed_contactos")
    .select("cliente_id, chat_id, nombre, etapa, etiquetas, ultimo_mensaje_en")
    .contains("etiquetas", ["agendado"])
    .limit(500);
  for (const c of etiquetados ?? []) {
    if (conCita.has(`${c.cliente_id}|${c.chat_id}`)) continue;
    const actuales = (c.etiquetas as string[] | null) ?? [];
    const nuevas = sinEtiqueta(actuales, "agendado");
    if (nuevas === actuales) continue;
    const { error } = await supa
      .from("ed_contactos")
      .update({ etiquetas: nuevas })
      .eq("cliente_id", c.cliente_id)
      .eq("chat_id", c.chat_id);
    if (!error) {
      corregidos++;
      avisarPuente(supa, c, c.etapa as string, nuevas);
    }
  }

  // Tienen cita y no tienen la etiqueta → poner (cita creada desde el portal
  // o la web, donde el motor no pasó).
  if (!conCita.size) return corregidos;
  const pares = [...conCita].map((k) => k.split("|"));
  const chatIds = [...new Set(pares.map((p) => p[1]))];
  const { data: contactosConCita } = await supa
    .from("ed_contactos")
    .select("cliente_id, chat_id, nombre, etapa, etiquetas, ultimo_mensaje_en")
    .in("chat_id", chatIds)
    .limit(1000);
  for (const c of contactosConCita ?? []) {
    if (!conCita.has(`${c.cliente_id}|${c.chat_id}`)) continue;
    const actuales = (c.etiquetas as string[] | null) ?? [];
    const nuevas = conEtiqueta(actuales, "agendado");
    if (nuevas === actuales) continue;
    const { error } = await supa
      .from("ed_contactos")
      .update({ etiquetas: nuevas })
      .eq("cliente_id", c.cliente_id)
      .eq("chat_id", c.chat_id);
    if (!error) {
      corregidos++;
      avisarPuente(supa, c, c.etapa as string, nuevas);
    }
  }
  return corregidos;
}

function avisarPuente(
  supa: SupabaseClient,
  c: { cliente_id: unknown; chat_id: unknown; nombre?: unknown; ultimo_mensaje_en?: unknown },
  etapa: string,
  etiquetas: string[],
) {
  const chatId = c.chat_id as string;
  notificarSistemaDelCliente({
    evento: "etapa",
    clienteId: c.cliente_id as string,
    contacto: {
      chatId,
      nombre: (c.nombre as string | null) || null,
      canal: chatId.startsWith("ig:") ? "instagram" : "whatsapp",
      etapa,
      etiquetas,
      ultimoMensajeEn: (c.ultimo_mensaje_en as string | null) ?? null,
    },
    supa,
  });
}
