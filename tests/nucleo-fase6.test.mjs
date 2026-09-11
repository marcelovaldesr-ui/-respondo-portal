import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ROLES, esRolValido, tienePermiso } from "../lib/permisos.ts";

const PERMISOS = [
  "operar_conversaciones",
  "editar_clientes",
  "gestionar_embudo",
  "operar_agenda",
  "configurar_agenda",
  "editar_conocimiento",
  "generar_insights",
  "gestionar_integraciones",
  "preguntar_isabel",
];

const leer = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/**
 * El fuente SIN comentarios. Las guardas de abajo buscan la forma peligrosa en
 * el código; los comentarios de estos archivos CITAN esa forma para explicar
 * por qué se cambió, y sin esto una explicación honesta haría fallar la prueba.
 */
const codigo = (p) =>
  leer(p)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const sql = (p) => leer(p).replace(/^\s*--[^\n]*$/gm, " ");

/* ────────────────────────────────────────────────────────────────────────────
 * 1. EL ROL AUSENTE O INVÁLIDO NO OTORGA NADA
 *
 * El hallazgo era `rol ?? "dueno"`: la ausencia de dato se convertía en el rol
 * con MÁS permisos del portal. Estas pruebas fijan lo contrario para siempre.
 * ────────────────────────────────────────────────────────────────────────── */

test("un rol nulo no es dueño: no concede ningún permiso", () => {
  for (const permiso of PERMISOS) {
    assert.equal(tienePermiso({ rol: null }, permiso), false, permiso);
    assert.equal(tienePermiso({ rol: undefined }, permiso), false, permiso);
    assert.equal(tienePermiso({}, permiso), false, permiso);
  }
});

test("un rol desconocido se rechaza en vez de caer en staff", () => {
  // Antes, cualquier valor distinto de "dueno" recibía en silencio los cuatro
  // permisos de staff, incluidos los de escritura.
  for (const rol of ["admin", "owner", "lector", "invitado", "zzz", ""]) {
    for (const permiso of PERMISOS) {
      assert.equal(tienePermiso({ rol }, permiso), false, `${rol}/${permiso}`);
    }
  }
});

test("el rol distingue mayúsculas: 'Dueno' no es 'dueno' y no entra", () => {
  for (const rol of ["Dueno", "DUENO", "Staff", " dueno", "dueno "]) {
    assert.equal(esRolValido(rol), false, rol);
    assert.equal(tienePermiso({ rol }, "operar_conversaciones"), false, rol);
  }
});

test("un rol que no es texto no concede nada", () => {
  for (const rol of [1, true, {}, [], { toString: () => "dueno" }]) {
    assert.equal(esRolValido(rol), false);
    assert.equal(tienePermiso({ rol }, "generar_insights"), false);
  }
});

/* ────────────────────────────────────────────────────────────────────────────
 * 2. LA MATRIZ ES CERRADA Y ESPEJO DEL `check` DE LA BASE
 *
 * Comprobado contra la base el 11-sep-2026: `portal_usuarios.rol` es NOT NULL
 * con `check (rol in ('dueno','staff'))` y `email` UNIQUE.
 * ────────────────────────────────────────────────────────────────────────── */

test("los roles del código son exactamente los del check de la base", () => {
  assert.deepEqual([...ROLES].sort(), ["dueno", "staff"]);
});

test("cada rol válido resuelve a un conjunto de permisos, y staff ⊂ dueño", () => {
  for (const rol of ROLES) {
    assert.equal(esRolValido(rol), true);
    // Un rol declarado pero sin entrada en la matriz daría false en todo: eso
    // es fail-closed, pero sería un rol inútil. Debe conceder algo.
    assert.ok(PERMISOS.some((p) => tienePermiso({ rol }, p)), rol);
  }
  for (const permiso of PERMISOS) {
    if (tienePermiso({ rol: "staff" }, permiso)) {
      assert.equal(tienePermiso({ rol: "dueno" }, permiso), true, permiso);
    }
  }
});

test("agregar un permiso nuevo no se lo regala a staff por omisión", () => {
  assert.equal(tienePermiso({ rol: "staff" }, "permiso_que_no_existe_todavia"), false);
  assert.equal(tienePermiso({ rol: "dueno" }, "permiso_que_no_existe_todavia"), false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 3. GUARDAS SOBRE EL CÓDIGO FUENTE
 *
 * El error original no era lógico sino de forma: un `as` que finge validar y
 * un `??` que rellena. Estas guardas impiden que vuelvan.
 * ────────────────────────────────────────────────────────────────────────── */

test("lib/auth.ts no rellena el rol con un valor por omisión", () => {
  const src = codigo("../lib/auth.ts");
  assert.equal(/\?\?\s*["']dueno["']/.test(src), false, 'quedó un ?? "dueno"');
  assert.equal(/\|\|\s*["']dueno["']/.test(src), false, 'quedó un || "dueno"');
  assert.equal(/as\s+["']dueno["']\s*\|\s*["']staff["']/.test(src), false, "quedó el cast que finge validar");
  assert.ok(src.includes("esRolValido"), "el rol debe validarse antes de devolverse");
});

test("ningún archivo del portal asume un rol por omisión", () => {
  const sospechosos = [];
  const andar = (dir) => {
    for (const e of fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const hijo = `${dir}${e.name}${e.isDirectory() ? "/" : ""}`;
      if (e.isDirectory()) andar(hijo);
      else if (/\.tsx?$/.test(e.name)) {
        const src = codigo(hijo);
        if (/(\?\?|\|\|)\s*["'](dueno|admin|owner|staff)["']/.test(src)) sospechosos.push(hijo);
      }
    }
  };
  andar("../lib/");
  andar("../app/");
  assert.deepEqual(sospechosos, []);
});

test("la matriz enumera lo que cada rol puede, no lo que le falta", () => {
  const src = codigo("../lib/permisos.ts");
  // La forma vieja: cualquier valor != "dueno" heredaba los permisos de staff.
  assert.equal(/rol\s*===\s*["']dueno["']\s*\|\|/.test(src), false);
});

/* ────────────────────────────────────────────────────────────────────────────
 * 4. LA FIRMA VIEJA SE CIERRA SOLA
 *
 * Reproducido contra el servidor el 11-sep-2026: una petición firmada con el
 * esquema viejo se aceptaba indefinidamente; con ts+nonce, el segundo envío da
 * 401. El esquema moderno está bien; lo que faltaba era que el viejo terminara.
 * ────────────────────────────────────────────────────────────────────────── */

test("el modo viejo ya no es un booleano que alguien deba acordarse de apagar", () => {
  const src = codigo("../lib/externo.ts");
  assert.equal(/MODO_FIRMA_VIEJA\s*=\s*true/.test(src), false);
  assert.ok(/FIN_FIRMA_VIEJA\s*=\s*["']\d{4}-\d{2}-\d{2}/.test(src), "debe ser una fecha");
});

test("la ventana vieja se cierra sola, y una fecha ilegible la cierra", async () => {
  const previo = process.env.RESPONDO_FIRMA_VIEJA_HASTA;
  const { ventanaViejaAbierta } = await import("../lib/externo.ts");

  process.env.RESPONDO_FIRMA_VIEJA_HASTA = "2020-01-01T00:00:00Z";
  assert.equal(ventanaViejaAbierta(), false, "una fecha pasada cierra la ventana");

  process.env.RESPONDO_FIRMA_VIEJA_HASTA = "cuando-gestion-migre";
  assert.equal(ventanaViejaAbierta(), false, "una fecha ilegible cierra, no abre");

  process.env.RESPONDO_FIRMA_VIEJA_HASTA = "2099-01-01T00:00:00Z";
  assert.equal(ventanaViejaAbierta(), true, "se puede extender desde configuración");

  if (previo === undefined) delete process.env.RESPONDO_FIRMA_VIEJA_HASTA;
  else process.env.RESPONDO_FIRMA_VIEJA_HASTA = previo;
});

test("el esquema nuevo sigue exigiendo ts, nonce y ventana de reloj", () => {
  const src = codigo("../lib/externo.ts");
  assert.ok(src.includes("x-respondo-ts"));
  assert.ok(src.includes("x-respondo-nonce"));
  assert.ok(/TOLERANCIA_SEG\s*=\s*5\s*\*\s*60/.test(src), "5 minutos de tolerancia de reloj");
  assert.ok(src.includes("limitarDistribuido(`nonce:"), "el nonce se consume una vez");
  // El nonce se quema DESPUÉS de validar la firma: si no, cualquiera podría
  // agotar nonces ajenos sin conocer el secreto.
  assert.ok(src.indexOf("firmaValidaCon(s, firmado, firma)") < src.indexOf("`nonce:${clienteId}"));
});

test("la cadena canónica que no cubre el archivo muere con la ventana vieja", () => {
  const src = codigo("../app/api/externo/adjunto/route.ts");
  assert.ok(src.includes("ventanaViejaAbierta()"), "la cadena vieja debe estar detrás de la ventana");
  assert.ok(src.includes("huellaDeArchivo(bytes)"), "la cadena nueva firma el contenido");
});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. LAS MIGRACIONES NO REABREN LO QUE CERRARON
 * ────────────────────────────────────────────────────────────────────────── */

test("volver a correr la 303 no reabre el bucket de creatividades", () => {
  const src = sql("../sql/303_marketing.sql");
  assert.equal(/do update set public\s*=\s*true/.test(src), false);
  assert.ok(/values \('creatividades', 'creatividades', false/.test(src));
});

test("la 305 deja el rol por omisión en el menos privilegiado", () => {
  const src = sql("../sql/305_autorizacion_fail_closed.sql");
  assert.ok(/alter column rol set default 'staff'/.test(src));
});
