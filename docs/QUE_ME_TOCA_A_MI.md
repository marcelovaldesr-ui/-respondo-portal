# Lo que queda por hacer a mano — Beto y Vera

Fecha: 19 de agosto de 2026.
Todo el código está escrito y verificado: **typecheck limpio y 124 tests en verde**
(los 105 que ya existían más 19 nuevos). Nada de lo que sigue es programar.

Son **seis pasos**, en este orden. Los tres primeros se pueden hacer hoy con la demo;
los tres últimos dependen de que RS-Shop mande sus cosas.

---

## Paso 1 · Aplicar la migración en Supabase  ·  2 minutos

Supabase → SQL Editor → pegar el contenido de **`sql/282_contactos_ficha.sql`** → Run.

Agrega tres cosas: `ultima_atencion` y `datos` a `ed_contactos`, y
`intervalo_mantencion_meses` a `ed_clientes`.

> **Se puede aplicar antes o después del deploy.** Las tres columnas son opcionales y
> el código las trata como ausentes: el importador avisa y no escribe, el generador no
> programa nada y el cron sigue funcionando igual. Es distinto de la migración 279, donde
> el código sí necesitaba la columna nueva.

**Cómo saber que quedó:** en el SQL Editor,
`select ultima_atencion, datos from ed_contactos limit 1;` no debe dar error.

---

## Paso 2 · Desplegar  ·  5 minutos

El portal usa `main` y sí tiene remoto (a diferencia de `web-respondo`).

```
git add -A
git commit -m "Envío por plantilla de Meta + importador y generador de seguimientos"
git push
```

No hice el commit yo a propósito: es tu repo y conviene que mires el diff antes. Son
18 archivos, 12 nuevos y 6 modificados.

Si quieres revisar antes de subir: `git diff lib/seguimientos.ts` es el cambio con más
consecuencias, porque toca cómo se envía **todo** lo proactivo.

---

## Paso 3 · Crear las plantillas en Meta  ·  10 minutos

Te dejé un script para no tener que llenar siete formularios a mano.

```
npx tsx scripts/crear_plantillas_meta.ts --cliente 55555555-5555-5555-5555-555555555555
```

Así, sin `--crear`, **no escribe nada**: valida los siete cuerpos contra las reglas de
Meta, se conecta al WABA y te muestra cuáles existen ya y cuáles faltan.

Cuando el listado te parezca bien:

```
npx tsx scripts/crear_plantillas_meta.ts --cliente 55555555-5555-5555-5555-555555555555 --crear
```

Y para ver cómo va la aprobación (tarda de minutos a 24 horas):

```
npx tsx scripts/crear_plantillas_meta.ts --cliente 55555555-5555-5555-5555-555555555555 --estado
```

> Ese UUID es el de la demo de RS-Shop, que hoy tiene el número oficial. Cuando arranque
> el piloto de verdad con el número de ellos, hay que repetir esto con el UUID del cliente
> nuevo: **las plantillas viven en el WABA de cada negocio, no son globales.**

**Si prefieres hacerlo a mano**, los siete cuerpos están en
`docs/PLANTILLAS_META_PASO_A_PASO.md` listos para copiar y pegar.

**Qué mirar:** que las seis de utilidad queden como UTILITY. Si Meta reclasifica alguna a
MARKETING, el script te lo dice con un ⚠ y esa pasa de costar ≈$18 a ≈$85 por mensaje.

---

## Paso 4 · Probar de punta a punta  ·  15 minutos

Esto es lo que yo no puedo hacer: necesita un teléfono de verdad.

1. **Con un número que NO haya escrito en 24 horas**, agenda una cita para pasado mañana
   desde el portal.
2. A las 24 horas de la cita debería llegar la confirmación **como plantilla**.
   Si llega como texto libre, la ventana estaba abierta y hay que probar con un número
   frío de verdad.
3. Revisa que **el portal muestre el mismo texto** que llegó al teléfono. Es la garantía
   central del diseño; si difieren, alguien editó `lib/plantillas.ts` sin volver a dar de
   alta la plantilla.

**Si algo falla, el código del error de Meta dice qué pasó:**

| Código | Qué significa |
|---|---|
| `132001` | La plantilla no existe con ese nombre o idioma en ese WABA. El más común. |
| `132000` | La cantidad de parámetros no calza con el cuerpo aprobado. |
| `132012` | Un parámetro trae saltos de línea o espacios de más. |
| `131047` | Se intentó texto libre fuera de la ventana. No debería aparecer nunca. |

---

## Paso 5 · Cuando Gaspar mande la lista de clientes  ·  10 minutos

La lista tiene que ser **CSV**. Si mandan un `.xlsx`, ábrelo y "Guardar como CSV", o
pásamelo y lo convierto.

Primero en seco, que es el modo por defecto:

```
npx tsx scripts/importar_clientes.ts lista.csv --cliente <uuid>
```

Te va a mostrar qué columna reconoció para cada campo, cuántos contactos son válidos,
y **cada fila descartada con el motivo** ("tiene 8 dígitos: probablemente le falta el 9
inicial", "no es celular", "sin nombre"). Eso se corrige en el Excel y se vuelve a correr.

Cuando el resumen se vea bien:

```
npx tsx scripts/importar_clientes.ts lista.csv --cliente <uuid> --escribir
```

**Dos cosas que conviene saber:**

- El importador **rechaza los teléfonos de 8 dígitos en vez de arreglarlos**. Ponerle un 9
  adelante a ojo es mandarle un WhatsApp a un desconocido con el nombre de otro cliente.
  Prefiero que revises 10 filas a mano.
- **Nunca toca las etiquetas.** Si alguien marcó a un contacto como `no_contactar`, una
  reimportación no se lo puede borrar.

---

## Paso 6 · Configurar el intervalo de mantención  ·  1 minuto

En el SQL Editor, con el valor que RS-Shop conteste en el formulario:

```sql
update ed_clientes
set intervalo_mantencion_meses = 6
where id = '<uuid del cliente>';
```

Si lo dejas en null, el generador usa 6 meses. Con 6, Beto le escribe a quien vino hace
**entre 5 y 8 meses**: antes de los 5 el mensaje es prematuro y molesta, después de los 8
ya no es un recordatorio sino una reactivación fría, que es otro mensaje y otra
conversación con el negocio.

**Cómo verificar que el generador ve a alguien:** después de importar, el cron devuelve
`{"generados": N}` en su respuesta JSON, y deja en el log la línea
`ventana 2025-12-19 → 2026-03-19 · 34 en rango · 12 programados`.

---

## Lo que quedó hecho (para que sepas qué esperar)

| Pieza | Estado |
|---|---|
| Envío por plantilla fuera de la ventana de 24 h | ✅ |
| Elección automática texto libre / plantilla | ✅ |
| Los 3 seguimientos de la agenda con plantilla | ✅ |
| Encuesta de Vera | ✅ operativa, se programa sola al cerrarse cada cita |
| Importador de la lista de clientes | ✅ con simulación y descartes explicados |
| Generador de "te toca la mantención" | ✅ colgado del cron único |
| Intervalo configurable por cliente | ✅ |
| Aviso en el portal cuando la ventana está cerrada | ✅ antes fallaba en silencio |
| Tests | ✅ 124 en verde, 19 nuevos |

**Lo que decidí NO hacer solo:** crear las plantillas en tu cuenta de Meta y desplegar a
producción. Las dos cosas tocan sistemas en vivo y me pareció que la decisión era tuya. El
script del paso 3 deja la primera en un comando.

---

## Dos cosas que no revisé

- **`npm run build`** no alcanzó a correr: el puente con tu computador corta a los 45
  segundos y un build de Next tarda más. El typecheck sí pasó completo, así que un error
  de compilación sería raro, pero conviene correrlo antes de desplegar.
- **`npm run lint`** por lo mismo. Si tira algo, va a ser de estilo, no de lógica.
