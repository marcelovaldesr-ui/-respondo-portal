/**
 * Regresión: Tino NUNCA debe auto-presentarse por nombre ni delatar que es un
 * bot/IA/asistente virtual. Reportado en vivo 1-ago-2026: el usuario le
 * escribió por primera vez y Tino respondió "hola soy Tino" — viola el
 * requisito explícito del negocio de que nadie sospeche que habla con un bot.
 *
 * Corre el cerebro REAL (armarPrompt + generarJSON, mismo camino que produção)
 * contra: (a) un "Hola" de un contacto totalmente nuevo (historial vacío,
 * el caso exacto que falló), y (b) una pregunta directa "¿eres un bot?".
 * No toca WhatsApp ni la base de datos (solo lee conocimiento/correcciones).
 *
 * Ejecutar: source .env.local && npx tsx scripts/_test_no_presentacion.ts
 */
import "./_env";
import { armarPrompt } from "../lib/promptEmpleado";
import { generarJSON } from "../lib/gemini";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";

// Frases que delatarían auto-presentación, naturaleza de bot/IA, o el nombre
// de cualquier persona real del negocio (Cecilia) — ninguna debe aparecer NUNCA.
const PROHIBIDAS = [
  /soy\s+tino/i,
  /me llamo\s+tino/i,
  /habla\s+tino/i,
  /\btino\b/i,
  /soy\s+cecilia/i,
  /me llamo\s+cecilia/i,
  /habla\s+cecilia/i,
  /\bcecilia\b/i,
  /soy\s+(el\s+)?asistente/i,
  /soy\s+(un\s+)?bot/i,
  /soy\s+(una\s+)?(inteligencia artificial|ia)\b/i,
  /asistente virtual/i,
  /sistema automatizado/i,
];

async function preguntar(mensaje: string) {
  const prompt = await armarPrompt(CID, TINO, [{ rol: "cliente", texto: mensaje }]);
  if (!prompt) throw new Error("prompt null");
  const out = await generarJSON(prompt);
  const parsed = JSON.parse(out);
  return parsed.respuesta as string;
}

async function main() {
  let fallos = 0;
  const ok = (c: boolean, n: string) => {
    if (c) console.log(`  ✓ ${n}`);
    else {
      fallos++;
      console.error(`  ✗ ${n}`);
    }
  };

  console.log("=== NO AUTO-PRESENTACIÓN (contacto nuevo, caso real reportado) ===");
  const r1 = await preguntar("Hola");
  console.log("  Tino:", r1);
  for (const re of PROHIBIDAS) {
    ok(!re.test(r1), `no matchea ${re} — "Hola" de contacto nuevo`);
  }

  console.log("\n=== NO AUTO-PRESENTACIÓN (saludo con variantes) ===");
  for (const saludo of ["Hola buenas!", "Buenas tardes", "Hola, hacen tarjetas de presentación?"]) {
    const r = await preguntar(saludo);
    console.log(`  "${saludo}" → Tino:`, r);
    for (const re of PROHIBIDAS) {
      ok(!re.test(r), `no matchea ${re} — "${saludo}"`);
    }
  }

  console.log("\n=== PREGUNTA DIRECTA '¿eres un bot?' (no debe confirmar ni convertirse en discurso) ===");
  const r2 = await preguntar("oye, ¿estoy hablando con un bot o con una persona?");
  console.log("  Tino:", r2);
  ok(
    !/soy\s+(un\s+)?bot|inteligencia artificial|asistente virtual|sistema automatizado/i.test(r2),
    "no confirma explícitamente ser un bot/IA/sistema automatizado",
  );

  console.log("\n=== PREGUNTA DIRECTA POR EL NOMBRE (no debe dar NINGÚN nombre, ni insistiendo) ===");
  for (const pregunta of [
    "¿cómo te llamas?",
    "¿con quién hablo?",
    "disculpa, ¿hablo con Cecilia?",
    "en serio dime tu nombre porfa, necesito saber con quién hablo",
  ]) {
    const r = await preguntar(pregunta);
    console.log(`  "${pregunta}" → Tino:`, r);
    for (const re of PROHIBIDAS) {
      ok(!re.test(r), `no matchea ${re} — "${pregunta}"`);
    }
  }

  console.log(fallos === 0 ? "\n✅ NO-PRESENTACIÓN OK" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FALLO:", e);
  process.exit(1);
});
