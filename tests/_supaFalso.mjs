/**
 * SUPABASE FALSO PARA PRUEBAS UNITARIAS (Fase 0, 11-sep-2026).
 *
 * Imita la cadena de PostgREST (`from().select().eq()...`) sin red. Cada
 * consulta queda anotada en `llamadas` con su tabla, operación, payload y
 * filtros, para poder AFIRMAR qué filtros se aplicaron (por ejemplo, que un
 * borrado lleva el filtro del negocio). La respuesta la decide la prueba con
 * `responder(llamada)` → `{ data, error, count }`.
 *
 * No toca ninguna base: sirve para probar aislamiento entre negocios y la
 * lógica de los procesos sin mandar nada a clientes reales.
 */
export function crearSupaFalso(responder = () => ({ data: null, error: null })) {
  const llamadas = [];
  const FILTROS = new Set([
    "eq", "neq", "in", "is", "gte", "lte", "lt", "gt", "not", "or", "contains",
    "ilike", "like", "filter", "match", "overlaps",
  ]);
  function builder(tabla) {
    const llamada = { tabla, op: "select", payload: null, opciones: null, filtros: [], select: null, modificadores: [] };
    llamadas.push(llamada);
    const b = {
      select(cols, opts) { if (llamada.op === "select") llamada.select = cols ?? "*"; llamada.selectOpts = opts ?? null; return b; },
      insert(p, o) { llamada.op = "insert"; llamada.payload = p; llamada.opciones = o ?? null; return b; },
      update(p, o) { llamada.op = "update"; llamada.payload = p; llamada.opciones = o ?? null; return b; },
      upsert(p, o) { llamada.op = "upsert"; llamada.payload = p; llamada.opciones = o ?? null; return b; },
      delete(o) { llamada.op = "delete"; llamada.opciones = o ?? null; return b; },
      order(...a) { llamada.modificadores.push(["order", ...a]); return b; },
      limit(n) { llamada.modificadores.push(["limit", n]); llamada.limit = n; return b; },
      range(...a) { llamada.modificadores.push(["range", ...a]); return b; },
      maybeSingle() { llamada.unico = "maybe"; return b; },
      single() { llamada.unico = "single"; return b; },
      then(res, rej) {
        let r;
        try { r = responder(llamada) ?? { data: null, error: null }; } catch (e) { return Promise.reject(e).then(res, rej); }
        return Promise.resolve({ error: null, count: null, ...r }).then(res, rej);
      },
    };
    for (const f of FILTROS) b[f] = (...args) => { llamada.filtros.push([f, ...args]); return b; };
    return b;
  }
  return {
    llamadas,
    from: (tabla) => builder(tabla),
    rpc: (nombre, args) => {
      const llamada = { tabla: `rpc:${nombre}`, op: "rpc", payload: args, filtros: [], modificadores: [] };
      llamadas.push(llamada);
      return Promise.resolve({ error: null, ...(responder(llamada) ?? { data: null }) });
    },
  };
}

/** ¿La llamada tiene este filtro exacto? */
export function tieneFiltro(llamada, op, columna, valor) {
  return llamada.filtros.some(
    (f) => f[0] === op && f[1] === columna && (valor === undefined || JSON.stringify(f[2]) === JSON.stringify(valor)),
  );
}
