/**
 * VERIFICACIÓN EN NAVEGADOR REAL — Estudio Creativo 2.0.
 *
 * Seis recorridos, todos con datos reales de la base:
 *   1. Respondo: el contexto es el correcto y el brief ofrece lo que VENDE.
 *   2. Respondo: escribir el copy a mano y subir un diseño propio.
 *   3. Respondo: generar copy con estrategia y guardar.
 *   4. Impresora: el mismo producto suena distinto (otro negocio, otra voz).
 *   5. Reemplazar el diseño subido por otro y guardar.
 *   6. Si el modelo falla, el diseño subido NO se pierde.
 *
 * ⚠️ POR QUÉ UN NAVEGADOR DE VERDAD: en `app/(marketing)` los `redirect()`
 * ocurren dentro de un Suspense, así que un `fetch` devuelve 200 con el
 * esqueleto de carga aunque la persona real termine en otra pantalla.
 *
 * ⚠️ `waitUntil: "networkidle"` NO se usa: en este contenedor las fuentes de
 * Google no resuelven y la espera se cuelga.
 *
 *   BASE=http://localhost:3000 node tests-navegador/estudio-2.mjs
 *
 * Con `SIN_MODELO=1` apunta a un servidor levantado sin GEMINI_API_KEY, que es
 * como se prueba el recorrido 6.
 */
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CORREO_RESPONDO = "hirespondo@gmail.com";
const CORREO_IMPRESORA = "impresoracolor3@gmail.com";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Se bloquea todo lo que no sea NUESTRO servidor: las fuentes de Google no
 *  resuelven en este contenedor y la espera se cuelga. Sale de BASE y no de una
 *  constante, porque el recorrido 6 corre contra otro puerto. */
const soloLocal = (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort());
const DOMINIO = new URL(BASE).hostname;

const fallas = [];
const ok = (t) => console.log(`  ✓ ${t}`);
const mal = (t, d) => {
  fallas.push(`${t}${d ? ` — ${d}` : ""}`);
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ""}`);
};

/** Sesión sin escribir contraseña: enlace mágico → /auth/verificar. */
async function cookiesDe(correo) {
  const { data, error } = await supa.auth.admin.generateLink({ type: "magiclink", email: correo });
  if (error) throw new Error(`generateLink(${correo}): ${error.message}`);
  const r = await fetch(`${BASE}/auth/verificar?token_hash=${data.properties.hashed_token}&type=magiclink`, { redirect: "manual" });
  const crudas = r.headers.getSetCookie?.() ?? [];
  if (!crudas.length) throw new Error(`sin Set-Cookie para ${correo} (status ${r.status})`);
  return crudas.map((c) => {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    return { name: par.slice(0, i).trim(), value: par.slice(i + 1).trim(), domain: DOMINIO, path: "/" };
  });
}

/** Un PNG de verdad, generado al vuelo: la validación decodifica, no confía. */
async function pngDePrueba(ancho, alto, color) {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: ancho, height: alto, channels: 3, background: color } })
    .png()
    .toBuffer();
}

const esperar = (page, ms = 1200) => page.waitForTimeout(ms);

async function abrirEstudio(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/marketing/creatividades/nueva`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await esperar(page, 2500);
  return page;
}

async function texto(page) {
  return page.locator("body").innerText();
}

/**
 * Espera a que el paso 2 esté escrito.
 *
 * ⚠️ El pipeline tarda entre 8 y 40 segundos: una llamada al modelo en el caso
 * bueno y hasta dos reescrituras si la revisión encuentra defectos. El tope es
 * generoso a propósito — una espera corta acá no mide el producto, mide la
 * suerte que tuvo la llamada.
 */
async function esperarTexto(page, ms = 120_000) {
  try {
    await page.getByText("Gancho (primera línea)").first().waitFor({ timeout: ms });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx.route("**/*", soloLocal);
  await ctx.addCookies(await cookiesDe(CORREO_RESPONDO));

  /* ── 1. El contexto de Respondo es el correcto ────────────────────────── */
  console.log("\n▸ 1. RESPONDO · el brief ofrece lo que se VENDE");
  const page = await abrirEstudio(ctx);
  const brief = await texto(page);

  if (/Cupos y qué cuenta como una conversación/.test(brief)) {
    mal("«Cupos y qué cuenta como una conversación» ya NO se ofrece como producto");
  } else {
    ok("«Cupos y qué cuenta como una conversación» ya no se ofrece como producto");
  }
  for (const basura of ["El panel: qué ve y qué controla el dueño", "Avisos de pedido y conexión", "Agenda y reservas online"]) {
    if (brief.includes(basura)) mal(`«${basura}» no debería ofrecerse como producto`);
  }
  ok("ninguna capacidad ni ficha de documentación aparece como producto");

  if (/Plan Inicial|Plan Crecimiento|Tino/.test(brief)) ok("sí aparecen los planes y empleados que se compran");
  else mal("aparecen los productos reales", "no se ven planes ni empleados");

  if (/\$1[24]9\.990|\$120\.000/.test(brief)) ok("los chips traen el precio real del catálogo");
  else mal("los chips traen precio");

  if (/LO QUE RESPONDO ENTIENDE DE TU NEGOCIO/i.test(brief)) ok("se puede revisar lo que Respondo entendió");
  else mal("existe el contexto revisable");

  if (/Escribir yo/.test(brief)) ok("se puede escribir el anuncio a mano");
  else mal("existe «Escribir yo»");

  if (/¿A dónde llega la persona\?/.test(brief)) ok("se elige el destino, no se asume WhatsApp");
  else mal("existe el selector de destino");

  // El rótulo del objetivo ya no promete un canal que este negocio no tiene.
  if (/Que más gente te escriba por WhatsApp/.test(brief)) mal("el objetivo no debería nombrar WhatsApp");
  else ok("el objetivo describe el resultado, no el canal");

  await page.screenshot({ path: "/tmp/e2-1-brief.png", fullPage: true });

  /* ── 2. Copy a mano + diseño propio ───────────────────────────────────── */
  console.log("\n▸ 2. RESPONDO · copy a mano y diseño propio");
  await page.getByRole("button", { name: "Escribir yo" }).click();
  await esperar(page);

  const campos = page.locator("input.campo, textarea.campo");
  await campos.nth(0).fill("Lo escribí yo, sin modelo");
  await campos.nth(1).fill("Titular escrito a mano");
  await campos.nth(2).fill("Este texto lo escribió una persona y nada lo puede reemplazar solo.");
  await esperar(page, 600);

  const t2 = await texto(page);
  if (/Lo estás escribiendo tú/.test(t2)) ok("la pantalla reconoce que el texto es de la persona");
  else mal("avisa que el texto es manual");

  if ((await texto(page)).includes("Titular escrito a mano")) ok("la vista previa refleja el texto manual");
  else mal("la vista previa refleja el texto manual");

  await page.getByRole("button", { name: "Seguir con la imagen" }).click();
  await esperar(page);

  const t3 = await texto(page);
  for (const [que, re] of [
    ["Generar", /Generar/],
    ["Subir mi diseño", /Subir mi diseño/],
    ["Usar una existente", /Usar una existente/],
  ]) {
    if (re.test(t3)) ok(`la imagen ofrece «${que}»`);
    else mal(`la imagen ofrece «${que}»`);
  }

  await page.getByRole("tab", { name: "Subir mi diseño" }).click();
  await esperar(page, 500);
  await page.locator('input[type="file"]').setInputFiles({
    name: "diseno.png",
    mimeType: "image/png",
    buffer: await pngDePrueba(1080, 1080, "#1d3557"),
  });
  await esperar(page, 4000);

  const t4 = await texto(page);
  if (/no se pudo|no es una imagen|pesa/i.test(t4)) mal("el diseño propio se sube", t4.slice(0, 160));
  else ok("el diseño propio se sube y se muestra");

  if ((await page.locator('img[src*="/api/marketing/imagen"]').count()) > 0) {
    ok("la pieza se sirve por el endpoint privado, no por una URL pública");
  } else {
    mal("la pieza se sirve por el endpoint privado");
  }
  await page.screenshot({ path: "/tmp/e2-2-manual.png", fullPage: true });

  /* ── 5. Reemplazar el diseño y guardar ────────────────────────────────── */
  console.log("\n▸ 5. RESPONDO · reemplazar el diseño y guardar");
  const antes = await page.locator('img[src*="/api/marketing/imagen"]').first().getAttribute("src");
  await page.locator('input[type="file"]').setInputFiles({
    name: "otro.png",
    mimeType: "image/png",
    buffer: await pngDePrueba(1080, 1080, "#7a1f2b"),
  });
  await esperar(page, 4000);
  const despues = await page.locator('img[src*="/api/marketing/imagen"]').first().getAttribute("src");
  if (antes && despues && antes !== despues) ok("el segundo diseño reemplaza al primero");
  else mal("el segundo diseño reemplaza al primero", `${antes} → ${despues}`);

  // Una proporción que no calza tiene que AVISAR, no deformar.
  await page.locator('input[type="file"]').setInputFiles({
    name: "ancha.png",
    mimeType: "image/png",
    buffer: await pngDePrueba(1600, 400, "#2a9d8f"),
  });
  await esperar(page, 4000);
  if (/va a recortar|se guarda tal cual/i.test(await texto(page))) {
    ok("avisa cuando la proporción no calza, en vez de deformar la pieza");
  } else {
    mal("avisa cuando la proporción no calza");
  }

  await page.getByRole("button", { name: "Guardar como borrador" }).click();
  await esperar(page, 5000);
  if (/\/marketing\/creatividades\/[0-9a-f-]{8,}/.test(page.url())) ok("se guarda con el diseño propio");
  else mal("se guarda con el diseño propio", page.url());
  await page.screenshot({ path: "/tmp/e2-5-guardada.png", fullPage: true });

  /* ── 3. Copy generado con estrategia ──────────────────────────────────── */
  console.log("\n▸ 3. RESPONDO · copy generado con estrategia");
  const p2 = await abrirEstudio(ctx);
  await p2.getByRole("button", { name: "Escribir el anuncio" }).click();
  const salio = await esperarTexto(p2);
  if (!salio) {
    mal("el anuncio se genera", (await texto(p2)).slice(0, 200));
  } else {
    const t = await texto(p2);
    if (/estrategia/i.test(t)) ok("muestra la estrategia antes del texto");
    else mal("muestra la estrategia");
    if (/Se apoya en/.test(t)) ok("dice en qué ángulo se apoya");
    else mal("dice el ángulo");
    if (/Otros ángulos/.test(t)) ok("ofrece otros ángulos, etiquetados");
    else mal("ofrece otros ángulos");
    if (/cupo|excedente/i.test(t)) mal("el anuncio NO debería hablar de cupos");
    else ok("el anuncio no habla de la mecánica del plan");
    await p2.screenshot({ path: "/tmp/e2-3-copy.png", fullPage: true });
  }

  /* ── 6. Si el modelo falla, el diseño propio NO se pierde ─────────────── */
  if (process.env.SIN_MODELO === "1") {
    console.log("\n▸ 6. SIN MODELO · el fallo de la IA no se lleva el trabajo manual");
    const p6 = await abrirEstudio(ctx);
    await p6.getByRole("button", { name: "Escribir yo" }).click();
    await esperar(p6);
    const c6 = p6.locator("input.campo, textarea.campo");
    await c6.nth(1).fill("Titular que no se puede perder");
    await c6.nth(2).fill("Texto escrito a mano antes de que el modelo fallara.");
    await p6.getByRole("button", { name: "Seguir con la imagen" }).click();
    await esperar(p6);
    await p6.getByRole("tab", { name: "Subir mi diseño" }).click();
    await esperar(p6, 500);
    await p6.locator('input[type="file"]').setInputFiles({
      name: "propio.png",
      mimeType: "image/png",
      buffer: await pngDePrueba(1080, 1080, "#3d405b"),
    });
    await esperar(p6, 4000);
    const conImagen = (await p6.locator('img[src*="/api/marketing/imagen"]').count()) > 0;

    // Ahora se pide texto a un modelo que no existe.
    await p6.getByRole("tab", { name: "1. Brief" }).click();
    await esperar(p6, 400);
    await p6.getByRole("button", { name: "Escribir el anuncio" }).click();
    await esperar(p6, 8000);

    const t6 = await texto(p6);
    if (/no está|no se pudo|sin motor|configurad/i.test(t6)) ok("el fallo del modelo se explica en vez de fallar mudo");
    else mal("el fallo del modelo se explica", t6.slice(0, 160));

    await p6.getByRole("tab", { name: "3. Imagen" }).click();
    await esperar(p6, 600);
    const sigue = (await p6.locator('img[src*="/api/marketing/imagen"]').count()) > 0;
    if (conImagen && sigue) ok("el diseño subido sigue ahí después del fallo");
    else mal("el diseño subido sobrevive al fallo del modelo");

    await p6.getByRole("tab", { name: "2. Texto" }).click();
    await esperar(p6, 600);
    if ((await texto(p6)).includes("Titular que no se puede perder")) ok("el texto manual tampoco se pierde");
    else mal("el texto manual sobrevive al fallo del modelo");
    await p6.screenshot({ path: "/tmp/e2-6-sinmodelo.png", fullPage: true });
  }

  /* ── 4. Impresora suena distinto ──────────────────────────────────────── */
  console.log("\n▸ 4. IMPRESORA · otro negocio, otra voz");
  const ctx2 = await navegador.newContext({ viewport: { width: 1500, height: 1200 } });
  await ctx2.route("**/*", soloLocal);
  await ctx2.addCookies(await cookiesDe(CORREO_IMPRESORA));
  const p3 = await abrirEstudio(ctx2);
  const briefImp = await texto(p3);
  if (/Tarjetas de presentación|Pendones|Flyers|Stickers/i.test(briefImp)) ok("Impresora ofrece sus productos reales");
  else mal("Impresora ofrece sus productos reales", briefImp.slice(0, 200));
  if (/Plan Inicial|Tino|empleados de IA/i.test(briefImp)) mal("no debería aparecer nada de Respondo en Impresora");
  else ok("no se filtra nada del otro negocio");
  await p3.screenshot({ path: "/tmp/e2-4-impresora.png", fullPage: true });

  await navegador.close();

  console.log("\n" + "─".repeat(66));
  if (fallas.length) {
    console.log(`FALLARON ${fallas.length}:`);
    for (const f of fallas) console.log(`  · ${f}`);
    process.exit(1);
  }
  console.log("TODO VERDE en navegador real.");
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
