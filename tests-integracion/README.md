# Pruebas de integración — reconciliar / embudo / vigilante

Punto pendiente de la auditoría de Conversaciones (3-sep-2026, sección "queda
pendiente / decisión de Marcelo", punto 4): pruebas de integración para
`reconciliarEstados`, `cargarEmbudo` y `revisarAbandonadas` (el vigilante)
contra la base de verdad, no contra fixtures inventados.

## Qué son y qué NO son

- **Sí**: corren `reconciliarEstados`, `cargarEmbudo` y `revisarAbandonadas`
  de punta a punta contra la base de PRODUCCIÓN de Impresora Color, en modo
  **solo lectura / dry-run**. Sirven para saber si el código realmente
  funciona contra la forma y el volumen reales de los datos — algo que un
  fixture a mano nunca prueba del todo.
- **No** son las pruebas normales del proyecto (`npm test`, las de
  `tests/*.test.mjs`). Esas siguen siendo rápidas, sin red, y corren en
  cualquier lado (CI incluido). Estas otras necesitan las credenciales reales
  y por diseño **no deben correr solas en CI** — son para correr a mano,
  cuando alguien quiera confirmar que estos tres módulos siguen sanos contra
  la base real.

## Garantía de seguridad (y cómo está probada)

Nada de lo que corre acá puede:
- escribir en la base (`insert`/`update`/`upsert`/`delete`/`rpc`/`storage`
  quedan interceptados ANTES de tocar la red — ver `soporte/dbSoloLectura.mjs`),
- mandar un WhatsApp real (Meta o WAHA),
- avisar a Gestión por el puente,
- ni llamar de verdad al modelo (Gemini) —

pase lo que pase adentro de la lógica de negocio. La lectura (`select`, `eq`,
`order`, etc.) sí es real: por eso hacen falta las credenciales de verdad.

La garantía de "nunca escribe" está probada, SIN necesitar ninguna
credencial, en `tests/db-solo-lectura.test.mjs` (corre con el `npm test` de
siempre): arma un cliente falso que **lanza una excepción** si alguien le
llama `insert`/`update`/`upsert`/`delete`/`rpc`/`storage` de verdad, y
confirma que el envoltorio nunca deja que eso pase. Si algún día ese test
falla, hay que arreglarlo ANTES de volver a correr algo contra producción.

## Cómo correrlas

```bash
npm run test:integracion
```

Ese script:
1. Carga `.env.local` (las mismas `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
   que usa el portal — no hace falta nada nuevo, y `.env.local` ya está fuera
   del repo por `.gitignore`).
2. Activa el alias `@/...` (el mismo que usa el resto del portal) para poder
   importar `lib/reconciliarEstados.ts`, `lib/embudo.ts` y
   `lib/reingresoTino.ts` tal cual son — sin copiarlos ni simplificarlos.
3. Corre cada prueba, mostrando en consola qué pasó de verdad (cuántas
   tarjetas cargó el embudo, cuántas escalaciones habría cerrado reconciliar,
   etc.) y qué HABRÍA escrito o mandado si no estuviera en dry-run.

Sin `.env.local` (o esas dos variables exportadas a mano), el script explica
el problema y no intenta nada — no hay forma de que corra "a medias".

## Qué mirar cuando terminan

Cada prueba imprime un resumen legible antes de las aserciones. Si algo
cambia de forma inesperada — reconciliar empieza a "querer" tocar una tabla
que no tocaba, el embudo revienta con un contacto real que tiene una forma
rara, el vigilante decide mandar un mensaje con el mock de Gemini apagado —
ahí está la señal, mucho antes de que llegue a producción sin revisar.

## Extender esto a otros módulos

El mismo mecanismo sirve para `detectarCierres` (`lib/cierreVentas.ts`, "EL
DETECTOR DE CIERRES") o `archivarPendientes`/`seguimientoPendiente`
(`lib/archivarMedia.ts`, `lib/seguimientoPendiente.ts`) — todos reciben el
cliente Supabase como parámetro, igual que los tres de acá. Un archivo nuevo
en esta carpeta, siguiendo el mismo patrón que
`reconciliar.integracion.test.mjs`, alcanza. Si el módulo nuevo usa
`ed_resultados`/`storage`/algo que el envoltorio bloquea sin que haga falta,
hay que sumarlo a `soporte/dbSoloLectura.mjs` a propósito — nunca aflojar el
bloqueo "por si acaso".

## Por qué NO hay una base de pruebas separada

Se evaluaron tres opciones (Supabase de pruebas nuevo, Postgres local, y
producción en dry-run) y Marcelo eligió producción en dry-run: menos
mantenimiento (no hay un segundo proyecto Supabase que mantener sincronizado
con las migraciones), y prueba contra la forma REAL de los datos de un solo
negocio real (Impresora Color) en vez de datos inventados que podrían no
parecerse a los de verdad. El costo es que estas pruebas dependen de que la
base esté disponible y de tener las credenciales — por eso no corren en CI.
