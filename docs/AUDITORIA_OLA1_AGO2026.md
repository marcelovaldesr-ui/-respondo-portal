# Auditoría adversarial de la Ola 1 (cobros, pedidos, conexión)

**Fecha:** 27 de agosto de 2026 · **Al cerrar:** 264 tests en verde · typecheck (app y
scripts) limpio · lint limpio.

> Método: atacar cada pieza como si quisiera romperla — dobles clics, reintentos de
> webhooks, datos corruptos, carreras entre dos personas, tablas sin migrar, Meta
> caída. Primero se listan los hallazgos ARREGLADOS, después lo que se revisó y
> estaba bien, y al final los límites conocidos que se aceptan a propósito.

---

## Hallazgos arreglados en esta pasada

### 🔴 1 · La protección estrella del generador de cotizaciones estaba ROTA

`generadorCotizacion.ts` leía «quién habló último» del hilo de **Beto** — pero la
conversación de cotización vive en el hilo de **Tino**, y el de Beto está vacío hasta
que él manda algo. Resultado: `ultimoRol` quedaba en null para TODOS los candidatos y
la regla «si el cliente habló último, no se le escribe» **jamás se activaba**. Beto
podía insistirle a alguien que había respondido hace una hora, pagando $85 por el
privilegio de quedar mal.

**Por qué los 17 tests no lo cazaron:** la regla pura era correcta; el bug estaba en
la plomería que la alimentaba. Lección repetida del panel de fidelización: que la
lógica esté bien probada no prueba que le llegue el dato correcto.

**Arreglo doble:**
1. La consulta ahora lee los mensajes de **todos los empleados del cliente** — para
   el cliente final es una sola conversación con el negocio.
2. **Fail-closed en la regla pura**: `ultimoRol` null → NO se envía (test nuevo).
   Con esta barrera, el mismo bug habría producido CERO envíos en vez de envíos
   indebidos — el lado correcto donde fallar cuando hay plata de por medio.

### 🔴 2 · Avisos de pedido DUPLICADOS al cliente final

`programarSeguimiento` no deduplica (el punto manual de `clientes/acciones.ts` lo
chequea aparte — esa asimetría fue la pista). Consecuencias reales:

- **Webhook:** los sistemas externos REINTENTAN; es la norma, no la excepción. Cada
  reintento era otro «tu pedido está listo».
- **Botón universal:** volver al chat y tocar de nuevo = segundo aviso a los 5 min.

**Arreglo:** ambos caminos consultan si ya hay un seguimiento del mismo tipo **en
cola** (`enviado_en is null`) para ese chat y responden ok sin duplicar. El webhook
responde `{ok:true, omitido}` para que el emisor deje de reintentar.

### 🟠 3 · Cobrar fuera de la ventana de 24 h daba el error crudo de Meta

El rollback ya funcionaba (la fila se borraba), pero la persona llenaba el formulario
y recibía el 131047 pelado. Ahora la ventana se chequea **antes de crear nada**, con
la función correcta (`ventanaAbierta`, por NÚMERO y no por hilo — la misma distinción
del vigilante de abandonadas) y un mensaje que dice qué hacer: retomar con plantilla
y cobrar cuando responda.

### 🟡 4 · El checklist de conexión mentía si faltaba la migración 283

supabase-js **no rechaza** en error de consulta — lo entrega en `r.error`. La rama de
éxito devolvía `count ?? 0`, así que una tabla inexistente se reportaba como «0
dispositivos»: un dato plausible y falso, la misma clase de mentira del «1 muy
grandes». Ahora error → «no verificable».

### 🟡 5 · Un cobro en un chat de Instagram mostraba «+ig:1436…» como contacto

Cosmético pero confuso: un IGSID no es un teléfono. Fallback → «Instagram».

---

## Atacado y resistió (no requirió cambios)

| Ataque | Resultado |
|---|---|
| Doble clic en «Cobrar» / Enter repetido | guard `enviando` en el componente + rate limit 10/min en el servidor |
| Dos personas marcando pagado el mismo cobro | el update condicionado (`eq estado anterior`) deja pasar a uno; el otro recibe «ya cambió de estado» |
| Des-pagar / des-anular | transiciones terminales, con test |
| Monto «25.000», «25,000», decimales, ceros de más | normalización + rango con bordes testeados + tope $10M |
| Enlace de pago `http://`, `javascript:`, basura | rechazado en la regla pura, con test |
| Envío del cobro falla a mitad de camino | fila borrada + control restaurado — no queda un cobro fantasma |
| Webhook sin credenciales / secreto malo / cliente ajeno | 401 con comparación en tiempo constante; contacto inexistente → 404 (jamás inicia conversación con desconocidos); `no_contactar` respetado |
| Cuerpo del webhook: no-JSON, arreglo, teléfono con formato, tipo inventado, detalle con saltos de línea | 8 tests de `pedidosCore`; saltos de línea limpiados (romperían la plantilla, 132012) |
| Migración 289 sin aplicar | detalle de conversación, Inicio y /cobros degradan a vacío/ceros sin romper (`catch` explícito en cada lectura) |
| Meta caída al abrir /whatsapp | timeout 8 s + «no se pudo consultar ahora», nunca página pegada |
| Cobro por Instagram | ruteo correcto (el bug del 17-ago no se repite); ventana no aplica en IG |
| Cobro por WAHA | `clienteId` pasado a `enviarTextoWaha` (la barrera multi-cliente del 11-ago) |
| PostgREST corta en 1.000 | todos los listados nuevos llevan `limit` explícito; conteos con `count/head` |

---

## Límites conocidos, aceptados a propósito

1. **«Marcar pagado» es palabra del negocio, no del banco.** Sin conciliación por API
   del proveedor (v2), el registro refleja lo que la persona declara. Es el mismo
   contrato que una libreta, pero compartido y con referencia.
2. **El tope diario de cotizaciones corta a medianoche UTC**, no de Chile (~3-4 h de
   corrimiento). Es un tope de gasto, no contabilidad: el corrimiento no cambia el
   máximo diario, solo desplaza la ventana. Se corrige si alguna vez importa.
3. **El primer cobro de un chat no aparece en el panel lateral hasta reabrir la
   conversación** (el detalle se refresca al volver). El mensaje sí se ve al tiro en
   el chat, que es la confirmación que importa.
4. **El botón Cobrar se muestra aunque falte el enlace de pago** — el error al usarlo
   explica exactamente qué configurar y dónde. Ocultarlo escondería la función que
   queremos que descubran.
5. **`pedido_listo` desde el webhook/botón mantiene un aviso en cola a la vez.** Para
   avisar dos pedidos distintos el mismo día al mismo cliente, el segundo sale cuando
   el primero ya se envió (minutos). Caso raro; si aparece, se afina.
