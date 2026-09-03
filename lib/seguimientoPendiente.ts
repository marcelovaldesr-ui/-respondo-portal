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
   * QUIÉN HABLÓ ÚLTIMO, DESDE `ed_contactos` (auditoría 3-sep-2026).
   *
   * `ultimo_mensaje_rol` / `ultimo_mensaje_en` los mantiene el trigger de la
   * migración 250 con CADA mensaje, de cualquier empleado: es exacto, gratis
   * y no depende de recorrer mensajes. La versión anterior paginaba salidas
   * desde el entrante más antiguo con techo de 5.000 filas: con 8.000
   * mensajes al mes en Impresora, ese techo iba a volver a fabricar falsos
   * "sin respuesta" (ya pasó con 1.000, el 2-sep).
   */
  const chatIds = candidatos.map((c) => c.chat_id as string);
  const { data: contactos } = await supa
    .from("ed_contactos")
    .select("chat_id, ultimo_mensaje_rol, ultimo_mensaje_en")
    .eq("cliente_id", clienteId)
    .in("chat_id", chatIds)
    .limit(LIMITE_CANDIDATOS);
  const ultimoDelContacto = new Map(
    (contactos ?? []).map((c) => [
      c.chat_id as string,
      { rol: (c.ultimo_mensaje_rol as string | null) ?? null, en: (c.ultimo_mensaje_en as string | null) ?? null },
    ]),
  );

  /**
   * Derivaciones que nadie marcó como atendidas. `atendida_en` se cierra desde
   * el 2-sep en todos los caminos (portal, teléfono, plantilla, barrido), pero
   * igual se comprueba que una PERSONA haya escrito después: es lo que de
   * verdad la cierra.
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

  /**
   * Solo para las derivadas hace falta saber si una PERSONA escribió después
   * de la derivación: se pagina (`lib/ultimaSalida.ts`) pero acotado a esos
   * chats y desde la derivación más antigua, que es un conjunto chico.
   */
  const derivados = [...ultimaDerivacion.keys()];
  const ultimaSalida = derivados.length
    ? await ultimaSalidaPorChat({
        supa,
        empleadoIds: empIds,
        chatIds: derivados,
        desde: [...ultimaDerivacion.values()].sort()[0],
      })
    : new Map<string, { cualquiera: string | null; humano: string | null }>();

  const ahora = Date.now();
  const out: ConversacionEsperando[] = [];
  for (const c of candidatos) {
    const chatId = c.chat_id as string;
    const ultimo = ultimoDelContacto.get(chatId);
    // Si el contacto tiene la fecha del último mensaje del cliente, es más
    // exacta que `ultimo_entrante_en` (que es por empleado).
    const entranteEn =
      ultimo?.rol === "cliente" && ultimo.en ? ultimo.en : (c.ultimo_entrante_en as string);

    let motivo: MotivoEspera | null = null;
    if (!ultimo || ultimo.rol === "cliente") {
      // Sin fila de contacto (raro) se asume esperando: mejor una alerta de
      // más que una conversación olvidada.
      motivo = "sin_respuesta";
    } else {
      // Alguien contestó después del cliente. ¿Fue solo Tino derivando, y
      // ninguna persona lo siguió? La derivación tiene que ser de este mismo
      // episodio (posterior al último mensaje del cliente).
      const derivadaEn = ultimaDerivacion.get(chatId);
      const humano = ultimaSalida.get(chatId)?.humano ?? null;
      if (derivadaEn && derivadaEn >= entranteEn && (!humano || humano < derivadaEn)) {
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
