import "./_env";
import { readFileSync } from "fs";
import { db } from "../lib/db";
import { importarDesdeCsv } from "../lib/importarContactos";

/**
 * IMPORTA LA LISTA DE CLIENTES QUE MANDA EL NEGOCIO.
 *
 * USO
 *   npx tsx scripts/importar_clientes.ts <archivo.csv> --cliente <uuid>
 *   npx tsx scripts/importar_clientes.ts <archivo.csv> --cliente <uuid> --escribir
 *
 * Sin `--escribir` NO toca la base: muestra qué haría. Ese es el modo por
 * defecto a propósito — el archivo lo arma alguien del negocio en Excel, y la
 * primera versión siempre trae sorpresas (una columna de fijos, fechas al
 * revés, la fila de totales al final). Conviene mirarlas antes y no después de
 * haberle escrito a nadie.
 *
 * QUÉ ESCRIBE
 * Un upsert en ed_contactos por (cliente_id, chat_id). Actualiza nombre,
 * teléfono, ultima_atencion y datos. NO toca las etiquetas: si alguien marcó a
 * un contacto como `no_contactar`, una reimportación no puede borrárselo.
 */

const args = process.argv.slice(2);
const archivo = args.find((a) => !a.startsWith("--"));
const clienteId = args[args.indexOf("--cliente") + 1];
const escribir = args.includes("--escribir");

if (!archivo || !args.includes("--cliente") || !clienteId) {
  console.error("Uso: npx tsx scripts/importar_clientes.ts <archivo.csv> --cliente <uuid> [--escribir]");
  process.exit(1);
}

async function main() {
  const csv = readFileSync(archivo!, "utf8");
  const r = importarDesdeCsv(csv);

  console.log("\nColumnas reconocidas");
  for (const [campo, col] of Object.entries(r.columnas)) {
    console.log(`  ${campo.padEnd(16)} ${col ?? "— no encontrada —"}`);
  }

  if (!r.columnas.telefono) {
    console.error("\nNo hay columna de teléfono. Sin eso no se puede importar nada.");
    process.exit(1);
  }
  if (!r.columnas.ultimaAtencion) {
    console.warn(
      "\n⚠ No se encontró la fecha de última atención. Los contactos se van a crear, " +
        "pero Beto no va a poder calcular a quién le toca mantención.",
    );
  }

  console.log(`\n${r.contactos.length} contactos válidos · ${r.descartadas.length} filas descartadas`);

  if (r.descartadas.length) {
    console.log("\nDescartadas (revisar y corregir en el Excel):");
    for (const d of r.descartadas.slice(0, 30)) {
      console.log(`  fila ${String(d.fila).padStart(4)}: ${d.motivo}`);
      console.log(`            ${d.crudo}`);
    }
    if (r.descartadas.length > 30) console.log(`  … y ${r.descartadas.length - 30} más`);
  }

  console.log("\nMuestra de lo que se va a guardar:");
  for (const c of r.contactos.slice(0, 5)) {
    console.log(
      `  ${c.chatId}  ${c.nombre.padEnd(22)} ${(c.ultimaAtencion ?? "sin fecha").padEnd(12)} ` +
        `${c.datos.vehiculo ?? ""}`,
    );
  }

  const conFecha = r.contactos.filter((c) => c.ultimaAtencion).length;
  const conVehiculo = r.contactos.filter((c) => c.datos.vehiculo).length;
  console.log(
    `\n  con fecha de atención: ${conFecha}/${r.contactos.length}` +
      `   ·   con vehículo: ${conVehiculo}/${r.contactos.length}`,
  );
  if (conVehiculo < r.contactos.length) {
    console.log("  (a los que no tienen vehículo, Beto no les escribe: la plantilla lo necesita)");
  }

  if (!escribir) {
    console.log("\nSimulación. Para escribir de verdad, repetir con --escribir\n");
    return;
  }

  const supa = db();
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre")
    .eq("id", clienteId)
    .maybeSingle();
  if (!cli) {
    console.error(`\nNo existe el cliente ${clienteId}.`);
    process.exit(1);
  }
  console.log(`\nEscribiendo en ${cli.nombre}…`);

  let ok = 0;
  let fallos = 0;
  // De a 100: un upsert de 3.000 filas en una sola llamada es el tipo de cosa
  // que funciona en la prueba y da timeout el día de la importación real.
  for (let i = 0; i < r.contactos.length; i += 100) {
    const lote = r.contactos.slice(i, i + 100).map((c) => ({
      cliente_id: clienteId,
      chat_id: c.chatId,
      nombre: c.nombre,
      telefono: c.telefono,
      etiqueta: "cliente",
      ultima_atencion: c.ultimaAtencion,
      datos: c.datos,
    }));
    const { error } = await supa
      .from("ed_contactos")
      .upsert(lote, { onConflict: "cliente_id,chat_id" });
    if (error) {
      fallos += lote.length;
      console.error(`  lote ${i / 100 + 1}: ${error.message}`);
    } else {
      ok += lote.length;
      process.stdout.write(`  ${ok}/${r.contactos.length}\r`);
    }
  }
  console.log(`\n\n${ok} contactos guardados${fallos ? `, ${fallos} con error` : ""}.`);
  if (fallos) {
    console.log("Si el error menciona 'ultima_atencion' o 'datos', falta aplicar sql/282.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
