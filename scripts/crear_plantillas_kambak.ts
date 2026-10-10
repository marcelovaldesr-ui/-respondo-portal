import "./_env";
import { db } from "../lib/db";
import { PLANTILLAS_KAMBAK, type PlantillaKambak } from "../lib/plantillasKambak";
import { tokenDeFila } from "../lib/whatsapp";

/**
 * DA DE ALTA LAS 6 PLANTILLAS DE KAMBAK EN META, CON UN COMANDO.
 *
 * USO (lo corre una PERSONA, nunca el código del portal):
 *   npx tsx scripts/crear_plantillas_kambak.ts            (revisa: no escribe nada)
 *   npx tsx scripts/crear_plantillas_kambak.ts --crear    (crea las que falten)
 *
 * SEGURIDAD
 *  - Solo actúa sobre el negocio con slug "kambak". No acepta otro cliente, así
 *    que no puede crear estas plantillas en el portafolio de Meta de nadie más.
 *  - Sin `--crear` solo lee. Con `--crear` crea únicamente las que NO existen y
 *    jamás borra ni edita las que ya hay.
 *  - No imprime el token ni ninguna clave.
 *  - Crear plantillas manda solicitudes de revisión a Meta: Meta decide si las
 *    aprueba y puede reclasificar la categoría.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const SLUG = "kambak";
const crear = process.argv.includes("--crear");

type Remota = { name: string; language: string; status: string; category: string };

async function listarRemotas(wabaId: string, token: string): Promise<Remota[]> {
  const salida: Remota[] = [];
  let url = `${GRAPH}/${wabaId}/message_templates?limit=100`;
  for (let pagina = 0; pagina < 5 && url; pagina++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`listar plantillas: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { data?: Remota[]; paging?: { next?: string } };
    salida.push(...(j.data ?? []));
    url = j.paging?.next ?? "";
  }
  return salida;
}

/** Cuerpo exacto que Meta espera para cada categoría. */
function componentes(p: PlantillaKambak): Record<string, unknown>[] {
  if (p.categoria === "authentication") {
    // Meta fija el texto. Pide: recomendación de seguridad, vencimiento y botón de copiar.
    return [
      { type: "BODY", add_security_recommendation: true },
      { type: "FOOTER", code_expiration_minutes: 5 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] },
    ];
  }
  return [
    {
      type: "BODY",
      text: p.cuerpo,
      example: { body_text: [p.ejemplos] },
    },
  ];
}

async function crearRemota(wabaId: string, token: string, p: PlantillaKambak) {
  const r = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: p.nombre,
      language: p.idioma,
      category: p.categoria.toUpperCase(), // UTILITY | MARKETING | AUTHENTICATION
      components: componentes(p),
    }),
  });
  const texto = await r.text();
  if (!r.ok) return { ok: false, detalle: `HTTP ${r.status}: ${texto.slice(0, 300)}` };
  const j = JSON.parse(texto) as { id?: string; status?: string };
  return { ok: true, detalle: `id ${j.id ?? "?"} · ${j.status ?? "PENDING"}` };
}

function revisarLocal(lista: PlantillaKambak[]): string[] {
  const errores: string[] = [];
  for (const p of lista) {
    if (p.categoria === "authentication") continue; // el texto lo pone Meta
    const usadas = new Set((p.cuerpo.match(/\{\{(\d+)\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, ""))));
    for (let i = 1; i <= p.variables.length; i++) {
      if (!usadas.has(i)) errores.push(`${p.nombre}: falta {{${i}}} en el cuerpo`);
    }
    if (usadas.size !== p.variables.length) errores.push(`${p.nombre}: variables y cuerpo no coinciden`);
    if (p.ejemplos.length !== p.variables.length) errores.push(`${p.nombre}: faltan ejemplos`);
    if (p.categoria === "marketing" && !/BAJA/.test(p.cuerpo)) errores.push(`${p.nombre}: falta la línea de baja`);
  }
  return errores;
}

async function main() {
  const { data: cli, error } = await db()
    .from("ed_clientes")
    .select("nombre, waba_id, waba_token, waba_token_cifrado")
    .eq("slug", SLUG)
    .maybeSingle();
  if (error || !cli) {
    console.error(`No se encontró el negocio "${SLUG}" en el portal.`);
    process.exit(1);
  }
  const wabaId = cli.waba_id as string | null;
  const token = tokenDeFila(cli as Parameters<typeof tokenDeFila>[0]);
  if (!wabaId || !token) {
    console.error("Kambak todavía no tiene el WhatsApp conectado (falta waba_id o token). Conéctalo primero.");
    process.exit(1);
  }

  const plantillas = Object.values(PLANTILLAS_KAMBAK);
  console.log(`\nNegocio: ${cli.nombre}   Cuenta de WhatsApp (WABA): ${wabaId}\n`);

  const errores = revisarLocal(plantillas);
  if (errores.length) {
    errores.forEach((e) => console.log(`  ✗ ${e}`));
    console.error("\nHay problemas en los textos. No se manda nada.");
    process.exit(1);
  }
  console.log(`  ✓ las ${plantillas.length} plantillas cumplen las reglas básicas\n`);

  const remotas = await listarRemotas(wabaId, token);
  const porNombre = new Map(remotas.map((r) => [`${r.name}|${r.language}`, r]));

  console.log("Estado en Meta");
  const faltan: PlantillaKambak[] = [];
  for (const p of plantillas) {
    const r = porNombre.get(`${p.nombre}|${p.idioma}`);
    if (!r) {
      faltan.push(p);
      console.log(`  · ${p.nombre.padEnd(20)} NO EXISTE      (${p.categoria})`);
    } else {
      const alerta = r.category.toLowerCase() !== p.categoria ? `  ⚠ Meta la dejó como ${r.category}` : "";
      console.log(`  · ${p.nombre.padEnd(20)} ${r.status.padEnd(14)} (${r.category})${alerta}`);
    }
  }

  if (!faltan.length) {
    console.log("\nNo falta ninguna. Si alguna está REJECTED, se corrige en el Administrador de WhatsApp.\n");
    return;
  }
  if (!crear) {
    console.log(`\nFaltan ${faltan.length}: ${faltan.map((p) => p.nombre).join(", ")}`);
    console.log("Para crearlas de verdad, repite el comando con --crear\n");
    return;
  }

  console.log(`\nCreando ${faltan.length} plantilla(s)…\n`);
  for (const p of faltan) {
    const r = await crearRemota(wabaId, token, p);
    console.log(`  ${r.ok ? "✓" : "✗"} ${p.nombre.padEnd(20)} ${r.detalle}`);
  }
  console.log("\nQuedan en revisión (de minutos a 24 horas). Para ver cómo van, corre el comando sin --crear.\n");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
