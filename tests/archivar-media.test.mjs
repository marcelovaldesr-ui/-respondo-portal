import assert from "node:assert/strict";
import test from "node:test";

import {
  DIAS_UTILES,
  PREFIJO_GRANDE,
  PREFIJO_META,
  PREFIJO_VENCIDO,
  TOPE_BYTES,
  decidir,
  extensionDe,
  rutaPara,
  vencido,
} from "../lib/archivarMediaCore.ts";

/**
 * Estas reglas deciden si el historial de imágenes de un negocio sobrevive.
 *
 * Meta BORRA el archivo que llega por webhook a los 7 días. Si el archivador se
 * equivoca, las fotos que mandaron los clientes desaparecen solas y no hay de
 * dónde recuperarlas.
 */

const BASE = {
  clienteId: "cli-1",
  mensajeId: "msg-abc",
  creadoEn: "2026-08-26T14:30:00.000Z",
  mediaUrl: `${PREFIJO_META}1234567890`,
  bytes: 120_000,
  mime: "image/jpeg",
  nombre: null,
};

test("una foto normal se archiva", () => {
  const d = decidir(BASE);
  assert.equal(d.accion, "archivar");
});

test("⭐ un archivo sobre el tope NO se guarda: se marca", () => {
  // Un solo cliente subiendo archivos de 100 MB llenaría el plan en un día, y
  // ese costo lo paga Respondo, no él.
  const d = decidir({ ...BASE, bytes: TOPE_BYTES + 1 });
  assert.equal(d.accion, "marcar_grande");
});

test("justo en el tope todavía se archiva", () => {
  assert.equal(decidir({ ...BASE, bytes: TOPE_BYTES }).accion, "archivar");
});

test("si Meta no informa el tamaño, se intenta igual", () => {
  // El control real vuelve a hacerse sobre los bytes descargados. Rechazar acá
  // por falta de dato perdería archivos perfectamente guardables.
  assert.equal(decidir({ ...BASE, bytes: null }).accion, "archivar");
});

test("lo que ya está archivado no se vuelve a tocar", () => {
  for (const url of ["sb:cli-1/2026-08/msg.jpg", "meta-grande:123", "", null]) {
    assert.equal(decidir({ ...BASE, mediaUrl: url }).accion, "omitir", `url: ${url}`);
  }
});

// ── Ruta dentro del bucket ──────────────────────────────────────────────────

test("la ruta empieza por cliente y agrupa por mes", () => {
  // El cliente primero permite borrar o medir todo lo de un negocio con un solo
  // prefijo; el mes evita una carpeta con decenas de miles de archivos.
  assert.equal(rutaPara(BASE), "cli-1/2026-08/msg-abc.jpg");
});

test("⭐ la ruta es estable: archivar dos veces sobrescribe, no duplica", () => {
  assert.equal(rutaPara(BASE), rutaPara(BASE));
});

test("una fecha corrupta no rompe la ruta", () => {
  const r = rutaPara({ ...BASE, creadoEn: "no-es-fecha" });
  assert.ok(r.includes("sin-fecha"), r);
});

// ── Extensiones ─────────────────────────────────────────────────────────────

test("la extensión sale del mime", () => {
  assert.equal(extensionDe("image/jpeg"), "jpg");
  assert.equal(extensionDe("application/pdf"), "pdf");
  assert.equal(extensionDe("audio/ogg"), "ogg");
});

test("el mime con parámetros igual se entiende", () => {
  // Meta manda cosas como "audio/ogg; codecs=opus".
  assert.equal(extensionDe("audio/ogg; codecs=opus"), "ogg");
});

test("el nombre del archivo manda sobre el mime", () => {
  // Es más fiable: el cliente mandó ese archivo con ese nombre.
  assert.equal(extensionDe("application/octet-stream", "presupuesto.pdf"), "pdf");
});

test("un mime desconocido no deja el archivo sin extensión", () => {
  assert.equal(extensionDe("application/x-cosa-rara"), "bin");
  assert.equal(extensionDe(null), "bin");
});

// ── Plazo de Meta ───────────────────────────────────────────────────────────

test("el margen del barrido es menor que el plazo de Meta", () => {
  // Si esto se invierte, el archivador iría a buscar archivos que Meta ya borró.
  assert.ok(DIAS_UTILES < 7, `${DIAS_UTILES} debería ser menor que 7`);
});

test("a los 7 días se considera vencido", () => {
  const ahora = new Date("2026-08-26T00:00:00.000Z").getTime();
  assert.equal(vencido("2026-08-25T00:00:00.000Z", ahora), false);
  assert.equal(vencido("2026-08-18T00:00:00.000Z", ahora), true);
});

// ── Las dos marcas de «no se archivó» son distintas ─────────────────────────

test("⭐⭐ «muy grande» y «Meta ya lo borró» NO comparten marca", () => {
  // Compartían marca y /api/salud reportó «1 muy grandes» sobre un archivo que
  // no era grande: era viejo. Un dato plausible y falso lleva a la conclusión
  // equivocada — «subamos el tope» cuando lo cierto era «llegamos tarde».
  assert.notEqual(PREFIJO_GRANDE, PREFIJO_VENCIDO);
});

test("ninguna de las dos marcas se confunde con un puntero vivo de Meta", () => {
  // `meta-grande:` y `meta-vencido:` empiezan con «meta», así que un filtro
  // descuidado por `meta%` los volvería a barrer para siempre.
  for (const marca of [PREFIJO_GRANDE, PREFIJO_VENCIDO]) {
    assert.equal(
      decidir({ ...BASE, mediaUrl: `${marca}123` }).accion,
      "omitir",
      marca,
    );
  }
});
