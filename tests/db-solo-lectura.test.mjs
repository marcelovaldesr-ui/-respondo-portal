import assert from "node:assert/strict";
import test from "node:test";

import { envolverSoloLectura, resumenBitacora } from "../tests-integracion/soporte/dbSoloLectura.mjs";

/**
 * ESTA ES LA PRUEBA QUE IMPORTA DE VERDAD.
 *
 * Las pruebas de integración (tests-integracion/) corren contra la base de
 * PRODUCCIÓN de Impresora Color. Que "nunca escriban" depende enteramente de
 * que este envoltorio intercepte insert/update/upsert/delete/rpc/storage
 * ANTES de que lleguen a la red — sin necesitar ninguna credencial real, acá
 * se prueba con un cliente falso que si alguna vez lo llamaran de verdad,
 * haría fallar la prueba (lanza). Corre con `npm test`, en cualquier entorno,
 * sin tocar ninguna base de verdad.
 */

function clienteFalsoQueRompeSiLoTocan() {
  const golpes = [];
  function builderQueRompe(tabla) {
    const builder = {
      select: (...a) => { golpes.push(["select", tabla, a]); return builder; },
      eq: (...a) => { golpes.push(["eq", tabla, a]); return builder; },
      limit: (...a) => { golpes.push(["limit", tabla, a]); return Promise.resolve({ data: [{ ok: true, tabla }], error: null }); },
      insert: () => { throw new Error(`¡SE LLAMÓ insert() DE VERDAD en ${tabla}! El envoltorio de solo lectura falló.`); },
      update: () => { throw new Error(`¡SE LLAMÓ update() DE VERDAD en ${tabla}! El envoltorio de solo lectura falló.`); },
      upsert: () => { throw new Error(`¡SE LLAMÓ upsert() DE VERDAD en ${tabla}! El envoltorio de solo lectura falló.`); },
      delete: () => { throw new Error(`¡SE LLAMÓ delete() DE VERDAD en ${tabla}! El envoltorio de solo lectura falló.`); },
    };
    return builder;
  }
  const cliente = {
    from: (tabla) => builderQueRompe(tabla),
    rpc: () => { throw new Error("¡SE LLAMÓ rpc() DE VERDAD! El envoltorio de solo lectura falló."); },
    storage: { from: () => ({ upload: () => { throw new Error("¡SE LLAMÓ storage.upload() DE VERDAD!"); } }) },
  };
  return { cliente, golpes };
}

test("los métodos de lectura pasan directo al cliente real", async () => {
  const { cliente: real, golpes } = clienteFalsoQueRompeSiLoTocan();
  const { cliente } = envolverSoloLectura(real);

  const r = await cliente.from("ed_contactos").select("id").eq("cliente_id", "x").limit(1);

  assert.deepEqual(r.data, [{ ok: true, tabla: "ed_contactos" }]);
  assert.ok(golpes.some((g) => g[0] === "select"));
  assert.ok(golpes.some((g) => g[0] === "eq"));
  assert.ok(golpes.some((g) => g[0] === "limit"));
});

test("insert/update/upsert/delete NUNCA llegan al cliente real", async () => {
  const { cliente: real, golpes } = clienteFalsoQueRompeSiLoTocan();
  const { cliente, bitacora } = envolverSoloLectura(real);

  // Si el envoltorio fallara, cualquiera de estas 4 líneas lanzaría (el
  // cliente falso está armado para eso) y la prueba se caería.
  const r1 = await cliente.from("ed_contactos").update({ etapa: "ganado" }).eq("chat_id", "56911111111");
  const r2 = await cliente.from("ed_escalaciones").insert({ chat_id: "x" });
  const r3 = await cliente.from("ed_contactos").upsert({ chat_id: "x" });
  const r4 = await cliente.from("ed_mensajes").delete().eq("id", "1");

  for (const r of [r1, r2, r3, r4]) {
    assert.equal(r.data, null);
    assert.equal(r.error, null);
  }

  // Nada debió golpear al cliente real.
  assert.equal(golpes.length, 0, `el cliente real vio llamadas que no debía: ${JSON.stringify(golpes)}`);

  // Y quedó todo anotado para que una prueba de integración lo pueda mostrar.
  assert.equal(bitacora.length, 4);
  assert.equal(bitacora[0].tipo, "update");
  assert.equal(bitacora[0].tabla, "ed_contactos");
  assert.ok(bitacora[0].encadenado.some((c) => c.metodo === "eq"));
  assert.match(resumenBitacora(bitacora), /update ed_contactos/);
});

test("rpc() y storage también quedan bloqueados", async () => {
  const { cliente: real, golpes } = clienteFalsoQueRompeSiLoTocan();
  const { cliente, bitacora } = envolverSoloLectura(real);

  const r1 = await cliente.rpc("una_funcion_cualquiera", { a: 1 });
  const r2 = await cliente.storage.from("adjuntos").upload("x.jpg", new Uint8Array());

  assert.equal(r1.error, null);
  assert.equal(r2.error, null);
  assert.equal(golpes.length, 0);
  assert.equal(bitacora.length, 2);
  assert.equal(bitacora[0].tipo, "rpc");
  assert.equal(bitacora[1].tipo, "storage");
});

test("resumenBitacora no lanza con una bitácora vacía", () => {
  assert.equal(resumenBitacora([]), "(ninguna)");
});
