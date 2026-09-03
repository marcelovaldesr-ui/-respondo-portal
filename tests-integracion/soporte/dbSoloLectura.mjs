/**
 * ENVOLTORIO DE SOLO LECTURA sobre un cliente Supabase real.
 *
 * POR QUÉ EXISTE: las pruebas de integración de reconciliarEstados, cargarEmbudo
 * y revisarAbandonadas (el vigilante) corren contra la base de PRODUCCIÓN de
 * Impresora Color — así lo pidió Marcelo, para probar la lógica contra datos
 * reales en vez de fixtures inventados. Eso significa que hay que garantizar,
 * en el código y no solo "de palabra", que ninguna corrida de estas pruebas
 * puede escribir un solo byte en la base real.
 *
 * CÓMO LO GARANTIZA:
 *  - `.from(tabla)` deja pasar TODO lo de lectura (.select, .eq, .in, .order,
 *    .limit, .single, .maybeSingle, .or, .gte, .lte, .is, .neq, ...) directo al
 *    cliente real: son consultas de verdad contra la base de verdad.
 *  - `.insert / .update / .upsert / .delete` en cualquier tabla se INTERCEPTAN
 *    antes de tocar la red: nunca llegan a ejecutarse. Quedan anotados en la
 *    `bitácora` (tabla, argumentos, y cada `.eq()/.in()/...` que se encadenó
 *    después) para que la prueba pueda mostrar "esto es lo que HABRÍA hecho".
 *  - `.rpc(...)` y `.storage` se bloquean SIEMPRE, sin excepción: ninguno de
 *    los tres módulos auditados los usa hoy, así que no hace falta abrir
 *    ninguno; si en el futuro alguno los necesita, hay que sumarlos acá a
 *    propósito (ver README de esta carpeta).
 *
 * Lo prueba, sin tocar ninguna base de verdad, `tests/db-solo-lectura.test.mjs`.
 */

const METODOS_ESCRITURA = new Set(["insert", "update", "upsert", "delete"]);

/** Construye un builder "falso": encadenable como el real, pero que nunca sale a la red. */
function construirBuilderFalso(entrada) {
  const resultado = {
    data: null,
    error: null,
    count: null,
    status: 200,
    statusText: "bloqueado por la prueba de solo lectura",
  };
  const promesa = Promise.resolve(resultado);

  const proxy = new Proxy(function bloqueado() {}, {
    get(_target, prop) {
      if (prop === "then") return promesa.then.bind(promesa);
      if (prop === "catch") return promesa.catch.bind(promesa);
      if (prop === "finally") return promesa.finally.bind(promesa);
      if (prop === Symbol.toStringTag) return "Promise";
      if (typeof prop !== "string") return undefined;
      // Cualquier otro método de la cadena (.eq, .select, .in, .single, ...)
      // se anota y se vuelve a encadenar sobre el mismo builder falso.
      return (...args) => {
        entrada.encadenado.push({ metodo: prop, args });
        return proxy;
      };
    },
  });
  return proxy;
}

function envolverTabla(builderReal, tabla, bitacora) {
  return new Proxy(builderReal, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && METODOS_ESCRITURA.has(prop)) {
        return (...args) => {
          const entrada = { tipo: prop, tabla, args, encadenado: [], en: new Date().toISOString() };
          bitacora.push(entrada);
          return construirBuilderFalso(entrada);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

/**
 * Envuelve un SupabaseClient real. Devuelve `{ cliente, bitacora }`:
 *  - `cliente`: se pasa donde el código de producción espera un SupabaseClient
 *    (todas las funciones auditadas lo reciben como parámetro — no hay que
 *    tocar `lib/db.ts` para nada).
 *  - `bitacora`: array que se va llenando con cada escritura interceptada.
 *    Vacío al final de una corrida = no se intentó escribir nada raro.
 */
export function envolverSoloLectura(clienteReal) {
  const bitacora = [];
  const cliente = new Proxy(clienteReal, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (tabla) => envolverTabla(target.from(tabla), tabla, bitacora);
      }
      if (prop === "rpc") {
        return (nombre, args) => {
          const entrada = { tipo: "rpc", nombre, args, encadenado: [], en: new Date().toISOString() };
          bitacora.push(entrada);
          return construirBuilderFalso(entrada);
        };
      }
      if (prop === "storage") {
        const entrada = { tipo: "storage", encadenado: [], en: new Date().toISOString() };
        bitacora.push(entrada);
        return construirBuilderFalso(entrada);
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
  return { cliente, bitacora };
}

/** Texto corto para loguear en las pruebas: qué se habría escrito, y dónde. */
export function resumenBitacora(bitacora) {
  if (!bitacora.length) return "(ninguna)";
  return bitacora
    .map((e) => {
      const destino = e.tabla ?? e.nombre ?? "storage";
      const filtros = e.encadenado
        .filter((c) => c.metodo !== "then" && c.metodo !== "select")
        .map((c) => `${c.metodo}(${c.args.map((a) => JSON.stringify(a)).join(",")})`)
        .join(".");
      return `${e.tipo} ${destino}${filtros ? " " + filtros : ""}`;
    })
    .join(" | ");
}
