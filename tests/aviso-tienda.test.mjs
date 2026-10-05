import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  firmaTiendaValida,
  validarAvisoTienda,
  paramsPedidoListo,
} from "../lib/avisoTiendaCore.ts";

const secreto = "s".repeat(64);
const cuerpo = JSON.stringify({
  evento: "pedido_listo",
  idempotency_key: "pedido_listo:ABC123",
  telefono: "56976490991",
  nombre: "María González",
  numero_orden: "ABC123",
  producto: "Flyers / Volantes × 500, Stickers × 100",
});
const ahora = 1_800_000_000;
const firmar = (ts, c = cuerpo) => createHmac("sha256", secreto).update(`${ts}.${c}`).digest("hex");

test("firma correcta pasa", () => {
  assert.ok(firmaTiendaValida({ cuerpoCrudo: cuerpo, timestamp: String(ahora), firma: firmar(ahora), secreto, ahoraSeg: ahora }));
});
test("firma mala, cuerpo alterado y sin secreto fallan", () => {
  assert.ok(!firmaTiendaValida({ cuerpoCrudo: cuerpo, timestamp: String(ahora), firma: "0".repeat(64), secreto, ahoraSeg: ahora }));
  assert.ok(!firmaTiendaValida({ cuerpoCrudo: cuerpo + " ", timestamp: String(ahora), firma: firmar(ahora), secreto, ahoraSeg: ahora }));
  assert.ok(!firmaTiendaValida({ cuerpoCrudo: cuerpo, timestamp: String(ahora), firma: firmar(ahora), secreto: undefined, ahoraSeg: ahora }));
});
test("timestamp viejo (>300 s) falla aunque la firma sea correcta", () => {
  const viejo = ahora - 301;
  assert.ok(!firmaTiendaValida({ cuerpoCrudo: cuerpo, timestamp: String(viejo), firma: firmar(viejo), secreto, ahoraSeg: ahora }));
  assert.ok(firmaTiendaValida({ cuerpoCrudo: cuerpo, timestamp: String(ahora - 299), firma: firmar(ahora - 299), secreto, ahoraSeg: ahora }));
});
test("validación del cuerpo", () => {
  const ok = validarAvisoTienda(JSON.parse(cuerpo));
  assert.ok(ok.ok);
  for (const mala of [
    { evento: "otro" },
    { ...JSON.parse(cuerpo), telefono: "+56976490991" },
    { ...JSON.parse(cuerpo), telefono: "5697649099" },
    { ...JSON.parse(cuerpo), nombre: "  " },
    { ...JSON.parse(cuerpo), producto: 5 },
    { ...JSON.parse(cuerpo), idempotency_key: "" },
  ]) assert.ok(!validarAvisoTienda(mala).ok);
  assert.ok(!validarAvisoTienda(null).ok);
});
test("variables de la plantilla: primer nombre, negocio, N° de orden", () => {
  const v = validarAvisoTienda(JSON.parse(cuerpo));
  assert.deepEqual(paramsPedidoListo(v.aviso, "Impresora Color"), ["María", "Impresora Color", "pedido N° ABC123"]);
});
