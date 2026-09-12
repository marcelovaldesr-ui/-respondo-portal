/**
 * BASE EN MEMORIA PARA PRUEBAS DE CICLO COMPLETO (Fase 0, 11-sep-2026).
 *
 * Emula lo justo de PostgREST para correr el código real de punta a punta sin
 * red ni base: filtros (eq, neq, in, is, gte, lte, lt, gt, not, contains),
 * rutas JSON (`variables->>campo`), order/limit, count head, insert/update/
 * delete con `.select()` de retorno, y restricciones únicas (incluidas las
 * PARCIALES, que es donde estaba el bug de las propuestas de Beto: un upsert
 * con onConflict contra un índice parcial devuelve 42P10).
 *
 * No es un Postgres: no hay joins ni RLS. Sirve para verificar la lógica.
 */
let secuencia = 0;

function valorDe(fila, col) {
  const m = /^(\w+)->>?(\w+)$/.exec(col);
  if (m) {
    const obj = fila[m[1]];
    const v = obj && typeof obj === "object" ? obj[m[2]] : undefined;
    return v === undefined ? null : v;
  }
  return fila[col] === undefined ? null : fila[col];
}

function comparar(a, b) {
  if (a === null || b === null) return NaN;
  const ta = typeof a === "string" && /^\d{4}-\d\d-\d\dT/.test(a) ? Date.parse(a) : a;
  const tb = typeof b === "string" && /^\d{4}-\d\d-\d\dT/.test(b) ? Date.parse(b) : b;
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

function cumple(fila, [op, col, a, b]) {
  const v = valorDe(fila, col);
  switch (op) {
    case "eq": return v === a || (v !== null && a !== null && String(v) === String(a));
    case "neq": return !(v === a);
    case "in": return a.includes(v);
    case "is": return a === null ? v === null : v === a;
    case "gte": return comparar(v, a) >= 0;
    case "lte": return comparar(v, a) <= 0;
    case "gt": return comparar(v, a) > 0;
    case "lt": return comparar(v, a) < 0;
    case "not":
      if (a === "is" && b === null) return v !== null;
      if (a === "eq") return v !== b;
      throw new Error(`not.${a} no emulado`);
    case "contains":
      if (Array.isArray(a)) return Array.isArray(v) && a.every((x) => v.includes(x));
      return v && Object.entries(a).every(([k, x]) => v[k] === x);
    case "overlaps":
      return Array.isArray(v) && a.some((x) => v.includes(x));
    case "or":
      // Subconjunto de la sintaxis de PostgREST: "col.op.valor,col.op.valor"
      // con op ∈ eq | in.(a,b) | cs.{a,b} | is. Suficiente para las consultas del portal.
      return partirOr(col).some(([c, o, val]) => {
        if (o === "in") return cumple(fila, ["in", c, val.replace(/^\(|\)$/g, "").split(",")]);
        if (o === "cs") return cumple(fila, ["contains", c, val.replace(/^\{|\}$/g, "").split(",")]);
        if (o === "is") return cumple(fila, ["is", c, val === "null" ? null : val]);
        return cumple(fila, [o, c, val]);
      });
    default:
      throw new Error(`filtro ${op} no emulado`);
  }
}

function partirOr(expr) {
  const partes = [];
  let actual = "";
  let nivel = 0;
  for (const ch of expr) {
    if (ch === "(" || ch === "{") nivel++;
    if (ch === ")" || ch === "}") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(actual);
      actual = "";
    } else actual += ch;
  }
  if (actual) partes.push(actual);
  return partes.map((p) => {
    const [c, o, ...resto] = p.split(".");
    return [c, o, resto.join(".")];
  });
}

/**
 * @param {Record<string, object[]>} tablas
 * @param {{ unicos?: Record<string, {cols: string[], donde?: (f: object) => boolean}[]>, defaults?: Record<string, object> }} esquema
 */
export function crearBaseMemoria(tablas = {}, esquema = {}) {
  const llamadas = [];
  const tabla = (n) => (tablas[n] ??= []);

  function violaUnico(nombre, fila, ignorar) {
    for (const u of esquema.unicos?.[nombre] ?? []) {
      if (u.donde && !u.donde(fila)) continue;
      const choca = tabla(nombre).some(
        (o) => o !== ignorar && (!u.donde || u.donde(o)) && u.cols.every((c) => o[c] === fila[c]),
      );
      if (choca) return true;
    }
    return false;
  }

  function builder(nombre) {
    const q = { tabla: nombre, op: "select", filtros: [], orden: [], limite: null, unico: null, head: false, retorno: false, payload: null, opciones: null };
    llamadas.push(q);
    const b = {
      select(_cols, opts) {
        if (q.op === "select") {
          q.head = Boolean(opts?.head);
          q.count = opts?.count;
        } else {
          q.retorno = true;
        }
        return b;
      },
      insert(p) { q.op = "insert"; q.payload = p; return b; },
      update(p) { q.op = "update"; q.payload = p; return b; },
      upsert(p, o) { q.op = "upsert"; q.payload = p; q.opciones = o ?? null; return b; },
      delete() { q.op = "delete"; return b; },
      order(col, o) { q.orden.push([col, o?.ascending !== false]); return b; },
      limit(n) { q.limite = n; return b; },
      range(a, z) { q.rango = [a, z]; return b; },
      maybeSingle() { q.unico = "maybe"; return b; },
      single() { q.unico = "single"; return b; },
      then(res, rej) {
        return Promise.resolve().then(() => ejecutar(q)).then(res, rej);
      },
    };
    for (const f of ["eq", "neq", "in", "is", "gte", "lte", "lt", "gt", "not", "contains", "overlaps"]) {
      b[f] = (...args) => { q.filtros.push([f, ...args]); return b; };
    }
    b.or = (expr) => { q.filtros.push(["or", expr]); return b; };
    return b;
  }

  function ejecutar(q) {
    const filas = tabla(q.tabla);
    const coinciden = () => filas.filter((f) => q.filtros.every((x) => cumple(f, x)));
    const salida = (lista) => {
      let l = [...lista];
      for (const [col, asc] of [...q.orden].reverse()) {
        l.sort((x, y) => (asc ? 1 : -1) * (comparar(valorDe(x, col), valorDe(y, col)) || 0));
      }
      if (q.rango) l = l.slice(q.rango[0], q.rango[1] + 1);
      if (q.limite != null) l = l.slice(0, q.limite);
      if (q.unico) {
        if (l.length > 1) return { data: null, error: { code: "PGRST116", message: "más de una fila" } };
        return { data: l[0] ? { ...l[0] } : null, error: null };
      }
      return { data: l.map((x) => ({ ...x })), error: null };
    };

    if (q.op === "select") {
      const l = coinciden();
      if (q.head) return { data: null, count: l.length, error: null };
      return { ...salida(l), count: q.count ? l.length : null };
    }
    if (q.op === "insert") {
      const nuevas = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((p) => ({
        id: `id-${++secuencia}`,
        creado_en: new Date(Date.UTC(2026, 0, 1) + secuencia * 1000).toISOString(),
        ...(esquema.defaults?.[q.tabla] ?? {}),
        ...p,
      }));
      for (const n of nuevas) {
        if (violaUnico(q.tabla, n)) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
      }
      filas.push(...nuevas);
      return q.retorno ? salida(nuevas) : { data: null, error: null };
    }
    if (q.op === "upsert") {
      const cols = String(q.opciones?.onConflict ?? "id").split(",");
      const unicos = esquema.unicos?.[q.tabla] ?? [];
      const calza = unicos.find((u) => u.cols.join(",") === cols.join(","));
      if (cols.join(",") !== "id" && calza?.donde) {
        return { data: null, error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } };
      }
      for (const p of Array.isArray(q.payload) ? q.payload : [q.payload]) {
        const previa = filas.find((f) => cols.every((c) => f[c] === p[c]));
        if (previa) Object.assign(previa, p);
        else filas.push({ id: `id-${++secuencia}`, ...(esquema.defaults?.[q.tabla] ?? {}), ...p });
      }
      return { data: null, error: null };
    }
    if (q.op === "update") {
      const l = coinciden();
      for (const f of l) {
        const tentativa = { ...f, ...q.payload };
        if (violaUnico(q.tabla, tentativa, f)) return { data: null, error: { code: "23505", message: "duplicate key" } };
      }
      for (const f of l) Object.assign(f, q.payload);
      return q.retorno ? salida(l) : { data: null, error: null };
    }
    if (q.op === "delete") {
      const l = coinciden();
      tablas[q.tabla] = filas.filter((f) => !l.includes(f));
      return q.retorno ? salida(l) : { data: null, error: null };
    }
    throw new Error(`op ${q.op} no emulada`);
  }

  return {
    tablas,
    llamadas,
    from: (n) => builder(n),
    rpc: async () => ({ data: null, error: { message: "rpc no emulada" } }),
  };
}
