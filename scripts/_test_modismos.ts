import { armarPrompt } from "../lib/promptEmpleado";
import { generarJSON } from "../lib/gemini";

const CID = "33333333-3333-3333-3333-333333333333";
const TINO = "a3333333-0000-0000-0000-000000000001";

const casos: string[] = [
  "hola necesito unos panfletos pa' repartir en la feria",
  "hacen calcomanías?",
  "quiero un lienzo grande pa'l local",
  "me hacen un carnet pal gimnasio?",
  "necesito tarjetas", // ambiguo: papel vs PVC -> debe preguntar
  "hacen talonarios de boleta?",
  "me hacen unas tazas personalizadas?", // no lo hacen
];

async function main() {
  for (const msg of casos) {
    const prompt = await armarPrompt(CID, TINO, [{ rol: "cliente", texto: msg }]);
    if (!prompt) { console.log(`\nCLIENTE: ${msg}\n  ERROR prompt null`); continue; }
    let parsed: any;
    try { parsed = JSON.parse(await generarJSON(prompt)); }
    catch (e) { console.log(`\nCLIENTE: ${msg}\n  ERROR: ${(e as Error).message}`); continue; }
    console.log(`\nCLIENTE: ${msg}`);
    console.log(`  TINO: ${parsed.respuesta}`);
    console.log(`  escalar=${parsed.escalar} accion=${parsed.accion ?? "-"}`);
  }
}
main().then(() => process.exit(0));
