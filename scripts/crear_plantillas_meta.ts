import "./_env";
import { db } from "../lib/db";
import { PLANTILLAS, validarCuerpo } from "../lib/plantillas";
import { tokenDeFila } from "../lib/whatsapp";

/**
 * DA DE ALTA LAS PLANTILLAS EN META, CON UN COMANDO.
 *
 * USO
 *   npx tsx scripts/crear_plantillas_meta.ts --cliente <uuid>            (revisa)
 *   npx tsx scripts/crear_plantillas_meta.ts --cliente <uuid> --crear    (crea)
 *   npx tsx scripts/crear_plantillas_meta.ts --cliente <uuid> --estado   (solo lista)
 *
 * POR QUÉ EXISTE
 * Las siete plantillas se pueden crear a mano en WhatsApp Manager, pero son
 * siete formularios con cuerpos que hay que pegar sin equivocarse, y hay que
 * repetirlo en el WABA de CADA cliente nuevo. Un error de una letra en el
 * nombre no se nota hasta que un envío falla con 132001, semanas después.
 *
 * Sin `--crear` no escribe nada: valida los cuerpos, muestra qué existe ya en
 * ese WABA y qué faltaría crear.
 *
 * IMPORTANTE: crear plantillas modifica el portafolio de Meta del cliente. El
 * script pide `--crear` explícito por eso, y nunca borra ni edita las que ya
 * existen: si una está creada con otro texto, lo dice y no la toca.
 */

const GRAPH = "https://graph.facebook.com/v21.0";

const args = process.argv.slice(2);
const clienteId = args[args.indexOf("--cliente") + 1];
const crear = args.includes("--crear");
const soloEstado = args.includes("--estado");

if (!args.includes("--cliente") || !clienteId) {
  console.error("Uso: npx tsx scripts/crear_plantillas_meta.ts --cliente <uuid> [--crear|--estado]");
  process.exit(1);
}

type PlantillaRemota = { name: string; language: string; status: string; category: string };

async function listarRemotas(wabaId: string, token: string): Promise<PlantillaRemota[]> {
  const salida: PlantillaRemota[] = [];
  let url = `${GRAPH}/${wabaId}/message_templates?limit=100`;
  for (let pagina = 0; pagina < 5 && url; pagina++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`listar plantillas: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { data?: PlantillaRemota[]; paging?: { next?: string } };
    salida.push(...(j.data ?? []));
    url = j.paging?.next ?? "";
  }
  return salida;
}

async function crearRemota(
  wabaId: string,
  token: string,
  p: (typeof PLANTILLAS)[string],
): Promise<{ ok: boolean; detalle: string }> {
  const cuerpo = {
    name: p.nombre,
    language: p.idioma,
    category: p.categoria.toUpperCase(), // UTILITY | MARKETING
    components: [
      {
        type: "BODY",
        text: p.cuerpo,
        ...(p.ejemplos.length ? { example: { body_text: [p.ejemplos] } } : {}),
      },
    ],
  };
  const r = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  if (!r.ok) return { ok: false, detalle: `HTTP ${r.status}: ${texto.slice(0, 300)}` };
  const j = JSON.parse(texto) as { id?: string; status?: string };
  return { ok: true, detalle: `id ${j.id ?? "?"} · ${j.status ?? "PENDING"}` };
}

async function main() {
  const supa = db();
  const { data: cli } = await supa
    .from("ed_clientes")
    .select("nombre, waba_id, waba_token, waba_token_cifrado")
    .eq("id", clienteId)
    .maybeSingle();

  if (!cli) {
    console.error(`No existe el cliente ${clienteId}.`);
    process.exit(1);
  }
  const wabaId = cli.waba_id as string | null;
  // Mismo camino que el envío real: cifrado si existe, texto plano de respaldo.
  const token = tokenDeFila(cli as Parameters<typeof tokenDeFila>[0]);
  if (!wabaId || !token) {
    console.error(
      `${cli.nombre} no tiene waba_id o token. Las plantillas se crean en el ` +
        `portafolio del cliente, así que primero hay que conectar el número.`,
    );
    process.exit(1);
  }

  console.log(`\nCliente: ${cli.nombre}   WABA: ${wabaId}\n`);

  // 1) Validar los cuerpos ANTES de mandarlos. Meta tarda horas en revisar y el
  //    motivo del rechazo no siempre dice qué regla se rompió.
  let invalidas = 0;
  for (const p of Object.values(PLANTILLAS)) {
    const errs = validarCuerpo(p);
    if (errs.length) {
      invalidas++;
      console.log(`  ✗ ${p.nombre}: ${errs.join(" · ")}`);
    }
  }
  if (invalidas) {
    console.error(`\n${invalidas} plantilla(s) con problemas. No se manda nada hasta arreglarlas.`);
    process.exit(1);
  }
  console.log(`  ✓ los ${Object.keys(PLANTILLAS).length} cuerpos cumplen las reglas de Meta`);

  // 2) Qué hay ya en ese WABA.
  const remotas = await listarRemotas(wabaId, token);
  const porNombre = new Map(remotas.map((r) => [`${r.name}|${r.language}`, r]));

  console.log("\nEstado en Meta");
  const faltan: string[] = [];
  for (const p of Object.values(PLANTILLAS)) {
    const r = porNombre.get(`${p.nombre}|${p.idioma}`);
    if (!r) {
      faltan.push(p.nombre);
      console.log(`  · ${p.nombre.padEnd(22)} NO EXISTE      (${p.categoria})`);
    } else {
      const alerta = r.category.toLowerCase() !== p.categoria ? `  ⚠ Meta la dejó como ${r.category}` : "";
      console.log(`  · ${p.nombre.padEnd(22)} ${r.status.padEnd(14)} (${r.category})${alerta}`);
    }
  }

  if (soloEstado) return;

  if (!faltan.length) {
    console.log("\nNo falta ninguna. Si alguna está REJECTED, hay que corregirla en WhatsApp Manager.\n");
    return;
  }

  if (!crear) {
    console.log(`\nFaltan ${faltan.length}: ${faltan.join(", ")}`);
    console.log("Para crearlas de verdad, repetir el comando con --crear\n");
    return;
  }

  console.log(`\nCreando ${faltan.length} plantilla(s)…\n`);
  for (const nombre of faltan) {
    const p = PLANTILLAS[nombre];
    const r = await crearRemota(wabaId, token, p);
    console.log(`  ${r.ok ? "✓" : "✗"} ${nombre.padEnd(22)} ${r.detalle}`);
  }
  console.log(
    "\nQuedan en revisión. Suele tardar de minutos a 24 horas.\n" +
      "Para ver cómo van: repetir con --estado\n",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
