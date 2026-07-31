/**
 * Confirma que el módulo de agenda NO alteró el comportamiento de Tino en los
 * clientes reales que no tienen agenda configurada (Impresora Color).
 *
 *   npx tsx scripts/_verificar_tino_intacto.ts
 */
import "./_env"; // PRIMERO: carga .env.local (si no, db() no encuentra las llaves)
import { db } from "../lib/db";
import { contextoAgenda } from "../lib/agendaBot";
import { armarPrompt } from "../lib/promptEmpleado";
import { listarServicios } from "../lib/agenda";

let ok = 0, fallos = 0;
function check(n: string, cond: boolean, extra?: string) {
  if (cond) { ok++; console.log(`  ✓ ${n}`); }
  else { fallos++; console.error(`  ✗ ${n}${extra ? ` — ${extra}` : ""}`); }
}

const supa = db();

async function main() {
  const { data: clientes } = await supa
    .from("ed_clientes")
    .select("id, nombre, activo, reservas_online, transporte")
    .eq("activo", true);

  console.log("\n═══ Clientes activos en la base ═══");
  for (const c of clientes ?? []) {
    const svcs = await listarServicios(c.id as string, supa);
    console.log(`  · ${c.nombre} — servicios de agenda: ${svcs.length} · reservas online: ${c.reservas_online} · transporte: ${c.transporte ?? "waha"}`);
  }

  // El cliente real que importa: el que NO es demo.
  const reales = (clientes ?? []).filter(
    (c) => !String(c.id).startsWith("11111111") && !String(c.id).startsWith("22222222"),
  );

  console.log("\n═══ Verificación de no-interferencia ═══");
  for (const c of reales) {
    const nombre = c.nombre as string;
    const clienteId = c.id as string;

    const svcs = await listarServicios(clienteId, supa);
    check(`${nombre}: sin servicios de agenda cargados`, svcs.length === 0, `tiene ${svcs.length}`);

    const { data: emp } = await supa
      .from("ed_empleados")
      .select("id, rol, nombre_publico")
      .eq("cliente_id", clienteId)
      .eq("activo", true);

    for (const e of emp ?? []) {
      const ctx = await contextoAgenda(clienteId, "56900000000", supa);
      check(
        `${nombre}/${e.nombre_publico}: contextoAgenda devuelve null (no se inyecta nada al prompt)`,
        ctx === null,
        ctx ? "¡devolvió contexto! el prompt cambiaría" : "",
      );

      // El prompt real debe salir SIN el bloque de agenda.
      const prompt = await armarPrompt(clienteId, e.id as string, [
        { rol: "cliente", texto: "hola, cuánto vale imprimir 100 volantes?" },
      ], ctx?.texto);
      check(
        `${nombre}/${e.nombre_publico}: el prompt NO contiene el bloque AGENDA REAL`,
        !!prompt && !prompt.includes("AGENDA REAL"),
        prompt ? "contiene el bloque" : "prompt nulo",
      );
      check(
        `${nombre}/${e.nombre_publico}: el prompt conserva sus reglas de siempre`,
        !!prompt && prompt.includes("REGLAS INQUEBRANTABLES") && prompt.includes("INFORMACIÓN DEL NEGOCIO"),
      );
      break; // basta con un empleado por cliente
    }
  }

  console.log("\n═══ El feed iCal quedó disponible para todos ═══");
  const { data: tokens } = await supa.from("ed_clientes").select("nombre, ical_token").eq("activo", true);
  const sinToken = (tokens ?? []).filter((t) => !t.ical_token);
  check("todos los clientes activos tienen ical_token", sinToken.length === 0,
    sinToken.map((t) => t.nombre).join(", "));

  console.log(`\n═══ RESULTADO: ${ok} OK, ${fallos} fallos ═══\n`);
  process.exit(fallos > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("💥", (e as Error).message);
  process.exit(1);
});
