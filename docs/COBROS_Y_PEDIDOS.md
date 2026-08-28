# Cobros en conversación + avisos de pedido

**Fecha:** 27 de agosto de 2026 · **Estado:** 255 tests en verde · typecheck (app y
scripts) limpio · lint limpio.

> Las dos funciones de la Ola 1 del plan de plataforma, construidas completas. La
> primera es la que convirtió a Vita en «el equipo que opera tu centro»; la segunda
> es la que deja a Beto funcionando en un negocio que entrega pedidos.

---

## 1 · Cobrar dentro de la conversación

### Qué es

El negocio configura **una vez** su enlace de pago (Mercado Pago, Flow, Getnet — todos
permiten crear un link sin API) en **Información → Cobros por WhatsApp**. Desde ahí,
en cualquier conversación aparece el botón **💲 Cobrar**: monto + concepto, y sale un
mensaje con el enlace y una referencia `P-XXXXXX`. El cobro queda registrado con
estado, y se marca **pagado** o **anulado** desde el panel de la derecha.

### Qué NO es, y es deliberado

**No somos pasarela.** La plata va directo del cliente final al negocio por SU
proveedor. Eso nos deja fuera de regulación financiera y de PCI. La conciliación
automática contra la API del proveedor es la v2, cuando un cliente la pida.

### El caso que lo valida

Cecilia dictó los datos de transferencia **90 veces en un mes** de mensajes, a mano,
y después persiguió comprobantes. Eso es exactamente lo que este flujo elimina.

### Decisiones que conviene no revisar de nuevo

- **Inerte sin enlace configurado** — mismo criterio que cupos y reingreso.
- **`pagado` es terminal.** Des-pagar cambiaría el total del mes hacia atrás sin
  rastro. La corrección correcta es anular + cobro nuevo.
- **La referencia no usa 0/O ni 1/I/L**: la gente la dicta por teléfono.
- **El update de estado va condicionado en la base** (`eq estado anterior`): dos
  personas marcando a la vez no se pisan; el segundo recibe el aviso.
- **Si el envío falla, la fila se borra**: nunca se comunicó nada, así que dejar el
  registro sería inventar un cobro que no existió.
- Tope $10.000.000 por cobro: cinturón contra el cero de más.

### Archivos

`lib/pagosCore.ts` (reglas puras, 16 tests) · `lib/pagos.ts` (datos) ·
`accionesPagos.ts` (server actions, mismo camino de envío que responder a mano,
incluido el ruteo de Instagram) · `components/inbox/Cobro.tsx` y `PagosCard.tsx` ·
migración **289**.

---

## 2 · Avisos de pedido: los dos caminos

El estado de un pedido vive en el sistema de cada negocio. **Respondo no compite con
eso** (decidido contra Tecnom: no construir DMS). Lo que ponemos es la capa que le
habla al cliente final, con dos formas de enterarse:

### Camino universal — sin sistema externo

En el panel de contexto de la conversación (solo rubros que entregan: imprenta,
tienda, retail) hay una tarjeta **«Pedido listo»**: se escribe qué pedido es y un
toque programa el aviso. El motor de seguimientos decide solo si sale como texto
libre (ventana abierta, gratis) o como la plantilla `pedido_listo`, con todas sus
salvaguardas: horario hábil, `no_contactar`, reintentos. Sale en ≤5 minutos.

### Camino integrado — el sistema del cliente avisa

```
POST https://<portal>/api/integraciones/pedidos
Headers:  X-Respondo-Cliente: <uuid del cliente>
          X-Respondo-Secreto: <secreto de ed_integraciones>
Body:     { "chat_id": "56912345678",
            "tipo": "pedido_listo" | "encargo_llego",
            "detalle": "500 tarjetas" }
```

El secreto es el de `ed_integraciones` (el mismo del puente saliente — un secreto por
integración, dos direcciones). Barreras: comparación en tiempo constante, freno por
IP, **el contacto tiene que existir** (esto avisa sobre conversaciones reales, no
inicia relaciones con desconocidos), respeta `no_contactar`, y valida que el rubro
tenga la plantilla.

La app de Gestión de Impresora es el primer consumidor natural: cuando Cecilia marque
un pedido como listo allá, un POST acá y el aviso sale solo. **Ese enganche del lado
de Gestión queda pendiente y es opcional** — el camino universal ya cubre el caso.

### Argumento comercial

«Ya tengo mi sistema» deja de ser una objeción y pasa a ser el punto de conexión:
*tu sistema manda un aviso, tu cliente recibe un WhatsApp*.

---

## Prueba manual (después de migración 289 + deploy)

1. Información → pegar un enlace de pago → Guardar.
2. Abrir una conversación → 💲 Cobrar → $1.000, «prueba» → debe llegar el mensaje con
   enlace y referencia, y aparecer la tarjeta «Cobros de este chat».
3. Marcar pagado → la etiqueta cambia; intentar marcarlo de nuevo desde otra pestaña
   debe decir «ya cambió de estado».
4. En un chat de Impresora → tarjeta «Pedido listo» → escribir «500 tarjetas» →
   avisar → en ≤5 min llega el mensaje (texto libre si la ventana está abierta).
5. Webhook: `curl -X POST .../api/integraciones/pedidos` con las cabeceras y un
   chat_id real → `{"ok":true,"programado":"pedido_listo"}`.
