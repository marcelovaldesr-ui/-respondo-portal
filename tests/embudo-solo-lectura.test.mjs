/**
 * ABRIR EL EMBUDO NO ESCRIBE NADA (Fase 0). La escritura la hace el cron.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { cargarEmbudo, recalcularEtapasEmbudo } from "../lib/embudo.ts";
import { recalcularEmbudos } from "../lib/embudoCron.ts";

const hace = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

function base() {
  return crearBaseMemoria({
    ed_clientes: [{ id: "c1", activo: true }],
    ed_empleados: [{ id: "e1", cliente_id: "c1" }, { id: "e2", cliente_id: "c2" }],
    ed_contactos: [
      // Cotizado y 10 días en silencio → el cálculo lo cierra como perdido.
      { cliente_id: "c1", chat_id: "a", nombre: "A", etiquetas: ["cotizacion"], etapa: "cotizado", etapa_manual: false, ultimo_mensaje_en: hace(10), ultimo_mensaje_rol: "empleado" },
      // Agendó → ganado.
      { cliente_id: "c1", chat_id: "b", nombre: "B", etiquetas: [], etapa: "nuevo", etapa_manual: false, ultimo_mensaje_en: hace(1), ultimo_mensaje_rol: "cliente" },
      { cliente_id: "c2", chat_id: "a", nombre: "Otro", etiquetas: ["cotizacion"], etapa: "cotizado", etapa_manual: false, ultimo_mensaje_en: hace(10), ultimo_mensaje_rol: "empleado" },
    ],
    ed_resultados: [{ empleado_id: "e1", chat_id: "b", tipo: "agendamiento", creado_en: hace(1) }],
    ed_escalaciones: [],
    ed_integraciones_salida: [],
  });
}

test("cargarEmbudo (la página) muestra las etapas recalculadas pero no escribe", async () => {
  const supa = base();
  const tarjetas = await cargarEmbudo("c1", 14, supa);
  assert.equal(tarjetas.find((t) => t.chatId === "a").etapa, "perdido");
  assert.equal(tarjetas.find((t) => t.chatId === "b").etapa, "ganado");
  assert.equal(supa.llamadas.filter((l) => l.op !== "select").length, 0, "cero escrituras al abrir la página");
  assert.equal(supa.tablas.ed_contactos[0].etapa, "cotizado");
});

test("el cron persiste los cambios, solo en el negocio correcto", async () => {
  const supa = base();
  const r = await recalcularEtapasEmbudo("c1", 14, supa);
  assert.equal(r.cambios, 2);
  const [a, b, otro] = supa.tablas.ed_contactos;
  assert.equal(a.etapa, "perdido");
  assert.equal(b.etapa, "ganado");
  assert.equal(otro.etapa, "cotizado", "el mismo chat_id en otro negocio no se toca");
});

test("recalcularEmbudos: una vez por hora (minutos 0-4), el resto de las corridas no hace nada", async () => {
  const supa = base();
  const fuera = await recalcularEmbudos({ supa, ahora: new Date("2026-09-11T15:17:00Z") });
  assert.equal(fuera.sinTrabajo, true);
  const dentro = await recalcularEmbudos({ supa, ahora: new Date("2026-09-11T15:02:00Z") });
  assert.equal(dentro.negocios, 1);
  assert.equal(dentro.cambios, 2);
});
