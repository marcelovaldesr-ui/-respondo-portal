# El chat del portal: qué se arregló y cómo probarlo

**Fecha:** 21 de agosto de 2026
**Objetivo:** que el inbox se sienta como WhatsApp o Instagram nativos, y que las
imágenes que manda un cliente se puedan ver.
**Estado:** 150 tests en verde, typecheck y lint limpios.

---

## 1. Lo que estaba roto (no "mejorable": roto)

### Las imágenes NO llegaban por Cloud API

Tres eslabones cortados, uno detrás del otro:

1. `parserMeta` reconocía que venía una foto —por eso escribía «[el cliente envió una
   imagen]»— pero **descartaba el `id`**, que es lo único con lo que se puede pedir el
   archivo a Meta.
2. `inboundMeta` nunca pasaba los metadatos del adjunto a `guardarMensaje`, así que
   `media_tipo` quedaba en NULL y el inbox no dibujaba nada.
3. `/api/whatsapp/media` **solo sabía resolver por WAHA**.

Como todo cliente nuevo entra por Cloud API, en la práctica esto significa que **la función
no existía para nadie salvo Impresora Color**. Y enviar archivos tampoco: el portal
respondía «llega en una próxima etapa».

### El chat pedía la conversación entera cada 4 segundos

`/api/whatsapp/mensajes` devolvía **200 mensajes completos** y el navegador reemplazaba el
arreglo entero en React. Eso encadenaba tres problemas:

- **Red**: ~52 KB cada 4 s, por pestaña, aunque no hubiera pasado nada.
- **Render**: reemplazar el arreglo obliga a React a redibujar todo. Y como la clave era el
  **índice del arreglo**, además re-montaba cada burbuja: las imágenes se volvían a pedir y
  parpadeaban en cada ciclo.
- **Percepción**: hasta 4 segundos para ver un mensaje. WhatsApp entrega en menos de uno.

### Y cuatro cosas más

- **Cada tecla redibujaba la conversación**: el texto en curso vivía en el mismo componente
  que la lista.
- **El scroll secuestraba**: bajaba al final en cada mensaje nuevo aunque estuvieras leyendo
  algo de ayer.
- **Los ✓✓ no existían.** El dato estaba en la base desde la migración 213 y el inbox
  simplemente no lo mostraba: no había forma de saber si un mensaje llegó.
- **El sondeo seguía corriendo con la pestaña oculta**, pidiendo 200 mensajes para nadie.

---

## 2. Qué se hizo

| Pieza | Archivo | Qué resuelve |
|---|---|---|
| Extracción del adjunto de Meta | `lib/parserMeta.ts` | Guarda el `id` con el que se descarga |
| Guardado del adjunto | `lib/inboundMeta.ts` | `meta:<id>` en `media_url` — sin migración nueva |
| Proxy con dos transportes | `app/api/whatsapp/media` | Resuelve por Meta **y** por WAHA, con caché de un año |
| Envío de archivos por Cloud | `lib/whatsapp.ts` | `subirMediaMeta` + `enviarMediaMeta` |
| Subida binaria con progreso | `app/api/whatsapp/adjunto` | Reemplaza el base64; tope real 16 MB |
| Consultas incrementales | `lib/inboxConsulta.ts` | Delta, historial e estados, con respaldo de columnas |
| Empuje en vivo | `app/api/whatsapp/stream` | SSE, latencia ~0,9 s |
| Transporte del navegador | `components/inbox/useMensajesEnVivo.ts` | SSE → sondeo adaptativo → pausa si está oculta |
| Burbuja memoizada | `components/inbox/Burbuja.tsx` | Clave estable + ✓✓ de entrega |
| Compositor aislado | `components/inbox/Compositor.tsx` | Escribir ya no redibuja la lista |
| Imágenes | `components/inbox/Adjunto.tsx` | Espacio reservado, carga diferida, visor |

### Medición

| | Antes | Ahora |
|---|---|---|
| Refresco sin novedad | 52,2 KB | **0,08 KB** |
| Tráfico por hora, 1 pestaña | 45,9 MB | **0,02 MB** |
| Carga inicial del detalle | 500 mensajes · 121 KB | 60 mensajes · **15 KB** |
| Latencia de un mensaje | 0-4 s (prom. 2,0) | **0-0,9 s (prom. 0,45)** |
| Re-render al escribir | toda la lista | **nada** |

---

## 3. Decisiones que conviene conocer

### Por qué SSE y no Supabase Realtime

Realtime era menos código, pero conecta el **navegador directo a la base**, y en este portal
el aislamiento entre clientes **está hecho por código, no por RLS**: cada consulta filtra por
`cliente_id`. Abrir ese canal dejaría el aislamiento dependiendo de políticas que hoy no
existen — sería el hallazgo de WAHA otra vez, pero para lectura.

Con SSE la barrera sigue siendo la de siempre: sesión de portal y empleado del cliente
logueado, en un solo punto.

### Por qué el filtro incremental es inclusivo (`>=`)

Lo natural sería pedir "estrictamente posterior al último que tengo". Pero dos mensajes
pueden compartir el mismo `creado_en` al milisegundo —pasa en una ráfaga— y con `>` el
segundo **se perdería para siempre**, sin error.

Perder un mensaje de un cliente es inaceptable; repetir uno no cuesta nada porque se
deduplica por id. Se acota por fecha y se garantiza por id.

### Por qué se borró la server action de adjuntos

Se eliminó `enviarArchivoComoHumano` en vez de dejarla "por si acaso". Dos caminos de envío
conviviendo es exactamente cómo uno se queda atrás — ya pasó con la lógica de versiones
duplicada, y el resultado fue el cartel de error que queríamos evitar.

### Por qué la caché del proxy es de un año

El contenido de un mensaje es inmutable: la foto que mandaron el martes es la misma para
siempre. Antes eran 5 minutos, así que reabrir una conversación volvía a descargar cada foto
— y por Cloud API cada descarga son **dos viajes a Meta**, no uno. Va como `private` para que
quede en el navegador de esa persona y fuera de cualquier CDN compartida.

---

## 4. Qué te toca probar

Nada de esto necesita migración. **No hay SQL que aplicar.**

### 4.1 · Recibir una imagen (lo más importante)

Con un cliente en `transporte = 'cloud'`:

1. Mándale una **foto con texto** al número del negocio desde otro teléfono.
2. En el portal debe verse **la imagen**, no «[el cliente envió una imagen]».
3. Tócala: se abre el visor a pantalla completa, con botón de descarga.
4. Manda una foto **sin texto** y un **PDF**. El PDF debe aparecer como enlace.

> Si la imagen no carga, el error está en los registros de Vercel como
> `[whatsapp] resolverMediaMeta`. El caso más probable es que el token del cliente no tenga
> permiso sobre ese media.

### 4.2 · Enviar una imagen

1. Adjunta una foto con 📎. Debe verse **al instante** (vista previa local) con una barra de
   progreso, antes de que el servidor conteste.
2. **Copia una imagen y pégala** con Ctrl+V sobre la caja de texto: debe enviarse igual.
3. Que llegue al teléfono, y que en el portal quede la imagen en el historial.

### 4.3 · El ritmo en vivo

1. Escribe desde otro teléfono: el mensaje debe aparecer en **menos de un segundo**.
2. El puntito verde al lado del nombre indica que está en vivo. Ámbar = sondeo, gris =
   reconectando.
3. **Sube el scroll** a leer mensajes viejos y pide que te escriban: no debe arrastrarte
   abajo; aparece un botón «N mensajes nuevos ↓».
4. Escribe un mensaje largo en la caja: la conversación no debe titilar.

### 4.4 · Los ✓✓

Al enviar: 🕘 → ✓ (salió) → ✓✓ (entregado) → ✓✓ azul (leído). Si se queda en 🕘 mucho rato,
el envío no está saliendo.

### 4.5 · Historial

En un chat largo, arriba aparece «Ver mensajes anteriores». Al apretarlo, la conversación
**no debe saltar**: te quedas mirando el mismo mensaje.

---

## 5. Lo que quedó pendiente a propósito

- **Virtualizar la lista.** Con 60 mensajes visibles y paginación no hace falta. Si algún
  cliente carga 2.000 en pantalla, ahí sí.
- **Miniaturas del lado del servidor.** Requiere `sharp` como dependencia nueva. Con caché de
  un año, espacio reservado y carga diferida, el problema práctico ya está resuelto.
- **Enviar audio.** No lo pidió nadie todavía.
- **Adjuntos por Instagram.** Sigue avisando que solo se puede texto.
