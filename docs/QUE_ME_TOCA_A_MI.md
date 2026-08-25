# Lo que queda por hacer a mano

> **Actualizado el 21-ago-2026, tarde.** Además de lo de abajo se reescribió el chat del
> portal por rendimiento y se arregló la recepción de imágenes por Cloud API. Eso tiene su
> propio documento con las pruebas que hay que hacer con un teléfono real:
> **`docs/INBOX_RENDIMIENTO_AGO2026.md`**. No requiere migración.

Fecha: 21 de agosto de 2026.
Estado del código: **typecheck limpio, lint limpio y 136 tests en verde** (124 que ya
existían más 12 nuevos). Nada de lo que sigue es programar.

> Este archivo reemplaza al del 19-ago (plantillas de Meta). Los pasos de plantillas que ya
> hiciste no están repetidos acá; lo que quedó pendiente de esa tanda sí.

---

## Primero: lo que bloquea, y no es código

### 1 · Cargar el método de pago del WABA ⛔

Es lo único que separa a Beto y Vera de funcionar. Las plantillas ya están **aprobadas**,
pero Meta **siempre** cobra los mensajes que inicia el negocio: sin tarjeta cargada en el
portafolio, los rechaza todos aunque estén aprobados.

Mientras esto no esté, la prueba de punta a punta del seguimiento no se puede hacer.

### 2 · Subir la recategorización de `cotizacion_pendiente`

Quedó modificada en tu disco y sin commitear desde el 19-ago:

    lib/plantillas.ts
    tests/plantillas.test.mjs

En `HEAD` la plantilla **sigue declarada como `utility`**. Mientras no subas esto, el
catálogo dice $18 para algo que Meta cobra a $85.

### 3 · Decidir qué pasa con Isabel

La web publica cuatro empleados (`/empleados/isabel`, con foto y descripción) y afirma que
«trabajan juntos en la misma plataforma». En el código existen tres: `tino`, `rita` y
`vera`.

Construirla o sacarla de la web. Las dos son válidas; dejarla publicada como está, no.
Detalle del mismo orden: hay páginas `beto.astro` **y** `rita.astro` publicadas.

---

## Lo que hice hoy y necesita que lo despliegues

### 4 · Desplegar

    git add -A
    git commit -m "Paridad del camino de Meta con WAHA, botones nativos y atribucion de campana"
    git push

No lo commiteé yo: es tu repo y conviene que mires el diff. **Ojo que en ese `git add -A`
entran también los dos archivos del punto 2**, que es justo lo que queremos.

El cambio con más consecuencias es `lib/whatsapp.ts`, porque toca cómo se envía **todo** lo
que sale por Cloud API.

**No hace falta migración.** La atribución de campaña usa la columna `datos` de
`ed_contactos`, que ya viene en la 282; si esa migración todavía no está aplicada, el
código avisa en el log y sigue funcionando.

### 5 · Probar el ritmo humano  ·  10 minutos

Esto es lo que yo no puedo hacer: necesita un teléfono de verdad y un cliente en
`transporte = 'cloud'`.

1. Escríbele a Tino y mira que **aparezca «escribiendo…»** antes de la respuesta, y que la
   respuesta tarde 1,5–6 s en vez de salir instantánea.
2. Mándale **tres mensajes cortos seguidos** ("Hola" … "quiero cotizar" … "1000 flyers"),
   con 10-15 segundos entre uno y otro. **Tino debe responder UNA vez**, al final, teniendo
   en cuenta los tres. Antes contestaba tres veces.
3. Mándale un mensaje y, **mientras está "escribiendo"**, mándale otro. Solo debe salir la
   respuesta del segundo. En el inbox no debe quedar una respuesta que el cliente no vio.

> ⚠️ **Un formato que hay que verificar acá.** El indicador de «escribiendo…» de Meta se
> pide con un cuerpo que circula en dos variantes y la documentación oficial está tras
> login. Lo dejé envuelto en un `try/catch`, así que **si Meta lo rechaza el mensaje se
> manda igual** — pero no vas a ver el «escribiendo…». Si en la prueba 1 no aparece,
> búscame el error en los registros de Vercel y lo ajusto en dos minutos.

### 6 · Ver la atribución de campaña  ·  cuando corra una pauta

Cuando alguien entre por un anuncio de Click-to-WhatsApp, en `ed_contactos.datos` va a
quedar:

```json
{ "campana": { "anuncioId": "1202...", "tipo": "ad", "titular": "...", "visto": "2026-..." } }
```

Para verlo:

```sql
select chat_id, datos->'campana' from ed_contactos
where cliente_id = '<uuid>' and datos ? 'campana';
```

⚠️ Meta manda esto **solo en el primer mensaje** de la conversación. Y no lo pisamos
después: la primera referencia es la que trajo al cliente.

---

## Qué quedó hecho

| Pieza | Estado |
|---|---|
| **G1** · Debounce adaptativo en Cloud API (6/20 s según el mensaje) | ✅ |
| **G2** · Guardia anti-mensaje-fantasma antes de enviar | ✅ |
| **G3** · «Escribiendo…» + retardo humano proporcional | ✅ (formato del indicador por verificar) |
| Ritmo humano en un módulo compartido y con tests | ✅ `lib/ritmoHumano.ts` |
| Botones nativos de WhatsApp (enviar) | ✅ `enviarBotones()` |
| Atribución de campaña Click-to-WhatsApp | ✅ |
| Parser del webhook extraído y bajo test | ✅ `lib/parserMeta.ts` |
| Tests | ✅ 136 en verde, 12 nuevos |

### Lo que decidí NO hacer solo

- **Commitear y desplegar.** Toca producción.
- **Usar los botones en las conversaciones de Tino.** La capacidad quedó lista
  (`enviarBotones`), pero *decidir en qué momentos de la conversación aparecen* es diseño de
  producto, no implementación. Conviene elegir dos o tres lugares concretos —confirmar una
  hora, elegir entre dos servicios, "¿te dejo con alguien del equipo?"— y probarlos, en vez
  de llenarlo de botones.
- **Las brechas G4-G6** (adjuntos por Meta y freno de ritmo). Son de severidad media y baja
  y no bloquean instalar un cliente. Van en la próxima tanda.

---

## Dos cosas que sí revisé

A diferencia de la tanda anterior, esta vez alcancé a correr todo desde el contenedor:

- `npm test` → **136 en verde**
- `npx tsc --noEmit` → **limpio**
- `npx eslint` sobre los archivos tocados → **limpio**

Lo que no corrí es `npm run build`. El typecheck pasó completo, así que un error de
compilación sería raro, pero conviene correrlo antes de desplegar.
