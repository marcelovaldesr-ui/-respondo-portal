import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "@/lib/db";
import { cerrarEscalacionesPendientes } from "@/lib/escalaciones";
import { ETIQUETAS_ABIERTAS, etiquetasTrasCierre } from "@/lib/etiquetasCiclo";
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
 *  2. CONVERSACIONES CERRADAS CON ETIQUETAS ABIERTAS. Contactos en ganado o
 *     perdido que todavía tienen "Cotización", "Posible comprador",
 *     "Necesita atención" o "Falta pago". Se limpian (etiquetasCiclo.ts) y se
 *     avisa al sistema del cliente por el puente, para que Gestión muestre lo
 *     mismo. Cubre TODOS los caminos por los que una etapa se vuelve
 *     terminal: el cierre por silencio del embudo, un movimiento a mano, y el
 *     detector de cierres.
 *
 * Topes por pasada explícitos: lo que no alcanza queda para el siguiente
 * latido. PostgREST corta en 1.000 sin avisar; acá nunca se le pide más.
 */

const MAX_ESCALACIONES = 200;
const MAX_CONTACTOS = 50;

export type ResumenReconciliar = {
  escalacionesCerradas: number;
  contactosLimpiados: number;
};

export async function reconciliarEstados(
  supa: SupabaseClient = db(),
): Promise<ResumenReconciliar> {
  const out: ResumenReconciliar = { escalacionesCerradas: 0, contactosLimpiados: 0 };

  try {
    out.escalacionesCerradas = await cerrarDerivacionesAtendidas(supa);
  } catch (e) {
    console.error("[reconciliar] derivaciones:", (e as Error).message);
  }
  try {
    out.contactosLimpiados = await limpiarEtiquetasDeCerradas(supa);
  } catch (e) {
    console.error("[reconciliar] etiquetas:", (e as Error).message);
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

async function limpiarEtiquetasDeCerradas(supa: SupabaseClient): Promise<number> {
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("cliente_id, chat_id, nombre, etapa, etiquetas, ultimo_mensaje_en")
    .in("etapa", ["ganado", "perdido"])
    .overlaps("etiquetas", [...ETIQUETAS_ABIERTAS])
    .order("ultimo_mensaje_en", { ascending: false })
    .limit(MAX_CONTACTOS);
  if (!contactos?.length) return 0;

  let limpiados = 0;
  for (const c of contactos) {
    const actuales = (c.etiquetas as string[] | null) ?? [];
    const limpias = etiquetasTrasCierre(actuales, c.etapa as string);
    if (limpias === actuales) continue;

    const { error } = await supa
      .from("ed_contactos")
      .update({ etiquetas: limpias })
      .eq("cliente_id", c.cliente_id)
      .eq("chat_id", c.chat_id);
    if (error) continue;
    limpiados++;

    const chatId = c.chat_id as string;
    notificarSistemaDelCliente({
      evento: "etapa",
      clienteId: c.cliente_id as string,
      contacto: {
        chatId,
        nombre: (c.nombre as string | null) || null,
        canal: chatId.startsWith("ig:") ? "instagram" : "whatsapp",
        etapa: c.etapa as string,
        etiquetas: limpias,
        ultimoMensajeEn: (c.ultimo_mensaje_en as string | null) ?? null,
      },
      supa,
    });
  }
  return limpiados;
}
