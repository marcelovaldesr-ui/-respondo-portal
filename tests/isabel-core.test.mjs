import assert from "node:assert/strict";
import test from "node:test";

import {
  armarConversaciones,
  armarPrompt,
  clavesDelHilo,
  hiloEnTexto,
  normalizarRespuesta,
  palabrasClave,
  panoramaEnTexto,
  quien,
  rankearChats,
  sinAcentos,
  situacionEnTexto,
  situacionVacia,
  validarPregunta,
  MAX_PREGUNTA,
} from "../lib/isabelCore.ts";

/**
 * Lo que se prueba acá es lo que decide QUÉ ve Isabel. Una respuesta mala del
 * modelo se corrige con el prompt; un contexto mal armado hace que conteste
 * seguro sobre algo que nunca leyó, que es el error que cuesta la confianza.
 */

test("las palabras de relleno no sirven para buscar", () => {
  assert.deepEqual(palabrasClave("¿qué es lo que más me piden?"), ["piden"]);
  assert.deepEqual(palabrasClave("hay algo para mi"), []);
});

test("las palabras se devuelven como las escribió el dueño, con acentos", () => {
  // Importa: `ilike` distingue acentos, así que si acá se perdiera la tilde,
  // buscar «cotización» no encontraría nada.
  assert.deepEqual(palabrasClave("cuántas cotizaciones quedaron sin respuesta"), [
    "cuántas",
    "cotizaciones",
    "quedaron",
    "respuesta",
  ]);
});

test("un número largo SÍ es una búsqueda: el folio del presupuesto", () => {
  assert.deepEqual(palabrasClave("qué pasó con el presupuesto 5292"), ["pasó", "presupuesto", "5292"]);
});

test("no se repite la misma palabra escrita distinto", () => {
  const claves = palabrasClave("reclamo, reclamos y RECLAMO");
  assert.deepEqual(claves, ["reclamo", "reclamos"]);
});

test("sinAcentos deja la palabra comparable", () => {
  assert.equal(sinAcentos("Cotización"), "cotizacion");
  assert.equal(sinAcentos("PENDÓN"), "pendon");
});

test("los roles se traducen a algo que el modelo entiende", () => {
  assert.equal(quien("cliente"), "CLIENTE");
  assert.equal(quien("empleado"), "ASISTENTE");
  assert.equal(quien("humano"), "EQUIPO");
  assert.equal(quien("cualquier_cosa"), "EQUIPO");
});

const msg = (chatId, rol, texto, creadoEn, nombre) => ({ chatId, rol, texto, creadoEn, nombre });

test("las conversaciones se agrupan por chat y quedan en orden cronológico", () => {
  const texto = armarConversaciones([
    msg("569111", "empleado", "Le cotizo en 20 minutos", "2026-09-02T12:00:00Z"),
    msg("569111", "cliente", "Hola, quiero 500 flyers", "2026-09-02T11:00:00Z", "Ana"),
  ]);

  const lineas = texto.split("\n");
  assert.match(lineas[0], /Ana/);
  assert.match(lineas[1], /CLIENTE: Hola, quiero 500 flyers/);
  assert.match(lineas[2], /ASISTENTE: Le cotizo/);
});

test("la conversación más reciente va primero", () => {
  const texto = armarConversaciones([
    msg("vieja", "cliente", "mensaje viejo", "2026-01-01T10:00:00Z", "Vieja"),
    msg("nueva", "cliente", "mensaje nuevo", "2026-09-09T10:00:00Z", "Nueva"),
  ]);
  assert.ok(texto.indexOf("Nueva") < texto.indexOf("Vieja"));
});

test("se recorta por conversación, no de golpe al final", () => {
  const muchos = [];
  for (let i = 0; i < 40; i++) {
    muchos.push(msg("a", "cliente", `mensaje ${i}`, `2026-09-0${(i % 9) + 1}T10:00:00Z`));
    muchos.push(msg("b", "cliente", `otro ${i}`, `2026-09-0${(i % 9) + 1}T11:00:00Z`));
  }
  const texto = armarConversaciones(muchos, { maxMensajes: 3 });
  // Las dos conversaciones siguen presentes, cada una recortada.
  assert.ok(texto.includes("…a"), "la conversación a no puede desaparecer");
  assert.ok(texto.includes("…b"), "la conversación b no puede desaparecer");
});

test("un texto larguísimo se corta y no revienta el contexto", () => {
  const texto = armarConversaciones([msg("a", "cliente", "x".repeat(5000), "2026-09-01T10:00:00Z")], {
    maxChars: 100,
  });
  assert.ok(texto.length < 400);
});

test("sin mensajes devuelve vacío, no una cabecera fantasma", () => {
  assert.equal(armarConversaciones([]), "");
});

test("el panorama se lee como frases, no como JSON", () => {
  const t = panoramaEnTexto({
    dias: 30,
    conversaciones: 41,
    mensajes: 388,
    esperando: 2,
    citasProximas: 5,
    cobrosPendientes: 3,
    cobradoMes: 890000,
    porEtapa: [{ etapa: "cotizado", total: 7 }],
    porEtiqueta: [{ etiqueta: "reclamo", total: 2 }],
  });
  assert.match(t, /41 conversaciones/);
  assert.match(t, /\$890\.000/);
  assert.match(t, /cotizado: 7/);
});

test("el panorama sin datos lo dice, no muestra vacíos", () => {
  const t = panoramaEnTexto({
    dias: 30,
    conversaciones: 0,
    mensajes: 0,
    esperando: 0,
    citasProximas: 0,
    cobrosPendientes: 0,
    cobradoMes: 0,
    porEtapa: [],
    porEtiqueta: [],
  });
  assert.match(t, /Embudo: sin datos/);
});

test("el prompt lleva la pregunta y el panorama, y no deja huecos sin rellenar", () => {
  const p = armarPrompt({
    negocio: "Impresora Color",
    rubro: "imprenta",
    hoy: "jueves 10 de septiembre de 2026",
    panorama: "Últimos 30 días: 41 conversaciones",
    fichas: "· [precios] Flyers: $30 c/u",
    conversaciones: "--- Ana ---",
    pregunta: "¿alguien reclamó?",
  });

  assert.ok(p.includes("Impresora Color"));
  assert.ok(p.includes("¿alguien reclamó?"));
  assert.ok(p.includes("41 conversaciones"));
  assert.ok(!p.includes("{{"), "quedó un hueco sin reemplazar en el prompt");
});

test("el prompt no deja huecos aunque falte todo", () => {
  const p = armarPrompt({
    negocio: "",
    rubro: "",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "algo",
  });
  assert.ok(!p.includes("{{"));
  assert.ok(p.includes("no hay fichas cargadas"));
});

test("se acepta la respuesta buena del modelo", () => {
  const r = normalizarRespuesta(
    JSON.stringify({
      respuesta: "Sí, reclamó una persona el lunes.",
      apoyos: ["Ana, 8 de septiembre: «llegó mal impreso»"],
      seguridad: "alta",
    }),
  );
  assert.equal(r.seguridad, "alta");
  assert.equal(r.apoyos.length, 1);
});

test("si el modelo contesta en prosa igual sirve, con seguridad media", () => {
  const r = normalizarRespuesta("No hubo reclamos esta semana.");
  assert.equal(r.respuesta, "No hubo reclamos esta semana.");
  assert.equal(r.seguridad, "media");
  assert.deepEqual(r.apoyos, []);
});

test("una respuesta vacía se descarta en vez de mostrarse en blanco", () => {
  assert.equal(normalizarRespuesta(JSON.stringify({ respuesta: "" })), null);
  assert.equal(normalizarRespuesta(""), null);
});

test("«no sé» se conserva: es una respuesta válida, no una falla", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: "Con lo que tengo cargado no puedo saberlo.", seguridad: "no_se" }),
  );
  assert.equal(r.seguridad, "no_se");
});

test("una seguridad inventada por el modelo se degrada a media", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: "Algo", seguridad: "certísima" }),
  );
  assert.equal(r.seguridad, "media");
});

test("una respuesta que vino como lista se junta en una sola", () => {
  const r = normalizarRespuesta(
    JSON.stringify({ respuesta: ["Sí.", "Fue el lunes."], seguridad: "alta" }),
  );
  assert.equal(r.respuesta, "Sí. Fue el lunes.");
});

test("la pregunta se valida antes de gastar una llamada al modelo", () => {
  assert.equal(validarPregunta("  ").ok, false);
  assert.equal(validarPregunta("x".repeat(MAX_PREGUNTA + 1)).ok, false);

  const ok = validarPregunta("  ¿alguien   reclamó? ");
  assert.equal(ok.ok, true);
  assert.equal(ok.texto, "¿alguien reclamó?");
});

/* ───────────────────────────────────────────────────────────────────────────
 * Ola A: la situación del negocio y el rankeo de conversaciones
 * ─────────────────────────────────────────────────────────────────────────── */

test("una situación vacía no escribe encabezados sobre la nada", () => {
  assert.equal(situacionEnTexto(situacionVacia()), "");
});

test("los bloques vacíos se omiten enteros, no dicen «ninguno»", () => {
  const s = situacionVacia();
  s.citas = [{ cuando: "vie 12 sep, 10:30", quien: "Ana", servicio: "Corte", estado: "agendada" }];
  const t = situacionEnTexto(s);

  assert.match(t, /PRÓXIMAS CITAS/);
  assert.ok(!t.includes("COBROS"), "no puede aparecer un bloque sin filas");
  assert.ok(!t.includes("DERIVACIONES"));
});

test("las derivaciones abiertas llevan quién, hace cuánto y por qué", () => {
  const s = situacionVacia();
  s.esperando = [
    { quien: "Ana Pérez", motivo: "reclamo", resumen: "Llegó mal impreso el pendón.", dias: 3 },
    { quien: "…4821", motivo: "precio", resumen: "Pide descuento por volumen.", dias: 1 },
  ];
  const t = situacionEnTexto(s);

  assert.match(t, /Ana Pérez — hace 3 días, motivo «reclamo»/);
  assert.match(t, /hace 1 día,/, "un día en singular");
  assert.match(t, /Llegó mal impreso/);
});

test("los cobros pendientes traen el total y el detalle en pesos chilenos", () => {
  const s = situacionVacia();
  s.cobrosPendientes = [
    { quien: "Ana", monto: 45000, concepto: "500 flyers", dias: 9 },
    { quien: "Luis", monto: 120000, concepto: "Pendón 2x1", dias: 2 },
  ];
  const t = situacionEnTexto(s);

  assert.match(t, /\$165\.000 en total/);
  assert.match(t, /\$45\.000 por 500 flyers/);
});

test("los cierres detectados van con la frase que los sostiene", () => {
  const s = situacionVacia();
  s.cierres = [
    { quien: "Ana", estado: "pagado", evidencia: "ya transferí el total", cuando: "8 sep" },
  ];
  assert.match(situacionEnTexto(s), /Ana \(8 sep\) pagado: «ya transferí el total»/);
});

test("los resultados muestran la plata solo cuando existe", () => {
  const s = situacionVacia();
  s.resultados = [
    { tipo: "venta_confirmada", total: 14, valor: 890000 },
    { tipo: "agendamiento", total: 22, valor: 0 },
  ];
  const t = situacionEnTexto(s);

  assert.match(t, /venta_confirmada: 14 \(\$890\.000\)/);
  assert.match(t, /agendamiento: 22$/m, "sin valor no se inventa un $0");
});

test("los clientes molestos van con nombre y fecha, no como un total", () => {
  const s = situacionVacia();
  s.molestos = [{ quien: "Ana", cuando: "8 sep", nota: "" }];
  const t = situacionEnTexto(s);

  assert.match(t, /CLIENTES MARCADOS COMO MOLESTOS/);
  assert.match(t, /· Ana \(8 sep\)$/m, "sin nota no queda un espacio colgando");
});

test("el informe semanal ya analizado entra al contexto", () => {
  const s = situacionVacia();
  s.informes = [
    {
      periodo: "1 sep al 7 sep",
      resumen: ["Semana floja en cotizaciones."],
      problemas: ["Nadie retomó las de más de 3 días."],
      oportunidades: ["Los pendones se piden mucho y no están en la lista."],
    },
  ];
  const t = situacionEnTexto(s);

  assert.match(t, /INFORME DE LA SEMANA 1 sep al 7 sep/);
  assert.match(t, /· problema: Nadie retomó/);
  assert.match(t, /· oportunidad: Los pendones/);
});

test("la situación entra al prompt y no deja huecos", () => {
  const p = armarPrompt({
    negocio: "Impresora Color",
    rubro: "imprenta",
    hoy: "jueves 10 de septiembre de 2026",
    panorama: "41 conversaciones",
    situacion: "DERIVACIONES ABIERTAS:\n· Ana — hace 3 días",
    fichas: "",
    conversaciones: "",
    pregunta: "¿quién está esperando?",
  });

  assert.ok(p.includes("Ana — hace 3 días"));
  assert.ok(!p.includes("{{"));
});

test("sin situación, el prompt lo dice en vez de dejar el hueco", () => {
  const p = armarPrompt({
    negocio: "x",
    rubro: "y",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "algo",
  });
  assert.ok(!p.includes("{{"));
  assert.match(p, /sin novedades/);
});

test("⭐ gana la conversación que aparece en MÁS términos, no la que salió primero", () => {
  // Pregunta: «¿qué pasó con la cotización de los pendones?»
  const porCotizacion = ["chatA", "chatB", "chatC"];
  const porPendones = ["chatC"];

  const orden = rankearChats([porCotizacion, porPendones]);
  assert.equal(orden[0], "chatC", "habla de las dos cosas: es la que importa");
});

test("a igual cantidad de términos, gana la más reciente", () => {
  // Las listas vienen ordenadas de más reciente a más antigua.
  const orden = rankearChats([["nuevo", "viejo"]]);
  assert.deepEqual(orden, ["nuevo", "viejo"]);
});

test("un chat repetido dentro del mismo término no suma dos veces", () => {
  const orden = rankearChats([["a", "a", "a"], ["b"]]);
  // 'a' aparece en 1 término y 'b' en 1: empata, y desempata la posición.
  assert.equal(orden.length, 2);
  assert.equal(orden[0], "a");
});

test("el rankeo respeta el tope y no revienta con listas vacías", () => {
  assert.deepEqual(rankearChats([]), []);
  assert.deepEqual(rankearChats([[], []]), []);
  assert.equal(rankearChats([["a", "b", "c", "d"]], 2).length, 2);
});

test("el prompt le dice qué hacer con un saludo, para no contestarlo con «no sé»", () => {
  // Caso real visto en producción el 10-sep: «como estas?» devolvía «con lo que
  // tengo cargado no puedo saber cómo estoy», con la caja ámbar de «no sé». La
  // barandilla estaba bien; la que faltaba era la regla para lo que no es una
  // pregunta del negocio.
  const p = armarPrompt({
    negocio: "x",
    rubro: "y",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "como estas?",
  });
  assert.match(p, /TE HABLAN A TI/);
  assert.match(p, /NO corresponde decir que no puedes saberlo/);
});

/* ───────────────────────────────────────────────────────────────────────────
 * Isabel como persona: identidad, criterio y memoria del hilo
 * ─────────────────────────────────────────────────────────────────────────── */

test("el prompt le da una identidad, no solo una tarea", () => {
  const p = armarPrompt({
    negocio: "Impresora Color",
    rubro: "imprenta",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "hola",
  });

  assert.match(p, /Eres Isabel y trabajas en Impresora Color/);
  assert.match(p, /TU CRITERIO SÍ VALE/, "sin esto vuelve a ser un buscador con cara de persona");
  assert.match(p, /INICIATIVA/);
});

test("el rigor se aplica al negocio, no a la conversación", () => {
  const p = armarPrompt({
    negocio: "x",
    rubro: "y",
    hoy: "hoy",
    panorama: "",
    fichas: "",
    conversaciones: "",
    pregunta: "hola",
  });

  // Las dos cosas conviven: puede conversar Y no puede inventar cifras.
  assert.match(p, /TE PREGUNTAN POR EL NEGOCIO/);
  assert.match(p, /Nunca sumes conversaciones a ojo/);
});

test("el hilo se arma del más viejo al más nuevo, que es como se lee", () => {
  const t = hiloEnTexto([
    { pregunta: "¿y qué le respondimos?", respuesta: "Que llegaba el jueves." },
    { pregunta: "¿qué pidió Ana?", respuesta: "500 flyers." },
  ]);

  assert.ok(t.indexOf("¿qué pidió Ana?") < t.indexOf("¿y qué le respondimos?"));
  assert.match(t, /EL DUEÑO: ¿qué pidió Ana\?/);
  assert.match(t, /TÚ: 500 flyers\./);
});

test("el hilo se corta en pocos turnos y no arrastra la sesión entera", () => {
  const muchos = Array.from({ length: 10 }, (_, i) => ({
    pregunta: `pregunta ${i}`,
    respuesta: `respuesta ${i}`,
  }));
  const t = hiloEnTexto(muchos);
  assert.equal(t.split("EL DUEÑO:").length - 1, 3);
});

test("sin hilo no se inventa una conversación previa", () => {
  assert.equal(hiloEnTexto([]), "");
});

test("una respuesta kilométrica del hilo se recorta", () => {
  const t = hiloEnTexto([{ pregunta: "p", respuesta: "x".repeat(3000) }]);
  assert.ok(t.length < 700);
});

test("⭐ una repregunta hereda los términos de la anterior", () => {
  // «¿y qué le respondimos?» no tiene con qué buscar: sin esto Isabel
  // contestaría a ciegas justo cuando el dueño está profundizando.
  assert.deepEqual(palabrasClave("¿y qué le respondimos?"), ["respondimos"]);

  const claves = clavesDelHilo([
    { pregunta: "¿qué pidió Ana Pérez?", respuesta: "500 flyers" },
  ]);
  assert.ok(claves.includes("pidió"));
  assert.ok(claves.includes("Pérez"));
});

test("sin hilo, clavesDelHilo no revienta", () => {
  assert.deepEqual(clavesDelHilo([]), []);
});
