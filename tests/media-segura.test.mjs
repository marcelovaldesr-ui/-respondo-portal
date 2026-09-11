/**
 * Adjuntos servidos por /api/whatsapp/media (auditoría 11-sep-2026).
 * Un archivo que declara ser HTML o SVG NUNCA se entrega para mostrarse dentro
 * del portal: se descarga como binario. Protege contra XSS almacenado.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cabecerasDeTipo, nombreSeguro } from "../lib/mediaSegura.ts";

test("HTML declarado por el remitente se descarga, no se muestra", () => {
  const c = cabecerasDeTipo("text/html", "cotizacion.html");
  assert.equal(c["Content-Type"], "application/octet-stream");
  assert.match(c["Content-Disposition"], /^attachment;/);
  assert.equal(c["X-Content-Type-Options"], "nosniff");
});

test("SVG, XML, JS y tipos con mayúsculas o parámetros también se descargan", () => {
  for (const t of ["image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript", "TEXT/HTML; charset=utf-8", " text/html ", "", null, undefined]) {
    const c = cabecerasDeTipo(t, "x");
    assert.equal(c["Content-Type"], "application/octet-stream", `tipo ${t}`);
    assert.match(c["Content-Disposition"], /^attachment;/);
  }
});

test("imágenes, audio de WhatsApp, video mp4 y PDF siguen viéndose en el chat", () => {
  assert.equal(cabecerasDeTipo("image/jpeg", "a.jpg")["Content-Type"], "image/jpeg");
  assert.equal(cabecerasDeTipo("audio/ogg; codecs=opus", "nota.ogg")["Content-Type"], "audio/ogg");
  assert.equal(cabecerasDeTipo("video/mp4", "v.mp4")["Content-Type"], "video/mp4");
  const pdf = cabecerasDeTipo("application/pdf", "cotizacion.pdf");
  assert.equal(pdf["Content-Type"], "application/pdf");
  assert.match(pdf["Content-Disposition"], /^inline;/);
});

test("el nombre de archivo no puede inyectar cabeceras ni comillas", () => {
  const c = cabecerasDeTipo("application/pdf", 'a"\r\nSet-Cookie: x=1.pdf');
  assert.ok(!/[\r\n"]/.test(c["Content-Disposition"].replace(/filename="[^"]*"$/, "")));
  assert.ok(!/\r|\n/.test(c["Content-Disposition"]));
  assert.equal((c["Content-Disposition"].match(/"/g) ?? []).length, 2);
  assert.equal(nombreSeguro(""), "archivo");
  assert.equal(nombreSeguro(null), "archivo");
  assert.ok(nombreSeguro("x".repeat(500)).length <= 120);
});
