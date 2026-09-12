# Batería de evaluación — ¿audio y visión se ganan el derecho a existir?

> **Estado: la decisión ya se tomó — NO-GO para las dos, y el código multimedia
> se retiró del producto** (informe de la Fase 3, sección AF). Esta batería se
> conserva **fuera del producto**, intacta, para el día en que aparezca una
> razón de negocio para volver a mirarlo. No se importa desde ninguna parte del
> portal y no afecta al build.

No es un test. Es una **medición** para contestar una sola pregunta, con
evidencia del modelo de verdad y no con opinión:

> ¿Escuchar una nota de voz, o ver una foto, mejora la conversación **lo
> suficiente** frente a lo que Tino hace hoy: callarse, pasar el chat a una
> persona y avisarle al dueño?

Si la respuesta no es claramente **sí**, la capacidad se queda apagada. Eso es
un resultado correcto, no un fracaso.

---

## El criterio, que NO es el habitual

**No se mide exactitud de palabras.** Una transcripción con el 96 % de las
palabras bien que cambia «cinco mil» por «quinientas» es un **fracaso**. Una
con el 70 % que conserva todos los números es utilizable.

Cada caso declara sus **datos críticos** —los que pueden cambiar una venta:
cantidades, precios, medidas, unidades, fechas, horarios, terminaciones,
negaciones, correcciones— y cada uno termina en uno de tres estados:

| estado | qué significa | qué pasa en producción |
|---|---|---|
| **PRESERVADO** | el valor real aparece | se puede seguir |
| **OMITIDO** | no aparece ni el real ni uno falso | recuperable: Tino lo pregunta |
| **ALTERADO** | aparece **otro** valor confundible | **fracaso**: no hay red abajo |

La asimetría es todo el asunto. Omitir un número se arregla preguntando;
cambiarlo no lo detecta nadie hasta que el cliente reclama por una cotización
errada. Por eso **un solo dato ALTERADO condena el caso**, por bien que salga
el resto.

En visión hay una cuarta categoría, y es la que más se espera:
**NO_GO_POR_IRRELEVANCIA** — la descripción es correcta, pero Tino tiene que
preguntar exactamente lo mismo que si no hubiera visto la foto. Correcto pero
inútil también es NO_GO: la capacidad tiene que ahorrar trabajo, no parecer
inteligente.

---

## Qué hace, en dos etapas

**Etapa 1 · fidelidad.** Manda el archivo a Gemini con los prompts y el parser
que se habían construido para producción —hoy retirados del árbol y conservados
dentro del propio script, intactos— y puntúa los datos críticos.

**Etapa 2 · utilidad** (solo audio). Mete la transcripción en el historial
igual que en producción —el marcador del audio sigue ahí y la transcripción va
detrás, marcada como deducción del sistema— y corre el **prompt real de Tino**
contra el negocio **demo**. Esta etapa contesta lo que de verdad importa:
*¿Tino cotiza sobre un número mal transcrito, o lo confirma antes de avanzar?*

Que Tino pregunte «¿serían 5.000 unidades?» **es un buen resultado**
(`GO_CON_CONFIRMACION`), no un defecto.

---

## Garantías

- **No escribe nada** en la base. Lo único que la toca es `armarPrompt`, que
  lee la ficha del negocio.
- **No le agrega superficie a producción**: nada de esto se importa desde el
  portal, y el script es autocontenido salvo por `armarPrompt` y `generarJSON`
  en su forma de solo texto.
- **No manda ningún mensaje**: no se importa `whatsapp.ts` ni `waha.ts`.
- **No usa conversaciones de clientes**. Los archivos son grabaciones y fotos
  hechas a propósito, y el negocio es el **demo** (`33333333-…`), no Impresora.
- **La clave nunca se imprime ni se pide por chat.** Se lee sola de
  `.env.local`, igual que el resto de los scripts.

---

## Cómo correrla

```bash
npx tsx scripts/_eval_multimodal.ts            # todo lo que haya grabado
npx tsx scripts/_eval_multimodal.ts audio      # solo audio
npx tsx scripts/_eval_multimodal.ts vision     # solo visión
npx tsx scripts/_eval_multimodal.ts A03 A06    # casos puntuales
```

Lo que falte se informa y se saltea: **se puede empezar con tres audios**. Deja
el crudo en `scripts/eval-multimodal/resultado.json`.

Necesita `GEMINI_API_KEY` en `.env.local` — la misma que ya usa el portal.
Costo estimado de la batería completa: **menos de US$ 0,50** (25 llamadas con
adjunto + 12 de la etapa 2, Gemini 2.5 Flash).

---

## Lo que hay que grabar (esto es el trabajo de verdad)

Los archivos van en `scripts/eval-multimodal/muestras/` con el nombre que dice
`casos.json` (`a01.ogg`, `a02.ogg`, … `v01.jpg`, …). Cualquier extensión sirve
si el tronco coincide: `a01.m4a` vale.

### Audio — 12 grabaciones, ~30 minutos en total

**Grabarlas con WhatsApp**, como las manda un cliente: nota de voz, con el
teléfono, en las condiciones que pide cada caso. Después se exportan del chat.

> ⚠️ **No sirven audios de laboratorio.** El punto de esta batería es medir el
> audio que llega de verdad: habla rápida, modismos, muletillas, frases a
> medias, ruido de calle, volumen bajo. Un audio leído despacio y claro mide
> algo que no existe en producción, y daría un GO falso.

Cada caso trae su `guion` en `casos.json` — es una guía, no un libreto:
**decirlo como se diría de verdad** vale más que decirlo exacto. Lo único que
tiene que estar sí o sí son los datos críticos (los números, las medidas, el
día, el «no»).

Los importantes, si hay que recortar:

| caso | por qué es el que decide |
|---|---|
| `A02` | «cinco mil etiquetas» → si sale «quinientas», NO_GO y se termina la discusión |
| `A03` | quince mil / cincuenta mil: la confusión más cara del rubro |
| `A06` | ⭐ el audio solo tiene sentido junto a lo que Tino preguntó antes |
| `A07` | perder un «no» invierte el pedido — el fracaso más silencioso |
| `A09` | grabado **en la calle o en el auto andando**, no con ruido agregado |
| `A11` | audio largo con tres cantidades distintas: donde más ahorra y donde más se cruza |

`A10` (lejos del micrófono, hablando bajo) está para el caso contrario: ahí lo
**correcto** es que el modelo diga «no se entiende». Eso cuenta como acierto.

### Visión — 13 imágenes, ~15 minutos

Fotos con el teléfono de cosas que ya hay en el taller, más dos capturas de
pantalla. `casos.json` dice qué fotografiar en cada una.

Las que deciden: `V03` (una tarjeta de presentación con el pie «¿cuánto me sale
esto?»), `V06` y `V07` (capturas con **especificaciones escritas** — el único
caso donde visión entrega datos y no impresiones), y `V08` (una referencia
estética bonita y sin ningún dato: mide costo sin beneficio).

`V09` (movida) y `V10` (oscura) miden honestidad: si el modelo describe algo con
seguridad, es un fracaso grave.

> **Sin PII.** Que no salga el RUT, el teléfono ni la dirección de nadie en las
> capturas: taparlo antes. Estos archivos quedan en el repo si se decide
> conservar la batería.

---

## Qué mandarme de vuelta

La salida de consola completa, o `resultado.json`. Con eso se cierra el
GO / NO-GO con evidencia. Nada de lo que contiene es dato de cliente.
