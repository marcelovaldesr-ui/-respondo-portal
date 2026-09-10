import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generarJSON } from "@/lib/gemini";
import {
  MENSAJES_HILO,
  MENSAJES_MINIMOS,
  construirPrompt,
  interpretar,
  type MensajeHilo,
  type VeredictoJuez,
} from "@/lib/juezCotizacionCore";

/**
 * EL JUEZ, CONECTADO: lee el hilo de verdad y le pregunta al modelo.
 *
 * Las reglas viven en `juezCotizacionCore.ts` (puro y probado). Acá solo está
 * la plomería: traer los mensajes correctos y llamar al modelo una vez.
 *
 * ⚠️ CUÁNDO SE LLAMA. **Solo después de que la reja aprobó al candidato.** La
 * reja (`decidirCotizacion`) descarta el 99% sin gastar un peso; el juez es la
 * segunda vuelta sobre los pocos que quedan. Al revés sería pagarle al modelo
 * por leer 300 conversaciones para descartar 290 que un `if` descarta gratis.
 *
 * COSTO REAL: ~2-3k tokens por candidato con Gemini Flash. Con 10 candidatos al
 * día son centavos — contra los ~$85 que cuesta cada plantilla que el juez
 * evita mandar de más.
 */

/** Los empleados de un cliente. El hilo se arma con los mensajes de TODOS. */
export async function empleadosDelCliente(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<string[]> {
  const { data } = await supa.from("ed_empleados").select("id").eq("cliente_id", clienteId);
  return (data ?? []).map((e) => e.id as string);
}

/**
 * Los últimos mensajes de una conversación, de todos los empleados del cliente.
 *
 * ⚠️ SE PIDEN DESCENDENTE Y SE DAN VUELTA. Pedirlos ascendente con `limit`
 * devuelve los MÁS VIEJOS —el mismo error que en septiembre hizo que "quién
 * habló último" fuera un mensaje de hacía tres semanas— y acá dejaría al juez
 * leyendo el principio de la conversación en vez del final, que es justo donde
 * se ve si la cotización se cerró.
 */
export async function hiloReciente(p: {
  chatId: string;
  empleadoIds: string[];
  limite?: number;
  supa?: SupabaseClient;
}): Promise<MensajeHilo[]> {
  const supa = p.supa ?? db();
  if (!p.empleadoIds.length) return [];

  const { data } = await supa
    .from("ed_mensajes")
    .select("rol, texto, creado_en")
    .eq("chat_id", p.chatId)
    .in("empleado_id", p.empleadoIds)
    .order("creado_en", { ascending: false })
    .limit(p.limite ?? MENSAJES_HILO);

  return (data ?? [])
    .reverse()
    .map((m) => ({
      rol: (m.rol as string) ?? "",
      texto: (m.texto as string) ?? "",
      creadoEn: (m.creado_en as string) ?? null,
    }));
}

/**
 * ¿Esta cotización quedó abierta? Una llamada al modelo, una respuesta cerrada.
 *
 * Nunca lanza: cualquier fallo —el modelo caído, la base sin responder, una
 * respuesta ilegible— devuelve `abierta: null`, que NO envía. El error se
 * conserva en `motivo` para que la página de aprobación pueda mostrarlo en vez
 * de que el candidato desaparezca sin explicación.
 */
export async function juzgarCotizacion(p: {
  chatId: string;
  negocio: string;
  diasEsperando: number;
  empleadoIds: string[];
  supa?: SupabaseClient;
  /**
   * Timestamp absoluto después del cual ya no se llama al modelo. El cron muere
   * a los 60 s: sin esto, diez candidatos con el modelo lento se llevan la
   * función entera y no alcanza a correr ni el latido. Ver `lib/presupuesto.ts`.
   */
  fechaLimite?: number;
  /** Para probar sin gastar: recibe el prompt y devuelve el crudo del modelo. */
  llamarModelo?: (prompt: string) => Promise<string>;
}): Promise<VeredictoJuez & { mensajes: MensajeHilo[] }> {
  let mensajes: MensajeHilo[] = [];
  try {
    mensajes = await hiloReciente({
      chatId: p.chatId,
      empleadoIds: p.empleadoIds,
      supa: p.supa,
    });
  } catch (e) {
    return {
      abierta: null,
      cotizado: "",
      motivo: `no se pudo leer el hilo: ${(e as Error).message}`,
      mensajes: [],
    };
  }

  if (mensajes.length < MENSAJES_MINIMOS) {
    return {
      abierta: false,
      cotizado: "",
      motivo: `el hilo tiene ${mensajes.length} mensaje(s): no hay cotización que juzgar`,
      mensajes,
    };
  }

  const prompt = construirPrompt({
    negocio: p.negocio,
    mensajes,
    diasEsperando: p.diasEsperando,
  });

  let crudo = "";
  try {
    crudo = p.llamarModelo
      ? await p.llamarModelo(prompt)
      : await llamarModeloPorDefecto(prompt, p.fechaLimite);
  } catch (e) {
    return {
      abierta: null,
      cotizado: "",
      motivo: `el juez no respondió: ${(e as Error).message}`,
      mensajes,
    };
  }

  /**
   * ⚠️ ACÁ ES DONDE SE CAYÓ EL VIGILANTE. `crudo` es un STRING; `interpretar`
   * es el único que lo convierte, y lo hace tolerando cercas de markdown y
   * texto alrededor. Nunca leer `.abierta` de `crudo` directamente.
   */
  return { ...interpretar(crudo), mensajes };
}

/**
 * La llamada real al modelo.
 *
 * `thinkingBudget: 0` porque la pregunta es de LECTURA, no de razonamiento
 * largo: sin tope, Gemini se toma entre 25 y 43 s impredecibles en tareas
 * analíticas (medido 31-jul). Dos intentos y 25 s de techo porque esto corre en
 * un cron de fondo, no con un cliente esperando en WhatsApp.
 *
 * Se exporta con nombre para que la simulación y las pruebas puedan reemplazarla
 * sin tocar `juzgarCotizacion`.
 */
export async function llamarModeloPorDefecto(
  prompt: string,
  fechaLimite?: number,
): Promise<string> {
  return generarJSON(prompt, {
    timeoutMs: 25_000,
    intentosPorModelo: 2,
    thinkingBudget: 0,
    fechaLimite,
  });
}
