import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

import { rutaDeImagen, rutaEsDelCliente, urlDeImagen, PREFIJO } from "../lib/marketing/imagenes.ts";
import { soloDe, unaDe, exigirId, FugaDeTenant } from "../lib/marketing/tenant.ts";
import { motivoSinPublicidad } from "../lib/marketing/capacidades.ts";

const RAIZ = path.resolve(import.meta.dirname, "..");
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), "utf8");

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

/**
 * FASE 5 — la segunda barrera.
 *
 * Lo que se prueba acá no es que el código filtre bien hoy: eso ya lo prueba la
 * fase 4. Es que SI ALGUIEN OLVIDA EL FILTRO, los datos igual no salen.
 */

/* ── 1. El cinturón de lectura ──────────────────────────────────────────── */

test("una fila de otro negocio no cruza la frontera del módulo", () => {
  const filas = [{ id: "x", cliente_id: A }, { id: "y", cliente_id: B }];
  assert.throws(() => soloDe(A, "ed_mk_creatividades", filas), FugaDeTenant);
});

test("una consulta bien hecha pasa sin ruido", () => {
  const filas = [{ id: "x", cliente_id: A }, { id: "z", cliente_id: A }];
  assert.equal(soloDe(A, "ed_mk_creatividades", filas).length, 2);
  assert.equal(soloDe(A, "ed_mk_creatividades", []).length, 0);
  assert.equal(soloDe(A, "ed_mk_creatividades", null).length, 0);
});

test("una fila suelta de otro negocio también se detiene", () => {
  assert.throws(() => unaDe(A, "ed_mk_campanas", { id: "x", cliente_id: B }), FugaDeTenant);
  assert.equal(unaDe(A, "ed_mk_campanas", null), null);
  assert.deepEqual(unaDe(A, "ed_mk_campanas", { id: "x", cliente_id: A }), { id: "x", cliente_id: A });
});

test("un identificador de negocio vacío nunca llega a la base", () => {
  // `.eq("cliente_id", undefined)` haría que PostgREST ignorara el filtro.
  for (const malo of ["", "   ", "corto"]) {
    assert.throws(() => exigirId(malo), /identificador del negocio/);
  }
  assert.doesNotThrow(() => exigirId(A));
});

/* ── 2. Las tablas del módulo solo se tocan por la capa de aislamiento ──── */

test("nadie consulta las tablas de Marketing por fuera de tenant.ts", () => {
  const sospechosos = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        recorrer(rel);
      } else if (/\.tsx?$/.test(e.name) && rel !== path.join("lib", "marketing", "tenant.ts")) {
        if (/\.from\(["']ed_mk_/.test(leer(rel))) sospechosos.push(rel);
      }
    }
  };
  recorrer("lib");
  recorrer("app");
  assert.deepEqual(sospechosos, [], `estos archivos esquivan la capa de aislamiento: ${sospechosos.join(", ")}`);
});

/* ── 3. El puntero de imagen ────────────────────────────────────────────── */

test("solo se acepta un puntero nuestro, con la forma exacta", () => {
  assert.equal(rutaDeImagen(`${PREFIJO}${A}/1700000000000.jpg`), `${A}/1700000000000.jpg`);
  // Todo lo demás, fuera.
  for (const malo of [
    null,
    "",
    "https://atacante.example/pixel.jpg",
    "https://proyecto.supabase.co/storage/v1/object/public/creatividades/x/1.jpg",
    `${PREFIJO}../../etc/passwd`,
    `${PREFIJO}${A}/../../otro/1.jpg`,
    `${PREFIJO}/absoluta/1.jpg`,
    `${PREFIJO}${A}/1.jpg.exe`,
    `${PREFIJO}${A}/script.svg`,
    `${PREFIJO}`,
  ]) {
    assert.equal(rutaDeImagen(malo), null, `debería rechazar: ${malo}`);
  }
});

test("una ruta del prefijo de otro negocio se rechaza", () => {
  const ruta = `${B}/1700000000000.jpg`;
  assert.equal(rutaEsDelCliente(ruta, A), false);
  assert.equal(rutaEsDelCliente(`${A}/1700000000000.jpg`, A), true);
  // Y el prefijo tiene que ser completo: `A` no puede colarse como prefijo de otro.
  assert.equal(rutaEsDelCliente(`${A}extra/1.jpg`, A), false);
});

test("la imagen se pide a nuestro endpoint, nunca a Storage ni a un tercero", () => {
  const url = urlDeImagen(`${PREFIJO}${A}/1700000000000.jpg`);
  assert.ok(url.startsWith("/api/marketing/imagen?r="), url);
  assert.doesNotMatch(url, /supabase|https?:/);
  // Una URL externa guardada de antes no se sirve.
  assert.equal(urlDeImagen("https://atacante.example/x.jpg"), null);
  // Las imágenes de la demostración son locales y pasan tal cual.
  assert.equal(urlDeImagen("/marketing/demo/pendon-feria.jpg"), "/marketing/demo/pendon-feria.jpg");
});

/* ── 4. El bucket y la migración ────────────────────────────────────────── */

test("la migración cierra el bucket y migra los punteros", () => {
  const sql = leer("sql/304_marketing_endurecimiento.sql");
  assert.match(sql, /update storage\.buckets\s*\n?\s*set public = false/i);
  assert.match(sql, /object\/public\/creatividades/, "migra las URLs públicas existentes");
  assert.match(sql, /revoke all on ed_mk_creatividades from anon, authenticated/i);
  assert.match(sql, /revoke all on ed_ads_conexion\s+from anon, authenticated/i);
  // No se abren policies: eso volvería las tablas MENOS restrictivas de lo que están.
  assert.doesNotMatch(sql, /create policy/i);
});

test("el endpoint de imagen exige sesión y comprueba el negocio", () => {
  const src = leer("app/api/marketing/imagen/route.ts");
  assert.match(src, /obtenerUsuarioConPermiso\("generar_insights"\)/);
  assert.match(src, /status: 401/);
  assert.match(src, /rutaEsDelCliente\(ruta, usuario\.clienteId\)/);
  // El 404 y no 403: un 403 confirmaría que el archivo existe.
  assert.match(src, /status: 404/);
  // Se sirve el binario, no una URL firmada que sobreviva a la sesión.
  assert.doesNotMatch(src, /createSignedUrl|getPublicUrl/);
  // Y jamás se hace fetch del valor guardado: sería una superficie SSRF.
  assert.doesNotMatch(src, /fetch\(/);
  assert.match(src, /private, max-age/);
});

test("ya no queda ningún getPublicUrl en el módulo de Marketing", () => {
  for (const f of ["lib/marketing/creatividades.ts", "lib/marketing/imagenes.ts"]) {
    assert.doesNotMatch(leer(f), /getPublicUrl/, `${f} todavía publica una URL`);
  }
});

/* ── 5. Los pasos que cuestan plata tienen tope ─────────────────────────── */

test("generar texto, generar imagen y preguntar al copiloto pasan por el tope", () => {
  for (const f of [
    "app/(marketing)/marketing/creatividades/acciones.ts",
    "app/(marketing)/marketing/copiloto/acciones.ts",
    "app/(marketing)/marketing/campanas/acciones.ts",
  ]) {
    assert.match(leer(f), /cupoDisponible\(usuario\.clienteId/, `${f} no tiene tope de uso`);
  }
});

test("el tope se cuenta por negocio, no por usuario ni global", () => {
  const src = leer("lib/marketing/cupo.ts");
  assert.match(src, /mk:\$\{paso\}:\$\{clienteId\}/, "la clave del tope incluye el negocio");
  // Un fallo del limitador no puede dejar a nadie sin trabajar.
  assert.match(src, /catch \{\s*\n?\s*return null;/);
});

/* ── 6. Secretos ────────────────────────────────────────────────────────── */

test("ninguna clave de servidor se expone al navegador", () => {
  const prohibido = /SUPABASE_SERVICE_ROLE_KEY|META_ADS_APP_SECRET|GEMINI_API_KEY|token_cifrado/;
  const cliente = [];
  const recorrer = (d) => {
    for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) recorrer(rel);
      else if (/\.tsx$/.test(e.name) && /^\s*["']use client["']/.test(leer(rel))) cliente.push(rel);
    }
  };
  recorrer("components");
  recorrer("app");
  assert.ok(cliente.length > 5, "la búsqueda tiene que encontrar componentes de cliente");
  for (const f of cliente) {
    assert.doesNotMatch(leer(f), prohibido, `${f} nombra un secreto de servidor`);
  }
});

test("solo hay variables públicas donde corresponde", () => {
  // Cualquier `NEXT_PUBLIC_` nueva es pública por definición: que no sea un secreto.
  const publicas = new Set();
  const recorrer = (d) => {
    for (const e of fs.readdirSync(path.join(RAIZ, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        recorrer(rel);
      } else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
        for (const m of leer(rel).matchAll(/NEXT_PUBLIC_[A-Z_]+/g)) publicas.add(m[0]);
      }
    }
  };
  recorrer("lib");
  recorrer("app");
  recorrer("components");
  for (const v of publicas) {
    assert.doesNotMatch(v, /SECRET|SERVICE_ROLE|PRIVATE|TOKEN|GEMINI/, `${v} no puede ser pública`);
  }
});

/* ── 7. Los logs no llevan datos de personas ────────────────────────────── */

test("el registro de fallas no puede arrastrar contenido de conversaciones", () => {
  // Se mira el objeto que se registra, no los comentarios que lo explican.
  const src = leer("lib/marketing/fallas.ts");
  const registro = src
    .slice(src.indexOf("JSON.stringify({"), src.indexOf("}),", src.indexOf("JSON.stringify({")))
    .replace(/^\s*\/\/.*$/gm, ""); // los comentarios explican, no se registran
  assert.match(registro, /detalle: crudo\.slice\(0, \d+\)/, "el detalle va acotado");
  // Ni contenido de conversaciones, ni prompts, ni datos de la persona.
  assert.doesNotMatch(registro, /prompt|telefono|nombre|texto|mensaje/i);
  assert.match(registro, /cliente: args\.clienteId/, "sí va el negocio, para poder diagnosticar");
});

test("el aviso de fuga no registra el identificador del otro negocio", () => {
  const src = leer("lib/marketing/tenant.ts");
  assert.match(src, /ajeno: typeof encontrado === "string" \? "otro" : "ausente"/);
});

/* ── 8. Verdad del copy de capacidades ──────────────────────────────────── */

test("no se le echa la culpa al plan de algo que es de la instalación", () => {
  const textos = [
    motivoSinPublicidad({ puedeConectarMeta: false, metaConectada: false, metaFaltaElegirCuenta: false }),
    motivoSinPublicidad({ puedeConectarMeta: true, metaConectada: false, metaFaltaElegirCuenta: false }),
    motivoSinPublicidad({ puedeConectarMeta: true, metaConectada: true, metaFaltaElegirCuenta: false }, "limite_api"),
  ];
  for (const t of textos) assert.doesNotMatch(t, /tu plan|plan contratado/i, t);
});
