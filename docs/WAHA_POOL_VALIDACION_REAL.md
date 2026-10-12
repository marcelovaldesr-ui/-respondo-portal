# Runbook Operativo: Validación con WAHA Real (Lunes en la Mañana)

**Fecha de entrada en vigencia:** Octubre 2026  
**Sistema:** Pool WAHA Multi-Chip para Envíos Kambak (`respondo-portal` v2)  
**Audiencia:** Operador de infraestructura, Administrador técnico de Respondo / Kambak  
**Objetivo:** Guía paso a paso para encender, verificar y validar el pool de números WAHA en ambiente de producción con chips físicos reales, sin riesgos de corte en Meta Cloud API ni spam a clientes.

---

## 1. Requisitos Previos

Antes de activar el tráfico de producción por el pool WAHA, verificar los siguientes puntos:

### 1.1 Base de Datos (Supabase)
1. Aplicar la migración idempotente `sql/326_waha_pool_v2.sql`.
   - Crea tablas `ed_waha_lids`, agrega columnas de control (`ultimo_ok_en`, `origen_ref`, índices concurrentes).
   - Crea funciones RPC atómicas: `waha_reservar_numero_cola`, `waha_marcar_envio_ok`, `waha_marcar_envio_fallido`.
2. Verificar que las tablas existen ejecutando `sql/consultas/kambak_pool_estado.sql`.

### 1.2 Servidor WAHA
1. Servidor WAHA Core/Plus levantado y accesible vía HTTPS (ej. `https://waha.tudominio.cl`).
2. API Key configurada y protegida.
3. Webhook global de WAHA apuntando a:  
   `https://portal.kambak.cl/api/whatsapp/webhook-waha-pool`  
   con cabecera `x-waha-signature` o secreto configurado.

### 1.3 Chips Físicos y Sesiones WhatsApp
1. Crear las sesiones en WAHA (ej. `waha-chip-1`, `waha-chip-2`).
2. Escanear el código QR desde cada teléfono Android/iPhone de soporte.
3. Verificar en WAHA que el estado de cada sesión sea `WORKING`.
4. Registrar los números en la tabla `ed_numeros_waha` con:
   - `estado`: `'calentando'` (si es chip nuevo) o `'activo'` (si ya tiene historial).
   - `sesion_waha`: nombre exacto de la sesión en WAHA.
   - `telefono`: número en formato E.164 (ej. `+56912345678`).
   - `tope_hoy`: 20 (para warmup día 1) o valor asignado.

---

## 2. Variables de Entorno en Producción (Vercel)

| Variable | Valor Recomendado | Descripción |
|---|---|---|
| `WAHA_POOL_APAGADO` | `0` | `1` apaga el pool completamente y conmuta tráfico a Meta. Dejar en `0` para operar. |
| `WAHA_API_URL` | `https://waha.tudominio.cl` | URL base del servidor WAHA sin barra final. |
| `WAHA_API_KEY` | `[secreto-waha-api]` | Token de autenticación de WAHA. |
| `WAHA_POOL_WEBHOOK_SECRETO` | `[secreto-hmac-webhook]` | Secreto para verificar webhooks entrantes de WAHA. |
| `WAHA_POOL_TOPE_MAX` | `150` | Límite máximo diario absoluto por chip (tope de seguridad). |
| `WAHA_POOL_AUTORESPUESTA` | `1` | `1` para respuesta automática de cortesía (máx 1/24h por contacto). `0` para silenciar. |
| `CRON_SECRET` | `[secreto-cron-vercel]` | Token para disparar `/api/cron/pool-kambak`. |

---

## 3. Checklist de Activación y Paso a Paso

### Paso 1: Verificación de Salud del Portal (`/api/salud`)
Ejecutar una consulta HTTP al endpoint de salud:
```bash
curl -s https://portal.kambak.cl/api/salud | jq .wahaPool
```
**Respuesta esperada:**
```json
{
  "totalChips": 2,
  "activos": 2,
  "calentando": 0,
  "pausados": 0,
  "cola": {
    "en_cola": 0,
    "enviando": 0,
    "antiguedadMinutos": 0
  }
}
```
Si `pausados > 0` o el servidor está inalcanzable, consultar `revisarSaludPool()` o revisar el log de Vercel.

### Paso 2: Estado Operativo en SQL
Ejecutar en la consola de Supabase las consultas de `sql/consultas/kambak_pool_estado.sql`:
- **Consulta 1 (Semáforo del pool):** Debe mostrar los chips con `salud = 'ok'`, `sesion_estado = 'WORKING'`.
- **Consulta 2 (Envíos de hoy):** Conteo inicial en 0.
- **Consulta 3 (Cola de despacho):** Cola limpia o con mensajes acumulados de noche pendientes de horario 09:00.

### Paso 3: Envío de Prueba Unitario
Realizar una petición firmada con HMAC a `/api/externo/mensajes`:
```bash
# Ejemplo de payload de prueba
{
  "clienteId": "kambak",
  "to": "+569XXXXXXXX",  # Teléfono de prueba del operador
  "template": "sello_promo",
  "language": "es",
  "variables": ["Operador", "Local Piloto", "Prueba Pool", "Verificando entrega", "Hoy"],
  "idempotencyKey": "prueba-operativa-001",
  "canalMarketing": "waha",
  "origen_ref": "local-piloto"
}
```
**Resultado esperado:**
- HTTP 200 `{ "ok": true, "status": "queued", "id": "..." }` (o `"sent"` si no hay cola).
- El mensaje ingresa en `ed_envios_api` con `canal = 'waha'`, `estado = 'en_cola'`.

### Paso 4: Disparo y Monitoreo del Drenado
Llamar al cron de drenado:
```bash
curl -X POST https://portal.kambak.cl/api/cron/pool-kambak \
  -H "Authorization: Bearer $CRON_SECRET"
```
**Verificaciones inmediatas:**
1. El teléfono de prueba recibe el mensaje en WhatsApp.
2. El mensaje llega con el texto formateado correctamente sin variables rotas.
3. En `ed_envios_api`, el registro cambia a `estado = 'sent'`, `waha_message_id` poblado.
4. En `ed_numeros_waha`, el chip utilizado incrementa `enviados_hoy` en 1 y actualiza `ultimo_envio_en` y `ultimo_ok_en`.

### Paso 5: Prueba de Inbound y Respuesta
1. Desde el teléfono de prueba que recibió el mensaje, responder cualquier texto (ej. "Hola, gracias").
2. Verificar que:
   - WAHA emite evento `message` hacia `/api/whatsapp/webhook-waha-pool`.
   - Se resuelve el LID si aplica y se almacena en `ed_waha_lids`.
   - Si `WAHA_POOL_AUTORESPUESTA=1`, el contacto recibe una sola respuesta automática amable.
   - Una segunda respuesta inmediata NO recibe otro mensaje automático (anti-bucle 24h).
3. Responder `BAJA`:
   - Verificar que se registra en `ed_bajas` para la cuenta Kambak.
   - Verificar que se emite webhook `contact.optout` hacia Kambak.
   - Enviar otro mensaje al mismo número: el portal debe responder `{ status: "skipped", reason: "opted_out" }`.

---

## 4. Gestión de Contingencias e Incidentes

### A. WAHA no responde o Servidor Caído
- **Detección:** `poolSalud` detecta 3 fallos consecutivos en llamadas a la API de WAHA.
- **Acción automática:** Activa backoff exponencial (pausa de 5 min a 60 min) en chips afectados. Los mensajes permanecen seguros en la cola. Si la cola excede antigüedad o la indisponibilidad persiste, se activa failover automático a Meta Cloud API para los mensajes urgentes.
- **Acción manual:** Si el servidor WAHA necesita mantenimiento prolongado:
  ```bash
  # En Vercel:
  WAHA_POOL_APAGADO=1
  ```
  Esto conmuta automáticamente el 100% del tráfico a Meta Cloud API sin pérdida de mensajes.

### B. Chip Bloqueado / Baneado por WhatsApp
- **Detección:** WAHA reporta `session.status = 'STOPPED'` o `FAILED`, o la tasa de fallo de los últimos 20 envíos supera el 20%.
- **Acción automática:** El chip pasa inmediatamente a `estado = 'pausado'`, `motivo_pausa = 'tasa_fallo_alta'` o `'sesion_desconectada'`. La cola excluye ese chip y utiliza los restantes del pool.
- **Acción manual:**
  1. En Supabase: revisar `sql/consultas/kambak_pool_operacion.sql` (Consulta 5: Calidad y señales de riesgo).
  2. Reemplazar el chip en el teléfono físico.
  3. Re-escanear el QR en WAHA con una nueva sesión.
  4. Actualizar `ed_numeros_waha` con el nuevo número y dejarlo en `estado = 'calentando'` con `tope_hoy = 20`.

### C. Alerta de Bajas Anormal (>3%)
- Si un local o campaña genera más de un 3% de bajas en una tanda:
  - Revisar el contenido de la plantilla y la segmentación del local en Kambak.
  - Asegurar que la lista de clientes tenga consentimiento explícito previo.

---

## 5. Rampa de Calentamiento (Warmup)

Los chips en estado `'calentando'` avanzan de forma estrictamente controlada por días hábiles de envío exitoso:
- **Día 1:** 20 mensajes/día
- **Día 2:** 35 mensajes/día
- **Día 3:** 50 mensajes/día
- **Día 4:** 75 mensajes/día
- **Día 5:** 100 mensajes/día
- **Día 6+:** Promoción a `'activo'` (tope según `WAHA_POOL_TOPE_MAX`, default 150/día).

**Condiciones obligatorias para que un chip avance de rampa:**
1. Haber alcanzado al menos el 70% de su cupo del día anterior.
2. Tasa de entrega exitosa > 90%.
3. `ultimo_ok_en` registrado (al menos un envío confirmado).
4. Cero bloqueos temporales en las últimas 24 horas.

La revisión y ajuste ocurre automáticamente a las 21:30 (hora de Chile) al cierre de la ventana hábil de marketing.
