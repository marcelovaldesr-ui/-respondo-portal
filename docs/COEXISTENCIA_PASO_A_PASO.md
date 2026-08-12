# Coexistencia WhatsApp — conectar el número de Impresora Color

Estado al 11-ago-2026: app de Meta **aprobada y publicada**, Tech Provider
verificado, código de Embedded Signup + Coexistencia ya construido en el portal.
Lo que falta es configuración y un arreglo de base que hay que hacer **en orden**.

---

## ⚠️ El orden importa — no lo cambies

El paso 2 (migración) mueve un dato que el código VIEJO todavía usa. Si aplicas
la migración antes de desplegar el código nuevo, **Tino deja de responder** en
Impresora Color hasta que despliegues.

```
1. Deploy del código   →  2. Migración 275  →  3. Panel de Meta  →  4. Conectar
```

El código nuevo funciona con o sin la migración aplicada (tiene camino de
respaldo), así que desplegarlo primero es seguro. Al revés no.

---

## Por qué hacía falta un arreglo antes de conectar

`ed_clientes.waba_phone_id` estaba haciendo dos trabajos incompatibles:

- Para **WAHA** guardaba el nombre de la instancia (`impresora-color`) — así se
  rutean hoy los mensajes entrantes de Cecilia.
- Para **Meta** guarda el `phone_number_id` numérico de la Cloud API.

Al terminar el Embedded Signup, el portal sobrescribe ese campo con el id
numérico. En ese mismo instante el ruteo de WAHA se quedaba sin mapeo: si algo
de la vía oficial no quedaba fino, Tino se quedaba mudo **y sin camino de
vuelta**, porque el dato viejo ya estaba pisado.

Es el mismo patrón que causó el apagón de 21 horas de agosto: una sola variable
compartida entre dos sistemas, sin señal visible al desincronizarse.

La migración 275 le da a cada vía su propia columna (`waha_instancia` y
`waba_phone_id`), y agrega un CHECK para que no vuelvan a mezclarse.

---

## Paso 1 — Desplegar el código

Commit y push de lo que se cambió hoy:

- `sql/275_waha_instancia.sql` (nuevo)
- `lib/waha.ts` — resuelve el cliente por `waha_instancia`, con respaldo al
  campo viejo mientras la migración no esté aplicada.
- `app/api/whatsapp/onboarding/route.ts` — verifica contra Meta si el número
  quedó realmente en Coexistencia (`is_on_biz_app`) y lo guarda.
- `app/(portal)/whatsapp/page.tsx` — muestra el modo (Coexistencia / solo API).

Espera a que Vercel termine el deploy antes de seguir.

---

## Paso 2 — Aplicar la migración

Supabase → SQL editor → pega y ejecuta **`sql/275_waha_instancia.sql`** completo.

Al final devuelve una tabla de verificación. Impresora Color debe quedar así:

| nombre | transporte | waha_instancia | waba_phone_id |
|---|---|---|---|
| Impresora Color | waha | impresora-color | *(null)* |

Si `waha_instancia` sale vacío, **para acá y avísame** — no sigas al paso 4.

Prueba rápida: mándale un WhatsApp a Cecilia (o pídele que te escriba) y
confirma que Tino sigue respondiendo normal. Todavía estás en WAHA; nada
debería haber cambiado.

---

## Paso 3 — Configurar el panel de Meta

### 3.a Campos del webhook (esto es lo que hace funcionar la Coexistencia)

App **Respon.do** → **WhatsApp → Configuración** → sección Webhook → *Administrar*.

Además de `messages` que ya está, activa:

| Campo | Para qué sirve |
|---|---|
| `smb_message_echoes` | **El más importante.** Cuando Cecilia responde desde su teléfono, el portal se entera y Tino se hace a un lado en esa conversación. Sin esto, Tino le contesta encima al cliente. |
| `smb_app_state_sync` | Sincroniza los contactos de su agenda. |
| `history` | Permite importar conversaciones pasadas (ver nota abajo). |

### 3.b Variables en Vercel

Confirma que existan estas cinco (deberían estar de las pruebas del 5-ago):

```
NEXT_PUBLIC_WHATSAPP_APP_ID      ← App ID de Respon.do
NEXT_PUBLIC_WHATSAPP_CONFIG_ID   ← id de la configuración de Embedded Signup
WHATSAPP_APP_ID                  ← mismo App ID
WHATSAPP_APP_SECRET              ← secreto de la app
WHATSAPP_VERIFY_TOKEN            ← respondo-tino-verify-2026
```

Si tocas alguna, redeploy.

### 3.c Token permanente

Si el token de la app sigue siendo temporal, genera uno de **Usuario del
sistema** (business.facebook.com → Configuración del negocio → Usuarios del
sistema), con `whatsapp_business_messaging` y `whatsapp_business_management`.
Ese no expira. En Coexistencia el token del cliente lo entrega el propio
Embedded Signup, así que esto es para la app, no para Cecilia.

---

## Paso 4 — Conectar el número de Cecilia

Requisitos de su lado:

- App de WhatsApp Business **versión 2.24.17 o superior**.
- El número tiene que tener actividad reciente (Meta rechaza números nuevos o
  inactivos). El de Cecilia la tiene de sobra.

Flujo:

1. Entra al portal como Impresora Color → **WhatsApp** → *Conectar WhatsApp*.
2. Inicia sesión con la cuenta de Facebook del negocio.
3. Elige **conectar el número que ya usa en la app de WhatsApp Business**.
4. Meta muestra un código. Cecilia, **en su teléfono**, recibe un mensaje de
   la cuenta oficial de Facebook Business → *Conectar* → *Confirmar* → pega el
   código.
5. Al terminar, la página debe mostrar **Modo: Coexistencia**.

Si dice "Solo API", **avísame antes de seguir** — significa que el número no
quedó compartido con la app y Cecilia perdería el uso desde su teléfono.

---

## Paso 5 — Probar antes de cantar victoria

Con el número ya conectado, prueba estas tres cosas en orden:

1. **Entrante:** escríbele al número desde otro teléfono → Tino responde.
2. **Toma humana:** que Cecilia responda desde su app en esa misma conversación
   → en el portal la conversación pasa a modo humano y Tino se calla.
3. **Saliente desde el portal:** responde desde el inbox del portal → llega.

Si las tres pasan, recién ahí Impresora Color está de verdad en la vía oficial.

---

## Rollback (si algo sale mal)

Una línea en Supabase:

```sql
update ed_clientes set transporte = 'waha' where nombre = 'Impresora Color';
```

Vuelve a salir todo por WAHA al instante. El mapeo de WAHA sigue intacto en
`waha_instancia`, que es justamente el punto de la migración 275.

---

## Nota: NO sincronizar el historial

Meta permite importar hasta 180 días de conversaciones al conectar (hay una
ventana de 24 h para pedirlo, y es irreversible: una sola vez por conexión).

**Para Impresora Color no conviene.** El portal ya tiene ese historial guardado
desde WAHA — importarlo otra vez duplicaría cada conversación en el inbox y en
las métricas. La sincronización de historial tiene sentido para un cliente
NUEVO que llega con su historial en el teléfono y nada en el portal.

Por eso el paso no está construido. Si algún día entra un cliente así, se
implementa con la SMB App Data API (`sync_type: "history"`).

---

## Lo que Cecilia pierde al pasar a Coexistencia

Confirmado con Marcelo (11-ago): no usa ninguna de estas, así que no aplica.
Se deja anotado para el próximo cliente:

- Listas de difusión (quedan de solo lectura)
- Mensajes temporales y "ver una vez"
- Ubicación en tiempo real
- Catálogo, pedidos y estados desde la API
- Respuestas rápidas, etiquetas y mensajes de ausencia de la app

Sigue funcionando igual: chats 1 a 1, llamadas y videollamadas, contactos, y su
perfil de negocio.
