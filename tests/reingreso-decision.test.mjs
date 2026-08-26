import assert from "node:assert/strict";
import test from "node:test";

import {
  CATEGORIAS,
  elegible,
  esRelleno,
  filtrar,
  habilitadasPara,
} from "../lib/reingresoDecision.ts";

/**
 * Estas reglas deciden si Tino le vuelve a escribir a un cliente real cuando el
 * equipo dejó la conversación botada. Equivocarse acá tiene dos costos:
 *  - de más: el asistente dice un precio que no sabe, o insiste con un mensaje
 *    vacío, y el cliente se molesta con la IA;
 *  - de menos: la conversación se muere en silencio, que es lo que ya pasaba.
 */

const base = {
  minutosSinRespuesta: 200,
  umbralMinutos: 180,
  clienteEsperando: true,
  ventanaAbierta: true,
  yaReingreso: false,
  bloqueado: false,
  activo: true,
};

// ── Elegibilidad ────────────────────────────────────────────────────────────

test("el caso normal: cliente esperando hace rato y nadie contestó", () => {
  assert.equal(elegible(base).ok, true);
});

test("apagado por cliente = el vigilante es INERTE", () => {
  // Igual que los cupos: se puede desplegar sin que haga nada hasta que alguien
  // lo encienda a propósito.
  assert.equal(elegible({ ...base, activo: false }).ok, false);
});

test("NUNCA reingresa dos veces en la misma conversación", () => {
  // Es la regla que evita lo que más molesta: el asistente insistiendo. Si ya
  // entró y sigue sin respuesta, el problema es del equipo.
  assert.equal(elegible({ ...base, yaReingreso: true }).ok, false);
});

test("respeta el interruptor de «acá Tino no entra»", () => {
  assert.equal(elegible({ ...base, bloqueado: true }).ok, false);
});

test("no entra si el último mensaje NO es del cliente", () => {
  // Si contestó una persona, no hay nada abandonado.
  assert.equal(elegible({ ...base, clienteEsperando: false }).ok, false);
});

test("no entra antes de que pase el tiempo configurado", () => {
  assert.equal(elegible({ ...base, minutosSinRespuesta: 179 }).ok, false);
  assert.equal(elegible({ ...base, minutosSinRespuesta: 180 }).ok, true);
});

test("con la ventana de 24 h cerrada NO entra", () => {
  // Fuera de la ventana solo saldría una plantilla de pago. Retomar así un chat
  // que el equipo dejó botado costaría plata y se vería peor.
  assert.equal(elegible({ ...base, ventanaAbierta: false }).ok, false);
});

// ── La reja: qué se manda de verdad ─────────────────────────────────────────

const HABILITADAS = habilitadasPara({ precios: false });

test("responde una categoría habilitada", () => {
  const d = filtrar(
    { accion: "responder", categoria: "horario", texto: "Cerramos a las 18:30." },
    HABILITADAS,
  );
  assert.equal(d.accion, "responder");
});

test("⭐ NO responde precios mientras el catálogo esté incompleto", () => {
  // El riesgo real: ve el precio de un producto parecido e INFIERE el que falta.
  const d = filtrar(
    { accion: "responder", categoria: "precio", texto: "El tóner 85A sale $34.990." },
    HABILITADAS,
  );
  assert.equal(d.accion, "callar");
});

test("y sí los responde cuando el negocio los habilita", () => {
  const d = filtrar(
    { accion: "responder", categoria: "precio", texto: "El tóner 85A sale $34.990." },
    habilitadasPara({ precios: true }),
  );
  assert.equal(d.accion, "responder");
});

test("⭐ una categoría INVENTADA por el modelo se descarta entera", () => {
  // «Estar seguro» no es opinión del modelo: si no conocemos la categoría, no la
  // pudimos haber habilitado.
  for (const c of ["stock", "disponibilidad", "descuento", "", "HORARIO_"]) {
    const d = filtrar(
      { accion: "responder", categoria: c, texto: "Sí, tenemos 4 unidades." },
      HABILITADAS,
    );
    assert.equal(d.accion, "callar", `"${c}" no debería pasar`);
  }
});

test("una respuesta vacía no se manda", () => {
  assert.equal(
    filtrar({ accion: "responder", categoria: "horario", texto: "   " }, HABILITADAS).accion,
    "callar",
  );
});

test("una pregunta útil sí pasa, sin necesitar lista blanca", () => {
  // No afirma nada del negocio, así que no puede equivocarse en un precio.
  const d = filtrar(
    { accion: "preguntar", texto: "¿Para qué modelo de impresora es? Así te confirmo el compatible." },
    HABILITADAS,
  );
  assert.equal(d.accion, "preguntar");
});

test("⭐⭐ el mensaje de relleno NUNCA sale, aunque venga disfrazado de pregunta", () => {
  // Marcelo: «no sirve que vuelva a decirle al cliente que aún están esperando».
  // Un segundo aviso de que no hay novedades confirma el abandono.
  const rellenos = [
    "¿Sigues ahí?",
    "Seguimos revisando tu consulta, ¿me confirmas si esperas?",
    "Déjame confirmar eso con el equipo y te respondo.",
    "Estamos viendo tu caso, gracias por tu paciencia.",
    "Aún estamos con tu solicitud.",
    "No te hemos olvidado.",
    "Te confirmo a la brevedad.",
  ];
  for (const t of rellenos) {
    assert.equal(esRelleno(t), true, `debería ser relleno: "${t}"`);
    assert.equal(
      filtrar({ accion: "preguntar", texto: t }, HABILITADAS).accion,
      "callar",
      `no debería enviarse: "${t}"`,
    );
  }
});

test("una pregunta legítima no se confunde con relleno", () => {
  const buenas = [
    "¿Para qué modelo de impresora es?",
    "¿Lo necesitas para hoy o alcanzas a esperar a mañana?",
    "¿Es para retiro en tienda o despacho?",
    "¿Cuántas unidades necesitas?",
  ];
  for (const t of buenas) {
    assert.equal(esRelleno(t), false, `NO debería ser relleno: "${t}"`);
    assert.equal(filtrar({ accion: "preguntar", texto: t }, HABILITADAS).accion, "preguntar");
  }
});

test("si el modelo no propone nada, se calla", () => {
  assert.equal(filtrar({ accion: "nada" }, HABILITADAS).accion, "callar");
});

test("precio está en el catálogo de categorías pero NO en las de base", () => {
  assert.ok(CATEGORIAS.includes("precio"));
  assert.ok(!habilitadasPara({ precios: false }).includes("precio"));
});
