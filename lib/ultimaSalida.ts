import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ÚLTIMA RESPUESTA DEL NEGOCIO, POR CONVERSACIÓN.
 *
 * POR QUÉ EXISTE (2-sep-2026)
 * ---------------------------
 * Dos lectores distintos —el vigilante de `reingresoTino.ts` y la lista de
 * "sin seguimiento" de `seguimientoPendiente.ts`— necesitan lo mismo: para un
 * puñado de chats, ¿cuándo fue la última vez que alguien del negocio (Tino o
 * una persona) le escribió al cliente? Los dos lo resolvían con UNA consulta a
 * `ed_mensajes` y un `.limit(1000/2000)`.
 *
 * El problema: PostgREST corta en 1.000 filas **sin avisar**, y este
 * repositorio ya lo había pagado una vez (analítica, 31-jul). Volvió a pasar:
 * Impresora Color tiene 3.600 salientes desde el chat pendiente más antiguo, la
 * consulta devolvía las primeras 1.000 (las más viejas, porque no había orden)
 * y a 92 conversaciones que SÍ tenían respuesta se las mostraba como
 * "sin responder" en Gestión. Un tercio de la alerta era falso.
 *
 * Acá se lee de la más reciente a la más antigua y en páginas, parando apenas
 * todos los chats pedidos ya tienen su último mensaje. Como solo interesa el
 * ÚLTIMO por chat, leer al revés hace que casi siempre alcance con una página.
 */

export type UltimaSalida = {
  /** Último mensaje que NO es del cliente (Tino o persona), o null si nunca. */
  cualquiera: string | null;
  /** Último mensaje escrito por una PERSONA del equipo (`rol = humano`). */
  humano: string | null;
};

const PAGINA = 1000;
/** Techo de páginas: 5.000 mensajes. Más que eso es otro problema. */
const MAX_PAGINAS = 5;

export async function ultimaSalidaPorChat(p: {
  supa: SupabaseClient;
  empleadoIds: string[];
  chatIds: string[];
  /** Mensajes anteriores a esto no se miran. Úsalo para acotar la lectura. */
  desde?: string;
}): Promise<Map<string, UltimaSalida>> {
  const out = new Map<string, UltimaSalida>();
  if (!p.chatIds.length || !p.empleadoIds.length) return out;

  // No se corta antes de tiempo aunque todos los chats ya tengan su
  // "cualquiera": el último mensaje de una PERSONA puede ser más antiguo que
  // el último de Tino (una derivación, un reingreso) y estar en la página
  // siguiente. Lo que acota la lectura es `desde`, no un atajo.
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    let q = p.supa
      .from("ed_mensajes")
      .select("chat_id, rol, creado_en")
      .in("empleado_id", p.empleadoIds)
      .in("chat_id", p.chatIds)
      .neq("rol", "cliente")
      .order("creado_en", { ascending: false })
      .range(pagina * PAGINA, (pagina + 1) * PAGINA - 1);
    if (p.desde) q = q.gte("creado_en", p.desde);

    const { data, error } = await q;
    if (error || !data?.length) break;

    for (const m of data) {
      const chatId = m.chat_id as string;
      const cur = m.creado_en as string;
      const prev = out.get(chatId) ?? { cualquiera: null, humano: null };
      // Viene ordenado de reciente a antiguo: el primero que aparece es el último.
      if (!prev.cualquiera) prev.cualquiera = cur;
      if (!prev.humano && m.rol === "humano") prev.humano = cur;
      out.set(chatId, prev);
    }
    if (data.length < PAGINA) break;
  }

  return out;
}
