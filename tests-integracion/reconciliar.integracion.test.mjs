import test from "node:test";
import assert from "node:assert/strict";

import { clienteDePruebaSoloLectura } from "./soporte/entorno.mjs";
import { instalarMocksDeSalida } from "./soporte/mocksSalida.mjs";
import { resumenBitacora } from "./soporte/dbSoloLectura.mjs";

/**
 * reconciliarEstados corre en el cron cada 5 min contra TODOS los clientes.
 * Esta prueba lo corre contra la base real (dry-run: nada se escribe ni se
 * manda de verdad — ver soporte/dbSoloLectura.mjs y soporte/mocksSalida.mjs),
 * y sirve para dos cosas que un test con fixtures no puede dar:
 *
 *  1. Que el código realmente corra de punta a punta contra el volumen y la
 *     forma real de los datos de Impresora Color (no lo que YO creo que tiene
 *     la base, sino lo que tiene de verdad).
 *  2. Un registro legible de qué HABRÍA cambiado si hubiera corrido en serio,
 *     para que Marcelo/Cecilia lo puedan mirar antes de confiar en el cron.
 */
test("reconciliarEstados corre contra la base real sin escribir ni mandar nada de verdad", async (t) => {
  const { llamadas, restaurar } = await instalarMocksDeSalida();
  t.after(() => restaurar());

  const { reconciliarEstados } = await import("@/lib/reconciliarEstados");
  const { cliente, bitacora } = clienteDePruebaSoloLectura();

  const resumen = await reconciliarEstados(cliente, { fechaLimite: Date.now() + 25_000 });

  console.log("\n[reconciliar] resumen:", resumen);
  console.log("[reconciliar] esto habría escrito:", resumenBitacora(bitacora));
  console.log("[reconciliar] avisos al puente que se habrían mandado:", llamadas.puente.length);

  // Si llegó hasta acá sin lanzar, ya corrió de punta a punta contra datos reales.
  assert.ok(resumen);
  assert.equal(typeof resumen.escalacionesCerradas, "number");
  assert.equal(typeof resumen.contactosLimpiados, "number");
  assert.equal(typeof resumen.contactosReabiertos, "number");
  assert.equal(typeof resumen.agendadosCorregidos, "number");

  // Nada debe haber salido de verdad — este módulo no manda WhatsApp directo,
  // pero si algún día lo hiciera, esto lo agarra.
  assert.equal(llamadas.waha.length, 0);
  assert.equal(llamadas.metaTexto.length, 0);

  // Toda escritura interceptada tiene que ser sobre las tablas que este
  // módulo declara tocar (ver el comentario de cabecera de reconciliarEstados.ts).
  // Si aparece una tabla distinta, algo cambió en el código y esta prueba
  // avisa antes de que llegue a producción sin revisión.
  const tablasEsperadas = new Set(["ed_escalaciones", "ed_contactos"]);
  for (const e of bitacora) {
    assert.ok(
      tablasEsperadas.has(e.tabla),
      `escritura en una tabla no esperada: ${JSON.stringify(e)}`,
    );
  }
});
