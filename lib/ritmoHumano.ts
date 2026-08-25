/**
 * RITMO HUMANO DE LA CONVERSACIÓN — compartido por TODOS los transportes.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * Estas dos funciones nacieron dentro del camino de WAHA, cada una resolviendo
 * un incidente real de producción. El camino de Meta (Cloud API) nunca las
 * tuvo: tenía un debounce fijo de 6 s y enviaba sin ninguna pausa.
 *
 * Eso importa más de lo que parece, porque **todo cliente nuevo entra por Cloud
 * API** (regla de la auditoría de escala). O sea: los arreglos que más costó
 * encontrar estaban aplicados solo en el número de Impresora Color, y el primer
 * cliente que pague habría recibido la versión con los bugs.
 *
 * Al vivir acá, sin imports de `@/`, además se pueden probar con `node --test`.
 *
 * REGLA: si mañana se agrega un transporte nuevo, usa esto. No lo copies.
 */

/** Espera corta: el mensaje se entiende solo, conviene responder rápido. */
export const ESPERA_CORTA = 6000;

/**
 * Espera larga: parece que el cliente sigue escribiendo.
 *
 * Subida de 15 s a 20 s (auditoría Monday-readiness, 3-ago-2026, Impresora
 * Color): dos incidentes reales de la misma semana mostraban a Tino
 * preguntando lo mismo 2-4 veces seguidas porque los fragmentos del cliente
 * llegaban a 15-17 s uno del otro — justo en el borde de la ventana anterior,
 * donde la comprobación de "¿llegó algo más nuevo?" corre casi al mismo tiempo
 * que se guarda el fragmento siguiente (carrera). Con más margen sobre los
 * huecos reales observados, la comprobación tiene tiempo de ver el fragmento
 * nuevo antes de decidir responder. No elimina la carrera de raíz (seguiría
 * siendo posible con huecos de exactamente 20 s), pero la ventana anterior
 * fallaba con huecos típicos observados en producción. Trade-off consciente: un
 * mensaje corto o ambiguo tarda hasta 20 s en responderse en vez de 15 s.
 */
export const ESPERA_LARGA = 20000;

/**
 * CUÁNTO ESPERAR ANTES DE RESPONDER.
 *
 * Antes eran 6 s para todo. Mucha gente escribe en WhatsApp a pedazos —"Ese" …
 * "Mismo" … "Es ese mismo"— con 15 s entre uno y otro, así que cada fragmento
 * caía fuera de la ventana y disparaba su propia respuesta. El asistente
 * terminaba preguntando tres veces lo mismo porque nunca vio la frase completa.
 *
 * La regla es simple: si el mensaje se entiende solo, contestar rápido; si
 * parece que viene más, esperar.
 *
 * EL SALUDO ES LA EXCEPCIÓN IMPORTANTE. "Hola" es corto y sin puntuación, o sea
 * que la regla general lo mandaría a esperar 20 s. Pero es el PRIMER contacto:
 * ahí la velocidad es justamente lo que impresiona, y nadie manda "Hola" en
 * pedazos. Se responde rápido.
 *
 * Al revés, un mensaje de uno o dos caracteres ("?", "y") es siempre un pedazo,
 * aunque termine en signo de pregunta.
 */
export function ventanaDeEspera(texto: string): number {
  const s = texto.trim();
  if (!s) return ESPERA_CORTA;

  // Puro signo o una letra: continuación de lo anterior, seguro.
  if (s.length <= 2) return ESPERA_LARGA;

  // Saludos y aperturas: se entienden solos y abren la conversación.
  if (/^(hola|holaa+|buenas|buen[oa]s?\s+(d[ií]as?|tardes|noches)|hey|ola|alo|aló)\b/i.test(s)) {
    return ESPERA_CORTA;
  }

  // Frase corta sin cierre: probablemente sigue escribiendo.
  const palabras = s.split(/\s+/).length;
  if (palabras <= 4 && !/[.?!…]$/.test(s)) return ESPERA_LARGA;

  return ESPERA_CORTA;
}

/**
 * CUÁNTO DEMORARSE EN "ESCRIBIR" LA RESPUESTA (1,5–6 s, proporcional al largo).
 *
 * No es cosmético: el requisito central del producto es que el cliente no note
 * que habla con un bot, y nada delata más a un bot que una respuesta de cuatro
 * líneas que aparece 200 ms después de apretar enviar.
 *
 * El jitter evita el otro extremo: un retardo EXACTO y siempre igual también se
 * nota, porque ningún humano escribe a velocidad constante.
 *
 * El tope de 6 s es deliberado. Podría escalar más con textos largos, pero a
 * partir de ahí el cliente empieza a percibirlo como demora, no como alguien
 * escribiendo — y encima corre contra el presupuesto de tiempo de la función
 * (ver lib/presupuesto.ts).
 */
export function delayHumano(texto: string): number {
  const base = 1500 + texto.length * 35;
  const jitter = Math.floor(Math.random() * 1200);
  return Math.min(6000, Math.max(1500, base + jitter));
}
