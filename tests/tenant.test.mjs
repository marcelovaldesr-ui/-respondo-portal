/**
 * Acciones de conversación: empleado y contacto tienen que ser del negocio de
 * la sesión (auditoría 11-sep-2026, caso real de «pedido listo» enviable desde
 * el WhatsApp de otro negocio).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { empleadoYContactoDelCliente } from "../lib/tenant.ts";
import { crearSupaFalso, tieneFiltro } from "./_supaFalso.mjs";

const A = "cliente-A";
const EMP_B = "empleado-de-B";

function supaCon({ empleadoDe, contactoDe }) {
  return crearSupaFalso((ll) => {
    const cid = ll.filtros.find((f) => f[1] === "cliente_id")?.[2];
    if (ll.tabla === "ed_empleados") return { data: empleadoDe === cid ? { id: "e" } : null };
    if (ll.tabla === "ed_contactos") return { data: contactoDe === cid ? { chat_id: "569", nombre: "Ana" } : null };
    return { data: null };
  });
}

test("rechaza un empleado de otro negocio aunque el contacto sea propio", async () => {
  const supa = supaCon({ empleadoDe: "cliente-B", contactoDe: A });
  const r = await empleadoYContactoDelCliente(supa, { clienteId: A, empleadoId: EMP_B, chatId: "569" });
  assert.equal(r.ok, false);
  const emp = supa.llamadas.find((l) => l.tabla === "ed_empleados");
  assert.ok(tieneFiltro(emp, "eq", "cliente_id", A), "la consulta del empleado filtra por el negocio de la sesión");
});

test("rechaza un contacto de otro negocio", async () => {
  const supa = supaCon({ empleadoDe: A, contactoDe: "cliente-B" });
  const r = await empleadoYContactoDelCliente(supa, { clienteId: A, empleadoId: "e", chatId: "569" });
  assert.equal(r.ok, false);
});

test("acepta cuando ambos son del negocio y devuelve las columnas pedidas", async () => {
  const supa = supaCon({ empleadoDe: A, contactoDe: A });
  const r = await empleadoYContactoDelCliente(supa, { clienteId: A, empleadoId: "e", chatId: "569", columnasContacto: "nombre" });
  assert.equal(r.ok, true);
  assert.equal(r.contacto.nombre, "Ana");
  assert.equal(supa.llamadas.find((l) => l.tabla === "ed_contactos").select, "nombre");
});

test("falla cerrado ante error de la base o ids vacíos", async () => {
  const conError = crearSupaFalso(() => ({ data: { id: "x" }, error: { message: "timeout" } }));
  assert.equal((await empleadoYContactoDelCliente(conError, { clienteId: A, empleadoId: "e", chatId: "1" })).ok, false);
  const vacio = crearSupaFalso(() => ({ data: { id: "x" } }));
  assert.equal((await empleadoYContactoDelCliente(vacio, { clienteId: A, empleadoId: "", chatId: "1" })).ok, false);
  assert.equal(vacio.llamadas.length, 0);
});
