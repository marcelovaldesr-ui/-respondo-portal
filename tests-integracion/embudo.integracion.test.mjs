import test from "node:test";
import assert from "node:assert/strict";

import { clienteDePruebaSoloLectura } from "./soporte/entorno.mjs";
import { instalarMocksDeSalida } from "./soporte/mocksSalida.mjs";
import { resumenBitacora } from "./soporte/dbSoloLectura.mjs";

/** Primer cliente con "impresora" en el nombre; si no hay ninguno, el primero que exista. */
async function buscarClientePrueba(cliente) {
  const porNombre = await cliente.from("ed_clientes").select("id, nombre").ilike("nombre", "%impresora%").limit(1);
  if (porNombre.data?.length) return porNombre.data[0];
  const cualquiera = await cliente.from("ed_clientes").select("id, nombre").limit(1);
  return cualquiera.data?.[0] ?? null;
}

/**
 * cargarEmbudo recalcula la etapa de CADA conversación activa cada vez que se
 * abre el tablero — no hay cron de por medio, así que un bug acá se ve apenas
 * alguien mira el embudo. Esta prueba lo corre contra los contactos reales de
 * Impresora Color en modo dry-run (ver soporte/dbSoloLectura.mjs).
 */
test("cargarEmbudo corre contra la base real sin escribir ni mandar nada de verdad", async (t) => {
  const { llamadas, restaurar } = await instalarMocksDeSalida();
  t.after(() => restaurar());

  const { cargarEmbudo } = await import("@/lib/embudo");
  const { cliente, bitacora } = clienteDePruebaSoloLectura();

  const negocio = await buscarClientePrueba(cliente);
  assert.ok(negocio, "no hay ningún registro en ed_clientes contra el cual probar");
  console.log(`\n[embudo] probando contra: ${negocio.nombre} (${negocio.id})`);

  const tarjetas = await cargarEmbudo(negocio.id, 14, cliente);

  console.log(`[embudo] ${tarjetas.length} tarjetas cargadas`);
  console.log("[embudo] recálculos que se habrían guardado:", resumenBitacora(bitacora));
  console.log("[embudo] avisos al puente que se habrían mandado:", llamadas.puente.length);

  assert.ok(Array.isArray(tarjetas));
  for (const t of tarjetas) {
    assert.equal(typeof t.chatId, "string");
    assert.equal(typeof t.etapa, "string");
  }

  // cargarEmbudo solo debería tocar ed_contactos (el recálculo de etapa).
  for (const e of bitacora) {
    assert.equal(e.tabla, "ed_contactos", `escritura en una tabla no esperada: ${JSON.stringify(e)}`);
  }
  assert.equal(llamadas.waha.length, 0);
  assert.equal(llamadas.metaTexto.length, 0);
});
