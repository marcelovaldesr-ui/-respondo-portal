import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ultimaSalidaPorChat } from "@/lib/ultimaSalida";

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
 * QUÉ CUENTA COMO "ESPERANDO" (ampliado el 2-sep-2026)
 * ----------------------------------------------------
 *  a) `sin_respuesta`: el último mensaje es del cliente y nadie del negocio
 *     —ni persona ni Tino— contestó después.
 *  b) `derivada_sin_atender`: Tino derivó al equipo («le aviso al equipo para
 *     que te responda») y desde entonces ninguna PERSONA le escribió al
 *     cliente. El último mensaje es de Tino, así que (a) no lo ve — pero el
 *     cliente está igual de esperando. En Impresora Color había 234
 *     derivaciones sin atender y esta lista no mostraba ninguna.
 *
 * SOLO LECTURA. No toca `ed_chat_estado`, no cambia `modo`, no le escribe al
 * cliente. Es exactamente lo que el puente externo ya hace para leer una
 * conversación (`app/api/externo/conversacion`), pero para muchas a la vez.
 */

export type MotivoEspera = "sin_respuesta" | "derivada_sin_atender";

export type ConversacionEsperando = {
  chatId: string;
  /** Última vez que escribió el cliente y nadie del negocio le contestó después. */
  ultimoEntranteEn: string;
  /** Cuándo se tocó por última vez el estado de esta conversación. */
  actualizadoEn: string | null;
  /** Si el vigilante ya la revisó al menos una vez (y, si no pudo resolverla, ya avisó por push). */
  yaRevisadaPorVigilante: boolean;
  horasEsperando: number;
  motivo: MotivoEspera;
};

const LIMITE_CANDIDATOS = 500;

/**
 * Conversaciones en modo "humano" donde el cliente sigue esperando a alguien
 * del negocio (ver los dos motivos arriba). Es la señal dura de "esto se quedó
 * sin seguimiento", sin opinar de si la persona ya lo tenía controlado por
 * fuera (llamada, WhatsApp personal, etc.) — eso lo decide quien lo mire.
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

  /**
   * Última respuesta del negocio por chat. Paginado (`lib/ultimaSalida.ts`):
   * la versión anterior hacía una sola consulta con `.limit(2000)`, PostgREST
   * la cortaba en 1.000 filas sin avisar, y 92 conversaciones que SÍ tenían
   * respuesta salían acá como "sin responder". Un tercio de la alerta era
   * falso (medido el 2-sep-2026).
   *
   * `desde`: nada anterior al entrante más antiguo puede cambiar el veredicto
   * de ningún candidato (vienen ordenados ascendente, así que es el primero).
   */
  const chatIds = candidatos.map((c) => c.chat_id as string);
  const ultimaSalida = await ultimaSalidaPorChat({
    supa,
    empleadoIds: empIds,
    chatIds,
    desde: candidatos[0].ultimo_entrante_en as string,
  });

  /**
   * Derivaciones que nadie marcó como atendidas. `atendida_en` casi nunca se
   * marca (solo al «Devolver a Tino»), así que NO se confía en ese campo para
   * decir que ya la vieron: lo que la cierra es que una persona haya escrito
   * después de la derivación.
   */
  const { data: escalaciones } = await supa
    .from("ed_escalaciones")
    .select("chat_id, creado_en")
    .in("empleado_id", empIds)
    .in("chat_id", chatIds)
    .is("atendida_en", null)
    .order("creado_en", { ascending: false })
    .limit(1000);
  const ultimaDerivacion = new Map<string, string>();
  for (const e of escalaciones ?? []) {
    const chatId = e.chat_id as string;
    if (!ultimaDerivacion.has(chatId)) ultimaDerivacion.set(chatId, e.creado_en as string);
  }

  const ahora = Date.now();
  const out: ConversacionEsperando[] = [];
  for (const c of candidatos) {
    const chatId = c.chat_id as string;
    const entranteEn = c.ultimo_entrante_en as string;
    const salida = ultimaSalida.get(chatId) ?? { cualquiera: null, humano: null };

    let motivo: MotivoEspera | null = null;
    if (!salida.cualquiera || salida.cualquiera <= entranteEn) {
      motivo = "sin_respuesta";
    } else {
      // Alguien contestó después del cliente. ¿Fue solo Tino derivando, y
      // ninguna persona lo siguió? La derivación tiene que ser de este mismo
      // episodio (posterior al último mensaje del cliente).
      const derivadaEn = ultimaDerivacion.get(chatId);
      if (derivadaEn && derivadaEn >= entranteEn && (!salida.humano || salida.humano < derivadaEn)) {
        motivo = "derivada_sin_atender";
      }
    }
    if (!motivo) continue;

    out.push({
      chatId,
      ultimoEntranteEn: entranteEn,
      actualizadoEn: (c.actualizado_en as string | null) ?? null,
      yaRevisadaPorVigilante: Boolean(c.reingreso_en),
      horasEsperando: (ahora - new Date(entranteEn).getTime()) / 3_600_000,
      motivo,
    });
  }

  return out.sort((a, b) => b.horasEsperando - a.horasEsperando);
}
