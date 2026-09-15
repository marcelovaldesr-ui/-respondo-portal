import { db } from "@/lib/db";

/**
 * LA SEGUNDA BARRERA DE AISLAMIENTO DE MARKETING.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * POR QUÉ ESTO Y NO RLS. Vale la pena dejarlo escrito, porque «poner policies»
 * es la respuesta que parece obvia y en este repositorio es la equivocada:
 *
 *   · `lib/db.ts` crea UN solo cliente Supabase y usa `SUPABASE_SERVICE_ROLE_KEY`.
 *     Ese rol **bypassea RLS por diseño de Postgres**. Añadir policies no
 *     cambiaría absolutamente nada del acceso que hace el portal.
 *   · Las tablas de Marketing ya tienen `enable row level security` SIN policies.
 *     Eso no es trabajo a medias: es deny-all deliberado para `anon` y
 *     `authenticated`, el mismo patrón de `289_pagos`, `291_cierre` y `220_agenda`.
 *     **Agregarles una policy las volvería MENOS restrictivas**, no más.
 *   · No existe forma de que una policy sepa el `cliente_id`: el vínculo
 *     usuario→negocio vive en `portal_usuarios` cruzado por email, no hay
 *     `auth.uid()` en el modelo ni claims en el JWT.
 *
 * Es decir: el riesgo real no es «alguien entra con la llave pública» —esa ya
 * está cerrada—. El riesgo real es **un `.eq("cliente_id", …)` olvidado**. Una
 * policy no protege contra eso, porque service_role ni siquiera las evalúa.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * LO QUE SÍ PROTEGE, y es lo que hace este archivo, en dos capas:
 *
 *   1. NO SE PUEDE OLVIDAR. Las consultas no se escriben a mano: se piden acá y
 *      salen ya filtradas y con el `cliente_id` estampado. Un test estructural
 *      falla si algún archivo de Marketing vuelve a llamar a `db().from("ed_mk_…")`
 *      por su cuenta.
 *   2. SI IGUAL SE ESCAPA, NO SALE. Toda fila leída pasa por `soloDe()`, que
 *      verifica el `cliente_id` de cada registro antes de devolverlo. Una
 *      consulta mal armada no entrega datos ajenos: lanza y queda en el log.
 *
 * La capa 2 es la que cumple la promesa: aunque alguien construya la consulta
 * mal, los datos de otra empresa no cruzan la frontera del módulo.
 */

/** Las tablas que este módulo posee. Nada fuera de esta lista pasa por acá. */
export type TablaMarketing = "ed_mk_creatividades" | "ed_mk_campanas" | "ed_mk_contexto";

/** Error de aislamiento. Nunca debería ocurrir; si ocurre, es un bug grave. */
export class FugaDeTenant extends Error {
  constructor(tabla: string, esperado: string, encontrado: unknown) {
    super(`aislamiento: ${tabla} devolvió una fila de otro negocio`);
    this.name = "FugaDeTenant";
    console.error(
      JSON.stringify({
        evento: "marketing.fuga_tenant",
        tabla,
        cliente: esperado,
        // El id ajeno NO se registra: no hace falta para diagnosticar y sería
        // filtrar el identificador de otro negocio a nuestros logs.
        ajeno: typeof encontrado === "string" ? "otro" : "ausente",
      }),
    );
  }
}

/**
 * Lectura de una tabla del módulo, ya acotada a un negocio.
 *
 * Se usa así:
 *   const { data } = await leerDe(clienteId, "ed_mk_creatividades")
 *     .select("*").order("actualizado_en", { ascending: false });
 *   const filas = soloDe(clienteId, "ed_mk_creatividades", data);
 *
 * El `.eq("cliente_id")` ya viene puesto. `soloDe` es el cinturón.
 */
export function leerDe(clienteId: string, tabla: TablaMarketing) {
  exigirId(clienteId);
  return db().from(tabla).select("*").eq("cliente_id", clienteId);
}

/** Igual que `leerDe` pero eligiendo columnas. */
export function leerColumnas(clienteId: string, tabla: TablaMarketing, columnas: string) {
  exigirId(clienteId);
  return db().from(tabla).select(columnas).eq("cliente_id", clienteId);
}

/**
 * EL CINTURÓN. Verifica que cada fila leída sea de este negocio.
 *
 * No es paranoia decorativa: es la única capa que sigue funcionando cuando la
 * consulta se armó mal. Cuesta un recorrido de un arreglo que ya está en
 * memoria y convierte una fuga silenciosa en un error ruidoso.
 */
export function soloDe<T extends Record<string, unknown>>(
  clienteId: string,
  tabla: TablaMarketing,
  filas: T[] | null | undefined,
): T[] {
  if (!filas?.length) return [];
  for (const f of filas) {
    if (f.cliente_id !== clienteId) throw new FugaDeTenant(tabla, clienteId, f.cliente_id);
  }
  return filas;
}

/** La versión de una sola fila. `null` si no hay, error si es de otro negocio. */
export function unaDe<T extends Record<string, unknown>>(
  clienteId: string,
  tabla: TablaMarketing,
  fila: T | null | undefined,
): T | null {
  if (!fila) return null;
  return soloDe(clienteId, tabla, [fila])[0] ?? null;
}

/**
 * Escritura acotada. El `cliente_id` lo pone esta función, NUNCA el llamador:
 * así una fila no puede nacer con el identificador de otro negocio, ni siquiera
 * por descuido al armar el objeto.
 */
export function insertarEn(clienteId: string, tabla: TablaMarketing, fila: Record<string, unknown>) {
  exigirId(clienteId);
  return db()
    .from(tabla)
    .insert({ ...fila, cliente_id: clienteId })
    .select("id")
    .maybeSingle();
}

/**
 * Modificación acotada a un registro del negocio.
 *
 * `.select("id")` no es cosmético: PostgREST NO da error cuando ninguna fila
 * coincide, así que sin esto un id ajeno o borrado respondía «Guardado» sin
 * haber escrito nada. Y `cliente_id` se borra del payload: nadie reasigna una
 * fila a otro negocio desde acá.
 */
export function modificarEn(clienteId: string, tabla: TablaMarketing, id: string, cambios: Record<string, unknown>) {
  exigirId(clienteId);
  const limpio = { ...cambios };
  delete limpio.cliente_id;
  delete limpio.id;
  return db().from(tabla).update(limpio).eq("id", id).eq("cliente_id", clienteId).select("id").maybeSingle();
}

/** Borrado acotado. Devuelve la fila borrada para poder confirmar que existía. */
export function borrarEn(clienteId: string, tabla: TablaMarketing, id: string, columnas = "id") {
  exigirId(clienteId);
  return db().from(tabla).delete().eq("id", id).eq("cliente_id", clienteId).select(columnas).maybeSingle();
}

/**
 * ¿Este id pertenece a este negocio? Para los punteros que llegan del navegador.
 * Devuelve el id si sí, null si no o si viene vacío. Nunca lanza.
 */
export async function perteneceA(clienteId: string, tabla: TablaMarketing, id?: string | null): Promise<string | null> {
  if (!id) return null;
  try {
    const { data } = await db().from(tabla).select("id").eq("id", id).eq("cliente_id", clienteId).maybeSingle();
    return data ? id : null;
  } catch {
    return null;
  }
}

/**
 * Un `clienteId` vacío filtraría la tabla entera con `.eq("cliente_id", "")` o,
 * peor, con `undefined` PostgREST ignora el filtro. Se corta acá.
 */
export function exigirId(clienteId: string): void {
  if (!clienteId || typeof clienteId !== "string" || clienteId.length < 8) {
    throw new Error("aislamiento: falta el identificador del negocio");
  }
}
