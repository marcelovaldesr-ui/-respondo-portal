import "./_env";
import { createHmac, randomBytes } from "node:crypto";
import { db } from "../lib/db";

/**
 * PRUEBA DE ENVÍO REAL DE KAMBAK, HACIA TU PROPIO CELULAR.
 *
 * USO (lo corre una PERSONA):
 *   npx tsx scripts/probar_envio_kambak.ts 9XXXXXXXX                 (ensayo: NO envía nada)
 *   npx tsx scripts/probar_envio_kambak.ts 9XXXXXXXX --enviar        (envía 1 mensaje REAL)
 *   Opcional: --plantilla sello_promo | sello_cerca | sello_premio_cerca   (por defecto sello_promo)
 *
 * QUÉ HACE
 *  - Pide al portal de Respondo, firmado igual que lo hace Kambak, que mande UNA plantilla
 *    aprobada al celular que indiques. Prueba: firma, plantilla, número de WhatsApp, Meta.
 *  - NO pasa por los interruptores de Kambak ni toca a ningún cliente: va directo al portal,
 *    así que no hay riesgo de escribirle a clientes reales.
 *  - El celular debe ser DISTINTO del número de Kambak (+56 9 8576 1941).
 *  - Sin `--enviar` solo muestra qué enviaría. No imprime ninguna clave.
 */

const PORTAL = "https://respondo-portal.vercel.app";
const SLUG = "kambak";

const args = process.argv.slice(2);
const enviar = args.includes("--enviar");
const iPl = args.indexOf("--plantilla");
const plantilla = iPl >= 0 ? args[iPl + 1] : "sello_promo";
const crudo = (args.find((a, i) => !a.startsWith("--") && i !== iPl + 1) ?? "").replace(/[\s+()-]/g, "");

const VARIABLES: Record<string, string[]> = {
  // orden exacto de cada plantilla (ver lib/plantillasKambak.ts)
  sello_promo: ["Marcelo", "Kambak", "Prueba de conexión", "Este es un mensaje de prueba de Kambak. Puedes ignorarlo.", "hoy"],
  sello_cerca: ["Marcelo", "Kambak", "8", "10"],
  sello_premio_cerca: ["Marcelo", "2 sellos", "café gratis", "Kambak"],
};

function normalizar(n: string): string | null {
  const solo = n.replace(/^56/, "");
  return /^9\d{8}$/.test(solo) ? `+56${solo}` : null;
}

async function main() {
  const to = normalizar(crudo);
  if (!to) {
    console.error("Falta el celular o está mal escrito. Ejemplo: npx tsx scripts/probar_envio_kambak.ts 912345678");
    process.exit(1);
  }
  if (to === "+56985761941") {
    console.error("Ese es el número de Kambak: no puede enviarse un mensaje a sí mismo. Usa tu celular personal.");
    process.exit(1);
  }
  const variables = VARIABLES[plantilla];
  if (!variables) {
    console.error(`Plantilla no permitida en esta prueba. Usa: ${Object.keys(VARIABLES).join(", ")}`);
    process.exit(1);
  }

  const supa = db();
  const { data: cli } = await supa.from("ed_clientes").select("id, nombre").eq("slug", SLUG).maybeSingle();
  if (!cli) {
    console.error(`No se encontró el negocio "${SLUG}".`);
    process.exit(1);
  }
  const { data: ints } = await supa
    .from("ed_integraciones")
    .select("secreto")
    .eq("cliente_id", cli.id)
    .eq("activo", true)
    .limit(1);
  const secreto = (ints?.[0]?.secreto as string | undefined) ?? "";
  if (!secreto) {
    console.error("Kambak no tiene una integración activa con llave en el portal.");
    process.exit(1);
  }

  const clave = `prueba-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const cuerpo = JSON.stringify({
    clienteId: cli.id,
    to,
    template: plantilla,
    language: "es",
    variables,
    idempotencyKey: clave,
  });

  console.log(`\nNegocio: ${cli.nombre}   Plantilla: ${plantilla}   Destino: ${to.slice(0, 5)}•••${to.slice(-3)}`);
  if (!enviar) {
    console.log("\nENSAYO: no se envió nada. Para mandar el mensaje real, repite el comando agregando --enviar\n");
    return;
  }

  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(12).toString("hex");
  const firma = "sha256=" + createHmac("sha256", secreto).update(`${ts}.${nonce}.${cuerpo}`).digest("hex");

  const r = await fetch(`${PORTAL}/api/externo/mensajes`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-respondo-ts": ts,
      "x-respondo-nonce": nonce,
      "x-respondo-firma": firma,
    },
    body: cuerpo,
  });
  const texto = await r.text();
  console.log(`\nRespuesta del portal: HTTP ${r.status}\n${texto.slice(0, 400)}\n`);

  // Estado guardado (solo plantilla/estado/motivo/id de Meta: nunca el teléfono).
  await new Promise((ok) => setTimeout(ok, 4000));
  const { data: fila } = await supa
    .from("ed_envios_api")
    .select("plantilla, estado, motivo, wamid, creado_en")
    .eq("cliente_id", cli.id)
    .eq("clave", clave)
    .maybeSingle();
  console.log("Registro en el portal:", fila ?? "(aún sin registro)");
  console.log(
    "\nSi el estado es 'enviado', revisa tu celular. Si es 'en_cola', se mandará solo cuando abra el horario (9:00 a 21:00 hora de Chile).\n",
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
