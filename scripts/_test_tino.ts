/**
 * Script de auditoría (temporal): corre el cerebro REAL de Tino (armarPrompt +
 * generarJSON) contra preguntas de prueba, para validar que usa bien el
 * catálogo de precios fijos y que NO inventa fuera de rango. No toca WhatsApp.
 * Ejecutar: source .env.local && npx tsx scripts/_test_tino.ts
 */
import { armarPrompt } from "../lib/promptEmpleado";
import { generarJSON } from "../lib/gemini";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";

const casos: string[] = [
  "Hola! cuánto valen 100 tarjetas de presentación de 9x5 a un color?",
  "y 500 tarjetas full color ambas caras?",
  "necesito 1000 flyers A5 doble cara, cuánto sale?", // fuera de rango -> cotizar
  "cuánto cuesta un pendón roller de 100x200?",
  "hacen tazas personalizadas? cuánto una taza?", // no lo hacen
  "quiero 50 stickers de 5cm redondos", // bajo mínimo -> cotizar
  "precio de 200 stickers cuadrados de 8cm?", // forma no cambia precio
];

async function main() {
  for (const msg of casos) {
    const prompt = await armarPrompt(CID, TINO, [{ rol: "cliente", texto: msg }]);
    if (!prompt) {
      console.log(`\nCLIENTE: ${msg}\n  ERROR: prompt null`);
      continue;
    }
    let out: string;
    try {
      out = await generarJSON(prompt);
    } catch (e) {
      console.log(`\nCLIENTE: ${msg}\n  ERROR LLM: ${(e as Error).message}`);
      continue;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(out);
    } catch {
      console.log(`\nCLIENTE: ${msg}\n  (no-JSON) ${out.slice(0, 300)}`);
      continue;
    }
    console.log(`\nCLIENTE: ${msg}`);
    console.log(`  TINO: ${parsed.respuesta}`);
    console.log(
      `  escalar=${parsed.escalar} accion=${parsed.accion ?? "-"} lead=${parsed.lead?.clasificacion ?? "-"}`,
    );
  }
}

main().then(() => process.exit(0));
