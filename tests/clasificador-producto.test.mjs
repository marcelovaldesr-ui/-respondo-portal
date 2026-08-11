import assert from "node:assert/strict";
import test from "node:test";

import {
  clasificarProducto,
  detectarUrgencia,
  esRuido,
  esNotificacionAutomatica,
  esMensajePreformateado,
} from "../lib/clasificadorProducto.ts";

/**
 * Casos tomados de MENSAJES REALES de Impresora Color.
 *
 * No son ejemplos inventados: cada uno salió de correr el clasificador contra
 * 1.000 mensajes de cliente y 94 conversaciones de la base, el 11-ago-2026.
 * Varios de estos casos son precisamente los que estaban clasificando MAL en la
 * primera versión, y por eso existen las reglas de desambiguación. Si alguien
 * simplifica esas reglas, estos tests avisan.
 */

const p = (texto) => clasificarProducto(texto, "imprenta").producto;

test("reconoce el producto en cómo lo escribe la gente de verdad", () => {
  assert.equal(p("Yo necesito pendón roller"), "Pendones / roller");
  assert.equal(p("Los volantes q valor tienen?"), "Flyers / volantes");
  assert.equal(p("Los sticker son solo redondos ?"), "Stickers");
  assert.equal(p("Hacen lienzos"), "Lonas y telas PVC");
  assert.equal(p("Necesito un talonario de guias de despacho"), "Talonarios");
  assert.equal(p("Hacen tarjetas de presentación ?"), "Tarjetas de presentación");
  assert.equal(p("Le envío imagen Pará trovicel con adhesivo."), "Adhesivo y trovicel");
});

test("escribir sin tildes no rompe nada (así escribe la mayoría)", () => {
  assert.equal(p("cuanto sale un pendon"), "Pendones / roller");
  assert.equal(p("necesito el menu del local"), "Menús / cartas");
  assert.equal(p("hacen imanes publicitarios?"), "Imanes publicitarios");
});

test("gana el término más específico, no el primero que aparece", () => {
  // "pendón roller" tiene que ganarle a "pendón" suelto.
  assert.equal(clasificarProducto("quiero un pendon roller", "imprenta").termino, "pendon roller");
  // "tarjeta de presentacion" le gana a "tarjeta".
  assert.equal(
    clasificarProducto("cotizar tarjetas de presentacion", "imprenta").termino,
    "tarjetas de presentacion",
  );
});

test("desambigua tarjeta de papel vs credencial plástica", () => {
  // La ficha de vocabulario marca este caso como ambiguo en mayúsculas.
  assert.equal(p("necesito 200 tarjetas"), "Tarjetas de presentación");
  assert.equal(p("necesito tarjetas pvc para el gimnasio"), "Credenciales PVC");
  assert.equal(p("quiero tarjetas plasticas de socio"), "Credenciales PVC");
  assert.equal(p("Carnet de jugador"), "Credenciales PVC");
});

test("un PORTAtarjetas no es una tarjeta: mejor no clasificar que clasificar mal", () => {
  // Caso real: "Consulta por casualidad venden porta tarjetas de presentación".
  // Es un accesorio, no un impreso, y contaba como demanda de tarjetas.
  assert.equal(p("venden porta tarjetas de presentación"), null);
  assert.equal(p("Pack 100 Porta Credenciales Transparente en Mercado Libre"), null);
});

test("un letrero se clasifica por su material", () => {
  // Caso real: "necesito cotizar letrero de tela con armado madera de 2 x 1 mt".
  // Antes caía en señalética, que es otro producto y otro precio.
  assert.equal(p("cotizar letrero de tela con armado madera de 2 x 1 mt"), "Lonas y telas PVC");
  assert.equal(p("un letrero de caballete para la vereda"), "Palomas publicitarias");
  assert.equal(p("me instalaron un letrero en av argentina"), "Señalética");
});

test("etiqueta de producto envasado no es sticker publicitario", () => {
  // Caso real: "100.000 etiquetas longanizas granel". Es la especialidad de la casa.
  assert.equal(p("100.000 etiquetas longanizas granel"), "Etiquetas de producto");
  assert.equal(p("necesito etiquetas para mis vinos"), "Etiquetas de producto");
});

test("los términos genéricos solo entran si nada más calzó", () => {
  // "impresión" está en todas partes; no debe ganarle a un producto concreto.
  assert.equal(p("También quiero cotizar la impresión de trípticos"), "Dípticos / trípticos");
  // Sola sí vale: caso real "Hola, quiero cotizar impresiones."
  assert.equal(p("quiero cotizar impresiones"), "Fotocopias e impresiones");
});

test("cuenta lo que el negocio NO hace, porque es información comercial", () => {
  const taza = clasificarProducto("hacen tazas personalizadas?", "imprenta");
  assert.equal(taza.producto, "Tazas (no se hacen)");
  assert.equal(taza.noSeHace, true);

  const polera = clasificarProducto("necesito 50 poleras estampadas", "imprenta");
  assert.equal(polera.noSeHace, true);
});

test("un rubro sin diccionario no rompe: devuelve null", () => {
  assert.equal(clasificarProducto("quiero un pendón", "peluquería canina").producto, null);
  assert.equal(clasificarProducto("quiero un pendón", "").producto, null);
});

test("descarta cierres, saludos y adjuntos sin texto", () => {
  // 281 de 1.000 mensajes reales son de este tipo. Si contaran, la barra
  // "sin clasificar" se comería el gráfico.
  for (const t of [
    "Ok gracias", // el mensaje más frecuente de toda la base
    "Yaa gracias",
    "Ya perfecto. Muchas gracias",
    "listo",
    "Muchas gracias.",
    "Aprobado",
    "Así 👍🏻",
    "hola",
    "Bien. Gracias",
    "por favor",
    "[el cliente envió un audio]",
    "[el cliente envió una imagen]",
    "436,6cm x 59,4 cm",
    "78.740",
    "https://www.instagram.com/agstudiocl",
  ]) {
    assert.equal(esRuido(t), true, `debería ser ruido: ${t}`);
  }
});

test("no descarta como ruido un mensaje con contenido", () => {
  for (const t of [
    "Hola, quiero cotizar flyers publicitarios.",
    "Sin marco cuánto sale?",
    "hola, es un libro",
  ]) {
    assert.equal(esRuido(t), false, `NO debería ser ruido: ${t}`);
  }
});

test("reconoce notificaciones automáticas que no son clientes", () => {
  // 9% de las conversaciones reales. Sin este filtro, la bandeja de leads abre
  // con Rappi arriba y deja de usarse.
  assert.equal(esNotificacionAutomatica("*Rappi:* Acabaste de ingresar a tu cuenta"), true);
  assert.equal(
    esNotificacionAutomatica("NO OLVIDARSE HOY ULTIMO DIA PARA PAGAR IMPOSICIONES"),
    true,
  );
  assert.equal(esNotificacionAutomatica("Te has llevado un 50% de DESCUENTO"), true);
  assert.equal(esNotificacionAutomatica("blob:https://empresas.bci.cl/3fea6cd1"), true);
  // Y no se lleva por delante a un cliente de verdad.
  assert.equal(esNotificacionAutomatica("Hola, necesito cotizar 500 etiquetas"), false);
});

test("detecta el texto prellenado del enlace de entrada", () => {
  // 24% de las conversaciones reales empiezan así. La persona no lo escribió.
  assert.equal(esMensajePreformateado("Hola, quiero cotizar un trabajo de imprenta"), true);
  assert.equal(esMensajePreformateado("Hola, quiero cotizar stickers personalizados."), true);
  assert.equal(esMensajePreformateado("hola quiero cotizar anillados"), true);
  // Alguien que escribe de verdad no arranca con esa fórmula exacta.
  assert.equal(esMensajePreformateado("Hola! necesito saber el precio de unos flyers"), false);
});

test("la urgencia solo se marca cuando de verdad se dijo", () => {
  assert.equal(detectarUrgencia("necesito 500 flyers urgente"), "alta");
  assert.equal(detectarUrgencia("lo necesito para hoy"), "alta");
  assert.equal(detectarUrgencia("lo necesito para el viernes"), "media");
  // Nunca "baja" por defecto: pintar todo de baja hace que el badge no signifique nada.
  assert.equal(detectarUrgencia("hola, cuanto sale un pendon"), null);
  assert.equal(detectarUrgencia(""), null);
});
