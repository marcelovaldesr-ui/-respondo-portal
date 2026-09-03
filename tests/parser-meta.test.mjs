import assert from "node:assert/strict";
import test from "node:test";

import { parsearWebhook } from "../lib/parserMeta.ts";
import { MARCADOR_AUDIO } from "../lib/marcadorAudio.ts";

/**
 * Dos cosas que se agregaron el 21-ago-2026 y conviene que no se caigan solas:
 * la atribución de campaña de Click-to-WhatsApp y el ida y vuelta de los
 * botones nativos.
 *
 * `enviarBotones` no se prueba acá porque hace red. Lo que sí se prueba es lo
 * que vuelve cuando el cliente TOCA un botón, que es la mitad que importa: si
 * eso se rompe, una confirmación deja de llegarle al cerebro.
 */

const sobre = (mensaje, extraValue = {}) => ({
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "111" },
            contacts: [{ profile: { name: "Marcelo" }, wa_id: "56900000000" }],
            messages: [mensaje],
            ...extraValue,
          },
        },
      ],
    },
  ],
});

test("se captura el anuncio de origen de Click-to-WhatsApp", () => {
  const [m] = parsearWebhook(
    sobre({
      id: "wamid.1",
      from: "56900000000",
      type: "text",
      text: { body: "Hola, vi el aviso" },
      referral: {
        source_id: "120210000000000000",
        source_type: "ad",
        source_url: "https://fb.me/xyz",
        headline: "Flyers desde $30",
        body: "Entrega en 48 h",
      },
    }),
  );

  assert.equal(m.referencia?.anuncioId, "120210000000000000");
  assert.equal(m.referencia?.tipo, "ad");
  assert.equal(m.referencia?.titular, "Flyers desde $30");
  assert.equal(m.referencia?.url, "https://fb.me/xyz");
});

test("sin referral, el campo NO se inventa", () => {
  // Importa que quede undefined y no un objeto vacío: el resto del código
  // pregunta `if (m.referencia)` para decidir si guardar atribución.
  const [m] = parsearWebhook(
    sobre({ id: "wamid.2", from: "56900000000", type: "text", text: { body: "Hola" } }),
  );
  assert.equal(m.referencia, undefined);
});

test("un referral vacío tampoco cuenta como atribución", () => {
  const [m] = parsearWebhook(
    sobre({
      id: "wamid.3",
      from: "56900000000",
      type: "text",
      text: { body: "Hola" },
      referral: {},
    }),
  );
  assert.equal(m.referencia, undefined);
});

test("tocar un botón llega al cerebro como texto normal", () => {
  // Para el cerebro, tocar "Confirmar" tiene que ser idéntico a escribirlo.
  const [m] = parsearWebhook(
    sobre({
      id: "wamid.4",
      from: "56900000000",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "si", title: "Confirmar" } },
    }),
  );
  assert.equal(m.texto, "Confirmar");
  assert.equal(m.tipo, "interactive");
});

test("un interactivo sin título no se registra", () => {
  // Guardarlo como "[archivo]" haría que Tino tratara una confirmación como un
  // documento que no puede leer.
  const out = parsearWebhook(
    sobre({
      id: "wamid.5",
      from: "56900000000",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "x", title: "  " } },
    }),
  );
  assert.equal(out.length, 0);
});

/**
 * ADJUNTOS ENTRANTES.
 *
 * Hasta el 21-ago-2026 el parser reconocía que venía una foto —escribía «[el
 * cliente envió una imagen]»— pero tiraba el `id`, que es lo ÚNICO con lo que se
 * puede descargar el archivo. Por Cloud API, o sea por donde entra todo cliente
 * nuevo, las fotos no se podían ver.
 */

test("una imagen del cliente trae el id para poder descargarla", () => {
  const [m] = parsearWebhook(
    sobre({
      id: "wamid.10",
      from: "56900000000",
      type: "image",
      image: { id: "1122334455", mime_type: "image/jpeg", caption: "¿Sirve este modelo?" },
    }),
  );
  assert.equal(m.adjunto?.id, "1122334455");
  assert.equal(m.adjunto?.tipo, "imagen");
  assert.equal(m.adjunto?.mime, "image/jpeg");
  // El pie de foto ES el texto del mensaje: sin esto el cliente pregunta algo
  // y el asistente nunca se entera de lo que preguntó.
  assert.equal(m.texto, "¿Sirve este modelo?");
});

test("una imagen SIN pie de foto igual se registra, con marcador", () => {
  const [m] = parsearWebhook(
    sobre({ id: "wamid.11", from: "56900000000", type: "image", image: { id: "99", mime_type: "image/png" } }),
  );
  assert.equal(m.adjunto?.id, "99");
  assert.match(m.texto, /imagen/i);
});

test("un documento conserva su nombre", () => {
  const [m] = parsearWebhook(
    sobre({
      id: "wamid.12",
      from: "56900000000",
      type: "document",
      document: { id: "77", mime_type: "application/pdf", filename: "orden-4821.pdf" },
    }),
  );
  assert.equal(m.adjunto?.tipo, "documento");
  assert.equal(m.adjunto?.nombre, "orden-4821.pdf");
  assert.match(m.texto, /orden-4821\.pdf/);
});

test("audio y sticker se traducen a nuestro vocabulario, el mismo que WAHA", () => {
  const audio = parsearWebhook(
    sobre({ id: "w.13", from: "56900000000", type: "audio", audio: { id: "a1", mime_type: "audio/ogg" } }),
  )[0];
  assert.equal(audio.adjunto?.tipo, "audio");

  const sticker = parsearWebhook(
    sobre({ id: "w.14", from: "56900000000", type: "sticker", sticker: { id: "s1", mime_type: "image/webp" } }),
  )[0];
  assert.equal(sticker.adjunto?.tipo, "sticker");
});

/**
 * lib/promptEmpleado.ts no puede importar `@/lib/marcadorAudio` sin romper
 * `tsc`/`node --test` (ver el comentario de cabecera de parserMeta.ts), así
 * que el marcador queda escrito LITERAL ahí adentro, duplicado a mano. Esta
 * prueba es la que evita que ese literal se desincronice en silencio de
 * lib/marcadorAudio.ts — que es lo que usa lib/responderBot.ts para decidir
 * si deriva la conversación a una persona sin pasar por el modelo.
 */
test("el marcador de audio de Meta coincide EXACTO con lib/marcadorAudio.ts", () => {
  const audio = parsearWebhook(
    sobre({ id: "w.15", from: "56900000000", type: "audio", audio: { id: "a2", mime_type: "audio/ogg" } }),
  )[0];
  assert.equal(audio.texto, MARCADOR_AUDIO);

  const voz = parsearWebhook(
    sobre({ id: "w.16", from: "56900000000", type: "voice", voice: { id: "a3", mime_type: "audio/ogg" } }),
  )[0];
  assert.equal(voz.texto, MARCADOR_AUDIO);
});

test("un adjunto SIN id no inventa un adjunto vacío", () => {
  // Sin id no hay nada que descargar. El mensaje igual debe registrarse: vale
  // más un mensaje sin foto que ningún mensaje.
  const [m] = parsearWebhook(
    sobre({ id: "w.15", from: "56900000000", type: "image", image: { mime_type: "image/jpeg" } }),
  );
  assert.equal(m.adjunto, undefined);
  assert.match(m.texto, /imagen/i);
});

test("un mensaje de texto no arrastra adjunto", () => {
  const [m] = parsearWebhook(
    sobre({ id: "w.16", from: "56900000000", type: "text", text: { body: "Hola" } }),
  );
  assert.equal(m.adjunto, undefined);
});

// ── Editar y borrar NO son mensajes nuevos (auditoría 3-sep-2026) ──────────

test("⭐ editar o borrar un mensaje no se registra como «archivo»", () => {
  // Antes caían en la rama de adjuntos: Tino decía «¡me llegó tu archivo!» y
  // derivaba. 32 casos reales en Impresora Color.
  for (const type of ["edit", "revoke", "request_welcome", "order"]) {
    const r = parsearWebhook(sobre({ id: "wamid.x", from: "56900000000", type }));
    assert.equal(r.length, 0, `tipo ${type} debía ignorarse`);
  }
});

test("cada mensaje toma el nombre de SU remitente cuando el payload trae varios contactos", () => {
  const r = parsearWebhook(
    sobre(
      { id: "wamid.a", from: "56900000001", type: "text", text: { body: "hola" } },
      {
        contacts: [
          { profile: { name: "Ana" }, wa_id: "56900000000" },
          { profile: { name: "Beto" }, wa_id: "56900000001" },
        ],
      },
    ),
  );
  assert.equal(r[0].nombre, "Beto");
});
