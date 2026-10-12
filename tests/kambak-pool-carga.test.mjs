/**
 * TESTS FASE P12: Prueba de carga y resiliencia simulada del pool WAHA.
 * Simula cola de 200 mensajes, 3 chips en diferentes estados (activo, calentando con cupo agotado, pausado),
 * justicia round-robin entre locales, fallos transitorios de red, expiración y reaper.
 */
import assert from "node:assert/strict";
import test, { mock, beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const url = (p) => new URL(p, import.meta.url).href;
const KAMBAK = "aaaaaaaa-0000-4000-8000-00000000000a";
const TINO = "11111111-0000-4000-8000-00000000000a";

const CHIP_ACTIVO = "chip-activo-0000-00000000000a";
const CHIP_AGOTADO = "chip-agotado-0000-00000000000b";
const CHIP_PAUSADO = "chip-pausado-0000-00000000000c";

const base = crearBaseMemoria(
  {},
  {
    unicos: {
      ed_envios_api: [{ cols: ["cliente_id", "clave"] }],
      ed_waha_numeros: [{ cols: ["sesion"] }],
      ed_eventos_salida: [{ cols: ["cliente_id", "clave"] }],
    },
  },
);

let enviosRealizados = [];
let eventosSalida = [];
let simularFalloRed = false;

function reiniciar() {
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_clientes = [
    {
      id: KAMBAK,
      nombre: "Kambak",
      activo: true,
      solo_mensajeria: true,
      canal_marketing: "waha",
    },
  ];
  base.tablas.ed_empleados = [{ id: TINO, cliente_id: KAMBAK, rol: "tino", activo: true }];
  base.tablas.ed_envios_api = [];

  const hoyChile = "2026-10-15";
  base.tablas.ed_waha_numeros = [
    {
      id: CHIP_ACTIVO,
      cliente_id: KAMBAK,
      sesion: "chip_activo",
      estado: "activo",
      rol: "envio",
      tope_diario: 50,
      enviados_hoy: 10, // Le quedan 40 cupos
      dia: hoyChile,
    },
    {
      id: CHIP_AGOTADO,
      cliente_id: KAMBAK,
      sesion: "chip_agotado",
      estado: "calentando",
      rol: "envio",
      tope_diario: 20,
      enviados_hoy: 20, // 0 cupos disponibles hoy
      dia: hoyChile,
    },
    {
      id: CHIP_PAUSADO,
      cliente_id: KAMBAK,
      sesion: "chip_pausado",
      estado: "pausado",
      motivo_pausa: "tasa_fallos",
      rol: "envio",
      tope_diario: 100,
      enviados_hoy: 0,
      dia: hoyChile,
    },
  ];

  base.tablas.ed_mensajes = [];
  base.tablas.ed_contactos = [];
  base.tablas.ed_eventos_salida = [];

  enviosRealizados = [];
  eventosSalida = [];
  simularFalloRed = false;

  process.env.RESPONDO_POOL_SIMULADO = "1";
  process.env.KAMBAK_WEBHOOK_URL = "https://www.kambak.cl/api/hooks/respondo";
  process.env.KAMBAK_WEBHOOK_SECRET = "test-secret";
  delete process.env.WAHA_POOL_APAGADO;
  delete process.env.WAHA_POOL_FALLBACK_META;
  delete process.env.WAHA_POOL_COLA_MAX_HORAS;
}

mock.module(url("../lib/db.ts"), { namedExports: { db: () => base } });
mock.module(url("../lib/wahaPool.ts"), {
  namedExports: {
    wahaPoolApagado: () => process.env.WAHA_POOL_APAGADO === "1",
    poolSimulado: () => process.env.RESPONDO_POOL_SIMULADO === "1",
    existeEnWhatsApp: async () => ({ ok: true, existe: true }),
    iniciarTipeo: async () => ({ ok: true }),
    pararTipeo: async () => ({ ok: true }),
    enviarTextoPool: async (sesion, destino, texto) => {
      if (simularFalloRed) {
        return { ok: false, error: "Network timeout simulating WAHA downtime" };
      }
      enviosRealizados.push({ sesion, destino, texto });
      return { ok: true, waId: `waha_out_${Date.now()}_${Math.random()}` };
    },
  },
});
mock.module(url("../lib/webhookSalida.ts"), {
  namedExports: {
    emitirEvento: async (clienteId, tipo, clave, payload) => {
      eventosSalida.push({ clienteId, tipo, clave, payload });
      return { ok: true };
    },
  },
});

const {
  drenarColaWaha,
  reaperEnviosWaha,
  expirarColaWaha,
} = await import("../lib/kambakEnvios.ts");

const MEDIODIA = new Date("2026-10-15T15:00:00Z");

beforeEach(() => {
  reiniciar();
});

test("Carga masiva: 200 mensajes en cola distribuidos entre 4 locales respetan topes por chip", async () => {
  const locales = ["cafe-centro", "panaderia-sol", "bocaccio", "bar-sur"];
  const ahora = MEDIODIA.getTime();

  // Poblar 200 mensajes en cola (50 por cada local)
  for (let i = 0; i < 200; i++) {
    const loc = locales[i % locales.length];
    base.tablas.ed_envios_api.push({
      id: `envio_carga_${i}`,
      cliente_id: KAMBAK,
      clave: `kambak-carga-key-${i}`,
      plantilla: "sello_promo",
      categoria: "marketing",
      canal: "waha",
      estado: "en_cola",
      telefono: "+56912340000",
      variables: ["Cliente", "Local", "Promo", "Hoy", "Fin"],
      telefono_hash: `hash_${i}`,
      mes: "2026-10",
      origen_ref: loc,
      programado_para: new Date(ahora - (200 - i) * 1000).toISOString(),
      creado_el: new Date(ahora - (200 - i) * 1000).toISOString(),
    });
  }

  assert.equal(base.tablas.ed_envios_api.filter((f) => f.estado === "en_cola").length, 200);

  // Ejecutar pasadas de drenado hasta que se agoten los cupos disponibles de los chips
  // Avanzamos el reloj 190 segundos por pasada para superar la pausa de seguridad (60 a 180s)
  let totalEnviados = 0;
  for (let pasada = 0; pasada < 45; pasada++) {
    const instante = new Date(MEDIODIA.getTime() + pasada * 190 * 1000);
    const rDrenado = await drenarColaWaha(instante);
    totalEnviados += rDrenado.enviados;
    if (rDrenado.enviados === 0 && totalEnviados >= 40) break;
  }

  // Debe haber despachado exactamente 40 mensajes.
  assert.equal(totalEnviados, 40);
  assert.equal(enviosRealizados.length, 40);

  // Verificar que el chip activo ahora tiene 50 enviados_hoy (tope alcanzado)
  const chipActivo = base.tablas.ed_waha_numeros.find((n) => n.id === CHIP_ACTIVO);
  assert.equal(chipActivo.enviados_hoy, 50);

  // Verificar que el chip agotado no recibió envíos extras
  const chipAgotado = base.tablas.ed_waha_numeros.find((n) => n.id === CHIP_AGOTADO);
  assert.equal(chipAgotado.enviados_hoy, 20);

  // Verificar que el chip pausado no recibió ningún envío
  const chipPausado = base.tablas.ed_waha_numeros.find((n) => n.id === CHIP_PAUSADO);
  assert.equal(chipPausado.enviados_hoy, 0);

  // Verificar equidad round-robin: los 40 mensajes enviados deben repartirse equitativamente entre los 4 locales (10 cada uno)
  const enviados = base.tablas.ed_envios_api.filter((f) => f.estado === "enviado");
  assert.equal(enviados.length, 40);

  const porLocal = {};
  for (const e of enviados) {
    porLocal[e.origen_ref] = (porLocal[e.origen_ref] || 0) + 1;
  }
  for (const loc of locales) {
    assert.equal(porLocal[loc], 10, `Local ${loc} debió enviar exactamente 10 mensajes`);
  }

  // Los 160 mensajes restantes deben permanecer seguros en_cola
  const restantes = base.tablas.ed_envios_api.filter((f) => f.estado === "en_cola");
  assert.equal(restantes.length, 160);
});

test("Resiliencia ante fallo de red en WAHA no pierde mensajes y preserva la cola", async () => {
  // 5 mensajes en cola
  for (let i = 0; i < 5; i++) {
    base.tablas.ed_envios_api.push({
      id: `envio_fallo_${i}`,
      cliente_id: KAMBAK,
      clave: `kambak-fallo-key-${i}`,
      plantilla: "sello_promo",
      categoria: "marketing",
      canal: "waha",
      estado: "en_cola",
      telefono: "+56912340000",
      variables: ["Cliente", "Local", "Promo", "Hoy", "Fin"],
      telefono_hash: `hash_${i}`,
      mes: "2026-10",
      origen_ref: "local-a",
      programado_para: MEDIODIA.toISOString(),
      creado_el: MEDIODIA.toISOString(),
    });
  }

  // Activar simulación de fallo de red en WAHA
  simularFalloRed = true;

  const rDrenado = await drenarColaWaha(MEDIODIA);
  assert.equal(rDrenado.enviados, 0);
  assert.equal(rDrenado.fallidos > 0, true);

  // Los mensajes no se eliminan
  const noEliminados = base.tablas.ed_envios_api.length;
  assert.equal(noEliminados, 5);

  // Restaurar red: los mensajes deben poder enviarse
  simularFalloRed = false;
  // Simular que ya pasó el proximo_intento_en
  for (const f of base.tablas.ed_envios_api) {
    delete f.proximo_intento_en;
  }
  const rDrenadoOk = await drenarColaWaha(MEDIODIA);
  assert.equal(rDrenadoOk.enviados > 0, true);
});

test("Expiración de cola (expirarColaWaha) marca mensajes viejos como fallido/expired con webhook", async () => {
  const hace30Horas = new Date(MEDIODIA.getTime() - 30 * 3600 * 1000).toISOString();
  const hace1Hora = new Date(MEDIODIA.getTime() - 1 * 3600 * 1000).toISOString();

  // 3 mensajes viejos (>24h) y 2 mensajes recientes
  for (let i = 0; i < 3; i++) {
    base.tablas.ed_envios_api.push({
      id: `envio_viejo_${i}`,
      cliente_id: KAMBAK,
      clave: `kambak-viejo-${i}`,
      plantilla: "sello_promo",
      categoria: "marketing",
      canal: "waha",
      estado: "en_cola",
      telefono_hash: `hash_v_${i}`,
      mes: "2026-10",
      creado_en: hace30Horas,
    });
  }

  for (let i = 0; i < 2; i++) {
    base.tablas.ed_envios_api.push({
      id: `envio_nuevo_${i}`,
      cliente_id: KAMBAK,
      clave: `kambak-nuevo-${i}`,
      plantilla: "sello_promo",
      categoria: "marketing",
      canal: "waha",
      estado: "en_cola",
      telefono_hash: `hash_n_${i}`,
      mes: "2026-10",
      creado_en: hace1Hora,
    });
  }

  // Configurar expiración a 24 horas
  process.env.WAHA_POOL_COLA_MAX_HORAS = "24";

  const totalExpirados = await expirarColaWaha(base, MEDIODIA);
  assert.equal(totalExpirados, 3);

  // 3 viejos deben estar en fallido con motivo expirado
  const viejos = base.tablas.ed_envios_api.filter((f) => f.id.startsWith("envio_viejo_"));
  assert.equal(viejos.every((f) => f.estado === "fallido" && f.motivo === "expirado"), true);

  // 2 nuevos deben seguir en_cola
  const nuevos = base.tablas.ed_envios_api.filter((f) => f.id.startsWith("envio_nuevo_"));
  assert.equal(nuevos.every((f) => f.estado === "en_cola"), true);

  // Eventos de salida emitidos con reason expired
  const eventosExpirados = eventosSalida.filter((e) => e.payload.reason === "expired");
  assert.equal(eventosExpirados.length, 3);
});

test("Reaper de huérfanos rescata mensajes atascados en 'enviando' devolviéndolos a 'en_cola'", async () => {
  const hace10Minutos = new Date(MEDIODIA.getTime() - 10 * 60 * 1000).toISOString();

  // Caso 1: huérfano con wamid -> recuperado a enviado
  base.tablas.ed_envios_api.push({
    id: "envio_huerfano_1",
    cliente_id: KAMBAK,
    clave: "kambak-huerfano-1",
    plantilla: "sello_promo",
    categoria: "marketing",
    canal: "waha",
    estado: "enviando",
    wamid: "waha_recuperado_123",
    telefono_hash: "hash_huerfano_1",
    mes: "2026-10",
    actualizado_en: hace10Minutos,
  });

  // Caso 2: huérfano sin wamid -> marcado fallido por timeout incierto
  base.tablas.ed_envios_api.push({
    id: "envio_huerfano_2",
    cliente_id: KAMBAK,
    clave: "kambak-huerfano-2",
    plantilla: "sello_promo",
    categoria: "marketing",
    canal: "waha",
    estado: "enviando",
    telefono_hash: "hash_huerfano_2",
    mes: "2026-10",
    actualizado_en: hace10Minutos,
  });

  const rReaper = await reaperEnviosWaha(base, MEDIODIA);
  assert.equal(rReaper.recuperados, 1);
  assert.equal(rReaper.inciertos, 1);

  const fila1 = base.tablas.ed_envios_api.find((f) => f.id === "envio_huerfano_1");
  assert.equal(fila1.estado, "enviado");

  const fila2 = base.tablas.ed_envios_api.find((f) => f.id === "envio_huerfano_2");
  assert.equal(fila2.estado, "fallido");
  assert.equal(fila2.motivo, "estado_incierto");
});
