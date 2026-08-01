# Spec: clases grupales con cupo (pilates, crossfit, yoga, spinning) — 1-ago-2026

## Por qué este documento

La agenda de hoy funciona muy bien para el modelo "una persona, un profesional,
un horario": barbería, clínica estética, y con algo de pulido de lenguaje,
corretaje de propiedades (una visita = una persona, un corredor, un horario;
no requiere cambios de estructura, solo de textos — ver la sección final).

Un centro de pilates o un box de crossfit son un modelo distinto: diez
personas reservan el MISMO bloque de tiempo con el mismo instructor. Hoy eso
no es posible — no por descuido, sino porque el esquema actual está diseñado
a propósito solo para 1:1, con la fase grupal dejada pendiente. La prueba está
en el propio SQL, comentario original en `sql/220_agenda.sql`:

```sql
-- cupo > 1 = clase grupal (gimnasios). F0-F3 operan con cupo = 1 (citas);
-- el soporte grupal llega con la fase wellness. Se deja la columna para no
-- migrar de nuevo.
cupo int not null default 1 check (cupo between 1 and 100),
```

Este documento es esa fase pendiente. Es una spec, no una implementación:
tamaño comparable a la fase F0-F4 original del módulo de agenda (varios días
de trabajo real), no un ajuste chico. Se escribe ahora para no perder el
diseño, y se construye cuando el lanzamiento del 10-ago lo permita.

## Diagnóstico: por qué el modelo actual no alcanza

Tres cosas están fusionadas hoy en una sola fila de `ed_citas` que para
clases necesitan separarse:

1. **"El bloque de tiempo" y "la reserva de una persona" son la misma fila.**
   Para 1:1 es correcto: una cita ES una reserva. Para una clase, el bloque de
   tiempo existe una vez y tiene N reservas dentro (una por alumno).

2. **La regla anti-doble-reserva es 1:1 a propósito.** El `EXCLUDE USING
   gist` de `ed_citas` rechaza CUALQUIER segunda fila que se solape en el
   tiempo para el mismo profesional — es la protección correcta contra doble
   agendamiento en un modelo 1:1, pero aplicada tal cual a una clase
   rechazaría a la segunda persona que se anota, y a la tercera, y así.

3. **Los horarios se calculan al vuelo, no existen como entidad.**
   `agendaCore.computarSlots` no lee "horas ya definidas" — genera bloques
   libres cortando el horario semanal del profesional en trozos del largo del
   servicio, descontando lo ocupado. Funciona porque en el modelo 1:1 no hace
   falta que el bloque "exista" hasta que alguien lo reserva. Una clase de
   pilates SÍ necesita existir de antemano con su propio horario fijo (martes
   7:00, no "cualquier hora libre de 7 a 8") y su propio cupo, independiente
   de si alguien ya se anotó.

Nota de vocabulario para quien lo implemente: la palabra "cupo" hoy se usa
para dos cosas distintas en el código. `ed_servicios.cupo` es la capacidad
máxima de una clase (lo que trae esta spec). Pero en `lib/agendaBot.ts` y en
la UI, "cupo" es como Tino y el portal le llaman coloquialmente a **un
horario disponible** en el modelo 1:1 (token `C1`, `C2`...). Van a convivir
en el mismo código y son conceptos distintos — conviene renombrar el segundo
uso a "horario" en el texto de cara al usuario antes de tocar esto, para no
generar confusión entre "cupo disponible" (una hora libre) y "cupos
restantes" (lugares en una clase).

## Diseño propuesto

### 1. Nueva tabla `ed_clases` — la sesión existe como entidad

```sql
create table ed_clases (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references ed_clientes(id) on delete cascade,
  servicio_id     uuid not null references ed_servicios(id),
  profesional_id  uuid not null references ed_profesionales(id),
  inicio          timestamptz not null,
  fin             timestamptz not null,
  cupo_maximo     int not null check (cupo_maximo > 0),
  cupo_ocupado    int not null default 0 check (cupo_ocupado >= 0),
  estado          text not null default 'activa' check (estado in ('activa','cancelada')),
  check (inicio < fin),
  check (cupo_ocupado <= cupo_maximo),

  -- Mismo mecanismo que ed_citas: un profesional no puede dar dos clases
  -- encimadas. El solape ENTRE inscripciones de la MISMA clase es el punto
  -- del diseño, no un bug — por eso esta regla vive acá y no en ed_citas.
  constraint ed_clases_sin_solape exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin) with &&
  ) where (estado = 'activa')
);
```

### 2. `ed_citas` gana una columna opcional `clase_id`

```sql
alter table ed_citas add column clase_id uuid references ed_clases(id);
```

Cuando `clase_id` no es null, la fila es "la inscripción de una persona a esa
clase", no una cita 1:1. El `EXCLUDE` que ya existe en `ed_citas` debe
ajustarse para IGNORAR estas filas (agregar `and clase_id is null` a su
condición `where`) — si no, la primera inscripción a una clase bloquearía a
todas las siguientes exactamente por la misma razón que hoy previene el doble
agendamiento. Todo lo demás de `ed_citas` (nombre, teléfono, estado,
cancelación) se reutiliza tal cual: una inscripción se cancela igual que una
cita normal.

### 3. Inscripción atómica sin condición de carrera

El mismo problema que resolvía el `EXCLUDE` para 1:1 (dos reservas
simultáneas por el mismo cupo) existe acá con el cupo numérico: si dos
alumnos tocan "reservar" en el mismo instante para el último lugar, uno de
los dos tiene que perder. Postgres ya lo resuelve con bloqueo de fila si se
hace bien:

```sql
-- Dentro de una transacción:
update ed_clases
   set cupo_ocupado = cupo_ocupado + 1
 where id = $1 and cupo_ocupado < cupo_maximo
 returning cupo_ocupado;
-- Si no afecta ninguna fila → clase llena → mismo motivo 'cupo_tomado' que
-- ya usa el código de citas 1:1, mismo vocabulario para el resto del sistema.
-- Si afecta una fila → insertar en ed_citas con ese clase_id, misma transacción.
```

Cancelar una inscripción decrementa `cupo_ocupado` con el mismo cuidado
(nunca bajo 0, dentro de transacción).

### 4. Cómo se crean las sesiones

Dos caminos, no mutuamente excluyentes:

- **Manual**: el dueño crea "Pilates, martes 7:00, cupo 10" desde el portal,
  una vez. Sencillo de construir, pero no escala si el horario se repite
  todas las semanas indefinidamente.
- **Recurrente** (recomendado): el dueño define un patrón semanal por
  servicio (día, hora, profesional, cupo) — muy parecido a como hoy ya
  configura `ed_horarios` — y un proceso genera las sesiones reales dentro
  del horizonte de reserva configurado (`horizonte_dias`, que ya existe por
  cliente). Ese proceso puede colgar del mismo cron único que ya corre cada 5
  minutos (ver `docs/CRON_Y_VIGILANCIA.md`) sin crear una segunda tarea
  programada — coherente con la regla ya establecida de "un solo cron para
  todo".

### 5. Página pública de reserva

Para un servicio con `cupo = 1` (barbería, clínica) la experiencia no cambia
en absolutamente nada: sigue mostrando horas sueltas calculadas al vuelo,
exactamente como hoy.

Para un servicio con `cupo > 1`, en vez de horas sueltas se muestra una lista
de las próximas sesiones ya programadas, con los cupos que quedan visibles
("Pilates · martes 7:00 · quedan 3 de 10"), y al llegar a 0 la sesión se
muestra agotada en vez de desaparecer (mejor que ocultarla sin explicación,
mismo principio que ya se aplicó en el rediseño de la agenda: nunca mentir
por omisión).

### 6. Portal del dueño

Una clase necesita una vista que hoy no existe: la lista de inscritos de una
sesión (no solo "una cita con un nombre"), con la posibilidad de dar de baja
a un alumno puntual sin cancelar la clase completa.

### 7. Google Calendar

Con cupo > 1 no tiene sentido escribir un evento por cada inscripción — se
duplicaría en el calendario del profesional. Un solo evento por SESIÓN
(usando `clase_id` como ancla del id determinista, en vez de `citaId` como
hace hoy `sincronizarCita`), con la cantidad de inscritos en la descripción.

### 8. Tino / WhatsApp

`lib/agendaBot.ts` ya tiene el patrón de tokens (`C1`, `C2`...) para que el
modelo elija sin inventar horarios. El mismo patrón sirve para sesiones de
clase — el bloque que arma el prompt simplemente listaría sesiones con cupo
restante en vez de horarios libres, para los servicios que sean grupales.

## Qué NO cambia (cero riesgo de regresión)

Todo el modelo 1:1 sigue exactamente igual. `ed_citas` sin `clase_id`
(el 100% de las citas actuales) no toca ninguna regla nueva. Barbería Nogal,
Impresora Color y cualquier cliente con `cupo = 1` en sus servicios no ve
ninguna diferencia. La migración es aditiva: tabla nueva + una columna
nullable — el mismo patrón usado en toda la agenda hasta ahora.

## Fases sugeridas

- **G0**: migración (`ed_clases` + columna `clase_id`), ajuste del `EXCLUDE`
  de `ed_citas`, función de inscripción atómica con tests (incluyendo el caso
  de carrera: dos inscripciones simultáneas al último cupo).
- **G1**: generación recurrente de sesiones + portal para definir el patrón
  semanal y ver la lista de inscritos de cada sesión.
- **G2**: página pública de reserva para servicios grupales (lista de
  sesiones con cupos) + evento único por sesión en Google Calendar.
- **G3**: Tino ofreciendo sesiones de clase por WhatsApp (extensión de
  `agendaBot.ts`).

## Corretaje de propiedades: nota aparte

Esto no necesita nada de lo anterior. El modelo 1:1 ya le calza (una visita,
un corredor, un horario). Lo que falta es más liviano: los textos del portal
dicen "profesional", "servicio", "cliente" — genéricos que no hablan el
idioma de una corredora ("agente", "propiedad", "visita"). Es trabajo de
copy y quizás de un mapeo de términos por rubro, no de esquema. Se puede
resolver aparte, sin depender de esta spec.
