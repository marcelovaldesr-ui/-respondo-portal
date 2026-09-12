# Fase 3 — Tino más confiable

Trabajo hecho sobre el código de Fase 2 (base `origin/main` 87daaca, desplegada).
No se revirtió ninguna decisión de las fases anteriores.

> ## ⚠️ CÓMO LEER ESTE DOCUMENTO
>
> **La Fase 3 empezó como «Tino multimodal» y terminó como «Tino más
> confiable». El título del archivo quedó del principio; el resultado es el del
> final.**
>
> La historia completa, en tres frases:
>
> 1. Investigamos multimodalidad y **construimos un prototipo completo** de
>    visión y transcripción, apagado por defecto.
> 2. Medimos lo que aportaba y lo que costaba, y **decidimos NO incorporarla**:
>    no superaba suficientemente al fallback humano que ya existía.
> 3. Pero la investigación **descubrió y arregló varios problemas reales del
>    núcleo conversacional** —adjuntos que se perdían, Tino hablando encima de
>    una persona, Instagram sin agrupar ráfagas, un audio que podía llegar a
>    contestarse sin haberlo escuchado— y **esos sí llegaron al producto**.
>
> Por eso el documento tiene dos partes que se leen distinto:
>
> | | qué es | cómo leerla |
> |---|---|---|
> | **A–AA** | el prototipo multimodal: cómo se construyó y por qué así | **registro de la investigación.** Describe código que **ya NO está en el árbol**: se retiró. Se conserva porque explica decisiones que valdría la pena repetir si esto se retoma. |
> | **AB–AI** | la evaluación de valor y la decisión | **el resultado.** Es lo que hay que leer para entender qué quedó en producción y por qué. |
>
> Si vienes a saber **qué se desplegó**, salta directo a **AI. Fase 3 — decisión
> final**.

---

# PRIMERA PARTE — EL PROTOTIPO (registro de la investigación)

> Todo lo que describe esta parte se **construyó, se probó y después se
> retiró** del árbol. No es el estado del código: es el registro de qué se
> intentó y con qué criterio, para que retomarlo algún día no empiece de cero.
> El código está íntegro en `FASE3_MULTIMEDIA.patch` (ver AG).

## A. La arquitectura que había (reconstruida desde el código)

Un mensaje de WhatsApp recorre esto, y no había un solo lugar donde se
"entendiera" lo que llegaba:

```
POST /api/whatsapp/webhook          firma HMAC de Meta, tope 1 MB, idempotencia
  → lib/inboundMeta.ts              ecos, ruteo de empleado, dedupe por wamid
      guardarMensaje (ed_mensajes)  texto + puntero de media ("meta:<id>")
      debounce 6 s ó 20 s           lib/ritmoHumano.ts
  → lib/responderBot.ts             EL CEREBRO
      historial: últimos 20         strings planas, una línea por mensaje
      atajos por código             audio → derivar · confirmar cita · encuesta
      armarPrompt                   lib/promptEmpleado.ts
      generarJSON                   lib/gemini.ts → Gemini 2.5 Flash, SOLO TEXTO
      anti-carrera ×3               modo · último mensaje · otra vez al enviar
      enviarTexto                   typing + delay humano + guardia de vigencia
```

Tres transportes llegan al mismo cerebro: Meta Cloud API, WAHA (no oficial) e
Instagram Direct. El archivo se baja **después**, en el cron de 5 minutos
(`lib/archivarMedia.ts`), a un bucket privado de Supabase — a propósito: bajar
10 MB dentro del webhook se come su presupuesto y Meta lo reintenta.

Lo que estaba **bien** y no se tocó: la idempotencia en cuatro niveles, el
aislamiento entre negocios por código en el proxy de media, la validación de
host antes de mandar el token a Meta, las tres capas anti-carrera, el debounce
adaptativo.

---

## B. Los problemas reales que tenía

### ACTUAL — lo que Tino entendía

Texto, botones nativos, y la parte de una lista interactiva que el cliente tocó.
Nada más.

### PARCIAL — lo que recibía pero no comprendía

- **Imágenes.** Se guardaban, se archivaban y se veían en el portal. Al modelo
  le llegaba `[el cliente envió una imagen]` y el prompt le decía explícitamente
  «tú no ves el contenido».
- **Audios.** Igual, pero peor: `lib/responderBot.ts` detectaba el marcador y
  **derivaba la conversación a una persona sin responder**. Decisión correcta
  cuando no hay transcripción, pero significaba que toda nota de voz apagaba a
  Tino.

### 🔴 ROTO — lo que perdía contexto

1. **El pie de foto BORRABA la señal de que había una foto.** En
   `lib/parserMeta.ts` el texto del mensaje era `caption || marcador`. Una foto
   con el texto «¿pueden hacer esto?» se guardaba idéntica a un mensaje de texto
   suelto. El modelo leía «¿pueden hacer esto?» sin saber que existía un «esto»
   que mirar, y la regla 15 del prompt —«reconoce siempre el adjunto»— era
   imposible de cumplir. Pasaba en los tres transportes.
2. **Instagram tiraba la media.** `lib/inboundInstagram.ts` llamaba a
   `guardarMensaje` **sin el campo `media`**, aunque el parser sí extraía la URL.
   Una foto por DM quedaba con `media_tipo` nulo y el inbox no dibujaba nada. Es
   la misma brecha que ya se había corregido dos veces en los otros dos caminos.
3. **Instagram podía hablar encima del humano.** Su `sigueVigente` comparaba el
   id del último mensaje pero **no re-leía el modo**, a diferencia de Meta y
   WAHA. Si una persona tomaba el control durante los segundos del
   «escribiendo…», Tino igual mandaba su respuesta. Es exactamente el incidente
   que `lib/inboundWaha.ts` documenta como ya ocurrido en producción, repetido
   en otro canal porque la regla se había **copiado** en vez de compartido.
4. **Instagram no agrupaba ráfagas.** Sin debounce, cada DM disparaba su propio
   ciclo: tres burbujas seguidas, tres respuestas.

### NO EXISTE — lo que había que crear

Transcripción, visión, un lugar donde guardar lo interpretado, banderas para
encender capacidades por negocio, y **pruebas del cerebro**: no existía ni una
sola sobre `responderBot`, el control humano o las escalaciones.

---

## C. El pipeline anterior

```
imagen/audio → marcador de texto → prompt → modelo (solo texto)
                                                  ↓
                          audio: derivar sin responder
                          imagen: responder a ciegas
```

## D. El pipeline nuevo

```
imagen/audio → marcador + pie de foto  (ya no se pisan)
                    ↓
        ¿capacidad encendida para este negocio?   lib/banderas.ts  (default OFF)
                    ↓ sí
        decidirInterpretacion                     MIME, tamaño, clase
                    ↓
        bajar bytes                               sb: bucket · meta: Graph con host validado
                    ↓
        Gemini, MISMA llamada con inline_data     imagen → descripción · audio → transcripción
                    ↓
        leerRespuesta                             estricta: media respuesta = ninguna
                    ↓
        guardar (migración 308, degrada si falta)
                    ↓
        historial:  "[el cliente envió una imagen] ¿pueden hacer esto?"
                    "  ↳ [imagen, descrita por el sistema] Una tarjeta en papel mate.
                         [por la imagen no se puede determinar: gramaje]"
                    ↓
        prompt grande (regla 19 nueva) → respuesta
```

**Un solo pipeline, un solo proveedor, ninguna cola nueva.** Gemini acepta
imagen y audio en la misma llamada que el texto: es el mismo cliente, el mismo
timeout y el mismo respaldo de modelo que ya está probado en producción. No se
agregó ni un servicio.

---

## E. Imágenes

Formatos: JPEG, PNG, WEBP, HEIC/HEIF. **SVG no**, explícitamente: es un
documento con script, no una foto, y no tiene por qué llegar al modelo. Tope
4 MB — por encima casi siempre es un PDF escaneado, y eso lo mira una persona.

Al modelo se le pide **describir, no resolver**: quien decide qué hacer con la
venta es el prompt grande, que conoce precios y reglas. Si acá se le pidiera
«responde al cliente», tendríamos dos cerebros opinando y ninguna forma de saber
cuál se equivocó.

Y se le exige declarar **qué no puede determinar**. Una foto casi nunca dice el
material, la medida o la terminación, que es justo lo que hace falta para
cotizar. Que el modelo lo diga con todas sus letras es lo que después deja a
Tino preguntar en vez de inventar.

## F. Audio

Formatos de WhatsApp: ogg/opus, mpeg, mp4, aac, amr, wav, webm. Tope 8 MB
(~8 minutos). Nadie manda una nota de voz de 8 minutos esperando respuesta
automática: si llega, la escucha una persona.

Se pide **transcripción literal, no resumen**: el resumen ya lo hace el prompt
grande, y un resumen de un resumen es donde se pierden los números — que en este
negocio son la cantidad y el precio.

⭐ **La transcripción es evidencia derivada y se conserva como tal.** En el
historial entra como `↳ [nota de voz, transcrita] …`, nunca como si el cliente lo
hubiera escrito. La regla 19 del prompt le prohíbe a Tino citarla como palabras
del cliente y le pide confirmar los números antes de darlos por ciertos. Si
mañana una transcripción se equivoca y el cliente reclama, se puede ver en el
hilo de dónde salió.

**El atajo de derivación sigue vivo**: si no hay transcripción utilizable, la
conversación se deriva igual que antes. Solo se saltea cuando sí la hay.

## G. Mensajes en ráfaga

Ya existía y es bueno: ventana adaptativa de 6 s (mensaje completo) o 20 s
(fragmento corto sin puntuación), con excepción para los saludos. Cada ejecución
duerme su ventana y al despertar se pregunta si sigue siendo el último mensaje;
las que no, se retiran (`debounce_superseded`).

**Lo que se hizo: dárselo también a Instagram**, que era el único sin ventana.
No se tocó la mecánica de los otros dos.

## H. Replies y referencias

**No implementado.** Ver sección Y: el `context` de Meta no se parsea, no hay
columna para el mensaje citado, y hacerlo bien es una fase propia. La regla 16
del prompt ya cubre parte («ese mismo», «el de siempre») pidiendo que Tino
pregunte en vez de adivinar, que es el comportamiento correcto mientras tanto.

## I. Correcciones del cliente

**No se tocó el mecanismo de datos.** La regla 13 del prompt ya manda releer el
historial antes de preguntar, y el historial completo llega al modelo con los
20 mensajes en orden, así que «500» → «perdón, 5000» queda visible. Lo que NO se
hizo es persistencia de slots con corrección: no hay hoy una tabla de campos
extraídos que pueda quedar en estado inconsistente, así que el problema del
brief («cantidad = 500 y 5000 a la vez en distintos estados») no existe todavía.
Si se construye esa persistencia, ahí hay que resolverlo.

## J. Humano + Tino

Lo más importante de la fase después de la multimodalidad.

**La regla del turno ahora vive en un solo lugar**: `lib/turnoTino.ts`. Antes
estaba escrita tres veces, una por transporte, y las copias se habían separado
—la de Instagram nunca miró el modo—. La divergencia fue **la causa** del bug, no
un síntoma: por eso se compartió la regla en vez de arreglar la copia rota.

```
evaluarTurno({ modo, idUltimoDelCliente, idQueRespondo })
  → modo ≠ "bot"                    → no conserva · "modo_no_bot"
  → llegó un mensaje más nuevo      → no conserva · "mensaje_mas_nuevo"
  → si no                           → conserva
```

El orden importa: el modo se evalúa **primero**. Si se mirara el id antes, un
chat tomado por una persona dejaría pasar la respuesta cuando no hubiera
mensajes nuevos, que es el caso más común del takeover.

Las tres capas de revalidación siguen intactas y se revalida **justo antes de
enviar**, dentro del transporte, después de los segundos del «escribiendo…».
El caso del brief —cliente manda foto, humano toma la conversación, Tino termina
de procesar 5 s después— está cubierto y probado.

## K. Incertidumbre

Sin umbrales inventados: Gemini no entrega confianza calibrada, así que no se
finge tenerla. Se usan **hechos**:

| Hecho | Qué hace Tino |
|---|---|
| El modelo declaró `legible: false` | «[imagen que no se pudo interpretar]» → pregunta o deriva |
| Transcripción vacía | Se trata como fallo, no como «no dijo nada» |
| Lista de `no_puedo_determinar` | Pregunta exactamente eso |
| Descarga o modelo falló | Motivo guardado → deriva |
| Capacidad apagada | Camino de siempre, sin cambios |

Una transcripción vacía **no** es una transcripción de nada: es un fallo. La
diferencia importa porque lo primero se deriva a una persona y lo segundo haría
que Tino siguiera como si el cliente no hubiera dicho nada.

## L. Cotizaciones

No se tocó el motor. Lo que cambia es la **calidad del contexto**: la foto ya no
llega como un marcador ciego, y lo que la foto no puede decir llega escrito. La
regla 19 del prompt prohíbe explícitamente tratar la descripción como palabras
del cliente y obliga a preguntar lo que falta. Ningún precio sale de una imagen.

## M. Agenda

**No se tocó.** Tino sigue consumiendo el motor canónico de Fase 2
(`lib/agenda.ts`). Un audio que dice «¿tienes con Camila mañana a las cuatro?»
se transcribe y entra al **mismo** camino de texto que ya existía: el bloque
«AGENDA REAL» del prompt y `ejecutarAccionAgenda`. No hay una segunda
disponibilidad.

## N. Media en el portal

`components/inbox/Interpretacion.tsx`, debajo de la foto o del audio en el hilo:

- Si se interpretó: **«Transcripción · la hizo el sistema»** o **«Lo que se ve ·
  la hizo el sistema»**, con el texto. El rótulo no es decorativo: quien atiende
  tiene que poder desconfiar de una transcripción.
- Si falló: el motivo en su idioma («No se entendió el contenido», «Demasiado
  pesado para procesarlo») y qué hacer («Escúchalo tú para responder»).
- Si nunca se intentó: **no aparece nada**. Un negocio sin la función encendida
  ve el inbox exactamente igual que antes.

En tono neutro y no de alarma: que no se haya podido leer una foto no es una
emergencia. Pintarlo de rojo en cada audio con ruido cansaría hasta que nadie lo
mire.

## O. Seguridad

- El adjunto viaja **por id**, nunca por una URL sacada del payload. El id se
  canjea contra Graph con el token **del negocio dueño del mensaje**, y el host
  se valida antes de mandar ese token. Una URL del webhook sería un SSRF con
  credencial incluida. Con prueba.
- **El tope de tamaño se mide dos veces**: lo que declara Meta y los bytes
  reales. Meta no siempre informa, y confiar en lo declarado es cómo se cuela un
  archivo enorme. Con prueba.
- Allowlist de MIME explícita, no `startsWith("image/")`.
- El aislamiento entre negocios no cambió: la interpretación lee el mensaje por
  id y usa el `clienteId` que ya validó el llamador.
- No se loguea el archivo ni la URL firmada: el log lleva tipo, resultado y ms.

## P. Privacidad ⚠️

**Acá está la decisión que no es técnica.**

Hoy se guarda el archivo (bucket privado) y el texto del mensaje. Esto agrega
dos cosas:

1. Una **transcripción** del audio y una **descripción** de la imagen, en texto
   plano en la base. Es más sensible que el archivo: un audio hay que
   escucharlo, un texto se busca con un `LIKE`. Una nota de voz donde alguien
   dice su RUT pasa a ser texto indexable.
2. El archivo **sale hacia Google (Gemini)** para poder interpretarlo. Eso es lo
   que de verdad hay que contrastar con la política publicada, no la columna.

**Por eso la capacidad nace apagada y la migración queda sin aplicar.** No revisé
la política publicada en la web contra esto — es una lectura legal, no técnica, y
la sección AA la deja como decisión tuya.

## Q. Costos

Instrumentado con lo que ya existe: cada interpretación emite un log
`tino.media_interpretada` con `{cliente, tipo, resultado, ms}`. Con eso se
responde «¿cuánto nos cuesta que este cliente use multimedia?» contando eventos
por tipo, sin construir facturación.

Los topes son el control de costo real: 4 MB por imagen, 8 MB por audio, máximo
**dos adjuntos interpretados por turno**, y la interpretación se guarda para no
repetirla en cada turno del historial. Sin lo último, una conversación de diez
idas y vueltas con una foto pagaría diez veces por la misma foto.

## R. Latencia

Presupuesto por adjunto: 8 s de descarga + 15 s de modelo, con un solo intento.
Un solo intento a propósito: reintentar le suma segundos a alguien que está
esperando, y si el modelo falla, Tino tiene que preguntar o derivar ya.

Todo dentro de la ventana del debounce (6-20 s) y acotado por `fechaLimite`, que
es el mismo presupuesto de función que ya usa el modelo grande. Si no queda
tiempo útil, se devuelve `sin_presupuesto` sin empezar: bajar un archivo y que
el reloj se acabe a mitad de la llamada es lo peor de los dos mundos.

`interpretacion_ms` queda guardado por mensaje, así que la latencia real se mide
con una consulta, no con un cronómetro.

## S. Observabilidad

Motivos estables, los mismos en el código, en la columna y en los logs:

```
ok · ilegible · capacidad_apagada · sin_media · unsupported_media · too_large
media_download_failed · vision_failed · transcription_failed · timeout
sin_presupuesto
```

`capacidad_apagada` y `sin_media` **no se guardan**: no son incidentes, son el
estado normal de un negocio sin la función. Anotarlos llenaría la columna de
ruido. Un incidente se investiga con una consulta a
`interpretacion_estado`, sin leer logs de producción.

## T. Feature flags

`lib/banderas.ts`, por variable de entorno, **default OFF**:

```
TINO_VISION / TINO_AUDIO
  (vacío) | off | 0 | false   → apagada para todos
  on | 1 | true | *           → encendida para todos
  <uuid>,<uuid>               → SOLO esos negocios
```

La lista de ids es lo que permite probar con Impresora sin tocar a nadie más. Es
por entorno y no por columna porque encender visión es una decisión tuya, no del
dueño del negocio, y no hay pantalla donde tenga sentido ponerla.

## U. Pruebas

**763 en verde** (eran 725). Las 38 nuevas, en tres archivos:

`tests/media-interpretacion.test.mjs` — la parte que decide si un archivo sale
hacia un proveedor de IA, cubierta entera y sin red: defaults apagados, listas
por negocio, allowlist de MIME, topes, respuesta ilegible, JSON envuelto en
```` ``` ````, recorte, y que una descripción inventada nunca llegue al historial.

`tests/turno-tino.test.mjs` — ⭐ la regla que más incidentes ha causado, que
**no tenía ninguna prueba**. Incluye una que falla si alguien vuelve a duplicar
la regla en un transporte.

`tests/tino-multimodal-casos.test.mjs` — los casos del brief de punta a punta
determinista: «¿pueden hacer esto?» + foto, dos imágenes, imagen ilegible, la
ráfaga de cinco mensajes, y las dos invariantes de seguridad del camino de media.

## V. Evaluación conversacional

**No hecha.** Requiere una `GEMINI_API_KEY` y un negocio de prueba con
conocimiento cargado; en este entorno no hay ninguna de las dos, y usar la clave
o los datos de Impresora para experimentar estaba prohibido.

Lo que sí quedó listo para hacerla en cuanto haya entorno: los fixtures de
conversación del §18 están construidos como casos deterministas, así que
agregarles la llamada real al modelo es sumar una capa, no empezar de cero.

**Lo que hay que medir cuando se haga**, y no se puede afirmar hasta entonces:
cuántas preguntas hace Tino con una foto delante (la hipótesis es que baja),
cuántas veces cita la transcripción como palabras del cliente (debería ser
cero), y cuánto sube la latencia percibida.

## W. Migraciones

**`sql/308_interpretacion_media.sql` — escrita, NO aplicada, pendiente de tu
aprobación.** Verifiqué antes que 308 estuviera libre (`ls sql/`).

Agrega cuatro columnas a `ed_mensajes`: `interpretacion`,
`interpretacion_estado`, `interpretacion_clase`, `interpretacion_ms`, más un
índice parcial.

**Por qué hace falta SQL** (se evaluó no tocar el esquema y no alcanza): sin
persistir, cada turno volvería a mandar la misma foto al modelo; el operador no
podría leer la transcripción en el portal; y sin `interpretacion_estado` un
incidente obliga a leer logs de producción.

**No se aplica automáticamente porque cambia qué datos se guardan de una
conversación** (§P). El archivo lo dice en su cabecera.

**El portal funciona igual sin ella**: `lib/responderBot.ts`,
`lib/inboxConsulta.ts` y `lib/mediaInterpretacion.ts` degradan por capas ante el
error 42703, el mismo patrón que ya usa `guardarMensaje`. Se puede desplegar el
código primero y decidir la migración después, sin ventana de riesgo.

## X. Archivos

> ⚠️ Esta es la lista del **prototipo**. La mitad de estos archivos ya no está
> en el árbol. La lista de lo que quedó y lo que se retiró está en **AG**.

**Nuevos**
- `lib/banderas.ts` — capacidades por negocio, default apagado.
- `lib/mediaInterpretacionCore.ts` — reglas puras: qué se interpreta, qué se le
  pide al modelo, cómo se lee la respuesta, cómo entra al historial.
- `lib/mediaInterpretacion.ts` — el único lugar donde un archivo sale hacia la IA.
- `lib/turnoTino.ts` — ⭐ la regla del turno, ahora compartida por los tres
  transportes.
- `components/inbox/Interpretacion.tsx` — qué entendió el sistema, en el hilo.
- `sql/308_interpretacion_media.sql` — sin aplicar.
- `tests/media-interpretacion.test.mjs`, `tests/turno-tino.test.mjs`,
  `tests/tino-multimodal-casos.test.mjs`.

**Modificados**
- `lib/gemini.ts` — acepta `inline_data` (imagen/audio) sin cambiar nada de lo
  que ya andaba.
- `lib/responderBot.ts` — interpreta antes del prompt (máx. 2 por turno); el
  historial pasa a ser filas y `aPrompt` arma las líneas; el atajo de audio solo
  dispara si no hay transcripción.
- `lib/promptEmpleado.ts` — regla 19 nueva (evidencia derivada) y reglas 15 y
  casos borde ajustados: ya no afirma en absoluto que Tino no puede ver nada.
- `lib/parserMeta.ts`, `lib/waha.ts`, `lib/instagram.ts` — el pie de foto ya no
  borra el marcador del adjunto.
- `lib/inboundInstagram.ts` — **guarda la media**, re-lee el modo, y agrupa
  ráfagas.
- `lib/inboundMeta.ts`, `lib/inboundWaha.ts` — usan la regla de turno compartida.
- `lib/inboxConsulta.ts`, `components/inbox/Burbuja.tsx`,
  `components/inbox/tipos.ts` — la interpretación llega al hilo.
- `tests/parser-meta.test.mjs` — el test que fijaba el pie de foto pisando el
  marcador, actualizado con el porqué.

## Y. Lo que NO se hizo (y por qué)

- **Replies citados (§7).** El `context` de Meta no se parsea y no hay columna.
  Hacerlo bien es tocar el parser de los tres transportes, una columna más y la
  resolución de referencias ambiguas. Es una fase propia, no un apéndice de
  ésta. Mientras tanto la regla 16 del prompt hace lo correcto: pregunta en vez
  de adivinar.
- **Documentos y PDF (§3).** Auditado: se reconocen, se guardan y se ven; no se
  interpretan. Queda como **reconocido / no interpretado**, que es lo que pediste.
- **Correcciones con persistencia de slots (§6).** No existe hoy esa
  persistencia, así que no hay inconsistencia que arreglar. El historial completo
  ya deja ver la corrección.
- **Ubicación y contactos.** Meta los degrada a una frase y pierde las
  coordenadas. Real, anotado, fuera de alcance.
- **Evaluación conversacional con el modelo (§19).** Sección V.
- **Activar algo en algún cliente.** Todo apagado.
- No se tocó Marketing, la web, Beto, Vera, Isabel ni la Agenda.

## Z. Riesgos y deuda

> ⚠️ Lista del prototipo. **Los puntos 1, 2 y 5 desaparecieron al retirar
> multimedia**: eran riesgos de interpretar adjuntos dentro del turno de
> respuesta, y ese camino volvió a ser el de la Fase 2. Se dejan escritos
> porque son lo primero que habría que volver a mirar si esto se retoma.
> Siguen vigentes el 3 (bucket) y el 4 (Instagram poco probado).

1. **La calidad de la descripción de imagen no está medida.** Está el andamiaje
   y las barreras para que no invente, pero cuánto ayuda de verdad en una
   cotización es una pregunta empírica sin responder. **No encender en un cliente
   sin hacer antes la evaluación de la sección V.**
2. **Latencia.** En el peor caso la interpretación suma hasta ~23 s dentro de un
   presupuesto de 60 s que ya comparte con el debounce y el modelo grande. Está
   acotado por `fechaLimite` y degrada a derivación, pero el margen es más chico
   que antes. Con dos adjuntos en un turno es donde más apretaría.
3. **El bucket `adjuntos` sigue creciendo sin límite.** No es de esta fase y
   sigue igual después de retirar multimedia: sin retención ni limpieza, con
   Supabase Free en 110 de 500 MB. Queda documentado como deuda, no abierto como
   proyecto.
4. **Instagram sigue siendo el canal menos probado.** Se le arreglaron tres
   cosas a ciegas (media, modo, ráfaga): están bien por código y por prueba, pero
   nadie las ha visto funcionar en un DM real.
5. **Sin transcripción, el audio sigue apagando a Tino.** Con el NO-GO esto dejó
   de ser deuda: es el comportamiento definitivo, justificado en AC y AF. Lo que
   sí cambió es que ahora se dispara por el TIPO del archivo y no por una
   comparación de texto que se podía romper en silencio.

## AA. Las decisiones que había que tomar (y cómo se resolvieron)

> Escritas cuando esta parte se entregó. Se dejan tal cual, con su respuesta al
> lado, porque muestran qué se creía pendiente antes de evaluar el valor.

| lo que se preguntaba | cómo terminó |
|---|---|
| ¿Aplico la migración 308? | **No.** Se retiró: sin transcripción ni visión no hay nada que guardar (AF). |
| ¿Hay que actualizar la política de privacidad? | **No hace falta.** Ningún archivo de ningún cliente sale hacia Google, así que no hay tratamiento de datos nuevo que declarar. |
| ¿Con qué negocio se prueba primero? | **Con ninguno.** No se activó nada en ningún cliente. |
| ¿Cuándo hacemos la evaluación conversacional? | Quedó **lista y sin correr** (`scripts/_eval_multimodal.ts`). La decisión se tomó sin ella, y AD explica por qué eso es legítimo en el caso de visión. |

---

# SEGUNDA PARTE — ¿SE GANARON EL DERECHO A EXISTIR?

> Las secciones A–AA describen **qué se construyó**. Las que siguen contestan
> una pregunta distinta y posterior: **si convenía tenerlo**.
>
> El criterio cambió a mitad de la fase, y con razón. No se evalúa si audio y
> visión *funcionan*: se evalúa si mejoran la experiencia **lo suficiente
> frente a lo que Tino hace hoy**, que es derivar a una persona. Si no la
> mejoran claramente, se descartan — aunque ya estén programadas.
>
> **Esta es la parte que quedó vigente.**

---

## AB. Evaluación de valor — el método

### Lo primero: cuál es el fallback de verdad

Antes de comparar hacía falta describir bien el punto de partida, y resultó ser
mejor de lo que dice el brief. Hoy, con un audio:

```
lib/responderBot.ts  →  setModo(chat, "humano")
                     →  registrarEscalacion(trigger: "incertidumbre", RESUMEN_AUDIO)
                     →  avisarDerivacion(dueño)
                     →  return { accion: "audio_derivado" }
```

No es «Tino se queda callado». Es una **derivación completa**: el chat queda en
manos de una persona, se abre una escalación visible en la portada, y al dueño
le llega un aviso. El archivo se guardó en el bucket privado y se escucha desde
el panel. Es, francamente, un buen fallback — y eso sube la vara para audio más
de lo que sube para casi cualquier otra cosa.

Con una imagen el fallback es distinto y más débil: Tino **no** deriva, sigue
conversando y pregunta. Lo que hacía mal hasta esta fase era no enterarse de que
había una foto (el pie de foto borraba el marcador). Eso ya está corregido en el
núcleo seguro, **sin visión**.

### El criterio de medición

**No se mide exactitud de palabras.** Una transcripción con el 96 % de las
palabras correctas que cambia «cinco mil» por «quinientas» es un fracaso; una
con el 70 % que conserva todos los números es utilizable. Lo que se mide es la
supervivencia de los **datos que pueden cambiar una venta**, en tres estados:

| estado | qué pasa en producción |
|---|---|
| **PRESERVADO** | se puede seguir |
| **OMITIDO** | recuperable: Tino lo pregunta |
| **ALTERADO** | **fracaso**: no hay ningún control aguas abajo |

La asimetría es el punto entero. Omitir un número se arregla preguntando;
cambiarlo no lo detecta nadie hasta que el cliente reclama. Por eso **un solo
dato ALTERADO condena el caso**.

### La batería, y por qué no la corrí

Está lista y es real, no un mock: `scripts/_eval_multimodal.ts` +
`scripts/eval-multimodal/` (25 casos definidos, los de las secciones §5 y §9 del
brief). Usa los **prompts de producción**, el **parser de producción** y, en la
etapa 2, el **prompt real de Tino** contra el negocio demo. No escribe en la
base, no manda mensajes y no toca conversaciones de clientes.

Lo que falta para correrla son dos cosas, y ninguna la puedo conseguir yo:

1. **`GEMINI_API_KEY`.** El endpoint de Google *sí* se alcanza desde este
   contenedor (se verificó: devuelve el 403 de «falta identidad», o sea que la
   red llega). Pero la clave no se pide ni se pega por chat. La batería la lee
   sola de `.env.local` en tu máquina.
2. **Los archivos.** Nadie más que tú puede grabar notas de voz chilenas reales.
   Y ahí está el detalle que importa: **un audio de laboratorio daría un GO
   falso.** Leído despacio y claro, Gemini transcribe casi cualquier cosa; el
   riesgo vive en el audio grabado en el auto, rápido, con un número dicho al
   pasar. Generar los audios yo mismo con voz sintética habría producido un
   número bonito y mentiroso.

Costo de correrla completa: **~35 llamadas, menos de US$ 0,50**, y unos 45
minutos tuyos de grabación. Instrucciones exactas en
`scripts/eval-multimodal/README.md`.

### Lo que sí se pudo decidir sin correrla

Dos cosas, y son las que terminan resolviendo la fase:

- **Visión se decide por techo, no por medición.** Se puede razonar el *mejor
  caso posible* —una descripción perfecta y honesta— y ver qué cambia. Si en el
  mejor caso no alcanza, medir es innecesario. Ver AD.
- **Falta un dato empírico que pesa más que cualquier benchmark**: cuánto tarda
  hoy una persona en contestar un audio. Si tarda tres minutos, transcribir
  ahorra tres minutos y asume el riesgo de cotizar sobre un número mal oído.
  La consulta está escrita y es de solo lectura: `sql/consultas/valor_multimodal.sql`,
  bloque 2. Es **el** número.

---

## AC. Baseline vs audio

| | SIN AUDIO (hoy) | CON AUDIO |
|---|---|---|
| Qué pasa al llegar la nota de voz | chat a modo humano, escalación abierta, aviso al dueño | Tino transcribe y responde |
| Quién decide sobre los números | una persona que **escuchó** el audio | el modelo, sobre una transcripción |
| Si el audio no se entiende | lo escucha una persona | `legible:false` → lo escucha una persona (igual) |
| Latencia para el cliente | lo que tarde una persona (**dato faltante**) | +2-6 s sobre el turno normal |
| Peor caso | la conversación espera | **Tino cotiza 500 donde el cliente dijo 5.000** |
| Si el cliente reclama | hay un audio para escuchar | hay un audio y una transcripción marcada como deducción |

**El peor caso es el que decide.** Los dos lados tienen un modo de fallar, pero
no se parecen: el del fallback es *lento* y el de la transcripción es
*silencioso*. Un audio sin contestar se ve en la portada; una cotización con el
número cambiado se ve cuando el cliente reclama, o cuando el trabajo ya se
imprimió.

Hay una mitigación que cambia bastante el cálculo, y es la que tú mismo
planteaste: **confirmar siempre los datos críticos antes de cotizar** («entendí
5.000 unidades de 9×5 en mate, ¿está bien?»). Eso convierte un fallo invisible
en una pregunta que el cliente corrige. Funciona — con una advertencia que no
es teórica: la regla tendría que ser **obligatoria** en el prompt, y este prompt
ya tiene historia de reglas que compiten entre sí. El atajo de audio que existe
hoy nació exactamente de eso: se le pedía a Tino que pidiera el mensaje por
texto, la instrucción competía con «no repreguntes», y el resultado era
inconsistente.

**Y hay un tercer camino que no estaba en el brief**, que conviene mirar antes
de decidir: transcribir **para la persona que atiende**, y dejar el
comportamiento de Tino igual. Ver AH, Salida C. La diferencia es toda la
diferencia:

> Una transcripción con el 90 % de fidelidad es **útil para un humano** y
> **peligrosa para un bot**. El humano ve el hueco y lo llena; el bot cotiza.

---

## AD. Baseline vs visión

### El argumento del techo

Este no depende de ninguna medición, y por eso es el que cierra la discusión.
Supongamos el **mejor caso posible**: Gemini describe cada foto perfectamente y
declara con honestidad todo lo que no puede determinar. Caso dominante del
rubro — el cliente fotografía un impreso y pregunta «¿cuánto sale esto?»:

| dato que Tino necesita para cotizar | ¿lo resuelve una foto perfecta? |
|---|---|
| qué producto es | **sí** |
| cantidad | no — no está en la imagen |
| medida | no — y §11 prohíbe inferirla |
| material / gramaje | no — y §11 prohíbe inferirlo |
| terminación | no — y §11 prohíbe inferirla |

Uno de cinco. Y acá viene el remate: **Tino no pregunta de a una.** Pregunta en
un mensaje, en bloque. Sacar un ítem de un bloque de cinco **no ahorra ningún
turno de conversación** — y el turno es lo que el cliente vive y lo que el
negocio paga en atención.

> La regla que hace **segura** a visión (§11: no inferir gramaje, material,
> medida, cantidad, terminación, precio) es la misma que la hace **inútil** para
> cotizar. No es una tensión que se pueda resolver afinando el prompt: es la
> naturaleza del dato. Una foto no dice de qué papel es algo.

### Dónde sí aportaría, y por qué no alcanza

En las imágenes cuyo **texto** trae las especificaciones: la captura de la
conversación con el diseñador, la cotización de la competencia, la medida
escrita al lado del producto (casos V6 y V7 de la batería). Ahí visión no
adivina: **lee**, y puede resolver tres o cuatro de los cinco datos. Es valor
real.

Tres problemas:

1. Son una minoría de las imágenes que llegan.
2. Para atrapar esa minoría hay que procesar **el 100 %** de las fotos: no se
   sabe de antemano cuál trae texto.
3. Quien manda una captura con especificaciones casi siempre **también las
   escribe**. El dato ya estaba en el mensaje.

El bloque 5 de `sql/consultas/valor_multimodal.sql` está para confirmar esto con
datos reales: trae las últimas 40 respuestas de Tino después de una foto. La
pregunta al leerlas es una sola — *¿cuántas de estas preguntas las habría
evitado ver la foto?*

### Lo que visión reemplazaría, y que ya está gratis

El bochorno de que Tino ignore una foto **ya está resuelto en el núcleo seguro**:
el marcador del adjunto dejó de ser borrado por el pie de foto, así que Tino
sabe que hay una imagen y puede reconocerla. Eso costó tres líneas en tres
parsers, no un proveedor de visión.

Y hay un costo que se paga sí o sí: la regla 15 del prompt pasa de un absoluto
seguro —«tú NO puedes ver los adjuntos»— a un condicional: «salvo que abajo
aparezca una línea ↳». Cada condicional de ese prompt ha sido, históricamente,
el origen de un incidente.

**Conclusión: NO-GO, y no hace falta benchmark** porque la conclusión se sostiene
en el mejor caso.

---

## AE. Complejidad añadida

Contada de verdad, separando lo que depende de multimedia de lo que no.

### Código de producto que existe SOLO por multimedia

| archivo | líneas |
|---|---|
| `lib/mediaInterpretacionCore.ts` | 254 |
| `lib/mediaInterpretacion.ts` | 228 |
| `lib/banderas.ts` | 71 |
| `components/inbox/Interpretacion.tsx` | 78 |
| `lib/gemini.ts` (partes `inline_data`) | +39 |
| `lib/responderBot.ts` (paso de interpretación, `aPrompt`, columnas) | +95 |
| `lib/promptEmpleado.ts` (regla 19 + regla 15 condicional) | +18 |
| `lib/inboxConsulta.ts` (tercera capa de degradación) | +25 |
| `components/inbox/Burbuja.tsx` · `tipos.ts` | +10 |
| `sql/308_interpretacion_media.sql` | 88 |
| `tests/media-interpretacion.test.mjs` | 202 |
| **total** | **≈ 1.108** |

Más la batería de evaluación (`scripts/_eval_multimodal.ts` +
`scripts/eval-multimodal/` + `sql/consultas/`, ≈ 930 líneas), que es andamio de
medición y no producto.

### Puntos de fallo nuevos

Siete, todos en el camino de respuesta al cliente: descarga del archivo desde
Meta o desde el bucket · timeout de descarga (8 s) · llamada al modelo con
adjunto · timeout del modelo (15 s) · JSON malformado del modelo · escritura de
la interpretación · presupuesto de la función agotado (`sin_presupuesto`).

Cada uno está manejado y ninguno tumba el turno — eso está probado. Pero
*manejado* no es *gratis*: son siete estados más que alguien tiene que entender
cuando algo sale raro a las once de la noche.

### El resto de la cuenta

- **Proveedor externo**: ninguno nuevo (es el mismo Gemini). Es el punto más
  fuerte a favor de lo construido.
- **Latencia**: +2-6 s por adjunto dentro de una función que Vercel corta a los
  60 s y que ya gasta 5-17 s en el turno normal.
- **Costo**: bajo en dinero (centavos por conversación con Flash), no
  despreciable en atención.
- **Privacidad**: es el costo grande y **no es de código**. El archivo del
  cliente sale hacia Google, y la transcripción queda como texto buscable en la
  base. Un audio hay que escucharlo; un texto se busca con un `LIKE`. Una nota
  de voz donde alguien dice su RUT pasa a ser dato indexable.
- **Almacenamiento**: marginal (texto).
- **Monitoreo**: un log nuevo (`tino.media_interpretada`) y una columna de
  estado. Suficiente, pero es una superficie más que mirar.
- **Mantenimiento**: el peor ítem, y el menos visible. Mil cien líneas apagadas
  igual se typechequean, se testean, se leen y estorban en cada refactor futuro
  del cerebro de Tino. Código apagado que nadie va a encender es deuda que se
  paga en cuotas.

**Veredicto de esta sección, con tu propio criterio** («si el beneficio es
pequeño y la complejidad grande: NO-GO; somos una startup pequeña»): para visión
el beneficio es demostrablemente pequeño y la complejidad grande → NO-GO. Para
audio el beneficio es **desconocido**, no pequeño — y eso se resuelve con
evidencia, no con más código.

---

## AF. GO / NO-GO final

> **Decisión tomada por Marcelo el 12-sep-2026.** Lo que sigue no es una
> recomendación pendiente: es lo que se hizo.

### VISIÓN → **NO-GO · retirada del producto**

Firme, y **sin necesidad de evaluación con modelo real**, porque se decide por
techo: la conclusión se sostiene en el mejor caso posible (AD). El dato que el
negocio necesita para cotizar no está en la imagen, y la regla que evita que el
modelo lo invente es la misma que deja a Tino preguntando exactamente lo mismo
que sin ver la foto.

Lo que sí resolvía un problema real —que Tino ignorara una foto— quedó resuelto
en el núcleo seguro, con tres líneas en tres parsers y sin proveedor de visión.

### AUDIO PARA TINO → **NO-GO · retirada del producto**

No porque la idea fuera mala: porque la evidencia para decir GO no existía, un
GO no puede apoyarse en mocks, y **conseguirla costaba tiempo que hoy no se
justifica**. Decisión de producto de Marcelo: *«No quiero que Tino utilice
transcripciones para responder clientes.»*

El fallback que queda no es un parche a la espera de algo mejor. Es esto:

```
audio → modo humano → escalación → aviso al dueño → una persona lo escucha
```

Y es coherente con el riesgo: el peor caso de la transcripción —cotizar 500
donde el cliente dijo 5.000— es **silencioso**, y no hay ningún control aguas
abajo que lo detecte antes del reclamo.

### AUDIO PARA EL OPERADOR (Salida C) → **oportunidad futura, no implementada**

Es la mejor de las tres ideas y por eso queda escrita, no construida: transcribir
la nota de voz **para la persona que atiende**, sin tocar el comportamiento de
Tino. Ver AH.

Decisión de Marcelo: *«Primero quiero comprobar con uso real que escuchar audios
representa un problema suficientemente grande. No abrir otro frente por
anticipación.»* La forma de comprobarlo está escrita y es de solo lectura:
`sql/consultas/valor_multimodal.sql`, bloque 2.

### Lo que NO se hizo, en consecuencia

`sql/308` **no se aplicó** y se retiró del árbol. **No se tocó la política de
privacidad**: no hace falta, porque ningún archivo de ningún cliente sale hacia
Google. **No se definió retención nueva.** **No quedó ninguna bandera multimodal
en producción.** Nada se probó con clientes reales.

---

## AG. Qué código quedó, y qué se retiró

**No fue una limpieza ciega.** Se retiró archivo por archivo, con los dos
patches verificados ANTES de borrar nada, y la mitad de la Fase 3 se quedó
porque arregla bugs reales que no tienen nada que ver con mandarle archivos a
Gemini.

### SE QUEDÓ — el núcleo conversacional (≈ 560 líneas)

| qué | dónde | por qué |
|---|---|---|
| **Regla del turno, compartida** | `lib/turnoTino.ts` + `tests/turno-tino.test.mjs` | Estaba escrita tres veces y las copias se habían separado: la de Instagram nunca miraba el modo, así que una persona podía tomar el chat y Tino hablaba encima. Es el bug que más incidentes ha causado. Ahora los tres transportes la comparten y hay un test que falla si alguien vuelve a duplicarla. |
| **El pie de foto ya no borra el marcador** | `lib/parserMeta.ts` · `lib/waha.ts` · `lib/instagram.ts` | «¿pueden hacer esto?» + foto llegaba al modelo como un mensaje de texto suelto, sin ninguna huella de que hubiera un «esto». Ahora van los dos, en el orden en que los lee una persona. |
| **Instagram guarda la media** | `lib/inboundInstagram.ts` · `tipoMediaIg` | Los adjuntos de Instagram quedaban con `media_tipo` nulo y el inbox no dibujaba nada. Era el único de los tres transportes que tiraba el adjunto. |
| **Instagram agrupa ráfagas** | `lib/inboundInstagram.ts` (`ventanaDeEspera`) | Era el único canal sin debounce: cinco mensajes cortos disparaban cinco ciclos y Tino preguntaba cinco veces. |
| **⭐ Detección de audio por tipo de archivo** | `lib/marcadorAudio.ts` (`esAudioDelCliente`) + `tests/audio-derivacion.test.mjs` | **Bug nuevo, encontrado al revisar esto.** La derivación de audio dependía de que el texto fuera *exactamente* el marcador — y esta misma fase hizo que el marcador pueda venir acompañado. Cualquier canal que entregue texto junto a un audio habría hecho que **Tino contestara un audio que no escuchó**, en silencio. Ahora se mira `media_tipo`, que no depende de cómo quedó armado el texto; el marcador quedó como respaldo para los mensajes viejos de Instagram, guardados antes de que ese canal informara el tipo. |
| **Historial con `media_tipo`** | `lib/responderBot.ts` | Es lo que sostiene la detección de arriba, y baja una capa si esa columna no existiera, para no quedarse sin historial. |
| **Regla de adjuntos SIMPLE en el prompt** | `lib/promptEmpleado.ts` | La versión multimodal la había vuelto condicional («no puedes verlo, **salvo** que aparezca una línea ↳»), y cada condicional de ese prompt ha sido el origen de un incidente. Volvió a ser absoluta, y se le agregaron dos precisiones sin condicionales: que el pie de foto **sí** se lee aunque la imagen no, y que si hiciera falta ver el contenido hay exactamente dos salidas honestas —preguntar o derivar— porque una prohibición sin alternativa es lo que empuja al modelo a inventar. |
| **Tests** | `tests/tino-adjuntos-casos.test.mjs`, `tests/parser-meta.test.mjs` | Los de ráfaga, marcador, pie de foto y regla del prompt. El archivo se renombró (era `tino-multimodal-casos`) y se le quitaron los que puntuaban interpretaciones. |

### SE RETIRÓ — ≈ 1.108 líneas de producto

Borrados: `lib/mediaInterpretacion.ts` · `lib/mediaInterpretacionCore.ts` ·
`lib/banderas.ts` · `components/inbox/Interpretacion.tsx` ·
`tests/media-interpretacion.test.mjs` · `sql/308_interpretacion_media.sql`.

Revertidos a su estado de Fase 2: `lib/gemini.ts` (vuelve a ser solo texto) ·
`lib/inboxConsulta.ts` · `components/inbox/Burbuja.tsx` ·
`components/inbox/tipos.ts` · y las partes multimodales de `lib/responderBot.ts`
y `lib/promptEmpleado.ts`.

### Los dos patches, y cómo se verificaron

Nada se borró antes de comprobar que se podía recuperar. Los dos viven **fuera
del repositorio**, en `C:\Users\marce\Claude\Projects\ChatBot Ventas\`:

| archivo | qué contiene | cómo se reaplica |
|---|---|---|
| `FASE3_COMPLETA.patch` (210 KB) | **toda** la Fase 3 con multimedia, contra 87daaca, archivos nuevos incluidos | `git apply` sobre 87daaca |
| `FASE3_MULTIMEDIA.patch` (1.932 líneas) | **solo** el subconjunto multimedia, contra el árbol ya limpio | `patch -p1` sobre el commit de cierre |

**Verificación hecha, no supuesta.** Se copió el árbol limpio, se le aplicó
`FASE3_MULTIMEDIA.patch`, y se comprobó que los 14 archivos afectados quedaban
**byte a byte idénticos** al árbol con multimedia — y que ese árbol restaurado
**corre sus 767 pruebas en verde**. Es decir: el patch no solo se aplica, sino
que devuelve un producto funcionando.

### SE QUEDÓ, fuera del producto — la batería de evaluación

`scripts/_eval_multimodal.ts`, `scripts/eval-multimodal/` y
`sql/consultas/valor_multimodal.sql`.

Cumplen las cuatro condiciones que pusiste: **no se importan desde producción**
(nada del portal los referencia), **no afectan el build** (`next build` no mira
`scripts/`), **no contienen secretos** (la clave se lee de `.env.local` y nunca
se imprime) y **no contienen datos reales** (las muestras las graba quien
evalúe, y el negocio es el demo).

Para lograrlo, el script se volvió **autocontenido**: los prompts, el parser y
la llamada con adjunto que antes vivían en el producto ahora viven dentro del
propio archivo. No es duplicación —el original ya no existe, así que no hay de
qué divergir— y es lo que permite que `lib/gemini.ts` haya vuelto a ser
estrictamente solo texto.

---

## AH. La oportunidad que queda escrita: transcripción asistida para operadores

**No implementada, y a propósito.** Queda acá para que el día que aparezca una
razón de negocio no haya que volver a pensarla desde cero.

### La idea

Transcribir el audio y **mostrarlo en la bandeja**, sin cambiar nada del
comportamiento de Tino. Sigue derivando, sigue avisando al dueño. Lo único que
cambia es que quien atiende **lee** la nota de voz de noventa segundos en cinco
segundos, y contesta con su propio criterio sobre los números.

### Por qué es mejor que transcribir para Tino

- **Elimina el único modo de fallo que importa.** Tino nunca cotiza sobre una
  transcripción, porque nunca la usa.
- **Ataca el costo que hoy existe de verdad.** Lo que cuesta un audio no es la
  latencia: es el tiempo de la persona que tiene que escucharlo.
- ⭐ **El 90 % de fidelidad alcanza.** Una transcripción imperfecta le sirve a un
  humano —ve el hueco, escucha ese pedazo, completa— y es peligrosa para un bot.
  Esa asimetría baja la vara de «casi perfecta» a «suficientemente buena», y es
  toda la diferencia entre un NO-GO y un GO.
- **Es mucho menos código**: se caen la regla 19 del prompt, el condicional de la
  regla 15, las líneas `↳`, todo el camino de visión y el paso de interpretación
  dentro del turno. Quedarían ≈ 400 líneas en vez de 1.108, y la migración se
  reduce a **dos** columnas (`transcripcion`, `transcripcion_estado`) sin índice.
- **Cero puntos de fallo nuevos en el camino de respuesta**, que es lo mejor de
  todo: el cron de archivado (`lib/archivarMedia.ts`, `archivarPendientes`,
  dentro del cron de seguimientos) **ya baja los bytes del audio cada cinco
  minutos** para guardarlos en el bucket. Transcribir ahí no cuesta ninguna
  descarga nueva, ningún timeout nuevo, ninguna latencia en la conversación y
  ninguna presión sobre el presupuesto de la función del webhook. Si falla, no
  se entera nadie salvo la bandeja, que muestra el motivo.

### Lo que NO se ahorra

La privacidad. El archivo igual saldría hacia Google y la transcripción igual
quedaría como texto buscable en la base. Esa revisión hay que hacerla igual, y
va **antes** de encender nada.

### Cómo saber si vale la pena, cuando toque

`sql/consultas/valor_multimodal.sql`, **bloque 2**: cuánto tarda hoy una persona
en contestar un audio. Treinta segundos, solo lectura.

- mediana **< 10 min** → el equipo ya cubre bien los audios; no hay problema que
  resolver.
- mediana **> 60 min**, o muchos `sin_respuesta_nunca` → ahí sí hay algo, y esta
  es la forma barata de atacarlo.

---

## AI. FASE 3 — DECISIÓN FINAL

| | estado |
|---|---|
| **Visión** | **NO-GO · retirada del producto** |
| **Audio para Tino** | **NO-GO · retirada del producto** |
| **Audio para el operador** | **oportunidad futura · no implementada** (AH) |
| **SQL 308** | **no necesaria · no aplicada · retirada del árbol** |
| **Privacidad multimedia** | **sin cambio necesario**: no se activa nada, ningún archivo de cliente sale hacia Google, no hay retención nueva que definir |
| **Núcleo conversacional** | **reforzado y desplegado** — ver abajo |

### El núcleo que sí llegó al producto

| | estado |
|---|---|
| Turno humano | **una sola regla compartida** por los tres transportes, revalidada justo antes de enviar. El modo se evalúa primero: una persona siempre le gana a Tino |
| Captions + adjuntos | **el marcador y el pie de foto conviven**. Tino sabe que llegó una imagen y lee lo que el cliente escribió al lado; no sabe qué muestra, y el prompt se lo dice sin condicionales |
| Instagram media | **se guarda** tipo y puntero; el inbox la dibuja y el archivador la baja al bucket |
| Instagram ráfagas | **agrupa**, con el mismo criterio que Meta y WAHA |
| Derivación de audio | **por tipo de archivo**, no por igualdad de texto. Todo audio que Tino no puede escuchar → modo humano + escalación + aviso, y **cero respuestas sobre su supuesto contenido** |
| Prompt de Tino | **regla de adjuntos simple y absoluta**, con las dos salidas honestas escritas: preguntar o derivar |

### Lo que esta fase le costó al producto

Ni un punto de fallo nuevo. Ni un proveedor nuevo. Ni una columna nueva. Ni una
bandera nueva. Ni un cambio de privacidad.

**Una fase de investigación que termina en NO-GO y deja el producto más simple
de lo que lo encontró es un buen resultado**, no un fracaso — y esa era
exactamente la premisa con la que se pidió evaluarla.
