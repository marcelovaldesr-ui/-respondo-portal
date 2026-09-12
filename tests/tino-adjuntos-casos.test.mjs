import assert from "node:assert/strict";
import test from "node:test";

import { parsearWebhook } from "../lib/parserMeta.ts";
import { MARCADOR_AUDIO } from "../lib/marcadorAudio.ts";
import { ventanaDeEspera, ESPERA_CORTA, ESPERA_LARGA } from "../lib/ritmoHumano.ts";

/**
 * CASOS DE CONVERSACIÓN REAL CON ADJUNTOS (Fase 3).
 *
 * Recorre el camino determinista completo —del sobre que manda Meta hasta el
 * texto exacto que va a leer el modelo— para los casos que se rompían antes de
 * esta fase: el pie de foto que borraba el marcador, y la ráfaga de mensajes
 * cortos que disparaba una respuesta por cada pedazo.
 *
 * Tino NO interpreta el contenido de los adjuntos: se evaluó hacerlo y se
 * decidió que no (informe de la fase, sección AF). Lo que estas pruebas fijan
 * es lo único que el cerebro necesita saber —QUÉ llegó, y qué escribió el
 * cliente al lado— para poder reconocerlo sin inventar nada.
 */

const sobre = (mensaje) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "111" },
            contacts: [{ profile: { name: "Cliente" }, wa_id: "56900000000" }],
            messages: [mensaje],
          },
        },
      ],
    },
  ],
});

const imagen = (id, caption) =>
  parsearWebhook(
    sobre({
      id,
      from: "56900000000",
      type: "image",
      image: { id: `media-${id}`, mime_type: "image/jpeg", ...(caption ? { caption } : {}) },
    }),
  )[0];

const audio = (id) =>
  parsearWebhook(
    sobre({ id, from: "56900000000", type: "audio", audio: { id: `media-${id}`, mime_type: "audio/ogg" } }),
  )[0];

// ── IMAGEN ──────────────────────────────────────────────────────────────────

test("⭐ «¿pueden hacer esto?» + foto llega con la pregunta Y la huella de la foto", () => {
  // Es EL caso del brief. Antes se guardaba solo "¿pueden hacer esto?" y el
  // modelo no tenía forma de saber que existía un "esto".
  const m = imagen("w1", "¿pueden hacer esto?");
  assert.match(m.texto, /imagen/i);
  assert.match(m.texto, /¿pueden hacer esto\?/);
  assert.equal(m.adjunto.tipo, "imagen");
  assert.equal(m.adjunto.id, "media-w1");
});

test("una foto sin texto igual se registra y se puede descargar", () => {
  const m = imagen("w2", null);
  assert.match(m.texto, /imagen/i);
  assert.equal(m.adjunto.id, "media-w2");
});

test("dos imágenes seguidas son dos mensajes, cada una con su archivo", () => {
  const a = imagen("w3", "este modelo");
  const b = imagen("w4", "o este");
  assert.notEqual(a.adjunto.id, b.adjunto.id);
  assert.match(a.texto, /este modelo/);
  assert.match(b.texto, /o este/);
});

test("el marcador va PRIMERO y el texto del cliente después", () => {
  // El orden no es estético: es el orden en que lo lee una persona —qué llegó,
  // después qué dijo— y es el que hace que el modelo no confunda la marca del
  // sistema con las palabras del cliente.
  const m = imagen("w5", "¿cuánto sale?");
  assert.ok(m.texto.indexOf("imagen") < m.texto.indexOf("¿cuánto sale?"));
});

// ── AUDIO ───────────────────────────────────────────────────────────────────

test("una nota de voz se marca con el mismo marcador en todos los canales", () => {
  assert.equal(audio("w6").texto, MARCADOR_AUDIO);
});

// ── RÁFAGA ──────────────────────────────────────────────────────────────────

test("⭐ la ráfaga del brief: cinco mensajes cortos esperan antes de contestar", () => {
  // "Hola" / "quiero imprimir" / "500" / "de estos" / [foto]
  // El saludo es la excepción: se responde rápido porque es el primer contacto.
  assert.equal(ventanaDeEspera("Hola"), ESPERA_CORTA);
  // Los demás son fragmentos: si Tino contesta cada uno, pregunta cinco veces.
  assert.equal(ventanaDeEspera("500"), ESPERA_LARGA);
  assert.equal(ventanaDeEspera("de estos"), ESPERA_LARGA);
  assert.equal(ventanaDeEspera("quiero imprimir"), ESPERA_LARGA);
});

test("una pregunta completa no hace esperar de más", () => {
  // Esperar 20 s con una pregunta cerrada solo hace que el negocio parezca lento.
  assert.equal(ventanaDeEspera("¿Cuánto sale imprimir 500 tarjetas a color?"), ESPERA_CORTA);
});

test("los tres transportes agrupan ráfagas; ninguno quedó sin ventana", async () => {
  // Instagram no tenía debounce hasta la Fase 3: cada DM disparaba su ciclo.
  const { readFileSync } = await import("node:fs");
  for (const f of ["lib/inboundMeta.ts", "lib/inboundWaha.ts", "lib/inboundInstagram.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /ventanaDeEspera\(/, `${f} debe agrupar la ráfaga`);
    assert.match(src, /debounce_superseded/, `${f} debe retirarse si llegó algo más nuevo`);
  }
});

// ── LA REGLA QUE REEMPLAZA A LA VISIÓN ──────────────────────────────────────

test("⭐ el prompt deja UNA sola salida honesta cuando haría falta ver la imagen", async () => {
  /**
   * Tino no ve los adjuntos, y esa regla tiene que ser SIMPLE. La versión
   * multimodal la había vuelto condicional («no puedes verlo, salvo que
   * aparezca una línea ↳»), y cada condicional de este prompt ha sido el
   * origen de un incidente. Al retirar visión volvió a ser absoluta.
   *
   * Lo que se prueba: que la prohibición siga sin excepciones, y que el prompt
   * diga qué hacer en su lugar — preguntar o derivar — porque una prohibición
   * sin alternativa es justo lo que empuja al modelo a inventar.
   */
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../lib/promptEmpleado.ts", import.meta.url), "utf8");
  assert.match(src, /tú NO puedes verlo ni abrirlo/);
  assert.match(src, /preguntar por escrito lo que necesitas, o derivar a una persona/);
  assert.doesNotMatch(src, /↳/, "la regla volvió a ser absoluta: sin condicionales de interpretación");
});
