import assert from "node:assert/strict";
import test from "node:test";

import { califica, esCotizacionCompleta, leerConfig, productoCalza } from "../lib/ads/conversionesConfig.ts";
import {
  COTIZACION_VACIA,
  fusionarCotizacion,
  interpretarCantidad,
  interpretarExtraccion,
  leerCotizacion,
  marcarCalificadaManual,
} from "../lib/ads/cotizacionCore.ts";
import { parsearWebhook } from "../lib/parserMeta.ts";

/**
 * Conversiones a Meta, función general por tenant (nov-2026). Impresora Color
 * es el primer tenant: calendarios ≥ 500 unidades.
 */

const IMPRESORA = leerConfig({
  reglas: [{ producto: "Calendarios", sinonimos: ["calendario", "almanaque"], cantidadMinima: 500 }],
});

// ── referral ────────────────────────────────────────────────────────────────
test("⭐ el referral de un anuncio CTWA entrega clid, anuncio, tipo, titular y url", () => {
  const [m] = parsearWebhook({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1" },
              contacts: [{ wa_id: "56911111111", profile: { name: "Ana" } }],
              messages: [
                {
                  id: "wamid.ctwa",
                  from: "56911111111",
                  timestamp: "1794430000",
                  type: "text",
                  text: { body: "Hola, quiero cotizar calendarios 2027 para mi empresa" },
                  referral: {
                    source_id: "120200000000001",
                    source_type: "ad",
                    source_url: "https://fb.me/abc",
                    headline: "Calendarios 2027 — Variación 1",
                    ctwa_clid: "ARAkLmN0pQ",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(m.referencia?.ctwaClid, "ARAkLmN0pQ");
  assert.equal(m.referencia?.anuncioId, "120200000000001");
  assert.equal(m.referencia?.tipo, "ad");
  assert.equal(m.referencia?.titular, "Calendarios 2027 — Variación 1");
  assert.equal(m.referencia?.url, "https://fb.me/abc");
});

// ── configuración ───────────────────────────────────────────────────────────
test("la config se lee con valores por defecto y descarta reglas inválidas", () => {
  const c = leerConfig({ reglas: [{ producto: "", cantidadMinima: 5 }, { producto: "x", cantidadMinima: 0 }] });
  assert.deepEqual(c.reglas, []);
  assert.deepEqual(c.eventos, { LeadSubmitted: true, QualifiedLead: true, Purchase: true });
  assert.equal(leerConfig(null).testEventCode, null);
  assert.equal(leerConfig({ eventos: { Purchase: false } }).eventos.Purchase, false);
  assert.equal(leerConfig({ testEventCode: "TEST<script>" }).testEventCode, null, "solo caracteres seguros");
  assert.equal(leerConfig({ testEventCode: "TEST12345" }).testEventCode, "TEST12345");
});

// ── regla de calificación ───────────────────────────────────────────────────
test("⭐⭐ Impresora: calendarios ≥ 500 califica, 499 no", () => {
  assert.equal(califica({ producto: "calendarios", cantidad: 500 }, IMPRESORA.reglas), true);
  assert.equal(califica({ producto: "calendarios", cantidad: 5000 }, IMPRESORA.reglas), true);
  assert.equal(califica({ producto: "calendarios", cantidad: 499 }, IMPRESORA.reglas), false);
  assert.equal(califica({ producto: "calendarios", cantidad: null }, IMPRESORA.reglas), false);
});

test("singular, sinónimos y tildes calzan; otro producto no", () => {
  assert.equal(productoCalza("Calendario", IMPRESORA.reglas[0]), true);
  assert.equal(productoCalza("almanaques", IMPRESORA.reglas[0]), true);
  assert.equal(califica({ producto: "tarjetas", cantidad: 5000 }, IMPRESORA.reglas), false);
});

test("sin reglas configuradas nada califica solo", () => {
  assert.equal(califica({ producto: "calendarios", cantidad: 10000 }, []), false);
});

test("cotización completa = producto + cantidad", () => {
  assert.equal(esCotizacionCompleta({ producto: "calendarios", cantidad: 200 }), true);
  assert.equal(esCotizacionCompleta({ producto: "calendarios", cantidad: null }), false);
  assert.equal(esCotizacionCompleta({ producto: null, cantidad: 500 }), false);
});

// ── extracción ──────────────────────────────────────────────────────────────
test("la cantidad entiende puntos de miles y rangos (límite inferior)", () => {
  assert.equal(interpretarCantidad("1.000"), 1000);
  assert.equal(interpretarCantidad("500–999"), 500);
  assert.equal(interpretarCantidad("5.000+"), 5000);
  assert.equal(interpretarCantidad(750), 750);
  assert.equal(interpretarCantidad("muchos"), null);
  assert.equal(interpretarCantidad(-3), null);
});

test("la respuesta del modelo se valida; basura da null", () => {
  const d = interpretarExtraccion(
    '```json\n{"producto":"Calendarios","cantidad":1000,"tipo":"mural","fecha_necesita":"mediados de diciembre","tiene_logo":true,"empresa":"Agrícola Sur"}\n```',
  );
  assert.deepEqual(d, {
    producto: "calendarios",
    cantidad: 1000,
    tipo: "mural",
    fechaNecesita: "mediados de diciembre",
    tieneLogo: true,
    empresa: "Agrícola Sur",
  });
  assert.equal(interpretarExtraccion("no es json"), null);
  assert.equal(interpretarExtraccion("[1,2]"), null);
});

test("⭐ fusionar no borra lo que el modelo ya no ve y fija las fechas una sola vez", () => {
  const t1 = "2026-11-12T10:00:00.000Z";
  const t2 = "2026-11-12T11:00:00.000Z";
  const a = fusionarCotizacion(COTIZACION_VACIA, { producto: "calendarios", cantidad: null, tipo: null, fechaNecesita: null, tieneLogo: null, empresa: "Agrícola Sur" }, IMPRESORA.reglas, t1);
  assert.equal(a.completaEn, null);
  const b = fusionarCotizacion(a, { producto: null, cantidad: 1000, tipo: null, fechaNecesita: null, tieneLogo: null, empresa: null }, IMPRESORA.reglas, t2);
  assert.equal(b.producto, "calendarios", "no se pierde");
  assert.equal(b.empresa, "Agrícola Sur");
  assert.equal(b.completaEn, t2);
  assert.equal(b.calificadaEn, t2);
  const c = fusionarCotizacion(b, { producto: null, cantidad: 300, tipo: null, fechaNecesita: null, tieneLogo: null, empresa: null }, IMPRESORA.reglas, "2026-11-13T00:00:00.000Z");
  assert.equal(c.cantidad, 300, "la cantidad se corrige");
  assert.equal(c.calificadaEn, t2, "la fecha de calificación no se mueve");
});

test("menos de 500: queda completa (LeadSubmitted) pero NO calificada", () => {
  const r = fusionarCotizacion(COTIZACION_VACIA, { producto: "calendarios", cantidad: 1, tipo: null, fechaNecesita: null, tieneLogo: null, empresa: null }, IMPRESORA.reglas, "2026-11-12T10:00:00.000Z");
  assert.ok(r.completaEn);
  assert.equal(r.calificadaEn, null);
});

test("la marca manual califica aunque la IA no la haya detectado", () => {
  const r = marcarCalificadaManual(COTIZACION_VACIA, "cecilia@x.cl", "2026-11-12T10:00:00.000Z");
  assert.equal(r.calificadaEn, "2026-11-12T10:00:00.000Z");
  assert.equal(r.completaEn, "2026-11-12T10:00:00.000Z");
  assert.equal(r.calificadaManual?.por, "cecilia@x.cl");
  assert.deepEqual(leerCotizacion(r), r, "ida y vuelta por la columna");
});

test("el monto de la venta acepta puntos y signo peso, y rechaza basura", async () => {
  const { validarMontoVenta } = await import("../lib/ads/conversionesConfig.ts");
  assert.deepEqual(validarMontoVenta("1.250.000"), { ok: true, monto: 1250000 });
  assert.deepEqual(validarMontoVenta("$ 450000"), { ok: true, monto: 450000 });
  assert.equal(validarMontoVenta("").ok, false);
  assert.equal(validarMontoVenta("0").ok, false);
  assert.equal(validarMontoVenta("abc").ok, false);
  assert.equal(validarMontoVenta("99999999999").ok, false);
});
