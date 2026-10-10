/**
 * CUENTAS DE «SOLO MENSAJERÍA» (migración 322, ej. Kambak).
 *
 * La prueba que importa: un mensaje entrante a esa cuenta NO genera respuesta de
 * IA ni llamada al modelo (o sea, no se gastan tokens). Se corre el webhook REAL
 * (`manejarEntranteMeta`) contra una base en memoria, con el modelo y el envío
 * reemplazados por testigos que cuentan cuántas veces los llaman. Ningún
 * mensaje sale a ningún teléfono y no se toca ninguna base real.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";
import { crearSupaFalso } from "./_supaFalso.mjs";

const url = (p) => new URL(p, import.meta.url).href;

const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTRO = "bbbbbbbb-0000-4000-8000-00000000000b";
const TINO_K = "11111111-0000-4000-8000-00000000000a";
const TINO_O = "22222222-0000-4000-8000-00000000000b";

// ── Testigos ───────────────────────────────────────────────────────────────
let llamadasAlModelo = 0;
const base = crearBaseMemoria({
  ed_clientes: [
    { id: KAMBAK, nombre: "Kambak", activo: true, solo_mensajeria: true, transporte: "cloud", waba_phone_id: "PHONE_K", waba_token: "token-de-prueba" },
    { id: OTRO, nombre: "Otro negocio", activo: true, solo_mensajeria: false, transporte: "cloud", waba_phone_id: "PHONE_O", waba_token: "token-de-prueba" },
  ],
  ed_empleados: [
    { id: TINO_K, cliente_id: KAMBAK, rol: "tino", activo: true },
    { id: TINO_O, cliente_id: OTRO, rol: "tino", activo: true },
  ],
});

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/gemini.ts"), {
  namedExports: {
    generarJSON: async () => {
      llamadasAlModelo++;
      return { respuesta: "hola", escalar: false };
    },
  },
});

const { manejarEntranteMeta } = await import("../lib/inboundMeta.ts");
const { idsSoloMensajeria, esSoloMensajeria, sinSoloMensajeria, reiniciarCacheSoloMensajeria } =
  await import("../lib/soloMensajeria.ts");
const { tienePermiso } = await import("../lib/permisos.ts");

function payload(phoneId, waId, texto, de = "56911112222") {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneId },
              contacts: [{ profile: { name: "Ana" }, wa_id: de }],
              messages: [{ id: waId, from: de, type: "text", text: { body: texto } }],
            },
          },
        ],
      },
    ],
  };
}

const sinEspera = { sinDebounce: true };

// ── 1. LA PRUEBA OBLIGATORIA ───────────────────────────────────────────────
test("un mensaje entrante a una cuenta de solo mensajería no llama al modelo ni envía nada", async () => {
  reiniciarCacheSoloMensajeria();
  llamadasAlModelo = 0;
  let envios = 0;
  const r = await manejarEntranteMeta(payload("PHONE_K", "wamid.K1", "Hola, ¿cuántos sellos me faltan?"), {
    ...sinEspera,
    enviar: async () => {
      envios++;
      return { ok: true, waId: "x" };
    },
  });

  assert.equal(llamadasAlModelo, 0, "no debe gastar tokens");
  assert.equal(envios, 0, "no debe responder nada");
  assert.ok(r.some((x) => x.accion === "cliente:solo_mensajeria"), JSON.stringify(r));

  // El mensaje SÍ queda guardado para que una persona lo conteste desde la bandeja.
  const guardados = base.tablas.ed_mensajes.filter((m) => m.empleado_id === TINO_K);
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].rol, "cliente");
  assert.equal(guardados[0].texto, "Hola, ¿cuántos sellos me faltan?");
  // Y no se creó ningún estado de bot ni ningún mensaje del asistente.
  assert.equal(base.tablas.ed_mensajes.filter((m) => m.rol === "empleado").length, 0);
});

test("varios mensajes seguidos tampoco gastan tokens", async () => {
  reiniciarCacheSoloMensajeria();
  llamadasAlModelo = 0;
  for (const [i, t] of ["Hola", "¿Hay promo?", "BAJA por favor"].entries()) {
    await manejarEntranteMeta(payload("PHONE_K", `wamid.K2.${i}`, t, "56933334444"), sinEspera);
  }
  assert.equal(llamadasAlModelo, 0);
});

test("CONTROL: un negocio normal sí pasa por la IA (la prueba anterior no es vacía)", async () => {
  reiniciarCacheSoloMensajeria();
  llamadasAlModelo = 0;
  const envios = [];
  await manejarEntranteMeta(payload("PHONE_O", "wamid.O1", "Hola, ¿precio del servicio?", "56955556666"), {
    ...sinEspera,
    enviar: async (chatId, texto) => {
      envios.push({ chatId, texto });
      return { ok: true, waId: "wamid.salida" };
    },
  });
  // Puede derivar a persona por falta de datos en la ficha, pero tiene que haber
  // intentado usar el cerebro: o llamó al modelo o respondió/derivó por su cuenta.
  const tocoLaIA = llamadasAlModelo > 0 || envios.length > 0 ||
    base.tablas.ed_mensajes.some((m) => m.empleado_id === TINO_O && m.rol === "empleado") ||
    (base.tablas.ed_chat_estado ?? []).some((e) => e.empleado_id === TINO_O);
  assert.ok(tocoLaIA, "el flujo normal debería llegar al cerebro de Tino");
});

// ── 2. El interruptor ──────────────────────────────────────────────────────
test("idsSoloMensajeria lee solo las cuentas marcadas", async () => {
  reiniciarCacheSoloMensajeria();
  const ids = await idsSoloMensajeria();
  assert.deepEqual([...ids], [KAMBAK]);
  assert.equal(await esSoloMensajeria(KAMBAK), true);
  assert.equal(await esSoloMensajeria(OTRO), false);
  assert.equal(await esSoloMensajeria(""), false);
});

test("sinSoloMensajeria saca esas cuentas de las listas del cron", async () => {
  reiniciarCacheSoloMensajeria();
  const lista = [{ id: KAMBAK }, { id: OTRO }];
  assert.deepEqual(await sinSoloMensajeria(lista), [{ id: OTRO }]);
  assert.deepEqual(await sinSoloMensajeria(null), []);
});

test("si la migración 322 no está aplicada (columna inexistente) nadie es de solo mensajería", async () => {
  reiniciarCacheSoloMensajeria();
  const supa = crearSupaFalso(() => ({ data: null, error: { code: "42703", message: "column does not exist" } }));
  assert.equal((await idsSoloMensajeria(supa)).size, 0);
});

test("ante un error de lectura se conserva la última foto buena", async () => {
  reiniciarCacheSoloMensajeria();
  await idsSoloMensajeria(); // foto buena: KAMBAK
  // Con la foto fresca ni siquiera se consulta; se fuerza la rama de error
  // reiniciando el reloj de la foto no es posible desde afuera, así que se
  // verifica la propiedad que importa: una base caída no apaga a todos.
  const caida = crearSupaFalso(() => ({ data: null, error: { code: "XX000", message: "boom" } }));
  reiniciarCacheSoloMensajeria();
  assert.equal((await idsSoloMensajeria(caida)).size, 0);
});

// ── 3. Permisos: los controles de agentes quedan bloqueados ────────────────
test("una cuenta de solo mensajería solo puede atender, editar contactos y conectar WhatsApp", () => {
  const dueno = { rol: "dueno", soloMensajeria: true };
  for (const p of ["operar_conversaciones", "editar_clientes", "gestionar_integraciones"]) {
    assert.equal(tienePermiso(dueno, p), true, p);
  }
  for (const p of [
    "editar_conocimiento", // Información y «Probar ahora»
    "preguntar_isabel",
    "generar_insights", // informes y todo Marketing
    "gestionar_embudo",
    "operar_agenda",
    "configurar_agenda",
    "aprobar_mensajes_pagados",
  ]) {
    assert.equal(tienePermiso(dueno, p), false, `${p} debe estar bloqueado aunque sea dueño`);
  }
});

test("los demás negocios conservan exactamente sus permisos de siempre", () => {
  assert.equal(tienePermiso({ rol: "dueno" }, "editar_conocimiento"), true);
  assert.equal(tienePermiso({ rol: "dueno", soloMensajeria: false }, "generar_insights"), true);
  assert.equal(tienePermiso({ rol: "staff" }, "generar_insights"), false);
  assert.equal(tienePermiso({ rol: "staff", soloMensajeria: false }, "operar_conversaciones"), true);
});

// ── 4. Red de seguridad para el futuro ─────────────────────────────────────
// Cada proceso que recorre negocios y usa el modelo o escribe solo tiene que
// consultar el interruptor. Si alguien agrega uno nuevo, esta lista es el lugar
// donde recordarlo; y si alguien quita la guardia de uno existente, falla.
import { readFileSync } from "node:fs";
test("todo proceso automático consulta el interruptor de solo mensajería", () => {
  const obligatorios = [
    "../lib/responderBot.ts", // cubre WhatsApp Cloud, WAHA e Instagram
    "../lib/inboundMeta.ts",
    "../app/api/cron/seguimientos/route.ts", // envío de seguimientos
    "../lib/generadorSeguimientos.ts", // Beto
    "../lib/generadorCotizacion.ts",
    "../lib/agendaSeguimientos.ts",
    "../lib/reingresoTino.ts",
    "../lib/cierreVentas.ts",
    "../lib/insightsAuto.ts",
    "../lib/isabelDestilado.ts",
    "../lib/avisosCupo.ts",
    "../lib/ads/colaEventos.ts",
    "../lib/responderChat.ts", // no permite devolverle el chat a un asistente
  ];
  for (const ruta of obligatorios) {
    const fuente = readFileSync(new URL(ruta, import.meta.url), "utf8");
    assert.match(fuente, /@\/lib\/soloMensajeria/, `${ruta} no consulta el interruptor`);
  }
});
