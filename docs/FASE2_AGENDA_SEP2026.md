# Fase 2 — La agenda

Trabajo hecho sobre el código de Fase 1 (base `origin/main` 20c40bb). Todo lo de
Fase 0 y Fase 1 sigue en pie: no se revirtió ninguna decisión suya ni se borró
ninguna de sus pruebas.

**No se hizo commit. No se hizo push. No se desplegó nada. Beto sigue apagado.
No se envió ningún mensaje a ningún cliente real. No se encendió ninguna
funcionalidad que estuviera apagada.**

Estado: 725 pruebas en verde, typecheck sin errores nuevos (de hecho uno menos),
capturas antes/después revisadas en dos pasadas.

**Segunda vuelta (12-sep).** Marcelo cerró las seis decisiones de la sección U y
sus respuestas ya están incorporadas en el código: el horizonte se configura por
negocio desde el portal, la autogestión dejó de tener plazos propios y el enlace
de gestión ahora muere 24 h después del término de la cita.

**Cierre (12-sep, de noche).** Marcelo **ya aplicó la migración 307** en Supabase
y autorizó cerrar la fase sin él: validar, commitear, pushear, dejar que Vercel
despliegue y hacer el smoke test. El resultado está en la sección W.

**Se corrigieron tres cosas que hacían perder o duplicar reservas.** Están en la
sección B con nombre y apellido; la más grave es la primera.

---

## A. La arquitectura que había (reconstruida desde el código, antes de tocar nada)

La agenda no era un módulo: eran **tres implementaciones distintas** del mismo
cálculo, que podían responder cosas diferentes sobre la misma hora.

| Quién pregunta "¿a qué hora hay?" | Por dónde entraba | Qué tomaba en cuenta |
|---|---|---|
| Página pública `/reservar/[slug]` | `/api/reservas/disponibilidad` | horarios, bloqueos, citas, Google |
| Portal (crear cita a mano) | `NuevaCita` → sin cálculo | **nada**: se escribía la hora a mano |
| Tino por WhatsApp | `lib/agendaBot.ts` → `disponibilidad()` | lo mismo que la pública, con otros topes |

Las piezas de datos, que sí estaban bien pensadas y **no se tocaron**:

- `ed_servicios` — qué se vende, cuánto dura, cuánto buffer, cupo si es clase.
- `ed_profesionales` — persona, sillón, sala o cancha. Cada uno es una agenda.
- `ed_servicio_profesional` — quién puede hacer qué.
- `ed_horarios` — tabla aparte, en hora de pared chilena (`09:00`, no un instante).
- `ed_bloqueos` — vacaciones y feriados; `profesional_id` nulo = todo el negocio.
- `ed_citas` — con un `EXCLUDE` de Postgres que impide el solape **en la base**
  (migración 220, reescrito en la 260 para que las clases no cuenten).
- `ed_clases` + `ed_inscribir_en_clase` — cuando el solape ES el producto.
- `gestion_token` — 18 bytes aleatorios por cita: el enlace que el cliente usa
  para moverla o anularla sin tener cuenta.

Y el reloj: todo el módulo razona en `America/Santiago` vía `Intl`, anclando al
**mediodía chileno** y avanzando de a 24 h. Es lo correcto y se mantuvo: anclar
a medianoche se rompe los dos domingos al año en que el país cambia la hora.

**Numeración de migraciones (diagnóstico previo, exigido antes de crear nada):**
303 marketing · 304 endurecimiento (aplicada) · 305 autorización fail-closed ·
306 propuestas-memoria (sin aplicar). El siguiente libre era el **307**, y ahí
quedó lo único que esta fase agrega en SQL (ver sección M).

---

## B. Los problemas reales que tenía (no los cosméticos)

### B.1 — GRAVE · Si Google no respondía, se ofrecían horas ya tomadas

`lib/agendaGoogle.ts` era **fail-open**: si la llamada a `freeBusy` fallaba —token
vencido, Google caído, credenciales rotadas, cualquier cosa— la función devolvía
"no hay nada ocupado" y el motor ofrecía **el día entero** del profesional como
libre. Es decir: exactamente cuando dejábamos de poder ver su calendario
personal, era cuando más horas suyas ofrecíamos.

El resultado no es un error en pantalla: es un cliente que llega a las 15:00 a la
hora que reservó y se encuentra con que el profesional está en el dentista.

**Corregido de inmediato.** Ahora cada profesional cuyo calendario no se pudo
comprobar se marca como **no verificable** y sus horas **no se ofrecen** —ni en la
página pública, ni por WhatsApp, ni en el portal. Se prefiere ofrecer menos horas
antes que ofrecer una que no podemos garantizar. El dueño lo ve, con nombre y
motivo, en la pantalla de la agenda y en Configuración → Google Calendar.

La prueba que lo fija: *"si no podemos comprobar el Google de un profesional, sus
horas NO se ofrecen"*. La prueba vieja afirmaba lo contrario (daba por buena la
apertura), y fue reescrita.

### B.2 — GRAVE · Mover una cita no cambiaba de profesional

`reagendar` escribía la hora nueva pero **nunca** tocaba `profesional_id`. Mover
la cita de Marcela a un hueco de Camila dejaba la cita dentro del horario de
Camila pero seguía contando contra Marcela: dos personas en el mismo bloque de
Camila, y Marcela ocupada por alguien que no iba a ver.

Peor: **una inscripción a clase también se podía mover**, lo que dejaba una fila
apuntando a una `ed_clases` cuyo horario ya no coincidía. Datos rotos, y el cupo
de la clase mal contado.

**Corregido de inmediato.** Mover ahora revalida contra el motor, puede cambiar de
profesional (con validación de que pertenece al mismo negocio y puede hacer ese
servicio), borra el evento de Google del profesional anterior, y **rechaza** mover
inscripciones a clase con un motivo propio (`inscripcion_de_clase`).

### B.3 — GRAVE · La misma persona podía tomar dos lugares de una clase

El `EXCLUDE` de `ed_citas` ignora las inscripciones a propósito (doce personas en
el mismo bloque es el producto). Efecto lateral: nada impedía que **la misma
persona** ocupara dos lugares. Dos toques seguidos con mala señal y una clase de
ocho quedaba con siete personas y un fantasma.

**Corregido**: comprobación antes de inscribir (cubre el caso real, el dedo
nervioso) + índice único parcial en la migración 307 (cierra la carrera exacta en
la base) + traducción del 23505 a "ya estás inscrito".

### B.4 — La hora se ofrecía tantas veces como profesionales libres hubiera

Con tres profesionales libres a las 15:00, la página mostraba **15:00, 15:00 y
15:00**. Al cliente no le importa con quién: le importa a qué hora. Se veía roto
y hacía dudar de si el negocio funcionaba.

### B.5 — El calendario mostraba el mes casi vacío

El cálculo se cortaba en 120 cupos. Con tres profesionales y horas de 45 min, 120
cupos son **dos días**. El resto del mes aparecía sin horas aunque estuviera
entero libre.

### B.6 — Crear una cita a mano podía fallar en silencio

`crearCitaManual` no devolvía nada. Si la base rechazaba por solape, el panel se
cerraba igual y el dueño se quedaba creyendo que la cita existía.

### B.7 — El enlace de autogestión no vencía nunca

`gestion_token` no caducaba: un enlace de una cita de hace dos años seguía
abriendo la ficha con el nombre y el servicio de esa persona. Ahora vive hasta
**24 h después del término** de la cita.

### B.8 — La configuración era una sola pantalla de 700 líneas

Servicios, profesionales, horarios, bloqueos, reserva online, autogestión y
Google, todo apilado con diez formularios. Para cambiar un horario había que
bajar por todo lo demás.

---

## C. El motor canónico: un solo lugar donde se decide qué hora existe

Ahora hay **una** función de disponibilidad (`lib/agenda.ts` → `disponibilidad()`)
y todo el mundo la usa: la página pública, el portal, Tino y la autogestión del
cliente. Antes cada uno resolvía a su manera; ahora la única diferencia entre
ellos son los **parámetros**, no la lógica.

```
disponibilidad(clienteId, servicioId, {
  desdeDia, dias,          // el rango lo pide quien llama (un día, un mes)
  profesionalId,           // null = «cualquiera»
  maxPorDia,               // 1 para pintar el calendario, 60 para las horas
  soloPrimeroPorDia,       // ¿solo saber si el día abre?
  incluirNoVerificables,   // solo el portal, y avisando
}) → { ok, servicio, slots, profesionales, noVerificables, carga }
```

Un `slot` ya no es "hora + profesional", es **hora + quiénes pueden tomarla**:

```ts
type Slot = { inicio, fin, profesionalId, profesionales: string[] }
```

Ese cambio de forma es el que resuelve B.4 sin trucos de presentación: la hora
única existe en el dato, no en la pantalla.

**Número de consultas constante.** Pedir un día o pedir treinta cuesta lo mismo:
9 consultas (servicio · config · mapeo · profesionales · horarios · bloqueos ·
citas · clases · Google). Hay una prueba que falla si alguien agrega la décima.

---

## D. Multiprofesional y «Cualquiera»

- Si el negocio tiene **un** profesional, el selector **no se muestra**. Una
  peluquería de una persona no debería ver una pregunta que tiene una sola
  respuesta.
- Con dos o más, la opción por defecto es **«Cualquiera · más horas»**, y se dice
  por qué: con cualquiera hay más horas disponibles. Es verdad y ayuda a elegir.
- Elegir a alguien concreto filtra a sus horas. Volver a «Cualquiera» las suma.
- La hora aparece **una vez**, siempre.

---

## E. Asignación del profesional: en el servidor, y revisada al confirmar

El navegador nunca decide quién atiende. Manda "esta hora" (y, si la pidió,
"con esta persona") y el servidor:

1. **Revalida el día completo** en ese instante. La disponibilidad que el cliente
   vio puede tener dos minutos y en dos minutos pasan cosas.
2. Elige con `elegirProfesional()`, que es **determinista**: menos citas ese día →
   menos citas en total → orden estable por id. Sin azar: dos peticiones idénticas
   dan el mismo resultado, y el trabajo se reparte en vez de caer siempre sobre el
   primero de la lista.
3. Si al escribir choca con el `EXCLUDE` (código 23P01, alguien ganó por
   milisegundos), **reintenta con el siguiente candidato** en vez de rendirse.
4. Si pidieron a alguien concreto, **no se sustituye por otro a sus espaldas**.
   Se dice que esa persona ya no tiene esa hora y se ofrecen alternativas.

Dos pruebas fijan esto: dos clientes confirmando la misma hora terminan con
profesionales distintos, y cuando ya no queda nadie el segundo recibe
`cupo_tomado` **con alternativas cercanas**, no un error seco.

---

## F. Google Calendar

Se conservó la arquitectura viva (`freeBusy` al momento, dos modos: cuenta de
servicio en lote y OAuth por profesional). Lo que cambió es qué pasa **cuando no
se puede comprobar**:

| Situación | Antes | Ahora |
|---|---|---|
| Token ilegible / refresh falla | se ofrecía el día entero | profesional no verificable → sus horas no se ofrecen |
| `freeBusy` responde error para un calendario | se ofrecía el día entero | ese profesional queda fuera |
| Faltan las credenciales de la plataforma | se ofrecía el día entero | todos los sincronizados quedan fuera |
| Profesional sin `gcal_id` pero con sync activo | se ofrecía el día entero | queda fuera |
| Google responde bien | ocupados reales | igual |

El dueño se entera de tres maneras, en orden de cercanía: un aviso en la pantalla
de la agenda con el nombre de quién y un enlace directo a reconectar; el estado en
Configuración → Google Calendar, **antes** del botón de conectar y no debajo en
letra chica; y la frase que explica la consecuencia sin rodeos —"mientras no
podamos leer su calendario no ofrecemos sus horas, ni en tu página pública ni por
WhatsApp: preferimos ofrecer menos horas antes que dar una que ya está tomada".

---

## G. Servicios, profesionales y horarios

- **Configuración partida en seis secciones** con enlace propio
  (`/agenda/configuracion?s=horarios`), navegables por chips. Una cosa a la vez.
  El enlace propio además sirve para mandar a alguien justo ahí, que es lo que
  hace el aviso de Google.
- El horario de un profesional **apagado** va plegado, con un resumen
  ("12 h · lu, mi, vi"): no ofrece ni una hora, así que su grilla de siete días
  solo estiraba la pantalla. Plegado, nunca escondido.
- **«Se puede reservar hasta» es configuración del negocio**, en Reserva online:
  14, 30, 60 o 90 días, con 30 por defecto. Antes era un campo numérico libre
  rotulado «Horizonte (días)», que ni se entendía ni se tocaba. El tope de 90
  sigue aplicándose en el servidor, que es donde importa; si un negocio ya tenía
  guardado otro número, se agrega a la lista para no cambiarle la configuración
  por la espalda.
- Un profesional **sin horario** lo dice en su propia tarjeta: *"sin horario no
  hay cupos que ofrecer"*. Es la causa número uno de "mi página no muestra horas".
- Servicios y profesionales que ya tienen citas **no se pueden borrar**, solo
  apagar (se conserva el historial). Los que no, sí.

---

## H. La reserva pública

Flujo nuevo: **servicio → con quién → día → hora → tus datos**. Cuatro decisiones,
en el orden en que las piensa una persona.

- Calendario de mes real (no "los próximos 120 cupos"), con los días que tienen
  horas marcados y los que no, apagados y no tocables.
- Horas agrupadas en **Mañana / Tarde / Noche**. Una lista de 30 botones iguales
  no se lee; tres grupos sí.
- Celda de día y botón de hora de **44 px**, flechas de mes de **40 px**.
- Resumen lateral pegajoso en escritorio; en celular, una línea compacta que
  aparece recién cuando ya hay hora elegida (una tarjeta de resumen empujaba el
  flujo fuera de la pantalla).
- **Sin cuenta.** Nombre y WhatsApp. Nada más.
- Confirmación que dice con quién quedó, cuándo, cuánto dura y cuánto vale, más
  el enlace para moverla o anularla.

---

## I. La agenda del portal

Pasó de pantalla de configuración a **pantalla de trabajo**:

- Vista por defecto **Lista** ("qué me toca ahora"), con Día y Semana a un clic.
- Panel lateral de la cita con las acciones reales en orden de uso: confirmar,
  escribir por WhatsApp, mover, ya vino / no llegó, cancelar.
- **Mover a otra hora** desde el mismo panel, con selector de profesional.
- Aviso de calendarios no verificables arriba, con enlace a reconectar.
- Enlace profundo `?cita=<id>`: desde Conversaciones y desde Inicio se llega a la
  cita concreta, ya abierta.
- Cuando el tramo visible está vacío pero hay horas más adelante, se dice cuál es
  la próxima en vez de mostrar una grilla en blanco.
- El velo del panel es más claro en pantalla grande: mientras se confirma una
  hora, lo normal es seguir mirando el resto del día.

---

## J. Mover y anular (el cliente, solo)

**Una sola regla de disponibilidad.** El enlace de gestión no tiene plazos
propios: usa exactamente el mismo motor y el mismo `horizonte_dias` que la página
pública. Había una constante de 21 días inventada por mí; se eliminó. Si el
negocio abre 60 días, el cliente puede mover dentro de esos 60; si abre 14,
dentro de 14. Un solo lugar donde cambiarlo.

Al mover se respetan, sin excepción: anticipación mínima, disponibilidad real,
servicio, profesional, bloqueos, Google y el resto de las reglas canónicas.

- **Se mantiene el mismo profesional.** Quien reservó con Marcela espera seguir
  con Marcela; cambiar de persona se hace desde el portal.
- **El enlace muere 24 h después del término de la cita.** Se cuenta desde el
  fin y no desde el inicio: un taller de tres horas dejaría a la persona sin
  enlace mientras todavía está dentro. Un día alcanza para abrirlo a la mañana
  siguiente —«¿a qué hora era?», «¿cuánto salió?»— y no tanto como para que un
  enlace reenviado por WhatsApp muestre los datos de alguien meses después.
- **Vencido y mal escrito muestran lo mismo.** Distinguirlos sería más amable,
  pero confirmaría que ese token existió y quien tantea enlaces sabría cuándo
  acertó. El texto dice la regla —«los enlaces dejan de funcionar el día después
  de la hora»— que es cierta en los dos casos y no afirma nada sobre este token
  en particular.
- **Las inscripciones a clase no se mueven** (la clase es a una hora fija). Se
  puede anular e inscribirse en otra.
- Anular libera el cupo **al instante** y se lo dice a la persona.

## K. Recordatorios y Vera

No se encendió nada nuevo. Lo que se hizo es que **sigan siendo coherentes**:
mover una cita desde el portal **reprograma** sus avisos (antes quedaban apuntando
a la hora vieja: el recordatorio llegaba el día equivocado), y reabrir una cita
cancelada también. Vera sigue con su mismo disparador de postventa.

**Verificado para el cambio de vigencia del enlace:** de los tres mensajes que
programa una cita, solo dos llevan el enlace de gestión —confirmación T−24 h y
recordatorio T−3 h—, y ambos son **anteriores** a la hora. La encuesta de Vera
sale a T+2 h del término y sus parámetros son nombre y negocio, sin enlace. Por
eso acortar la vigencia a 24 h después del término no la toca. Si algún día la
encuesta necesitara el enlace, hay que revisar este número.

---

## L. El resto del portal

- **Conversaciones** (ficha lateral): la cita del chat lleva a `/agenda?cita=…`,
  con el texto "Ver o mover la hora →". Antes decía "ver cita" y no llevaba a
  ninguna parte útil.
- **Inicio**: las citas solo aparecen cuando hay algo que **hacer** con ellas, y el
  enlace abre la cita concreta. Nada de listas informativas que no piden acción.
- **Tino** usa el mismo motor, con topes propios (14 días, 3 horas por día, 24
  cupos: lo que cabe en un mensaje de WhatsApp sin marear). Entiende "con
  Marcela" —y lo respeta— y entiende "me da lo mismo". Cuando ofrece una hora que
  varios pueden tomar, lo dice: "(con Marcela o Camila)".

---

## M. Seguridad

- Todo lo de Fase 0 sigue: cada consulta del motor filtra por `cliente_id`. Hay
  una prueba de que mover una cita al profesional **de otro negocio** se rechaza.
- La disponibilidad pública valida que el servicio sea un UUID, limita a 60
  peticiones por minuto por IP y expone **solo** nombre, duración, precio y los
  nombres de los profesionales. Nada más del negocio viaja.
- No se puede reservar una hora que el servidor no ofreció: confirmar las 03:00
  se rechaza aunque se pida a mano.
- El `gestion_token` sigue siendo aleatorio de 18 bytes y ahora, además, **vence
  24 h después del término de la cita**. Pasado eso, la página muestra un aviso
  sin nombre, servicio, profesional, precio ni negocio.
- **Migración nueva: `sql/307_agenda_fase2.sql`** (única de esta fase). Un índice
  único parcial que impide dos inscripciones vivas de la misma persona en la misma
  clase. Es **opcional**: sin ella el portal funciona igual, solo queda con la
  protección de código. El archivo trae la consulta para revisar si hay
  duplicados antes de aplicarla.

---

## N. Rendimiento

- Consultas **constantes** por cálculo (9), independientes de cuántos días se
  pidan. Con prueba que lo fija.
- Nada de N+1: los nombres de los profesionales salen de consultas que ya se
  hacían, no de una por profesional.
- El calendario público pide **días** (un dato por día) y solo pide **horas** del
  día que se tocó. Antes traía 120 cupos completos para pintar una grilla.
- Google se consulta una vez por cálculo, en lote cuando es cuenta de servicio.

---

## O. Lo visual

Azul profundo + cian, la misma identidad de Fase 1, en cada superficie tocada.
Sin glassmorphism, sin degradados, sin sombras grandes, sin tarjetas dentro de
tarjetas dentro de tarjetas.

**La convergencia global (el índigo viejo).** El portal tenía ~90 usos de
`var(--indigo*)` repartidos en pantallas que esta fase no tocó. Cambiarlas a mano
era editar unos cuarenta archivos sin poder revisarlos todos. En vez de eso se
cambió el **valor** del token, conservando los nombres a propósito:

```css
--indigo: #1d3f8f;   /* el azul de la marca */
```

La convergencia es inmediata, reversible en una línea y verificable de un
vistazo. De paso apareció un detalle que solo se ve con el cambio hecho: el hover
del botón primario seguía en `#443cd1`, así que el botón saltaba de azul a morado
al pasar el mouse. Corregido.

También se subió el contraste (9,7:1 sobre blanco, antes 5,9:1) y se pasaron a
tokens los colores semánticos sueltos que quedaban en las pantallas tocadas
(`#B33A3A` → `var(--peligro)`, etc.).

**Blancos táctiles.** Con la raíz del portal en 13 px, `py-2` daba botones de
31 px: justo por debajo de lo que el pulgar acierta. Se puso un piso de 36 px en
`.btn` y 32 px en `.btn-chico`, y se arreglaron uno a uno los que quedaban
cortos (flechas de mes, días de la semana del horario, cerrar del panel). La
comprobación automática ya no encuentra ninguno por debajo de 32 px en las
pantallas de la agenda.

**Responsive.** Verificado a 320, 390 y 1280 px: ninguna de las pantallas de la
agenda desborda horizontalmente en ningún ancho.

---

## P. Pruebas

**725 en verde** (eran 704). Las 21 nuevas están en `tests/agenda-fase2.test.mjs`:

- un cupo por HORA, no uno por profesional
- el rango lo pide quien llama: día, tope por día y «solo si hay algo»
- asignación determinista: menos citas ese día, luego menos en total, luego orden estable
- nombre del profesional pedido por WhatsApp → id real, sin inventar
- rangos públicos: mes y día
- «cualquiera»: horas únicas; con profesional elegido, solo las suyas
- una cita ocupa solo a su profesional, y la hora sigue ofreciéndose por el otro
- **si no podemos comprobar el Google de un profesional, sus horas NO se ofrecen**
- reservar «cualquiera» asigna al de menos carga y respeta al pedido
- **dos clientes confirman la misma hora: uno gana, el otro se va con el segundo profesional**
- pedir a una persona concreta no se sustituye por otra a sus espaldas
- no se puede reservar una hora que el servidor no ofreció (madrugada, fuera de horario)
- mover una hora puede cambiar de profesional, y el de otro negocio se rechaza
- una inscripción a clase no se mueve de hora
- el día chileno de un instante no se corre con el cambio de hora
- una clase programada ocupa al profesional aunque no tenga inscritos
- el número de consultas no crece con los días pedidos
- **el enlace de gestión muere 24 h después del TÉRMINO de la cita**
- una sesión larga no mata su propio enlace antes de terminar
- mover por el enlace usa el horizonte del negocio, no un plazo propio
- si la base rechaza la inscripción duplicada, se dice «ya estás inscrito»

Además, la base de pruebas en memoria (`tests/_baseMemoria.mjs`) ahora **emula el
`EXCLUDE` de `ed_citas`**: devuelve el 23P01 real de Postgres. Sin eso, la prueba
de los dos clientes simultáneos habría pasado sin probar nada.

`tests/agenda-google-estado.test.mjs` fue reescrito: la versión anterior
**afirmaba el comportamiento inseguro** (que un fallo de Google dejara pasar las
horas). Esa prueba estaba fijando el error B.1.

---

## Q. Capturas

Render de los componentes reales con datos ficticios y captura en Chromium, a
1280/1440 px y a 390 px. Se hicieron **dos pasadas completas** de
captura → inspección → corrección → nueva captura. Lo que encontró cada una:

**Primera pasada (corregido):** la columna de horas se derrumbaba cuando la
tarjeta se partía en dos columnas (46 px de botón solapándose) → calendario y
horas siempre apilados; la tarjeta de resumen en celular empujaba el flujo fuera
de la pantalla → una línea compacta que aparece recién al elegir hora; el bloque
de error quedaba debajo del calendario, o sea invisible → subió arriba del día y
la hora; el recuadro de "hoy" se pintaba también en días sin horas, y se leía
como "este sí, toca aquí" → solo en días con cupo.

**Segunda pasada (corregido):** flechas de mes de 29 px → 40 px; días de la
semana del horario de 26 px → 36 px; velo del panel de la agenda al 35 % dejaba
la lista ilegible en escritorio → 18 %; en la tarjeta de Google el botón azul de
conectar era lo más visible y el aviso de que Google no responde iba abajo en
letra chica → el estado va primero, con el motivo y la consecuencia; la hora se
escribía "15:00 h" (unidad que no se usa así en Chile) → "15:00"; el resumen
decía "falta elegir el día y la hora" cuando el día ya estaba elegido; el
horario de un profesional apagado ocupaba 900 px de "cerrado" en gris → plegado
con resumen.

Archivos en `docs/capturas/fase2/`:

| Archivo | Qué muestra |
|---|---|
| `reserva_publica_antes.png` | la reserva vieja: la misma hora repetida por profesional |
| `reserva_publica.png` | la nueva, en escritorio |
| `reserva_publica_movil.png` | la nueva, a 390 px |
| `reserva_hora_ocupada.png` | "ese horario acaba de ocuparse" + alternativas |
| `reserva_confirmada.png` | confirmación con profesional asignado y enlace de gestión |
| `gestion_cita_movil.png` | el cliente moviendo su hora, sin cuenta |
| `agenda_portal.png` | agenda del portal con el panel de la cita abierto |
| `agenda_portal_movil.png` | el mismo panel a 390 px |
| `config_servicios.png` | configuración, sección Servicios |
| `config_profesionales.png` | sección Profesionales y horarios |
| `config_google.png` | sección Google Calendar, con un calendario caído |
| `config_reserva_online.png` | sección Reserva online, con el nuevo «Se puede reservar hasta» |
| `config_servicios_movil.png` | configuración a 390 px |
| `inicio_escritorio.png`, `inicio_escritorio_antiguos.png`, `inicio_movil.png`, `ficha_lateral.png`, `embudo_tarjetas.png` | pantallas de Fase 1, para verificar que el cambio de token de índigo no las rompió |

---

## R. Archivos

Detalle completo en `docs/FASE2_ARCHIVOS.txt`.

**Nuevos**
- `components/agenda/piezas.tsx` — selector de profesional, calendario de mes y
  botonera de horas, compartidos por la reserva pública y la autogestión.
- `tests/agenda-fase2.test.mjs` — las 19 pruebas.
- `sql/307_agenda_fase2.sql` — índice único de inscripciones (opcional).
- `docs/FASE2_AGENDA_SEP2026.md`, `docs/FASE2_ARCHIVOS.txt`, `docs/capturas/fase2/`.

**El motor**
- `lib/agenda.ts` — disponibilidad canónica, `reservarCupo`, `alternativasCercanas`,
  reagendar con cambio de profesional, clases como bloqueo.
- `lib/agendaCore.ts` — `Slot` con lista de profesionales, `elegirProfesional`, `diaChileDe`.
- `lib/agendaGoogle.ts` — fail-closed y reporte de no verificables.
- `lib/agendaBot.ts` — Tino sobre el mismo motor.
- `lib/autogestionDatos.ts`, `lib/clases.ts`, `lib/reservasPublicas.ts`.

**Pantallas**
- `components/ReservaPublica.tsx` (reescrita), `components/GestionCita.tsx`,
  `components/CalendarioAgenda.tsx`, `components/NuevaCita.tsx`,
  `components/HorarioSemanal.tsx`, `components/FichaServicioConfig.tsx`,
  `components/ReservaClases.tsx`.
- `app/(portal)/agenda/page.tsx`, `app/(portal)/agenda/configuracion/page.tsx`,
  `app/(portal)/agenda/acciones.ts`, `app/reservar/[slug]/page.tsx`,
  `app/cita/[token]/page.tsx`.
- `app/api/reservas/route.ts`, `app/api/reservas/disponibilidad/route.ts`,
  `app/api/reservas/clase/route.ts`.
- `components/inbox/FichaLateral.tsx`, `components/inicio/NecesitaAtencion.tsx`.
- `app/globals.css`.

---

## S. Lo que NO se hizo (a propósito)

- **No se hizo commit, push ni deploy.** Queda listo para `npm run check`.
- **No se encendió nada apagado.** Beto sigue apagado; Vera, igual que antes.
- **No se envió ningún mensaje** a ningún cliente real.
- **No se revirtió** ninguna decisión de Fase 0 ni de Fase 1.
- **No se creó un sistema de reservas de empresa.** Nada de listas de espera,
  recursos compartidos, reglas de precios por horario, ni pagos anticipados. Es
  una agenda de pyme.
- **No se tocó** `lib/ads/*` ni el sitio de marketing.
- **No se renombraron** los tokens `--indigo*` (ver sección O: se cambió el valor,
  no el nombre, para no editar cuarenta archivos a ciegas).
- **No se borró `ed_metricas`** (confirmada como tabla zombi en la fase anterior:
  6 filas, nada la escribe). La limpieza de tablas va en su propia migración, sin
  mezclarla con la agenda.
- **No se puso el calendario dentro de «Nueva hora».** Evaluado y descartado para
  esta fase: la versión obvia le quitaría al dueño la posibilidad de agendar
  fuera de horario. El razonamiento y el diseño correcto están en la sección T.
- **No se avisa al dueño por WhatsApp** cuando Google lleva rato caído. Sería lo
  mejor, pero implica mandar mensajes y esta fase no manda nada.

---

## T. Riesgos y deuda que queda

1. **Fail-closed cuesta horas.** Si el Google de alguien se cae un lunes a las 9,
   sus horas dejan de ofrecerse hasta que se arregle. Es el criterio confirmado
   —mejor menos horas que una hora doble— pero el dueño tiene que **enterarse
   rápido**. Hoy se entera al entrar al portal. El aviso proactivo por WhatsApp
   queda como mejora posterior, fuera de esta fase por decisión suya.
2. **`reservarCupo` reintenta con el siguiente candidato, pero una sola vez por
   candidato.** Con cinco profesionales y cinco personas confirmando el mismo
   segundo, la quinta recibe alternativas en vez de la hora. Es aceptable y
   honesto; convertirlo en transacción única exigiría una función en la base.
3. **El calendario público muestra un mes a la vez.** Con el horizonte en 60 o 90
   días hay que navegar mes a mes con las flechas. Funciona, pero si algún negocio
   usa 90 en serio, vale la pena mirar cómo se siente.
4. **Los colores semánticos sueltos** (`#0E7C66`, `#B0842A`…) siguen en pantallas
   que esta fase no tocó. Convertirlos es una barrida de una tarde, sin riesgo,
   pero hay que revisar pantalla por pantalla.
5. **`ed_metricas` sigue ahí**, confirmada zombi. Se limpia en su propia fase, no
   mezclada con la agenda (decisión suya).

### Quick win #1 — el calendario dentro de «Nueva hora» (evaluado, NO hecho)

Lo evalué a fondo antes de tocarlo y **la respuesta es que no es trivial, y que
la versión obvia sería un retroceso**:

`crearCitaManual` es deliberadamente **más permisiva** que la reserva pública. El
dueño puede agendar fuera de horario, en un día bloqueado o con un profesional
que ese día no atiende — porque alguien llama y dice «¿me puedes atender a las
8?». Si le pongo el calendario canónico y solo puede elegir cupos ofrecidos, le
quito esa capacidad. No es una inconsistencia que arreglar: es una diferencia
a propósito.

Lo correcto es un **híbrido**, y por eso es un trabajo y no un cambio de dos
líneas:

- las horas que el motor sí ofrece, como botones (el caso normal, un toque);
- el campo libre de fecha y hora debajo, rotulado como la excepción;
- y un aviso —no un bloqueo— cuando el instante elegido a mano choca con algo:
  «Marcela ya tiene una hora ahí», «ese día está bloqueado», «no podemos
  comprobar su Google».

Eso necesita una vía para preguntar disponibilidad desde el portal, que hoy no
existe: el endpoint público pide slug y aplica las reglas públicas. Es una acción
de servidor chica, pero es alcance nuevo.

**Riesgo de no hacerlo: bajo.** El servidor ya valida el choque contra el
`EXCLUDE` de la base y desde esta fase el error se ve en pantalla en vez de
tragarse. Lo que falta es comodidad, no seguridad.

## U. Las seis decisiones (cerradas por Marcelo el 12-sep)

| # | Decisión | Estado en el código |
|---|---|---|
| 1 | Aplicar la migración 307 | **Ya aplicada por Marcelo** en Supabase. El archivo va en el repo para que código e historial cuenten lo mismo |
| 2 | Google fail-closed confirmado | Ya estaba así. **No se vuelve a fail-open** |
| 3 | Horizonte configurable por negocio (14/30/60/90, default 30, tope 90) | Hecho: selector en Reserva online |
| 4 | Autogestión sin plazos propios + enlace vivo 24 h tras el término | Hecho: se eliminó la constante de 21 días |
| 5 | Recorrido con datos reales | El recorrido LOCAL no se hizo (`localhost:3000` nunca estuvo arriba). Se reemplazó por el smoke test del entorno desplegado, sección W |
| 6 | No borrar `ed_metricas` en esta fase | No se tocó |

Detalle de las dos que cambiaron código:

**3 · Horizonte.** `horizonte_dias` ya existía por negocio y el motor ya lo
respetaba; lo que faltaba era poder tocarlo. Agenda → Configuración → Reserva
online ahora tiene «Se puede reservar hasta: 14 / 30 / 60 / 90 días». El tope de
90 y el piso de 1 se aplican en la acción del servidor, que no confía en el
formulario. Un negocio con otro valor guardado lo conserva.

**4 · Autogestión.** `DIAS_REAGENDAR = 21` eliminada: `cuposParaReagendar` ya no
pasa `dias` y el motor aplica el horizonte del negocio. `DIAS_VIGENCIA_ENLACE =
30` reemplazada por `HORAS_VIGENCIA_TRAS_FIN = 24`, contada desde `fin` (con la
duración del servicio como respaldo si `fin` viniera nulo, para no matar el
enlace de alguien por un dato faltante).

---

## V. Cómo se validó

No existe `node_modules` en el entorno donde trabajo ni acceso al registro de npm
(política de la organización), así que **`npm run check` tal cual no se pudo
correr acá**. Se corrió su equivalente pieza por pieza, y la parte que falta la
corre Vercel en el build:

| Paso de `npm run check` | Cómo se validó |
|---|---|
| `npm test` | Corrido con el mismo runner de node y stubs de `@supabase/supabase-js`, `web-push` y `react`: **725 de 725 en verde** |
| `npm run typecheck` | `tsc --noEmit` sobre `app/`, `lib/` y `components/`, comparado contra la misma corrida en un worktree de `origin/main` 20c40bb: **0 errores nuevos**, y uno viejo menos |
| `npm run lint` | No se pudo (eslint vive en `node_modules`). Lo corre Vercel |
| `npm run build` | No se pudo. Lo corre Vercel en el deploy |

Esto se dice explícitamente porque la diferencia importa: si algo se rompe, se
rompe en el build de Vercel, no en una prueba que se saltó en silencio.


---

## W. Cierre de la fase

### Revisión adversarial final (antes del commit)

Última pasada buscando regresiones graves, no rediseño. Los veinte puntos, con
dónde se comprueba cada uno:

| Qué | Estado | Dónde se ve |
|---|---|---|
| Google sigue fail-closed | ✅ | `lib/agenda.ts` → `ofrecibles` excluye `noVerificables`; prueba «si no podemos comprobar el Google…» |
| Una hora se muestra una vez | ✅ | `porInicio: Map<number, string[]>` en `agendaCore.ts`; prueba «un cupo por HORA» |
| «Cualquiera» se asigna en el servidor | ✅ | `reservarCupo` → `elegirProfesional`; el navegador solo manda el instante |
| Profesional específico se respeta | ✅ | Prueba «pedir a una persona concreta no se sustituye» |
| Doble reserva protegida | ✅ | `EXCLUDE` + traducción de 23P01 + reintento; prueba de dos clientes simultáneos |
| La 307 coincide con la guarda de código | ✅ | Ambas sobre `(clase_id, chat_id)` y los mismos tres estados vivos. El endpoint público fija `chatId = telefono`, así que la columna nunca queda nula por ese camino |
| Mover puede cambiar de profesional | ✅ | `reagendar(..., {profesionalId})`, validando `cliente_id` del profesional nuevo |
| Las clases no se mueven como cita | ✅ | Motivo `inscripcion_de_clase` en motor, autogestión y portal |
| Recordatorios se reprograman al mover | ✅ | `reprogramarAvisos` en el portal; anular + programar en `reagendarPorToken` |
| Cancelar limpia lo que corresponde | ✅ | `cambiarEstadoCita` llama `anularSeguimientosDeCita` en `cancelada` y `no_show`, acotado al negocio |
| Vera no se dispara sobre canceladas | ✅ | Su encuesta es un seguimiento pendiente y se anula con lo anterior |
| Horizonte validado en el servidor | ✅ | `Math.max(1, Math.min(90, …))` en `configurarReservas`; el formulario no decide |
| Valor histórico fuera de los presets se conserva | ✅ | `opcionesHorizonte` incluye el valor guardado |
| Autogestión usa el horizonte del negocio | ✅ | `cuposParaReagendar` ya no pasa `dias`; prueba dedicada |
| El token vence 24 h tras el término | ✅ | `HORAS_VIGENCIA_TRAS_FIN`, contado desde `fin`; dos pruebas |
| Inválido y vencido dicen lo mismo | ✅ | Una sola rama en `app/cita/[token]/page.tsx` |
| Aislamiento entre negocios | ✅ | 14 filtros por `cliente_id` en el motor; prueba del profesional de otro negocio |
| La disponibilidad pública no filtra datos internos | ✅ | Solo nombre, duración, precio y nombres de profesionales. `noVerificables` **no** viaja: el público no se entera de quién tiene Google caído |
| Tino sigue en el motor canónico | ✅ | `agendaBot.ts` importa `disponibilidad` y `reservarCupo` de `lib/agenda` |

### Migración 307

**Aplicada por Marcelo en Supabase** antes de este cierre. El archivo
`sql/307_agenda_fase2.sql` entra al repositorio para que el código y el historial
de la base cuenten la misma historia. No se volvió a ejecutar nada contra la base.

### Recorrido local

No se hizo: `localhost:3000` nunca estuvo arriba. Por decisión suya no bloquea la
integración, y en su lugar va el smoke test del entorno desplegado. Lo que un
recorrido local aportaría y esto no: probar una reserva de punta a punta con
datos sembrados y ver los mensajes de WhatsApp sin enviarlos. Sigue valiendo la
pena algún día, pero como prueba de humo, no como requisito.

### Commit, push y deploy ✅

- **Commit:** `87daaca` en `main`.
- **Push:** hecho por Marcelo el 12-sep (el proxy de mi sesión no tiene
  credencial de escritura para este repo; se lo dejé en tres comandos).
- **Deploy:** Vercel, **Ready en 32 s**, Production. Sin errores de build.
- **El árbol desplegado es exactamente el que validé**: `git diff` entre mi
  commit local y `origin/main` no muestra ni una línea de código distinta (solo
  las instrucciones de push de este documento —ya obsoletas— y las PNG
  recodificadas por el puente).

### Smoke test de producción (12-sep)

Solo lectura. No se creó, movió ni anuló ninguna cita, no se envió ningún
WhatsApp y no se tocó la configuración de ningún profesional.

| Qué | Resultado |
|---|---|
| `/agenda` | ✅ carga. Vista **Lista** por defecto, con Día y Semana |
| `/agenda/configuracion?s=servicios` | ✅ las seis secciones, una a la vez |
| `?s=profesionales` | ✅ grilla semanal, blancos táctiles nuevos |
| `?s=reservas` | ✅ **«Se puede reservar hasta: 14 / 30 / 60 / 90 días»** |
| `?s=google` | ✅ el estado va primero («Marcelo · conectado») y el botón dice «Reconectar con Google» por estar ya configurado |
| `/inicio` | ✅ carga con datos reales; los grupos de Fase 1 intactos tras el cambio de token |
| `/conversaciones` | ✅ carga, 48 conversaciones |
| Errores de JS | ✅ ninguno en ninguna pantalla |

**Lo que NO se pudo validar en producción, y por qué:** los dos comportamientos
que más importan —dos profesionales libres a la misma hora ofreciendo **una sola**
hora, y un Google no verificable **escondiendo** las horas de esa persona— necesitan
al menos dos profesionales y un servicio activo. El negocio tiene un profesional y
un servicio apagado. Sembrar datos habría sido alterar la configuración real, que
estaba prohibido. Ambos quedan cubiertos por pruebas automáticas y por el arnés
visual; lo que falta es verlos con datos de verdad.

---

## Y. Dos cosas que apareció el smoke test (ninguna es de Fase 2)

### Y.1 — La página pública de reservas responde «Esta página no existe»

`https://respondo-portal.vercel.app/reservar/marcelo-coach` muestra «Esta página
no existe», mientras el portal dice que la página pública está **activa** y ofrece
el enlace para compartir.

La causa está en `app/reservar/[slug]/page.tsx`:

```ts
if (!servicios || servicios.length === 0) notFound();
```

El negocio tiene un solo servicio y está **apagado**, así que la lista de servicios
activos viene vacía y la página se declara inexistente. Viene de la migración
original del módulo de agenda (`14b20d5`), no de esta fase: el diff de Fase 2 sobre
ese archivo es puramente visual.

**Por qué importa:** el dueño ve «activa» y un enlace para poner en Instagram; quien
lo abre ve un 404. Es de las peores formas de fallar, porque nadie se entera.

**Arreglo propuesto (chico):** en vez de `notFound()`, una pantalla que diga la
verdad —«Este negocio no está tomando reservas online por ahora»— y, en el portal,
que la insignia diga «activa, pero sin servicios encendidos» cuando no hay ninguno.

### Y.2 — Un error transitorio de base de datos expulsa al dueño con un mensaje falso

Durante el recorrido, una navegación cayó en `/sin-acceso`: «Tu correo aún no está
habilitado… ese correo todavía no está asociado a ningún negocio». La navegación
siguiente funcionó sin tocar nada, así que fue un fallo momentáneo de la consulta.

`lib/auth.ts`:

```ts
const { data, error } = await db().from("portal_usuarios")...
if (error || !data) return null;
```

Un **error** de la consulta y un **usuario que no existe** terminan en el mismo
lugar. Fallar cerrado está bien; el problema es el mensaje: al dueño se le dice que
su cuenta no está habilitada y se le invita a «entrar con otro correo». Viene del
primer commit del portal (`eae0cfb`).

**Arreglo propuesto (chico):** separar las dos ramas. `error` → «no pudimos
verificar tu acceso, reintenta» y un log. `!data` → el mensaje actual. Sin cambiar
nada de la autorización.

---

## Z. Qué queda

**Nada que bloquee Fase 2.** Está commiteada, desplegada y con smoke hecho.

De esta fase, para cuando haya tiempo, por orden de valor:

1. **Y.1 — la página pública que dice «no existe».** Es el más urgente de los dos,
   porque hoy hay un enlace roto que el portal presenta como activo.
2. **Y.2 — el `/sin-acceso` por error transitorio.** Mensaje, no seguridad.
3. **Quick win #1 — el calendario dentro de «Nueva hora»** (sección T): híbrido,
   horas sugeridas + campo libre + aviso, nunca bloqueo.
4. **Ver los dos casos clave con datos reales.** Dos profesionales a la misma hora
   → una sola hora ofrecida; Google no verificable → horas escondidas. Necesita un
   negocio de prueba con dos profesionales y un servicio encendido.

Fuera de Fase 2, lo que sigue esperando (según los informes de sus fases):
migraciones **297**, **305** y **306**, escritas y sin aplicar. La **305** es la de
autorización fail-closed y tiene fecha: la firma vieja muere el **30 de septiembre**.
