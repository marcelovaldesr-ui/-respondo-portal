import test from "node:test";
import assert from "node:assert/strict";

import { clienteDePruebaSoloLectura } from "./soporte/entorno.mjs";
import { instalarMocksDeSalida } from "./soporte/mocksSalida.mjs";
import { resumenBitacora } from "./soporte/dbSoloLectura.mjs";

const IMPRESORA = "33333333-3333-3333-3333-333333333333";

/**
 * BETO Y SU JUEZ, CONTRA LA BASE REAL, SIN MANDAR NI ESCRIBIR NADA.
 *
 * Lo que estas pruebas cuidan no es una función: es que **no salga un mensaje
 * pagado que nadie aprobó**. Cada envío de `cotizacion_pendiente` son ~$85 de
 * marketing a un número real de un cliente de Impresora Color.
 *
 * Gemini queda interceptado devolviendo "{}" — la respuesta más segura que
 * existe: `interpretar()` la lee como "no se pudo determinar" y
 * `decidirConJuez()` no envía. Si alguna de estas pruebas termina con un envío,
 * significa que algo trató un JSON vacío como permiso para escribir.
 */

test("el generador de cotizaciones corre contra la base real y es INERTE", async (t) => {
  const { llamadas, restaurar } = await instalarMocksDeSalida();
  t.after(() => restaurar());

  const { generarSeguimientosCotizacion } = await import("@/lib/generadorCotizacion");
  const { cliente, bitacora } = clienteDePruebaSoloLectura();

  const r = await generarSeguimientosCotizacion(cliente, { fechaLimite: Date.now() + 30_000 });

  console.log("\n[cotizaciones] resumen:", r);
  console.log("[cotizaciones] escrituras interceptadas:", resumenBitacora(bitacora));
  console.log("[cotizaciones] mensajes que se habrían mandado — waha:", llamadas.waha.length, "| meta:", llamadas.metaTexto.length);

  assert.equal(typeof r.clientes, "number");
  assert.equal(typeof r.frenadosPorJuez, "number");
  assert.equal(typeof r.propuestos, "number");

  /**
   * ⚠️ LA ASERCIÓN QUE IMPORTA. Mientras ningún cliente tenga
   * `cotizacion_seguimiento` encendido, esto no puede programar ni proponer
   * absolutamente nada. Si esta prueba se pone roja, alguien encendió el
   * interruptor en la base — y eso hay que verlo acá antes que en la factura.
   */
  assert.equal(r.programados, 0, "programó seguimientos con el interruptor apagado");
  assert.equal(r.propuestos, 0, "creó propuestas con el interruptor apagado");
  assert.equal(llamadas.waha.length, 0);
  assert.equal(llamadas.metaTexto.length, 0);
});

test("el juez lee el hilo real de TODOS los empleados, no solo el de Beto", async (t) => {
  const { restaurar } = await instalarMocksDeSalida();
  t.after(() => restaurar());

  const { empleadosDelCliente, juzgarCotizacion } = await import("@/lib/juezCotizacion");
  const { decidirConJuez } = await import("@/lib/juezCotizacionCore");
  const { cliente } = clienteDePruebaSoloLectura();

  const empleadoIds = await empleadosDelCliente(IMPRESORA, cliente);
  console.log("\n[juez] empleados del cliente:", empleadoIds.length);
  assert.ok(empleadoIds.length >= 2, "Impresora tiene Tino, Beto y Vera: si viene 1, la consulta está filtrando de más");

  // Una conversación real con harto historial, elegida en caliente.
  const { data: contactos } = await cliente
    .from("ed_contactos")
    .select("chat_id, total_mensajes")
    .eq("cliente_id", IMPRESORA)
    .order("total_mensajes", { ascending: false })
    .limit(1);

  const chatId = contactos?.[0]?.chat_id;
  assert.ok(chatId, "no hay ninguna conversación en Impresora Color");

  const v = await juzgarCotizacion({
    chatId,
    negocio: "Impresora Color",
    diasEsperando: 7,
    empleadoIds,
    supa: cliente,
  });

  console.log("[juez] mensajes leídos del hilo:", v.mensajes.length);
  console.log("[juez] veredicto con el modelo interceptado:", { abierta: v.abierta, motivo: v.motivo });

  /**
   * 🔴 EL BUG DEL 27-AGO: leer solo el hilo de Beto. En Impresora casi todo lo
   * contesta Tino o una persona, así que el hilo de Beto está vacío y el juez
   * habría opinado sobre la nada. Si esto vuelve a 0, ese bug volvió.
   */
  assert.ok(v.mensajes.length > 0, "el hilo vino vacío: ¿se está filtrando por un solo empleado?");
  assert.ok(v.mensajes.some((m) => m.rol === "cliente"), "ningún mensaje del cliente en el hilo");

  /**
   * El modelo interceptado devuelve "{}": «no se pudo determinar» → NO se envía.
   *
   * No se cuenta `llamadas.gemini` a propósito: los mocks de módulo de
   * node:test quedan enlazados al PRIMER import, así que si otra prueba de este
   * archivo ya cargó la cadena, la llamada se registra en el contador de
   * aquella. Lo que sí es indiscutible es el veredicto: si el modelo real
   * hubiera respondido, `abierta` traería true o false, no null.
   */
  assert.equal(v.abierta, null, "el modelo NO quedó interceptado: llegó una respuesta de verdad");
  assert.equal(decidirConJuez(v).enviar, false, "un JSON vacío no puede autorizar un envío de $85");
});
