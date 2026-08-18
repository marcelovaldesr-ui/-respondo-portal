/**
 * ACTUALIZACIÓN DE PRECIOS FIJOS — Impresora Color (18-ago-2026).
 *
 * Fuente de verdad: "catalogo final.xlsx" (hoja "Catálogo Tienda Online"),
 * enviado por el dueño. Se tomaron SOLO las 36 filas marcadas "Sí" en la
 * columna "¿INCLUIR EN TIENDA?" y su columna G (PRECIO FINAL con IVA).
 *
 * QUÉ CAMBIÓ respecto de lo que Tino tenía cargado:
 *   - FLYERS: 10 de 12 precios suben (entre +11% y +57%).
 *   - Tarjetas, Stickers, Pendones, Tela PVC y Credencial PVC: SIN CAMBIOS.
 * Detalle del diff en docs/ACTUALIZACION_PRECIOS_AGO2026.md.
 *
 * Actualiza la ficha [precios] "Precios fijos — productos de tienda (con IVA)"
 * de ed_conocimiento (id 88a906a5-...), que es la que arma armarPrompt() y de
 * donde Tino saca los precios que SÍ puede dar directo. Todo lo que no está en
 * esta lista sigue derivándose a Cecilia (regla intacta, no se toca).
 *
 * Ejecutar: npx tsx scripts/_actualizar_precios_impresora.ts [--aplicar]
 * Sin --aplicar solo muestra el diff (dry-run).
 */
import "./_env";
import { db } from "../lib/db";

const FICHA_ID = "88a906a5-3e73-4946-8728-63fee87110e4";
const CID = "33333333-3333-3333-3333-333333333333";

const NUEVO_CONTENIDO = `Estos son los ÚNICOS productos de la imprenta con PRECIO FIJO. Todos los valores son el PRECIO FINAL CON IVA incluido, en pesos chilenos. Para CUALQUIER otro producto, tamaño, papel/material o cantidad que NO esté en esta lista, se mantiene la regla general: NO inventar precio; tomar los datos y derivar a Cecilia para cotizar.

REGLAS IMPORTANTES:
- Tarjetas, Flyers y Stickers: el precio fijo aplica SOLO de 100 a 500 unidades. Bajo 100 (menos del mínimo) o sobre 500 unidades: NO dar precio, cotizar por privado.
- Credencial PVC: el precio indicado es fijo 5 unidades. Sobre 5 unidades: cotizar.
- Pendón Roller y Tela PVC: precio por unidad.
- Stickers: el precio depende solo del tamaño y la cantidad; la forma (circular, rectangular o cuadrada) no cambia el valor.
- Todos los pedidos se retiran en el local (Arauco 1060, Chillán); no hay despacho. Para iniciar la producción se pide 50% de abono.
- Si el cliente pide una cantidad intermedia no listada (ej. 300 u), NO interpolar ni inventar: ofrecer la más cercana de la tabla o tomar los datos y derivar a Cecilia.

TARJETAS DE PRESENTACIÓN:
- 9 × 5 cm · couche 300 grs  4x0 color: 100 u $8.000 · 200 u $14.000 · 500 u $30.000
- 9 × 5 cm · couche 300 grs  4x4 color: 100 u $14.000 · 200 u $20.000 · 500 u $35.000

FLYERS / VOLANTES:
- A6 (10,5 × 14,8 cm) · Couché 90g — 1 cara: 100 u $15.000 · 200 u $22.000 · 500 u $42.000
- A6 (10,5 × 14,8 cm) · Couché 90g — 2 caras: 100 u $22.000 · 200 u $32.000 · 500 u $58.000
- A5 (14,8 × 21 cm) · Couché 90g — 1 cara: 100 u $22.000 · 200 u $32.000 · 500 u $68.000
- A5 (14,8 × 21 cm) · Couché 90g — 2 caras: 100 u $28.000 · 200 u $35.000 · 500 u $75.000

STICKERS (vinilo brillante; misma tarifa sea circular, rectangular o cuadrada):
- 3 cm · Vinilo brillante: 100 u $8.000 · 200 u $14.000 · 500 u $28.000
- 5 cm · Vinilo brillante: 100 u $10.000 · 200 u $16.000 · 500 u $32.000
- 8 cm · Vinilo brillante: 100 u $14.000 · 200 u $22.000 · 500 u $45.000

PENDÓN ROLLER RETRÁCTIL (con estuche), por unidad:
- 80 × 200 cm: $38.000
- 90 × 200 cm: $40.000
- 100 × 200 cm: $45.000
- 120 × 200 cm: $50.000

TELA PVC IMPRESA (sin ojetillos), por unidad:
- 100 × 80 cm: $11.500
- 150 × 100 cm: $15.000
- 150 × 200 cm: $18.000
- 80 × 60 cm: $8.000

CREDENCIAL PVC:
- 8,5 × 5,5 cm, PVC blanco, impresión full color: $2.500 (precio por 5 unidades; sobre 5, cotizar)`;

/** Extrae "producto|variante" -> precios, para diffear línea a línea. */
function lineasDePrecio(txt: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of txt.split("\n")) {
    const t = l.trim();
    if (!t.startsWith("- ")) continue;
    const i = t.lastIndexOf(":");
    if (i < 0) continue;
    m.set(t.slice(2, i).trim(), t.slice(i + 1).trim());
  }
  return m;
}

async function main() {
  const supa = db();
  const aplicar = process.argv.includes("--aplicar");

  const { data: actual, error } = await supa
    .from("ed_conocimiento")
    .select("id, cliente_id, categoria, titulo, contenido, vigente")
    .eq("id", FICHA_ID)
    .maybeSingle();
  if (error || !actual) {
    console.error("No se pudo leer la ficha de precios:", error);
    process.exit(1);
  }
  if (actual.cliente_id !== CID) {
    console.error("SEGURIDAD: la ficha no pertenece a Impresora Color. Abortado.");
    process.exit(1);
  }
  if (!actual.vigente) {
    console.error("OJO: la ficha no está vigente. Abortado (revisar a mano).");
    process.exit(1);
  }

  const viejo = lineasDePrecio(actual.contenido as string);
  const nuevo = lineasDePrecio(NUEVO_CONTENIDO);

  console.log("=== DIFF DE PRECIOS (línea a línea) ===");
  let cambios = 0;
  for (const [k, v] of nuevo) {
    const antes = viejo.get(k);
    if (antes === undefined) {
      cambios++;
      console.log(`  + NUEVO   ${k}\n            ${v}`);
    } else if (antes !== v) {
      cambios++;
      console.log(`  ~ CAMBIA  ${k}\n      antes: ${antes}\n      ahora: ${v}`);
    }
  }
  for (const k of viejo.keys()) {
    if (!nuevo.has(k)) {
      cambios++;
      console.log(`  - SE VA   ${k} (${viejo.get(k)})`);
    }
  }
  console.log(`\nLíneas de precio: antes ${viejo.size}, ahora ${nuevo.size}. Cambios: ${cambios}`);

  if (!aplicar) {
    console.log("\n(dry-run — no se escribió nada. Correr con --aplicar para guardar)");
    return;
  }
  const { error: e2 } = await supa
    .from("ed_conocimiento")
    .update({ contenido: NUEVO_CONTENIDO })
    .eq("id", FICHA_ID);
  if (e2) {
    console.error("ERROR al actualizar:", e2);
    process.exit(1);
  }
  console.log("\n✅ Ficha de precios actualizada en producción.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
