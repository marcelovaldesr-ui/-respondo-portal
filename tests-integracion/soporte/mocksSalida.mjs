import { mock } from "node:test";

/**
 * BLOQUEA TODO EFECTO EXTERNO REAL mientras corren las pruebas de integración.
 *
 * Nunca debe faltar en una prueba que llame a reconciliarEstados, cargarEmbudo
 * o revisarAbandonadas contra la base real: sin esto, correr el vigilante de
 * verdad mandaría WhatsApps reales a clientes de Impresora Color, avisaría a
 * Gestión por el puente, y llamaría al modelo (Gemini, con costo real).
 *
 * CÓMO FUNCIONA: usa el mock de módulos de node:test (`--experimental-test-module-mocks`).
 * Primero importa cada módulo real para no perder ningún export que la prueba
 * no necesite tocar (mock.module REEMPLAZA el módulo entero si no se le pasan
 * todos los exports — por eso acá siempre se parte de `...real`), y recién
 * después instala el mock. Tiene que llamarse ANTES de importar el módulo bajo
 * prueba (reconciliarEstados.ts, embudo.ts, reingresoTino.ts): si se llama
 * después, el módulo ya quedó enlazado a las funciones reales.
 *
 * Devuelve `{ llamadas, restaurar }`:
 *  - `llamadas.waha` / `.metaTexto` / `.push` / `.puente` / `.gemini`: qué se
 *    HABRÍA mandado, para que la prueba lo pueda mostrar y revisar.
 *  - `restaurar()`: deshace los 5 mocks. Usar siempre con `t.after(...)`.
 */
export async function instalarMocksDeSalida() {
  const [wahaReal, whatsappReal, puenteReal, pushReal, geminiReal] = await Promise.all([
    import("@/lib/waha"),
    import("@/lib/whatsapp"),
    import("@/lib/puenteSalida"),
    import("@/lib/push"),
    import("@/lib/gemini"),
  ]);

  const llamadas = { waha: [], metaTexto: [], push: [], puente: [], gemini: [] };

  const contextos = [
    mock.module("@/lib/waha", {
      namedExports: {
        ...wahaReal,
        enviarTextoWaha: async (destino, texto, opts) => {
          llamadas.waha.push({ tipo: "texto", destino, texto, opts });
          return { ok: true, id: `falso-waha-${llamadas.waha.length}` };
        },
        enviarMediaWaha: async (destino, ...resto) => {
          llamadas.waha.push({ tipo: "media", destino, resto });
          return { ok: true, id: `falso-waha-media-${llamadas.waha.length}` };
        },
      },
    }),
    mock.module("@/lib/whatsapp", {
      namedExports: {
        ...whatsappReal,
        enviarTexto: async (cfg, ...resto) => {
          llamadas.metaTexto.push({ cfg, resto });
          return { ok: true, id: `falso-meta-${llamadas.metaTexto.length}` };
        },
      },
    }),
    mock.module("@/lib/puenteSalida", {
      namedExports: {
        ...puenteReal,
        notificarSistemaDelCliente: (params) => {
          llamadas.puente.push({ modo: "fire-and-forget", params });
        },
        notificarYEsperar: async (params) => {
          llamadas.puente.push({ modo: "esperado", params });
        },
        notificarConTope: async (params) => {
          llamadas.puente.push({ modo: "con-tope", params });
        },
      },
    }),
    mock.module("@/lib/push", {
      namedExports: {
        ...pushReal,
        avisarACliente: async (...args) => {
          llamadas.push.push(args);
          return { ok: true };
        },
      },
    }),
    mock.module("@/lib/gemini", {
      namedExports: {
        ...geminiReal,
        // Devuelve "no estoy seguro / no digas nada": la respuesta más segura
        // posible. `interpretar()`/`filtrar()` (reingresoDecision.ts) tratan
        // cualquier JSON vacío o sin `accion` reconocida como "callar", así
        // que esto nunca puede terminar en un mensaje real, pase lo que pase.
        generarJSON: async (prompt, opciones) => {
          llamadas.gemini.push({ prompt, opciones });
          return "{}";
        },
      },
    }),
  ];

  return {
    llamadas,
    restaurar() {
      for (const c of contextos) c.restore();
    },
  };
}
