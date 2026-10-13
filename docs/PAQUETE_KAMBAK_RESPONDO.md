# Paquete Único: Kambak + Respondo (Agenda, WhatsApp IA, Beto, Vera y Sellos)

> **Fecha de auditoría:** Octubre 2026  
> **Alcance:** Auditoría contra código real de `respondo-portal` y `sello-fidelizacion` (`kambak`), más análisis competitivo contra **AgendaPro** (barberías) y **Riservi** (`widget.riservi.com`, restaurantes).  
> **Misión estratégica:** Sumarle a los rubros de Kambak (**Barberías, Restaurantes y Cafeterías**) todo el poder de Respondo (**Agenda web + Reservas por WhatsApp con Tino + Reactivación con Beto + Encuestas/Reseñas con Vera + Reportes con Isabel**) para:
> 1. Entrar a barberías que usan AgendaPro y **quitárselas por completo** dándoles agenda + WhatsApp IA + comisiones + fidelización con sellos en un solo lugar.
> 2. Entrar a restaurantes que usan links tipo Riservi (o anotan por WhatsApp a mano) y darles **link de reserva de mesas + reserva automática por WhatsApp + sellos NFC/Wallet + reseñas Google**.
> 3. **Subir el valor y el ticket de los planes altos de Kambak** (`Pro` y `Pro IA` / `Full Agenda + IA`) en `kambak.cl`.  
> **Regla de precios:** Todos los valores están expresados en **pesos chilenos NETOS (+ IVA)**. Costos de terceros (Meta) se marcan explícitamente para verificar en la fuente oficial vigente.

---

## 1. Qué ya existe hoy en código (y por qué antes no salía para Barberías/Restaurantes)

Antes Respondo apuntaba a talleres de motos, clínicas e inmobiliarias. Por eso el motor está construido, pero configurado para esos rubros. Esto es lo que encontramos en el código real:

### A. Agenda y Reservas (`respondo-portal`)
1. **Doble reserva imposible y multi-profesional (`sql/220_agenda.sql`, `sql/308_agenda_atomic_bloqueos.sql`):**
   - Servicios con duración (`duracion_min`), precio (`precio_clp`), tiempo de preparación entre clientes (`buffer_min`), profesionales con sus propios horarios, bloqueos de almuerzo/feriados, asignación automática al barbero con menos carga (*"Cualquiera disponible"*) y sincronización con Google Calendar.
2. **Reservas por dos vías simultáneas:**
   - **Por link web (`/reservar/[slug]`):** Igual de rápido que AgendaPro o el widget de Riservi, ideal para la bio de Instagram o un QR.
   - **Por WhatsApp conversando con Tino (`lib/agendaBot.ts`):** El cliente escribe *"¿Tienes hora mañana a las 6 para corte y barba?"* y Tino revisa la agenda en vivo y lo deja reservado sin que el barbero suelte la tijera.
3. **Confirmación, recordatorio y enlace de autogestión (`/cita/[token]`):**
   - Programa confirmación 24h antes (`cita_confirmacion`) y recordatorio 3h antes (`cita_recordatorio`). Si el cliente responde *"SÍ"* en WhatsApp, la cita pasa sola a `confirmada`.
4. **Por qué no aparecía en Barberías ni Restaurantes (Hallazgo #1):**
   - En `lib/plantillas.ts` (línea 80), la constante `CON_AGENDA` tenía solo `["estetica", "dental", "salud", "nutricion", "taller", "motos", "inmobiliaria"]`. Faltaba agregar `"barberia"` y `"restaurante"`, además de sus plantillas de inicio rápido en `lib/plantillasRubro.ts`.

### B. Vera (Postventa, Encuestas 1–5 y Reseñas en Google)
1. **Ya funciona al 100% con la agenda (`lib/agendaSeguimientos.ts` + `lib/agendaBot.ts`):**
   - 2 horas después de terminar la cita (corte de pelo o reserva de restaurante), Vera manda por WhatsApp una encuesta rápida de **1 a 5** (`encuesta_postventa`).
   - Cuando el cliente responde con un número del 1 al 5 (`encuestaRapida` en `lib/agendaBot.ts`):
     - La cita se marca sola como **`completada`**.
     - **Si responde 4 o 5:** Vera le agradece y le manda directo el link de **Google Maps (`google_maps_url`)** para que deje las 5 estrellas.
     - **Si responde 1, 2 o 3:** Vera contiene al cliente en privado y registra una alerta (`cliente_molesto`) para que el dueño lo sepa antes de que ponga un reclamo público.

### C. Beto (Seguimiento y Reactivación de clientes) — ¡Hallazgo clave en código!
1. **Qué hace Beto hoy en `respondo-portal` (`lib/generadorSeguimientos.ts`):**
   - Revisa `ed_contactos.ultima_atencion` para avisarle por WhatsApp al cliente que ya le toca volver.
2. **Por qué hoy Beto NO funcionaba para Barberías ni Restaurantes (Hallazgos #2 y #3):**
   - **Hallazgo #2 (`lib/generadorSeguimientos.ts`, línea 161):** Beto quedó programado pensando en **talleres de motos**: exige que el contacto tenga `datos.vehiculo` (*"sin moto"*) y usa un intervalo por defecto de **6 meses** (`intervalo_mantencion_meses`). Si un cliente de barbería no tiene una "moto" guardada en su ficha, Beto lo salta y no le escribe nunca.
   - **Hallazgo #3 (`lib/agenda.ts`):** Cuando una cita pasa a `completada` en la agenda, **no estaba actualizando `ed_contactos.ultima_atencion`**.
3. **Cómo lo destrabamos con un cambio mínimo:**
   - Al marcar una cita como `completada`, actualizaremos automáticamente `ed_contactos.ultima_atencion = hoy` y guardaremos el último servicio en `ed_contactos.datos`.
   - En `lib/generadorSeguimientos.ts`, permitiremos que en barberías Beto use el ciclo de corte (ej. **25 a 30 días** desde su último corte) sin exigir `vehiculo`, enviando el recordatorio para que vuelva a agendar su corte; y en Kambak además ya existe la campaña/rescate de sellos (`sello_rescate` y `sello_premio_cerca`).

### D. Kambak (`sello-fidelizacion`)
1. **Tarjeta de sellos en Apple Wallet y Google Wallet + Stickers NFC (`api/index.js`, `lib/respondo.js`):**
   - Suma sellos, gestiona premios, cumpleaños, referidos, carta digital NFC y ya recibe webhooks firmados desde Respondo en `POST /api/hooks/respondo` (`lib/routes-respondo.js`) e indexa clientes por celular en `locals/{slug}/uniq/tel_9XXXXXXXX`.

---

## 2. Competencia 1 (Barberías): AgendaPro vs. Nosotros

### A. Precios actuales de AgendaPro en Chile (verificados, valores NETOS + IVA)
- **Plan Individual — \$15.900 + IVA / mes (1 profesional):** Agenda web, Marketplace y solo **50 avisos de WhatsApp al mes** (bolsas extra de 50 mensajes cuestan ~\$5.000 + IVA). Sin comisiones ni inventario.
- **Plan Básico — \$34.900 + IVA / mes (2 profesionales):** Suma **cálculo de comisiones** e **inventario**. Mantiene tope de 50 WhatsApp/mes.
- **Plan Premium — \$54.900 + IVA / mes (hasta 5 profesionales):** Suma **encuestas**, **fichas personalizables**, **giftcards básicas**, presupuestos y 100 WhatsApp/mes.
- **Plan Pro — \$249.900 + IVA / mes (hasta 10 profesionales):** Suma facturación electrónica, API, correos masivos y 200 WhatsApp/mes.

### B. Tabla: AgendaPro vs. Nosotros (verificado en nuestro código)

| Función | Plan en AgendaPro | ¿La tenemos hoy en código? | Qué falta para quitarle clientes a AgendaPro | Dificultad |
| :--- | :--- | :--- | :--- | :--- |
| **Tino: WhatsApp que agenda, reagenda y responde solo 24/7** | **No tienen** (solo avisos mudos) | **Sí, 100%** (`lib/agendaBot.ts`) | Nada. Es nuestro gancho letal: *"tu WhatsApp agenda solo"*. | **Listo** |
| **Agenda web `/reservar/[slug]` sin doble reserva + Google Calendar** | Individual (\$15.900) | **Sí, 100%** (`lib/agenda.ts`, `sql/220_agenda.sql`) | Agregar `"barberia"` a `CON_AGENDA` y datos demo. | **Muy baja** |
| **Confirmaciones y recordatorios por WhatsApp + link `/cita/[token]`** | Individual (solo 50/mes) | **Sí, 100%** (`lib/agendaSeguimientos.ts`) | Agregar confirmación inmediata al reservar por web. | **Baja** |
| **Vera: Encuesta post-corte (1–5) + reseñas en Google Maps** | Recién en Premium (\$54.900) | **Sí, 100%** (`lib/agendaBot.ts`) | Nada. Funciona sola 2h después del corte. | **Listo** |
| **Beto: Reactivación automática cuando pasa el tiempo sin cortarse** | **No tienen por WhatsApp IA** | **Parcial** (`lib/generadorSeguimientos.ts`) | Quitar la exigencia de `"moto"` en `generadorSeguimientos.ts` y actualizar `ultima_atencion` al cerrar cita. | **Baja** (~30 min) |
| **Preguntas personalizables al reservar** | Recién en Premium (\$54.900) | **Sí, 100%** (`lib/fichaServicio.ts`) | Nada para reservas. | **Listo** |
| **1. Ficha de cliente con historial de citas y notas** *(Prioridad #1)* | Individual / Premium | **Parcial** (`lib/clientes.ts`) | Mostrar la lista de citas de `ed_citas` (fecha, corte, barbero, estado) en `/clientes/[chatId]` y desde `/agenda`. | **Baja** (~40 min) |
| **2. Resumen diario al dueño por WhatsApp** *(Prioridad #2)* | En app / correo | **Parcial** (`lib/operationsSummary.ts`) | Enviar cada mañana al `whatsapp_negocio` las citas del día por barbero, confirmadas y por cerrar de ayer. | **Baja** (~40 min) |
| **3. Tarjeta de sellos Kambak en Wallet al atenderse** *(Prioridad #3)* | Premium solo tiene giftcards sin Wallet ni NFC | **Sí en Kambak**, falta unir el cierre de cita | Al apretar *"Sí, se atendió"* en `/agenda`, enviar evento firmado `cita.completada` a Kambak para sumar +1 sello. | **Baja** (~1.5 h) |
| **4. Comisiones por profesional y reporte por barbero** *(Prioridad #4)* | Básico (\$34.900) | **No tenemos** | Guardar `% comisión` en `ed_profesionales` y calcular citas `completada` × precio × `%` por barbero. | **Baja-Media** (~1 h) |
| **Cobro de abono online al reservar (Flow)** | Pago online | **Parcial** (`lib/booking/bookingAnticipos.ts`) | Enchufar el motor Flow (ya construido) a `/reservar/[slug]`. | **Media** |
| **Marketplace, Correos masivos, Facturación SII, API pública** | Individual a Pro (\$249.900) | **No tenemos** | **NO HAREMOS** (decisión tomada). | **Descartado** |

---

## 3. Competencia 2 (Restaurantes): Riservi (`widget.riservi.com`) vs. Nosotros

Revisamos el widget y la página oficial de precios de **Riservi** (`riservi.com/precios.html`).

### A. Qué ofrece Riservi y dónde flaquea en Chile
- **Qué hace bien Riservi:** Tiene un link web (`widget.riservi.com`) para poner en Instagram donde el cliente elige **cantidad de personas, fecha, hora y zona/evento**, además de lista de espera QR y cobro de anticipo.
- **Puntos débiles de Riservi (verificados en `riservi.com/precios.html`):**
  1. **La gente en Chile sigue pidiendo mesa por WhatsApp:** Riservi es un formulario web. Si un cliente escribe al WhatsApp del restaurante *"Hola, ¿tienen mesa para 6 hoy a las 9?"*, Riservi no conversa ni agenda por WhatsApp.
  2. **WhatsApp caro y a medias:** En su plan Básico no incluye WhatsApp; en el plan Pro cobra un adicional por cada notificación enviada; y en su plan más caro (Avanzado) todavía dice literalmente: **"Marketing Automatizado por Whatsapp (pronto)"**.
  3. **Sin tarjeta de sellos en Apple/Google Wallet ni stickers NFC en la mesa:** Su fidelización es por correo electrónico (que casi nadie abre comparado con WhatsApp + Wallet).

### B. Tabla: Riservi vs. Nosotros (Restaurantes)

| Función en Restaurantes | Riservi (`widget.riservi.com`) | ¿La tenemos hoy en código? | Qué falta para superar a Riservi | Dificultad |
| :--- | :--- | :--- | :--- | :--- |
| **Link web de reserva para Instagram (`/reservar/[slug]`)** | Sí (`widget.riservi.com`) | **Sí** (`/reservar/[slug]` + campos de `ed_servicio_campos`) | Configurar plantilla de rubro `"restaurante"` con campo *"Cantidad de personas"* y *"Zona (Terraza / Salón)"*. | **Baja** |
| **Reserva automática conversando por WhatsApp (Tino 24/7)** | **No tiene** (solo link web) | **Sí, 100%** (`lib/agendaBot.ts`) | Ajustar prompt/plantilla de restaurante para que Tino pregunte cantidad de personas y turno. | **Baja** |
| **Control de capacidad por turno (descontar `N` comensales)** | Sí (por mesas/cupos) | **Parcial** (`ed_clases` descuenta `1` reserva a la vez) | Hacer que una reserva de `N` personas descuente `N` cupos del turno (o asigne mesa por capacidad). | **Media** (Fase Restaurantes) |
| **Reserva con pago de anticipo (grupos grandes / eventos)** | Sí (en Plan Pro/Avanzado) | **Parcial** (`lib/booking/bookingAnticipos.ts` con Flow) | Conectar el cobro de anticipo Flow al link `/reservar/[slug]` (ideal para mesas de 8+ o cenas/eventos). | **Media** |
| **Confirmación y recordatorio por WhatsApp anti-plantón** | Cobra extra por mensaje desde Plan Pro | **Sí, 100%** (`lib/agendaSeguimientos.ts`) | Agregar `"restaurante"` a `CON_AGENDA`. | **Muy baja** |
| **Tarjeta de sellos en Wallet + Carta NFC en la mesa + Cumpleaños/Referidos** | **No tiene Wallet ni NFC** (referidos solo en Plan Avanzado) | **Sí, 100% en Kambak** | Conectar `cita.completada` de la reserva para sumar sello automático al asistir a la mesa. | **Baja** |
| **Vera (Encuesta y Reseñas Google) + Beto (Reactivación por WhatsApp)** | En Riservi el marketing por WhatsApp dice *"pronto"* | **Sí** (`lib/agendaBot.ts`, `lib/generadorSeguimientos.ts`, campañas Kambak) | Destrabar Beto sin `vehiculo` + actualizar `ultima_atencion` al asistir. | **Baja** |

---

## 4. Cómo potenciamos los planes de Kambak (`kambak.cl`) para cobrar más caro

Hoy en `kambak.cl` (`public/index.html` y `public/kam.html`) tienes publicados 4 planes:
- **Simple Carta NFC:** \$30.000 pago único.
- **Fidelización:** \$49.990 / mes (Carta NFC + Sellos en Wallet + Reseñas + WhatsApp básico).
- **Pro:** \$74.990 / mes (Suma automatización de mensajes, Beto para inactivos/premios por vencer y Tino básico de consulta de sellos).
- **Pro IA:** \$119.990 / mes (Suma a Tino, Beto, Vera e Isabel completos).

**El problema actual:** Para una barbería (que paga \$34.900–\$54.900 en AgendaPro) o un restaurante (que cotiza Riservi), pagar \$74.990 o \$119.990 solo por "sellos + chat" podía parecer caro si tenían que pagar otro software aparte para la agenda.  
**La solución:** Al meter **Agenda + Reserva por WhatsApp + Ficha de cliente + Resumen diario + Comisiones** dentro de los planes **Pro** y **Pro IA** de Kambak, el cliente **elimina el gasto de AgendaPro/Riservi** y justifica de sobra pagar los planes altos de Kambak:

| Plan en `kambak.cl` | Precio (NETO + IVA, propuesta sobre tu escala actual) | Para quién calza perfecto | Qué suma ahora gracias a Respondo + Kambak |
| :--- | :--- | :--- | :--- |
| **1. Fidelización** *(Entrada)* | **\$49.990 + IVA / mes** *(actual en web)* | **Cafeterías y locales al paso** (sin reserva de hora). | • Tarjeta de sellos en Apple/Google Wallet + Stickers NFC.<br>• Aviso automático `sello_premio_cerca`, cumpleaños y referidos.<br>• Reseñas en Google. |
| **2. Pro (Agenda + Sellos)** *(Quita-AgendaPro)* | **\$74.990 + IVA / mes** *(actual en web, ahora mucho más potente)* | **Barberías (hasta 3 barberos) y Restaurantes chicos** que quieren reemplazar AgendaPro o el cuaderno. | • **Todo Fidelización** + **Agenda web `/reservar/[slug]`**.<br>• **Confirmaciones y recordatorios automáticos por WhatsApp**.<br>• **Sello automático al marcar *"Sí, se atendió"*** en la agenda.<br>• **Ficha de cliente con historial de citas**, **Resumen diario al dueño por WhatsApp** y **Cálculo de comisiones por barbero**.<br>• **Beto** (avisa premios por vencer y reactiva inactivos). |
| **3. Pro IA (Suite Completa con Empleados IA)** *(Ticket Alto)* | **\$119.990 + IVA / mes** *(hasta 5 prof. / 1 salón)*<br>o **\$149.990 + IVA / mes** *(hasta 10 prof. / restaurante grande con anticipos)* | **Barberías consolidadas y Restaurantes de alta demanda** que quieren que el WhatsApp trabaje solo 24/7. | • **Todo Pro** + **Tino Agendador IA en WhatsApp** (agenda, reagenda y responde dudas conversando 24/7).<br>• **Beto Reactivador IA** (escribe al mes del último corte o visita para agendar la siguiente hora).<br>• **Vera Postventa IA** (encuesta 1–5 a las 2h, filtra reclamos y consigue reseñas 5★ en Google).<br>• **Isabel** (inteligencia de negocio, informe semanal y retorno real) + **Cobro de anticipos con Flow**. |

### B. Campañas de Publicidad Personalizadas por WhatsApp (qué ya existe en código y cómo se cobran)

En `kambak` (`lib/routes-crm.js`, `lib/routes-rescue.js` y `lib/messaging.js`) **ya está construido el motor completo de campañas personalizadas**, y al unirlo con la agenda de Respondo se vuelve un arma de venta brutal para Barberías, Restaurantes y Cafeterías:

1. **Cómo se personaliza cada mensaje automáticamente:**
   - Saluda a cada cliente por su **primer nombre** (`Hola Camila...`).
   - En campañas de rescate o cercanía, le inyecta **cuántos sellos exactos lleva y cuántos le faltan para el premio de ese local** (*"Te faltan solo 2 sellos para tu Corte Gratis en Barbería Central"*).
   - Incluye opción legal de baja automática (*"Responde BAJA para no recibir más avisos"*), respeta horario hábil (`9:00 a 21:00` Chile) y tiene un **tope protector de máximo 4 mensajes publicitarios al mes por persona** (`CAP_MONTH = 4`) para nunca saturar al cliente.

2. **Los 4 segmentos inteligentes que ya existen en el panel del dueño (`AUDIENCES` en `lib/routes-crm.js`):**
   - **A punto de ganar (`cerca`):** Clientes a los que les faltan **1 o 2 sellos** para su premio (el segmento con mayor tasa de retorno inmediato).
   - **Inactivos (`inactivos`):** Clientes que llevan **30 días o más sin venir** (se actualiza solo cada vez que el barbero aprieta *"Sí, se atendió"* o timbran NFC).
   - **Nuevos (`nuevos`):** Clientes que se registraron en los **últimos 7 días** (ideal para lograr la segunda visita).
   - **Todos con permiso (`todos`):** Para lanzar un evento especial (ej. *Cata de café*, *Menú del Día de la Madre*, *Semana de 2x1 en barba*).

3. **Los 3 tipos de campañas que el dueño puede usar:**
   - **Campaña de Promoción (`sello_promo`):** Para llenar días flojos (ej. *"Martes y miércoles: doble sello o 20% dcto en Corte + Barba, válido hasta el jueves"*).
   - **Campaña de Evento (`sello_evento`):** Clave para **Cafeterías y Restaurantes** (ej. *"Este viernes: noche de pastas y vino / brunch especial"*).
   - **Piloto Automático de Rescate — Beto (`sello_rescate` en `lib/routes-rescue.js`):** Corre solo todos los días y le escribe únicamente a quienes cumplieron 21 días (configurable de 14 a 90 días) sin volver al local.

4. **La jugada maestra con el Plan Pro IA (Campaña → Respuesta → Reserva en el mismo chat):**
   - En cualquier otro software (como AgendaPro o Riservi), las campañas son "mudas": si el cliente responde al mensaje, nadie le contesta.
   - Con nosotros, cuando el cliente recibe la campaña en su WhatsApp y responde *"¡Buenísimo! ¿Tienen hora para mañana a las 18:00?"*, **se abre gratis la ventana de 24 horas y Tino le agenda la hora o la mesa en ese mismo segundo**.

5. **Economía de las campañas y límites por plan (margen casi 100% + cuidado de chips):**
   - **Cómo salen:** Las confirmaciones, recordatorios de cita y avisos transaccionales (`Utility`) salen por la vía oficial del negocio, mientras que las **campañas publicitarias (`sello_promo`, `sello_evento`, `sello_rescate`) salen por nuestro pool de chips secundarios** (costo de reposición de ~\$2.000 CLP por chip si alguno cae, sin arriesgar jamás el número del local ni el `+56 9 8576 1941`).
   - **Por qué igual ponemos límites claros de envíos en cada plan:**
     1. **Para cuidar los chips:** Evita que un local dispare 5.000 mensajes de golpe y queme los chips en una tarde.
     2. **Para justificar los planes más caros:** Le da un valor tangible enorme a pasar del plan de \$49.990 al de \$74.990 o \$119.990 (porque en el mercado un envío masivo de WhatsApp cuesta caro).
   - **Cupos de campañas personalizadas incluidos en los 3 planes (valores NETOS + IVA):**
     - **1. Fidelización (\$49.990 + IVA/mes):** Avisos automáticos de sello (`sello_premio_cerca`) + **hasta 150 envíos/mes** en campañas promocionales (1 campaña al mes para probar el retorno).
     - **2. Pro — Agenda + Sellos (\$74.990 + IVA/mes):** Confirmaciones y recordatorios de agenda + **Beto Rescate automático** + **hasta 400 envíos/mes** en campañas segmentadas (*Cerca del premio, Inactivos 30d, Nuevos, Eventos*).
     - **3. Pro IA — Suite Completa (\$119.990 + IVA/mes):** Todo lo de Pro + **hasta 1.000 envíos/mes** en campañas personalizadas + **Tino agendando en vivo a quienes respondan** + **Beto avisando por ciclo de corte/visita**.
     - **Bolsas extra (margen líquido):** Si un local quiere más envíos en un mes fuerte (Día de la Madre, Fiestas Patrias, Navidad), compra una bolsa adicional (ej. **\$14.900 + IVA por 300 envíos**).

---

## 5. Orden de Construcción para Barberías y Restaurantes (Fase 2)

Cada paso irá en su propia rama limpia desde `main` y con su propio PR pequeño, sin tocar `feat/kambak-waha-pool-v2` ni el `PR #58` de Kambak:

1. **Paso 1 — Ficha de cliente con historial de citas y notas (`respondo-portal`):**
   - En `/clientes/[chatId]` (y con link directo desde cada cita en `/agenda`), mostrar el historial real de `ed_citas` (fecha, servicio, barbero que lo atendió, estado de asistencia y contador de visitas) junto a sus notas de preferencia, sin depender de flags ocultos.
2. **Paso 2 — Resumen diario al dueño por WhatsApp (`respondo-portal`):**
   - En el cron matutino, enviar al `whatsapp_negocio` del dueño el resumen del día: cuántas citas hay hoy, desglose por barbero, cuántas ya confirmaron y cuántas citas de ayer quedaron *"Por cerrar"*.
3. **Paso 3A y 3B — Conexión Agenda ↔ Sellos Kambak + Rubros `"barberia"` y `"restaurante"` + Beto/Vera (`kambak` y `respondo-portal`):**
   - **3A (en `kambak`):** Reservar en `TAREAS.md` y anotar en `CAMBIOS.md`. En `lib/respondo.js`, recibir el evento firmado `cita.completada` en `/api/hooks/respondo` y sumar +1 sello al celular del cliente (o guardar sello pendiente en `pendingStamps/tel_9XXXXXXXX` si aún no abre su tarjeta), con idempotencia por `citaId` y actualización de Wallet.
   - **3B (en `respondo-portal`):**
     - Activar `"barberia"` y `"restaurante"` en `CON_AGENDA` (`lib/plantillas.ts`) y agregar plantilla demo en `lib/plantillasRubro.ts`.
     - Al pasar una cita a `completada` (botón *"Sí, se atendió"* o encuesta de Vera), actualizar `ed_contactos.ultima_atencion`, destrabar a **Beto** (`lib/generadorSeguimientos.ts`) para que no exija `"moto"` (`vehiculo`) en negocios con agenda, y disparar el webhook firmado `cita.completada` hacia Kambak.
4. **Paso 4 — Comisiones por profesional (`respondo-portal`):**
   - Agregar `% comisión` por profesional en `ed_profesionales` y mostrar en `/agenda` el cuadro de liquidación por barbero (citas completadas × valor servicio × comisión).
5. **Paso 5 (Siguiente ola — Restaurantes tipo Riservi):**
   - Descuento de cupos por `N` comensales en turnos de restaurante y conexión de anticipos Flow al link público `/reservar/[slug]`.
