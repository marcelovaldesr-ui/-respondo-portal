import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MÉTRICAS CANÓNICAS COMPARTIDAS (Fase 0, 11-sep-2026).
 *
 * Por qué existe: el mismo concepto se contaba distinto en cada pantalla.
 *  - "Te están esperando": el menú contaba CONVERSACIONES (RPC de la 293) y la
 *    portada e Isabel contaban FILAS de ed_escalaciones. Un chat con dos
 *    derivaciones abiertas sumaba 2 → menú 52, portada 53.
 *  - "Conversaciones": la portada sumaba chats distintos por empleado leyendo
 *    ed_mensajes SIN paginar (PostgREST corta en 1.000 filas): en un negocio con
 *    miles de mensajes al mes quedaba en ~100 mientras Isabel mostraba ~380.
 *
 * Regla: una métrica que significa lo mismo sale de UNA función de acá. Las que
 * miden algo distinto a propósito llevan otro nombre en pantalla.
 */

type Supa = SupabaseClient | ReturnType<typeof db>;

/**
 * CONVERSACIONES ACTIVAS desde `desde` hasta ahora = contactos del negocio con
 * al menos un mensaje (de cualquiera) en el período.
 *
 * Se cuenta sobre `ed_contactos.ultimo_mensaje_en` (lo mantiene el trigger de
 * la migración 250 con cada mensaje): "tuvo un mensaje desde X" equivale a
 * "su último mensaje es posterior a X" cuando el período termina ahora. Es un
 * count exacto en la base, sin traer filas ni topes de 1.000.
 *
 * ⚠️ Solo vale para períodos que TERMINAN AHORA. Para un rango cerrado del
 * pasado hay que contar sobre ed_mensajes paginado (ver lib/analitica.ts).
 */
export async function contarConversacionesActivas(
  clienteId: string,
  desde: string,
  supa: Supa = db(),
): Promise<number | null> {
  const { count, error } = await supa
    .from("ed_contactos")
    .select("chat_id", { count: "exact", head: true })
    .eq("cliente_id", clienteId)
    .gte("ultimo_mensaje_en", desde);
  return error ? null : count ?? 0;
}

/**
 * TE ESTÁN ESPERANDO = conversaciones (no filas) con al menos una derivación
 * sin atender. Misma fuente que el chip «Te esperan» de la bandeja y el número
 * del menú: el RPC `ed_resumen_conversaciones_portal` (migración 293).
 *
 * Respaldo sin la migración: chats DISTINTOS de ed_escalaciones abiertas (antes
 * el respaldo contaba filas y volvía a descuadrar).
 */
export async function contarEsperando(
  clienteId: string,
  empleadoIds: string[],
  supa: Supa = db(),
): Promise<number> {
  if (!empleadoIds.length) return 0;
  const { data, error } = await supa.rpc("ed_resumen_conversaciones_portal", { p_cliente_id: clienteId });
  const fila = (Array.isArray(data) ? data[0] : data) as { espera?: number } | null;
  if (!error && typeof fila?.espera === "number") return fila.espera;

  const { data: abiertas } = await supa
    .from("ed_escalaciones")
    .select("chat_id")
    .in("empleado_id", empleadoIds)
    .is("atendida_en", null)
    .limit(1000);
  return new Set((abiertas ?? []).map((e) => e.chat_id as string)).size;
}

/** Deja una fila por chat (la primera que aparece, que con orden ascendente es la más antigua). */
export function unaPorChat<T extends { chat_id: string }>(filas: readonly T[]): T[] {
  const vistos = new Set<string>();
  const out: T[] = [];
  for (const f of filas) {
    if (vistos.has(f.chat_id)) continue;
    vistos.add(f.chat_id);
    out.push(f);
  }
  return out;
}

/**
 * Lee TODAS las filas de una consulta paginando de a 1.000 (el tope silencioso
 * de PostgREST). `armar(desde, hasta)` debe devolver la consulta con `.range`.
 */
export async function leerTodo<T>(
  armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  tope = 50_000,
): Promise<{ filas: T[]; completo: boolean }> {
  const PAGINA = 1000;
  const filas: T[] = [];
  for (let inicio = 0; inicio < tope; inicio += PAGINA) {
    const { data, error } = await armar(inicio, inicio + PAGINA - 1);
    if (error) return { filas, completo: false };
    if (!data?.length) return { filas, completo: true };
    filas.push(...data);
    if (data.length < PAGINA) return { filas, completo: true };
  }
  return { filas, completo: false };
}

/**
 * Igual que `leerTodo`, pero pide las páginas EN PARALELO (de a `concurrencia`)
 * sabiendo de antemano cuántas filas hay. Para la portada: 9.000 mensajes en
 * serie son 9 viajes seguidos; así son 2 o 3 tandas. Si el conteo falla, cae a
 * la lectura en serie.
 */
export async function leerTodoParalelo<T>(
  contar: () => PromiseLike<{ count: number | null; error: unknown }>,
  armar: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  opts: { concurrencia?: number; tope?: number } = {},
): Promise<{ filas: T[]; completo: boolean }> {
  const PAGINA = 1000;
  const tope = opts.tope ?? 50_000;
  const { count, error } = await contar();
  if (error || count === null || count === undefined) return leerTodo(armar, tope);
  const total = Math.min(count, tope);
  const paginas = Math.ceil(total / PAGINA);
  const filas: T[] = [];
  let completo = count <= tope;
  const conc = Math.max(1, opts.concurrencia ?? 4);
  for (let i = 0; i < paginas; i += conc) {
    const tanda = await Promise.all(
      Array.from({ length: Math.min(conc, paginas - i) }, (_, k) => armar((i + k) * PAGINA, (i + k + 1) * PAGINA - 1)),
    );
    for (const r of tanda) {
      if (r.error) completo = false;
      filas.push(...(r.data ?? []));
    }
  }
  return { filas, completo };
}
