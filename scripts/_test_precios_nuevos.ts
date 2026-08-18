/**
 * Verifica en vivo (cerebro REAL: armarPrompt + Gemini) que Tino cotiza con los
 * precios del catálogo actualizado del 18-ago-2026, y que sigue derivando lo
 * que está fuera de rango en vez de inventar. No toca WhatsApp.
 */
import "./_env";
import { armarPrompt } from "../lib/promptEmpleado";
import { generarJSON } from "../lib/gemini";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";

// [pregunta, precio que DEBE aparecer, precio viejo que NO debe aparecer]
const CASOS: [string, string, string | null][] = [
  ["cuanto valen 100 volantes A6 una cara?", "15.000", "13.000"],
  ["precio 200 flyers A6 1 cara", "22.000", "17.500"],
  ["cuanto 500 volantes A6 una cara?", "42.000", "35.000"],
  ["cuanto salen 100 flyers A6 doble cara?", "22.000", "18.500"],
  ["500 volantes A6 ambas caras cuanto?", "58.000", "52.000"],
  ["100 flyers A5 una cara precio?", "22.000", "14.000"],
  ["cuanto 500 volantes A5 1 cara?", "68.000", "58.000"],
  ["100 volantes A5 doble cara cuanto sale?", "28.000", "22.000"],
  // No cambiaron: deben seguir igual
  ["100 tarjetas de presentacion a un color cuanto?", "8.000", null],
  ["cuanto 500 stickers de 5cm?", "32.000", null],
  ["precio pendon roller 100x200", "45.000", null],
];

const norm = (s: string) => s.replace(/\$\s*/g, "$").replace(/\s+/g, " ");

async function main() {
  let fallos = 0;
  for (const [preg, debe, noDebe] of CASOS) {
    const prompt = await armarPrompt(CID, TINO, [{ rol: "cliente", texto: preg }]);
    if (!prompt) { console.error(`  ✗ prompt null`); fallos++; continue; }
    const r = norm(JSON.parse(await generarJSON(prompt)).respuesta ?? "");
    const tieneNuevo = r.includes(debe);
    const tieneViejo = noDebe ? r.includes(noDebe) : false;
    if (tieneNuevo && !tieneViejo) console.log(`  ✓ "${preg}" → $${debe}`);
    else {
      fallos++;
      console.error(`  ✗ "${preg}"\n     esperado $${debe}${noDebe ? ` (y NO $${noDebe})` : ""}\n     respuesta: ${r}`);
    }
  }

  console.log("\n=== FUERA DE RANGO: no debe dar precio, debe derivar ===");
  for (const preg of ["cuanto salen 50 volantes A6?", "necesito 2000 flyers A5 doble cara, cuanto?"]) {
    const prompt = await armarPrompt(CID, TINO, [{ rol: "cliente", texto: preg }]);
    const d = JSON.parse(await generarJSON(prompt!));
    const r = norm(d.respuesta ?? "");
    // No debe aparecer NINGÚN precio de la tabla de flyers como valor cerrado.
    const inventó = /\$\s?\d{1,3}\.\d{3}/.test(r);
    if (!inventó) console.log(`  ✓ "${preg}" → sin precio (escalar=${d.escalar}, accion=${d.accion})`);
    else { fallos++; console.error(`  ✗ "${preg}" dio un precio fuera de rango: ${r}`); }
  }

  console.log(fallos === 0 ? "\n✅ PRECIOS NUEVOS OK" : `\n❌ ${fallos} FALLO(S)`);
  process.exit(fallos === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FALLO:", e); process.exit(1); });
