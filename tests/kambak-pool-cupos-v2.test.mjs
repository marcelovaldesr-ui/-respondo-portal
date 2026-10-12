/**
 * TESTS FASE P5: Contadores y cupos atómicos con RPC y fallback optimista.
 *
 * Cubre:
 *  - waha_reservar_cupo vía RPC y fallback condicional.
 *  - Dos reservas concurrentes sobre chip al límite: solo 1 tiene éxito.
 *  - Devolución de cupo (waha_devolver_cupo) ante fallo/cancelación.
 *  - Cambio de día (resetea enviados_hoy a 1 con nueva fecha).
 *  - elegirNumeroYReservar con rotación al siguiente candidato si el primero falla reserva.
 */
import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { crearBaseMemoria } from "./_baseMemoria.mjs";

const CLIENTE_K = "aaaaaaaa-0000-4000-8000-00000000000a";
const CHIP_1 = "chip-1-0000-000000000001";
const CHIP_2 = "chip-2-0000-000000000002";

let rpcReservas = 0;
let rpcDevoluciones = 0;

const base = crearBaseMemoria(
  {},
  {
    unicos: { ed_waha_numeros: [{ cols: ["sesion"] }] },
    rpc: {
      waha_reservar_cupo: (args) => {
        rpcReservas++;
        const num = base.tablas.ed_waha_numeros.find((n) => n.id === args.p_numero);
        if (!num) return { data: null, error: { message: "No encontrado" } };
        if (num.estado !== "activo") return { data: [], error: null };

        const envHoy = num.dia === args.p_hoy ? (num.enviados_hoy || 0) : 0;
        if (envHoy >= args.p_tope) return { data: [], error: null };

        num.dia = args.p_hoy;
        num.enviados_hoy = envHoy + 1;
        num.proximo_envio_en = args.p_proximo;
        num.ultimo_envio_en = new Date().toISOString();
        return { data: [{ ...num }], error: null };
      },
      waha_devolver_cupo: (args) => {
        rpcDevoluciones++;
        const num = base.tablas.ed_waha_numeros.find((n) => n.id === args.p_numero);
        if (!num) return { data: null, error: { message: "No encontrado" } };
        if (num.dia === args.p_hoy) {
          num.enviados_hoy = Math.max(0, (num.enviados_hoy || 1) - 1);
          num.proximo_envio_en = null;
        }
        return { data: [{ ...num }], error: null };
      },
    },
  },
);

const {
  reservarCupoNumero,
  devolverCupoNumero,
  elegirNumeroYReservar,
} = await import("../lib/poolNumeros.ts");

function reiniciar() {
  rpcReservas = 0;
  rpcDevoluciones = 0;
  for (const k of Object.keys(base.tablas)) delete base.tablas[k];
  base.tablas.ed_waha_numeros = [
    {
      id: CHIP_1,
      cliente_id: CLIENTE_K,
      sesion: "chip_1",
      estado: "activo",
      rol: "envio",
      tope_diario: 10,
      enviados_hoy: 9,
      dia: "2026-10-15",
      proximo_envio_en: null,
      pausado_hasta: null,
    },
    {
      id: CHIP_2,
      cliente_id: CLIENTE_K,
      sesion: "chip_2",
      estado: "activo",
      rol: "envio",
      tope_diario: 10,
      enviados_hoy: 5,
      dia: "2026-10-15",
      proximo_envio_en: null,
      pausado_hasta: null,
    },
  ];
}

beforeEach(() => {
  reiniciar();
});

test("P5: reserva de cupo vía RPC incrementa enviados_hoy y fija proximo_envio_en", async () => {
  const ahora = new Date("2026-10-15T14:00:00Z");
  const res = await reservarCupoNumero(CHIP_2, ahora, { pausaSegundos: 90 }, base);

  assert.ok(res);
  assert.equal(res.id, CHIP_2);
  assert.equal(res.enviados_hoy, 6);
  assert.equal(rpcReservas, 1);
  assert.ok(res.proximo_envio_en);
  const diffSegundos = (new Date(res.proximo_envio_en).getTime() - ahora.getTime()) / 1000;
  assert.equal(diffSegundos, 90);
});

test("P5: carrera concurrente sobre chip con 1 cupo restante: solo 1 reserva tiene éxito", async () => {
  const ahora = new Date("2026-10-15T14:00:00Z");
  // CHIP_1 tiene enviados_hoy = 9, tope = 10. Solo queda 1 cupo.
  const [res1, res2] = await Promise.all([
    reservarCupoNumero(CHIP_1, ahora, { pausaSegundos: 60, tope: 10 }, base),
    reservarCupoNumero(CHIP_1, ahora, { pausaSegundos: 60, tope: 10 }, base),
  ]);

  const exitosos = [res1, res2].filter((r) => r !== null);
  const fallidos = [res1, res2].filter((r) => r === null);

  assert.equal(exitosos.length, 1, "Exactamente una reserva debe triunfar");
  assert.equal(fallidos.length, 1, "La segunda reserva debe ser rechazada por cupo agotado");
  assert.equal(exitosos[0]?.enviados_hoy, 10);
});

test("P5: devolución de cupo decrementa contador y libera proximo_envio_en", async () => {
  const ahora = new Date("2026-10-15T14:00:00Z");
  // Reservamos cupo en CHIP_2 (sube de 5 a 6)
  const reservado = await reservarCupoNumero(CHIP_2, ahora, { pausaSegundos: 120 }, base);
  assert.equal(reservado?.enviados_hoy, 6);
  assert.ok(reservado?.proximo_envio_en);

  // Devolvemos el cupo (por fallo o cancelación de envío)
  const devuelto = await devolverCupoNumero(CHIP_2, ahora, base);
  assert.ok(devuelto);
  assert.equal(devuelto.enviados_hoy, 5);
  assert.equal(devuelto.proximo_envio_en, null);
  assert.equal(rpcDevoluciones, 1);
});

test("P5: cambio de día reinicia contador a 1 y actualiza día de referencia", async () => {
  // Fecha siguiente (2026-10-16)
  const manana = new Date("2026-10-16T13:00:00Z");
  // CHIP_1 tenía dia = "2026-10-15" y enviados_hoy = 9
  const res = await reservarCupoNumero(CHIP_1, manana, { tope: 10 }, base);

  assert.ok(res);
  assert.equal(res.dia, "2026-10-16");
  assert.equal(res.enviados_hoy, 1);
});

test("P5: fallback condicional funciona correctamente si RPC no está emulada o falla", async () => {
  // Base sin RPC emulada
  const baseSinRpc = crearBaseMemoria();
  baseSinRpc.tablas.ed_waha_numeros = [
    {
      id: "chip-fallback",
      cliente_id: CLIENTE_K,
      sesion: "chip_fb",
      estado: "activo",
      rol: "envio",
      tope_diario: 10,
      enviados_hoy: 3,
      dia: "2026-10-15",
      proximo_envio_en: null,
      pausado_hasta: null,
    },
  ];

  const ahora = new Date("2026-10-15T14:00:00Z");
  const res = await reservarCupoNumero("chip-fallback", ahora, { pausaSegundos: 100 }, baseSinRpc);
  assert.ok(res, "Fallback condicional debe reservar si no hay RPC");
  assert.equal(res.enviados_hoy, 4);

  // Devolución en fallback
  const dev = await devolverCupoNumero("chip-fallback", ahora, baseSinRpc);
  assert.ok(dev);
  assert.equal(dev.enviados_hoy, 3);
  assert.equal(dev.proximo_envio_en, null);
});

test("P5: elegirNumeroYReservar rota a chip alternativo si el primer candidato rechaza la reserva", async () => {
  // Ponemos CHIP_2 al tope para que falle reserva
  base.tablas.ed_waha_numeros[1].enviados_hoy = 10;
  base.tablas.ed_waha_numeros[1].tope_diario = 10;

  // CHIP_1 tiene 9 de 10
  const ahora = new Date("2026-10-15T14:00:00Z");
  const res = await elegirNumeroYReservar(CLIENTE_K, ahora, base);

  assert.ok(res);
  assert.equal(res.reservaOk, true);
  // Debió reservar en CHIP_1
  assert.equal(res.numero.id, CHIP_1);
  assert.equal(res.numero.enviados_hoy, 10);
});
