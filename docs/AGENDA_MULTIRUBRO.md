# Agenda multi-rubro — qué cambió y por qué

**Fecha:** 11-ago-2026 · **Migración:** `sql/277_agenda_multirubro.sql`
**Contraste:** AgendaPro y Dentalink (revisados hoy, no de memoria).

---

## El problema que teníamos

La agenda estaba bien construida —el constraint anti doble-reserva vive en
Postgres, no en JavaScript, y eso es serio— pero era **de un solo rubro**:

- Le pedía a todo el mundo lo mismo: nombre y teléfono.
- La única forma de cambiar o anular una hora era escribirle al negocio.
- No existía el tiempo de preparación entre horas.

Con eso se puede vender una barbería. No se puede vender una clínica dental, un
taller, una veterinaria ni una inmobiliaria — que son justo los rubros con más
volumen de agendamiento y más capacidad de pago.

---

## 1 · La ficha se adapta a cada rubro

En vez de programar un formulario por rubro (no escala, y nos deja manteniendo
uno por cliente), **cada negocio define sus propios campos por servicio**.

Un solo mecanismo cubre todo:

| Rubro | Qué pregunta |
|---|---|
| Clínica dental / médica | RUT, previsión (Fonasa/Isapre/Particular), ¿primera vez?, motivo |
| Taller mecánico | patente, marca y modelo, kilometraje, qué le pasa |
| Veterinaria | nombre de la mascota, especie, edad |
| Estética / peluquería | ¿primera vez?, alergias |
| Inmobiliaria | RUT, propiedad de interés, forma de pago |
| Barbería | nada — y la pantalla se ve igual que antes |

**9 tipos de campo:** texto corto, texto largo, lista de opciones, sí/no,
número, RUT, teléfono, correo y fecha.

### El RUT se valida de verdad

`tipo = 'rut'` verifica el **dígito verificador** (módulo 11) en el servidor. No
es cosmético: un RUT mal tipeado no se nota al reservar, se nota cuando hay que
emitir la boleta o buscar la ficha con el paciente al frente. Es el tipo de
detalle local que una herramienta internacional no trae.

### Plantillas por rubro

La pantalla de configuración ofrece plantillas (clínica, taller, veterinaria,
estética, inmobiliaria). El dueño aprieta una y ve el campo cargado, en vez de
quedarse mirando un formulario vacío sin saber qué poner. Es la diferencia entre
"configúralo tú" y "esto ya viene listo para tu rubro".

### Seguridad

Todo se valida **en el servidor** (`lib/fichaServicio.ts`). El formulario del
navegador ayuda a no equivocarse, pero no es una barrera: cualquiera puede mandar
el POST a mano. En concreto se rechaza:

- una opción que el negocio no ofreció (no se puede inyectar "Previsión: gratis")
- un RUT con dígito verificador falso
- claves que no corresponden a ningún campo definido (no se puede inflar el JSON)
- textos por sobre el largo máximo de cada tipo

12 pruebas cubren esto (`tests/ficha-servicio.test.mjs`).

---

## 2 · El cliente se mueve solo (cancelar y reagendar)

Era **el hueco más grande** frente a la competencia. En AgendaPro el cliente
cancela o reagenda desde un enlace y el negocio no hace nada; en Dentalink
también. Nosotros decíamos "escríbenos por WhatsApp".

Ahora cada cita tiene su enlace propio (`/cita/<token>`), que viaja en la
confirmación y en el recordatorio de WhatsApp, y en la pantalla de éxito de la
reserva web.

**Por qué importa más allá de competir:**

- Para el cliente: anula a las 23:40 sin escribirle a nadie ni esperar respuesta.
- Para el negocio: **el cupo se libera al instante** y otra persona puede
  tomarlo. Hoy la hora se pierde igual, pero el cupo queda ocupado hasta que
  alguien lee el WhatsApp — en la práctica, hasta el otro día.
- Para nosotros: cada cambio que el cliente resuelve solo es una conversación
  menos que Tino tiene que entender y escalar.

### El negocio manda

Tres interruptores por cliente, porque no todos los rubros son iguales (una
peluquería sí; una hora de pabellón con equipo reservado, no):

- puede cambiar día u hora
- puede anular
- hasta cuántas horas antes (0 = hasta la hora misma)

### Seguridad del enlace

El token es la única credencial, así que:

- 36 caracteres hex aleatorios (18 bytes) — imposible de adivinar o enumerar.
- Se valida el **formato antes de consultar la base**: un escaneo de URLs no nos
  cuesta una consulta por intento.
- Rate-limit por IP **y por token**: una IP rotativa no puede martillar una cita.
- La página **no expone** teléfono, notas internas, la ficha con datos
  personales, ni ningún id interno. Si alguien reenvía el enlace, no obtiene más
  de lo que ya sabía quien reservó.
- Las políticas se re-evalúan **en el servidor** al ejecutar: que el botón se
  haya visto habilitado no prueba nada, la pestaña pudo quedar abierta horas.
- Al reagendar, el instante tiene que ser uno que el servidor ofreció — misma
  barrera que ya usaba la reserva pública.
- `noindex`: aunque el token sea impredecible, no queremos la hora de alguien en
  un buscador.

9 pruebas cubren las políticas (`tests/autogestion.test.mjs`).

---

## 3 · Tiempo de preparación entre horas

Sanitizar el box, limpiar el sillón, guardar herramientas, dar la pasada entre un
auto y el siguiente. Sin esto la agenda se llena pegada y el negocio corre
atrasado todo el día — hoy lo resuelven a mano dejando horas falsas bloqueadas.

Se configura **por servicio** (limpiar un box de cirugía no toma lo mismo que una
consulta de control con el mismo dentista) y **no alarga la cita**: la hora sigue
durando lo que dice el servicio y a quien reserva se le muestra su hora real. Lo
único que cambia es que el cupo pegado deja de ofrecerse.

**Detalle que importa:** el buffer se aplica solo entre **citas**, nunca contra
**bloqueos**. Si el negocio para de 13 a 14 para almorzar, la tarde parte a las
14:00 exactas, no a las 14:15. Aplicarlo ahí le comería tiempo real de atención
todos los días sin que nadie entienda por qué.

6 pruebas cubren esto (`tests/agenda-buffer.test.mjs`).

---

## Cómo aplicarlo

Las tres migraciones de hoy son **aditivas**, y además el código trae respaldo
para cuando una columna todavía no existe. Verifiqué contra la base real que sin
la 277 aplicada la agenda y la configuración **siguen mostrando sus datos** en
vez de quedar vacías. Así que el orden no puede romper nada.

Recomendado:

```
1. Deploy del código
2. sql/275_waha_instancia.sql      (esta SÍ exige deploy antes — mueve un dato)
3. sql/276_purga_webhooks.sql
4. sql/277_agenda_multirubro.sql
```

Después de la 277, en el portal:

- **Agenda → Configuración → Servicios**: cada servicio tiene "Ficha" para
  definir qué se pregunta y cuántos minutos de preparación deja.
- **Agenda → Configuración → "Que tus clientes se muevan solos"**: los tres
  interruptores de autogestión.

---

## Limitación conocida (a propósito)

**Las reservas por WhatsApp no piden la ficha.** Si un servicio tiene campos
obligatorios y la hora se agenda conversando con Tino, la cita se crea sin esos
datos. La reserva web sí los exige.

No lo resolví hoy porque hacer que Tino pregunte 4 datos en medio de una
conversación empeora la experiencia que justamente lo hace vender —y porque hay
una salida mejor: mandarle el enlace de su hora para que complete la ficha él
mismo. Eso se apoya en lo que ya quedó construido y conviene hacerlo con un
cliente real de ese rubro al lado, no antes.

Mientras tanto, para un servicio con ficha obligatoria conviene empujar la
reserva por la página pública.

---

## Archivos

**Nuevos**
```
sql/277_agenda_multirubro.sql        esquema (ficha, token, buffer, políticas)
lib/fichaServicio.ts                 validación de la ficha + RUT chileno
lib/autogestion.ts                   políticas de cancelar/reagendar (puro)
lib/autogestionDatos.ts              capa de datos de la autogestión
components/FichaServicioConfig.tsx   configuración de la ficha (negocio)
components/GestionCita.tsx           pantalla del cliente final
app/cita/[token]/page.tsx            página pública de la hora
app/api/cita/[token]/route.ts        cancelar / reagendar / cupos
tests/ficha-servicio.test.mjs        12 pruebas
tests/autogestion.test.mjs            9 pruebas
tests/agenda-buffer.test.mjs          6 pruebas
```

**Modificados**
```
lib/agendaCore.ts                    buffer en el cálculo de cupos
lib/agenda.ts                        buffer + datos_extra + gestion_token
lib/agendaSeguimientos.ts            enlace de autogestión en los mensajes
app/api/reservas/route.ts            valida la ficha y devuelve el enlace
components/ReservaPublica.tsx        renderiza la ficha + enlace al terminar
app/reservar/[slug]/page.tsx         carga los campos de cada servicio
app/(portal)/agenda/page.tsx         muestra la ficha en el detalle
app/(portal)/agenda/configuracion/   ficha, buffer y autogestión
app/(portal)/agenda/acciones.ts      acciones nuevas
components/CalendarioAgenda.tsx      bloque "Datos que dejó"
```
