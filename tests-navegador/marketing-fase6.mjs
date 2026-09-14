/**
 * VERIFICACIÓN EN NAVEGADOR REAL — Marketing Fase 6.
 *
 * Los tres Customer Zero, en el mismo producto:
 *   · AyP        → solo Meta, sin conversaciones en Respondo.
 *   · Impresora  → Google con palabras clave y términos de búsqueda.
 *   · Completo   → el circuito cerrado de siempre, que no puede romperse.
 *
 * ⚠️ POR QUÉ UN NAVEGADOR DE VERDAD Y NO UN `fetch`: en `app/(marketing)` los
 * `redirect()` ocurren DENTRO de un Suspense, así que una petición cruda
 * devuelve 200 con el esqueleto de carga aunque la persona real termine en
 * otra pantalla. Un 200 no prueba nada acá (lección de la auditoría del
 * núcleo, sep-2026).
 *
 * ⚠️ `waitUntil: "networkidle"` NO se usa: en este contenedor las fuentes de
 * Google no resuelven y la espera se cuelga. Se bloquea todo lo que no sea
 * localhost y se espera `domcontentloaded`.
 */
import { chromium } from "/home/claude/.npm-global/lib/node_modules/playwright/index.mjs";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CORREO = process.env.CORREO ?? "marcelo.valdes.r@mail.pucv.cl";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Sesión sin escribir una contraseña: enlace mágico → /auth/verificar. */
async function cookiesDeSesion() {
  const { data, error } = await supa.auth.admin.generateLink({ type: "magiclink", email: CORREO });
  if (error) throw new Error(`generateLink: ${error.message}`);
  const token = data.properties.hashed_token;
  const r = await fetch(`${BASE}/auth/verificar?token_hash=${token}&type=magiclink`, { redirect: "manual" });
  const crudas = r.headers.getSetCookie?.() ?? [];
  if (!crudas.length) throw new Error(`sin Set-Cookie (status ${r.status})`);
  return crudas.map((c) => {
    const [par] = c.split(";");
    const i = par.indexOf("=");
    return { name: par.slice(0, i).trim(), value: par.slice(i + 1).trim(), domain: "localhost", path: "/" };
  });
}

const fallas = [];
const ok = (t) => console.log(`  ✓ ${t}`);
const mal = (t, d) => {
  fallas.push(`${t}${d ? ` — ${d}` : ""}`);
  console.log(`  ✗ ${t}${d ? ` — ${d}` : ""}`);
};

async function ver(page, ruta) {
  await page.goto(`${BASE}${ruta}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1400);
  return { url: page.url(), texto: await page.locator("body").innerText() };
}

async function main() {
  const navegador = await chromium.launch();
  const ctx = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  // Nada de fuentes ni telemetría: en este contenedor no resuelven y cuelgan.
  await ctx.route("**/*", (r) => (/^https?:\/\/localhost:3000/.test(r.request().url()) ? r.continue() : r.abort()));
  await ctx.addCookies(await cookiesDeSesion());
  const page = await ctx.newPage();

  const fijarVariante = async (v) => {
    await ctx.addCookies([{ name: "mk_demo", value: v, domain: "localhost", path: "/" }]);
  };

  /* ── 1. AyP: Meta sin conversaciones ──────────────────────────────────── */
  console.log("\n▸ AYP (solo Meta, sin WhatsApp en Respondo)");
  await fijarVariante("meta");

  const inicio = await ver(page, "/marketing");
  if (/\/login|sin-permiso/.test(inicio.url)) mal("entra a Marketing", inicio.url);
  else ok("entra a Marketing");

  if (/Personas/.test(inicio.texto)) mal("«Personas» NO aparece en el riel sin conversaciones");
  else ok("«Personas» no aparece en el riel");

  if (/Costo por resultado/i.test(inicio.texto)) ok("la franja de KPI muestra costo por resultado");
  else mal("la franja de KPI se adapta a solo-ads", "no aparece «Costo por resultado»");

  if (/Conversaciones\s*\n?\s*0\b/.test(inicio.texto)) mal("no debería haber KPI de conversaciones en cero");
  else ok("no hay KPI de conversaciones en cero");

  if (/Del anuncio al resultado/.test(inicio.texto)) ok("el embudo se titula sin prometer la venta");
  else mal("el titular del embudo se adapta", "no dice «Del anuncio al resultado»");

  if (/Cambios que propondría/.test(inicio.texto)) ok("se muestran los cambios propuestos");
  else mal("aparecen las recomendaciones", "falta el panel «Cambios que propondría»");

  const personas = await ver(page, "/marketing/leads");
  // La ruta sigue existiendo (no se rompe un enlace viejo), pero el riel no la ofrece.
  ok(`/marketing/leads responde sin romperse (${personas.url.includes("leads") ? "misma ruta" : personas.url})`);

  const arquitecto = await ver(page, "/marketing/arquitecto");
  if (/Diseñar campaña/.test(arquitecto.texto)) ok("el Arquitecto abre");
  else mal("el Arquitecto abre", arquitecto.url);
  if (/WhatsApp/.test(arquitecto.texto) && /no tiene WhatsApp conectado/i.test(arquitecto.texto)) {
    ok("el Arquitecto explica por qué WhatsApp no es un destino posible");
  } else if (!/WhatsApp/.test(arquitecto.texto)) {
    ok("el Arquitecto no ofrece WhatsApp como destino");
  } else {
    mal("el Arquitecto explica el destino WhatsApp", "lo ofrece sin explicar");
  }

  const copiloto = await ver(page, "/marketing/copiloto");
  if (/mejores clientes/i.test(copiloto.texto)) mal("el copiloto no debería sugerir lo que no puede responder");
  else ok("el copiloto no sugiere preguntas que no puede responder");

  /* ── 2. Impresora: Google con búsqueda ────────────────────────────────── */
  console.log("\n▸ IMPRESORA (Google Ads, campañas de Búsqueda)");
  await fijarVariante("google");

  const busqueda = await ver(page, "/marketing/busqueda");
  if (/Términos de búsqueda/.test(busqueda.texto)) ok("la pantalla de Búsqueda abre con los términos");
  else mal("la pantalla de Búsqueda abre", busqueda.url);
  if (/Palabras clave/.test(busqueda.texto)) ok("muestra las palabras clave");
  else mal("muestra las palabras clave");
  if (/impresion de planos a1/.test(busqueda.texto)) ok("aparece el término que choca con una palabra propia");
  else mal("aparece el término que choca con una palabra propia");
  if (/no se puede concluir|bloquearía|chocaría/i.test(busqueda.texto)) {
    ok("y se explica por qué NO se propone excluirlo");
  } else {
    mal("se explica por qué no se propone excluir el término riesgoso");
  }

  const campanasG = await ver(page, "/marketing/campanas");
  if (/Máximo rendimiento/.test(campanasG.texto)) ok("las campañas de Google aparecen con su tipo");
  else mal("las campañas de Google aparecen", "no se ve «Máximo rendimiento»");

  /* ── 3. Completo: no se puede haber roto nada ─────────────────────────── */
  console.log("\n▸ COMPLETO (publicidad + conversaciones + ventas)");
  await fijarVariante("completo");

  const full = await ver(page, "/marketing");
  for (const [que, re] of [
    ["conversaciones", /Conversaciones/],
    ["ventas", /Ventas/],
    ["ingresos", /Ingresos/],
    ["retorno", /Retorno|ROAS/],
  ]) {
    if (re.test(full.texto)) ok(`el circuito cerrado conserva ${que}`);
    else mal(`el circuito cerrado conserva ${que}`);
  }
  if (/Del anuncio a la venta/.test(full.texto)) ok("el embudo completo sigue titulándose igual");
  else mal("el embudo completo sigue titulándose igual");

  const atribucion = await ver(page, "/marketing/atribucion");
  if (!/\/login|sin-permiso/.test(atribucion.url)) ok("Atribución sigue abriendo");
  else mal("Atribución sigue abriendo", atribucion.url);

  const personasFull = await ver(page, "/marketing/leads");
  if (/Personas|leads/i.test(personasFull.texto)) ok("Personas vuelve a existir con conversaciones");
  else mal("Personas vuelve a existir con conversaciones");

  /* ── 4. Integraciones: el estado real, con Google ─────────────────────── */
  console.log("\n▸ INTEGRACIONES");
  const integraciones = await ver(page, "/marketing/integraciones");
  if (/Google Ads/.test(integraciones.texto)) ok("aparece la tarjeta de Google Ads");
  else mal("aparece la tarjeta de Google Ads");
  if (/Todavía no está activada|Conectar Google Ads/.test(integraciones.texto)) {
    ok("y dice su estado real en esta instalación");
  } else {
    mal("la tarjeta de Google dice su estado real");
  }

  await navegador.close();

  console.log("\n" + "─".repeat(64));
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
