import assert from "node:assert/strict";
import test from "node:test";

test("Prompt canal: contextualización sin leak en Instagram", async () => {
  // Verificamos la regla de reemplazo en lib/promptEmpleado.ts
  const NUCLEO_BASE = `Eres {{nombre_publico}}, empleado digital de {{nombre_negocio}} ({{rubro}}). Atiendes clientes reales por {{canal}}. No eres un "bot" ni un "asistente de IA" genérico: eres parte del equipo del negocio y hablas como tal.

## REGLAS INQUEBRANTABLES
9. Mensajes cortos, de WhatsApp real: 1–4 líneas, máximo una pregunta por mensaje.`;

  function renderizarNucleo(canal) {
    const esInstagram = canal?.toLowerCase() === "instagram";
    const canalNombre = esInstagram ? "Instagram" : "WhatsApp";
    const canalMensajes = esInstagram ? "Instagram Direct (máx. 1.000 caracteres)" : "WhatsApp real";

    return NUCLEO_BASE
      .replace(/\{\{nombre_publico\}\}/g, "Tino")
      .replace(/\{\{nombre_negocio\}\}/g, "Clínica San Lucas")
      .replace(/\{\{rubro\}\}/g, "odontologia")
      .replace(/\{\{canal\}\}/g, canalNombre)
      .replace(/de WhatsApp real/g, `de ${canalMensajes}`);
  }

  // 1. Caso Instagram
  const promptIg = renderizarNucleo("instagram");
  assert.ok(promptIg.includes("Atiendes clientes reales por Instagram."));
  assert.ok(!promptIg.includes("Atiendes clientes reales por WhatsApp."));
  assert.ok(promptIg.includes("Mensajes cortos, de Instagram Direct (máx. 1.000 caracteres):"));
  assert.ok(!promptIg.includes("de WhatsApp real:"));

  // 2. Caso WhatsApp
  const promptWa = renderizarNucleo("whatsapp");
  assert.ok(promptWa.includes("Atiendes clientes reales por WhatsApp."));
  assert.ok(!promptWa.includes("Atiendes clientes reales por Instagram."));
  assert.ok(promptWa.includes("Mensajes cortos, de WhatsApp real:"));

  // 3. Caso Default (sin canal especificado)
  const promptDef = renderizarNucleo(undefined);
  assert.ok(promptDef.includes("Atiendes clientes reales por WhatsApp."));
  assert.ok(promptDef.includes("Mensajes cortos, de WhatsApp real:"));
});
