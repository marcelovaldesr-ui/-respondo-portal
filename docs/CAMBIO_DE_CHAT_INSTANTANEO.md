# Por qué cambiar de chat se sentía lento, y qué se hizo

**Fecha:** 25 de agosto de 2026
**Estado:** 164 tests en verde · typecheck limpio · lint limpio.

> Arreglar la `key` que faltaba resolvió que el chat **no cambiara**. Este
> documento es lo otro: que cuando cambia, sea **instantáneo**. Son dos problemas
> distintos y se confunden fácil.

---

## Primero: medir, no suponer

El camino entre que el dedo toca una fila y los mensajes aparecen tiene cinco
tramos. Se recorrieron uno por uno mirando el código, no de memoria:

| # | Tramo | Costo real |
|---|---|---|
| 1 | Clic → React redibuja | ~0 ms |
| 2 | Efecto → decide pedir | ~0 ms |
| 3 | Navegador → función de Vercel | red |
| 4 | **Función → base de datos** | **el grueso** |
| 5 | Respuesta → dibujar 60 burbujas | 10-30 ms |

El tramo 4 era el caro, y ahí aparecieron **cuatro problemas independientes**.
Ninguno se arregla con los otros: por eso van los cuatro.

---

## Problema 1 · La precarga no servía para nada

Al pasar el mouse por una fila se pedía el detalle "para adelantar trabajo".

**La respuesta se tiraba a la basura.** No se guardaba en ningún lado, y el
endpoint responde `Cache-Control: no-store`, así que el navegador tampoco la
conservaba. Al hacer clic se volvía a pedir todo desde cero.

Lo único que lograba era calentar la función de Vercel.

→ **`components/inbox/cacheDetalle.ts`**: la precarga y la lectura ahora comparten
el mismo almacén. Dos niveles: memoria (instantáneo) y `sessionStorage`
(sobrevive a recargas). Se usa `session` y no `local` a propósito: son
conversaciones de clientes reales y no deben quedar en disco más de lo necesario.

Incluye deduplicación de peticiones en vuelo, para el caso real de pasar el mouse
y hacer clic de inmediato: sin eso eran dos peticiones idénticas compitiendo, y
la segunda no llega antes por ser la segunda.

---

## Problema 2 · Un viaje en serie escondido dentro de un `Promise.all`

`obtenerConversacion` lanza seis consultas en paralelo. Un `Promise.all` tarda lo
que tarda la más lenta… **mientras ninguna rama encadene dos consultas por
dentro.**

`estadoVentana` encadenaba dos: primero preguntaba el transporte del cliente y
después, con esa respuesta, la fila de `ed_chat_estado`. El bloque entero pasaba
a tardar esa cadena.

Y además pedía esa fila **por segunda vez**: el `modo` de la misma fila ya se
estaba trayendo tres líneas más arriba.

→ El transporte viaja en paralelo, la fila de estado se pide **una** vez con las
dos columnas, y la ventana se calcula sin red. **Un viaje menos y una consulta
menos**, en el camino que corre cada vez que alguien abre una conversación.

Es un error que introduje yo el 24-ago al agregar la lógica de la ventana de
24 h. Queda una advertencia sobre el `Promise.all` para que no se repita: desde
afuera, una rama que encadena por dentro no se ve.

---

## Problema 3 · La pantalla no respondía al toque

Aunque el dato llegue en 300 ms, si en esos 300 ms no pasa nada, se siente lento.

La lista **ya tiene** en pantalla el nombre del contacto, quién atiende y en qué
modo está. Son exactamente los datos de la cabecera del chat.

→ Al hacer clic, la fila entrega esos datos y la cabecera se pinta **en el mismo
fotograma del toque**, sin una sola petición. Lo único que queda cargando son los
mensajes, con un esqueleto en su lugar.

Esto no acelera la red: hace que la pantalla responda. Es la diferencia entre
«toqué y no pasó nada» y «ya estoy en el chat, faltan los mensajes».

---

## Problema 4 · El primer clic y el teléfono quedaban fuera

La precarga al pasar el mouse cubre el segundo clic en adelante. No cubre:

- **El primer clic.** Nadie pasa el cursor por encima antes de decidir: se mira
  la lista y se hace clic.
- **El teléfono.** No hay mouse. Y es justo donde la conexión es peor.

→ Dos cosas. **`PrecargaInicial`** adelanta las 6 primeras conversaciones
mientras el navegador está desocupado (`requestIdleCallback`, de a una y
espaciadas para no competir con lo que la persona está mirando). Y la fila
precarga también en **`pointerdown`**, que en un teléfono ocurre 80-150 ms antes
que el `click`.

---

## Dos bugs de corrección encontrados en el camino

Estos no son de rendimiento. Son de mostrarle a alguien la conversación
equivocada, que es peor.

**1 · Un fotograma con dos chats mezclados.** Al hacer clic, la selección cambia
y React redibuja **enseguida**; el efecto que carga el detalle corre **después**.
En ese hueco quedaba la cabecera del chat nuevo sobre los mensajes del anterior —
y la `key` de `InboxConversacion` se armaba con el empleado nuevo y el chat
viejo, una combinación que no existe.

→ El detalle se guarda **junto a la clave de a quién pertenece**, y `d` se
calcula comparando. Si lo cargado no es de la conversación abierta ahora, vale
null. No hay fotograma posible con dos chats mezclados, porque ya no depende de
cuándo corra un efecto.

**2 · La conversación anterior atenuada.** Estaba puesto a propósito, "para que
no quede en blanco". Pero es mostrar los mensajes de un cliente bajo el nombre y
la URL de OTRO. Ahora ahí va la cabecera correcta y el esqueleto.

---

## Una trampa que casi introduzco

Al vaciar el detalle en cada cambio, la **columna de contexto desaparecía y
volvía**. En una grilla de tres columnas eso no deja un hueco: las otras dos se
ensanchan y se vuelven a angostar, o sea **la conversación entera salta de lugar
bajo el cursor** justo cuando la persona va a leer.

→ La columna se dibuja con "hay chat abierto", no con "llegó el detalle", y lo
que todavía no se sabe va como esqueleto ocupando su lugar.

---

## Resultado

| | Antes | Ahora |
|---|---|---|
| Chat ya visitado | pedía todo de nuevo | **0 peticiones, instantáneo** |
| Chat precargado al pasar el mouse | pedía todo de nuevo | **0 peticiones, instantáneo** |
| Primer clic al abrir la bandeja | esperaba entero | **normalmente ya está** |
| Chat nunca visto | pantalla anterior atenuada | **cabecera al instante** + esqueleto |
| Viajes a la base | 1 + cadena de 2 | **1 + 1 en paralelo** |
| Consultas a `ed_chat_estado` | 2 a la misma fila | **1** |

Lo que **no** cambió: los mensajes siguen llegando por el stream en vivo. La
caché es solo un adelanto — si se sirve algo de hace un minuto, el stream lo pone
al día en menos de un segundo.

---

## Lo que queda sin hacer, y por qué

- **Virtualizar la lista de mensajes.** Con 60 en pantalla no hace falta.
- **Caché en el servidor del detalle.** Habría que invalidarla con cada mensaje
  entrante; es más riesgo de mostrar algo viejo que ganancia.
- **Mover la función de Vercel a la región de la base.** Es lo único que queda
  con impacto grande en el tramo 3-4, y **no se puede decidir desde el código**:
  hay que mirar en qué región está el proyecto de Supabase y en cuál corren las
  funciones. Si están en continentes distintos, ahí hay 100-200 ms por viaje que
  ningún cambio de código recupera. **Vale la pena revisarlo.**
