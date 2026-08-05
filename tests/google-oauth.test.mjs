import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-solo-para-tests";
const { firmarEstado, verificarEstado } = await import("../lib/googleOAuth.ts");

test("el state OAuth válido conserva tenant y profesional", () => {
  const esperado = { clienteId: "cliente-a", profesionalId: "prof-a" };
  assert.deepEqual(verificarEstado(firmarEstado(esperado)), esperado);
});

test("el state OAuth detecta manipulación", () => {
  const estado = firmarEstado({ clienteId: "cliente-a", profesionalId: "prof-a" });
  const [payload, firma] = estado.split(".");
  const alterado = `${payload.slice(0, -1)}A.${firma}`;
  assert.equal(verificarEstado(alterado), null);
});

test("el state OAuth firmado pero vencido no se reutiliza", () => {
  const payload = Buffer.from(
    JSON.stringify({
      clienteId: "cliente-a",
      profesionalId: "prof-a",
      emitidoEn: Date.now() - 16 * 60_000,
    }),
  ).toString("base64url");
  const clave = createHash("sha256")
    .update(`respondo-gcal-state:${process.env.SUPABASE_SERVICE_ROLE_KEY}`)
    .digest();
  const firma = createHmac("sha256", clave).update(payload).digest("base64url");
  assert.equal(verificarEstado(`${payload}.${firma}`), null);
});
