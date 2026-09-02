import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * CONVERSACIONES QUE UNA PERSONA TOMÓ Y EL CLIENTE QUEDÓ ESPERANDO.
 *
 * POR QUÉ EXISTE
 * ---------------
 * `lib/reingresoTino.ts` ya es un vigilante que revisa esto y, cuando no puede
 * resolverlo solo (p.ej. precios, con el catálogo incompleto), avisa por push.
 * Pero tiene dos límites, a propósito:
 *
 *  1. Solo mira conversaciones DENTRO de las primeras 24 h desde que escribió
 *     el cliente. Pasado ese plazo, no las vuelve a mirar nunca más.
 *  2. El aviso es una notificación push. Si nadie la activó (o el teléfono
 *     estaba con el volumen abajo, o la pestaña no estaba instalada), avisa al
 *     vacío y nadie se entera.
 *
 * Esto es la red de contención de esas dos grietas: una lectura simple, sin
 * ventana de tiempo, que un sistema del negocio (Gestión) puede pedir cuando
 * quiera para mostrar TODO lo que sigue esperando, sin importar hace cuánto.
 *
 * SOLO LECTURA. No toca `ed_chat_estado`, no cambia `modo`, no le escribe al
 * cliente. Es exactamente lo que el puente externo ya hace para leer una
 * conversación (`app/api/externo/conversacion`), pero para muchas a la vez.
 */

export type ConversacionEsperando = {
  chatId: string;
  /** Última vez que escribió el cliente y nadie del negocio le contestó después. */
  ultimoEntranteEn: string;
  /** Cuándo se tocó por última vez el estado de esta conversación. */
  actualizadoEn: string | null;
  /** Si el vigilante ya la revisó al menos una vez (y, si no pudo resolverla, ya avisó por push). */
  yaRevisadaPorVigilante: boolean;
  horasEsperando: number;
};

const LIMITE_CANDIDATOS = 500;

/**
 * Conversaciones en modo "humano" donde el ÚLTIMO mensaje es del cliente: nadie
 * —ni una persona, ni Tino— le contestó después. Es la señal dura de "esto se
 * quedó sin seguimiento", sin opinar de si la persona ya lo tenía controlado
 * por fuera (llamada, WhatsApp personal, etc.) — eso lo decide quien lo mire.
 */
export async function seguimientoPendiente(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<ConversacionEsperando[]> {
  const { data: emps } = await supa
    .from("ed_empleados")
    .select("id")
    .eq("cliente_id", clienteId)
    .limit(50);
  const empIds = (emps ?? []).map((e) => e.id as string);
  if (!empIds.length) return [];

  // Candidatos: modo humano y con alguna vez un mensaje entrante registrado.
  // Sin ventana de tiempo — esto es justo lo que la ventana de 24h del
  // vigilante deja afuera.
  const { data: candidatos } = await supa
    .from("ed_chat_estado")
    .select("chat_id, ultimo_entrante_en, actualizado_en, reingreso_en")
    .in("empleado_id", empIds)
    .eq("modo", "humano")
    .not("ultimo_entrante_en", "is", null)
    .order("ultimo_entrante_en", { ascending: true })
    .limit(LIMITE_CANDIDATOS);

  if (!candidatos?.length) return [];

  // Última respuesta del negocio (Tino o una persona), la más reciente por
  // chat_id — no importa cuál de los empleados de este cliente la mandó, solo
  // si YA se le contestó al cliente después de su último mensaje.
  const chatIds = candidatos.map((c) => c.chat_id as string);
  const { data: salientes } = await supa
    .from("ed_mensajes")
    .select("chat_id, creado_en")
    .in("empleado_id", empIds)
    .in("chat_id", chatIds)
    .neq("rol", "cliente")
    .limit(2000);

  const ultimaSalida = new Map<string, string>();
  for (const m of salientes ?? []) {
    const chatId = m.chat_id as string;
    const cur = m.creado_en as string;
    const prev = ultimaSalida.get(chatId);
    if (!prev || cur > prev) ultimaSalida.set(chatId, cur);
  }

  const ahora = Date.now();
  const out: ConversacionEsperando[] = [];
  for (const c of candidatos) {
    const chatId = c.chat_id as string;
    const entranteEn = c.ultimo_entrante_en as string;
    const salida = ultimaSalida.get(chatId);
    if (salida && salida > entranteEn) continue; // ya le contestaron despues

    out.push({
      chatId,
      ultimoEntranteEn: entranteEn,
      actualizadoEn: (c.actualizado_en as string | null) ?? null,
      yaRevisadaPorVigilante: Boolean(c.reingreso_en),
      horasEsperando: (ahora - new Date(entranteEn).getTime()) / 3_600_000,
    });
  }

  return out.sort((a, b) => b.horasEsperando - a.horasEsperando);
}
