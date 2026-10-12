# Informe de Cierre: Hardening e Integración Pool WAHA Kambak v2

**Fecha de entrega:** 12 de octubre de 2026  
**Constructor:** Antigravity (Guardia Nocturna)  
**Destinatario:** Marcelo  
**Ramas:**
- **Portal (`respondo-portal`):** `feat/kambak-waha-pool-v2` (HEAD: `7ab015c`, empujada a origin)
- **Kambak (`fideliza98-lab/sello-fidelizacion`):** `claude/pool-waha-avisos` (HEAD: `a3c692e`, empujada a origin)

---

## 1. Tabla de Estado por Fase

### Pista A: Portal (`respondo-portal`)

| Fase | Prioridad | Estado | Commit | Archivos clave | Tests agregados |
|---|---|---|---|---|---|
| **P0** | M | **HECHO** | `8d98997` | `sql/326_waha_pool_v2.sql`, `docs/PROGRESO_NOCHE_POOL.md` | Baseline (1196 ok / 5 preexistentes) |
| **P1** | M | **HECHO** | `679c90d` | `lib/wahaPoolIdentidad.ts`, `lib/inboundWahaPool.ts`, `sql/326_waha_pool_v2.sql` | 7 tests (`kambak-pool-identidad.test.mjs`) |
| **P2** | M | **HECHO** | `aedf87c` | `lib/poolSalud.ts`, `lib/wahaPool.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql` | 8 tests (`kambak-pool-salud-v2.test.mjs`) |
| **P3** | M | **HECHO** | `8ec07eb` | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | 4 tests (`kambak-pool-envios-v2.test.mjs`) |
| **P4** | M | **HECHO** | `90bc514` | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | 6 tests (`kambak-pool-cola-v2.test.mjs`) |
| **P5** | M | **HECHO** | `558e750` | `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql` | 4 tests (`kambak-pool-cupos-v2.test.mjs`) |
| **P6** | M | **HECHO** | `c90bb1e` | `lib/kambakEnvios.ts`, `lib/webhookSalida.ts`, `docs/contrato-eventos-kambak.json` | 5 tests (`kambak-pool-eventos-v2.test.mjs`) |
| **P7** | S | **HECHO** | `9f04d20` | `lib/poolNumeros.ts`, `lib/poolSalud.ts`, `sql/consultas/kambak_pool_operacion.sql` | 4 tests (`kambak-pool-warmup.test.mjs`) |
| **P8** | S | **HECHO** | `29373d7` | `lib/inboundWahaPool.ts`, `lib/poolNumeros.ts` | 8 tests (`kambak-pool-respuestas.test.mjs`) |
| **P9** | S | **HECHO** | `a38a589` | `lib/poolSalud.ts`, `sql/consultas/kambak_pool_estado.sql` | 4 tests (`kambak-pool-visibilidad.test.mjs`) |
| **P10** | S | **HECHO** | `1d0df9e` | `app/api/externo/mensajes/cancelar/route.ts`, `tests/_baseMemoria.mjs` | 4 tests (`kambak-pool-cancelar.test.mjs`) |
| **P11** | S | **HECHO** | `224d18a` | `lib/kambakEnvios.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql` | 5 tests (`kambak-pool-piloto.test.mjs`) |
| **P12** | C | **HECHO** | `7ab015c` | `docs/WAHA_POOL_VALIDACION_REAL.md`, `tests/kambak-pool-carga.test.mjs` | 4 tests (`kambak-pool-carga.test.mjs`) |
| **P13** | C | **HECHO** | `7ab015c` | `app/api/cron/pool-kambak/route.ts`, `KAMBAK.md`, `PLAN_KAMBAK_WAHA_POOL_OCT2026.md` | Full suite y compilación verificada |

### Pista B: Kambak (`fideliza98-lab/sello-fidelizacion`)

| Fase | Prioridad | Estado | Commit | Archivos clave | Tests agregados |
|---|---|---|---|---|---|
| **K0** | M | **HECHO** | `6af03e9` | `TAREAS.md` (reserva directa a main) | Inspección de arquitectura |
| **K1** | M | **HECHO** | `03b93da` | `lib/routes-crm.js`, `lib/messaging.js` | 6 tests (`test/pool-waha-avisos.test.js`) |
| **K2** | M | **HECHO** | `03b93da` | `lib/respondo.js`, `test/fixtures/contrato-eventos-kambak.json` | 6 tests de eventos terminales |
| **K3** | M | **HECHO** | `03b93da` | `public/panel.html`, `public/js/gestion.js`, `lib/routes-crm.js` | Verificación de polling y desglose |
| **K4** | M | **HECHO** | `03b93da` | `lib/bajas.js`, `lib/routes-crm.js` | 4 tests de supresión global |
| **K5** | S | **HECHO** | `a3c692e` | `lib/routes-crm.js`, `lib/respondo.js`, `public/js/gestion.js` | 5 tests (cancelación y reversión cupo) |
| **K6** | S | **HECHO** | `a3c692e` | `lib/respondo.js`, `lib/messaging.js` | 3 tests (`isPoolStore` y `buildBody`) |
| **K7** | S | **HECHO** | `a3c692e` | `public/js/gestion.js` | Validación UI y textos transparentes |
| **K8** | M | **HECHO** | `a3c692e` | `TAREAS.md`, `CAMBIOS.md`, `CONTEXTO.md` | Documentación técnica e historial |
| **K9** | C | **HECHO** | `03b93da` | `test/fixtures/contrato-eventos-kambak.json` | Fixtures sincronizados |

---

## 2. Resultados de Suites de Pruebas y Linter

### 2.1 Portal (`respondo-portal`)
- **`npm test`**: **1271 tests ejecutados**, **1266 pasados**, **5 fallos preexistentes**.
  - Los 5 fallos corresponden exclusivamente a la suite ajena de reservas de Pilates (`whatsapp-booking-actions.test.mjs`), documentados como preexistentes antes de iniciar.
  - **100% de los 136 tests de la suite del pool WAHA pasan en verde sin errores.**
- **`npm run lint`**: **0 errores**, 1 warning preexistente en página estática ajena (`app/privacidad/page.tsx` con etiqueta `<img>`).

### 2.2 Kambak (`sello-fidelizacion`)
- **Suite autónoma en memoria:**
  - `node test/pool-waha-avisos.test.js`: **30 pruebas pasadas, 0 fallidas (100% verde)**.
  - `node test/respondo.test.js`: **38 pruebas pasadas, 0 fallidas (100% verde)**.
  - Total: **68/68 pruebas pasando**.
- **Nota del emulador:** `test/api.test.js` requiere emulador externo de Firebase o service account real (no disponible en entorno local según las reglas de no tocar producción). La suite autónoma con base en memoria replica exactamente el contrato de Firestore de manera aislada y determinista.

---

## 3. Verificación de Integridad de Archivos Protegidos

Resultado del comando de control `git diff origin/feat/kambak-waha-pool --stat`:

```
 KAMBAK.md                                  |  61 +++
 app/api/cron/pool-kambak/route.ts          |  89 ++++
 app/api/externo/mensajes/cancelar/route.ts | 109 +++++
 docs/PLAN_KAMBAK_WAHA_POOL_OCT2026.md      |   8 +-
 docs/PROGRESO_NOCHE_POOL.md                | 349 +++++++++++++
 docs/WAHA_POOL_VALIDACION_REAL.md          | 171 +++++++
 docs/contrato-eventos-kambak.json          | 134 +++++
 lib/inboundWahaPool.ts                     | 200 +++++++-
 lib/kambakEnvios.ts                        | 415 ++++++++++++++--
 lib/poolNumeros.ts                         | 191 +++++++-
 lib/poolSalud.ts                           | 755 ++++++++++++++++++++++++++---
 lib/wahaPool.ts                            |  73 ++-
 lib/wahaPoolIdentidad.ts                   | 387 +++++++++++++++
 sql/326_waha_pool_v2.sql                   | 135 ++++++
 sql/consultas/kambak_pool_estado.sql       |  80 +++
 sql/consultas/kambak_pool_operacion.sql    |  97 ++++
 tests/_baseMemoria.mjs                     |   9 +-
 tests/kambak-pool-cancelar.test.mjs        | 166 +++++++
 tests/kambak-pool-carga.test.mjs           | 344 +++++++++++++
 tests/kambak-pool-cola-v2.test.mjs         | 295 +++++++++++
 tests/kambak-pool-cupos-v2.test.mjs        | 197 ++++++++
 tests/kambak-pool-envios-v2.test.mjs       | 202 ++++++++
 tests/kambak-pool-eventos-v2.test.mjs      | 263 ++++++++++
 tests/kambak-pool-identidad.test.mjs       | 290 +++++++++++
 tests/kambak-pool-piloto.test.mjs          | 157 ++++++
 tests/kambak-pool-respuestas.test.mjs      | 204 ++++++++
 tests/kambak-pool-salud-v2.test.mjs        | 295 +++++++++++
 tests/kambak-pool-visibilidad.test.mjs     | 182 +++++++
 tests/kambak-pool-warmup.test.mjs          | 178 +++++++
 29 files changed, 5909 insertions(+), 127 deletions(-)
```

### Lista de verificación de archivos protegidos (§1.2):
- [x] `lib/waha.ts` — **INTACTO** (0 cambios)
- [x] `lib/inboundWaha.ts` — **INTACTO** (0 cambios)
- [x] `app/api/whatsapp/webhook-waha/route.ts` — **INTACTO** (0 cambios)
- [x] `lib/whatsapp.ts` — **INTACTO** (0 cambios)
- [x] `lib/inboundMeta.ts` — **INTACTO** (0 cambios)
- [x] `lib/plantillas.ts` — **INTACTO** (0 cambios)
- [x] `lib/plantillasKambak.ts` — **INTACTO** (0 cambios)
- [x] Migraciones 322 a 325 — **INTACTAS** (todos los cambios de esquema están en `sql/326_waha_pool_v2.sql`, no aplicada)

---

## 4. Decisiones Tomadas por Cuenta Propia (para Revisión de Marcelo)

1. **Resolución de LID con seguridad conservadora (P1):**
   - Ante cualquier mensaje con identidad enmascarada (`@lid`) que no pueda ser resuelto con certeza unívoca mediante caché, API de WAHA o correlación de 72h con un único candidato, el sistema **nunca registra BAJA** ni envía auto-respuesta. En su lugar, marca el mensaje como `[sin_telefono: LID...]` y emite una alerta a HQ (con rate-limit de 1h) para verificación humana.
2. **Backoff exponencial en caída de servidor WAHA (P2):**
   - Si la API de WAHA falla 3 veces consecutivas, el pool no continúa golpeando el servidor caído: activa una pausa preventiva de 5 min a 60 min. Al recuperar conectividad, el auto-recovery restablece el chip automáticamente.
3. **Mecanismo de reserva atómica RPC idempotente (P5):**
   - Se diseñó la función PL/pgSQL `waha_reservar_numero_cola` con `FOR UPDATE SKIP LOCKED`. En caso de que la migración no esté aplicada en local/tests, el código cae limpiamente a un algoritmo en memoria que garantiza la misma semántica.
4. **Validación estricta de rampa de calentamiento (P7):**
   - Un chip solo avanza de escalón si alcanzó ≥70% de su cupo diario, mantuvo >90% de éxito, tiene `ultimo_ok_en !== null` (confirmando envíos reales previos) y 0 bloqueos en 24h.
5. **Auto-respuesta de cortesía anti-bucle (P8):**
   - La respuesta automática está protegida tras `WAHA_POOL_AUTORESPUESTA=1`, ignora grupos y palabras de baja, y tiene un límite estricto de **1 respuesta cada 24 horas por contacto**.
6. **Cancelación modular sin tocar el endpoint base (P10 & K5):**
   - En lugar de modificar el contrato de `POST /api/externo/mensajes`, se creó la sub-ruta `POST /api/externo/mensajes/cancelar` con autenticación HMAC idéntica. Cancela solo filas en estado `en_cola` del tenant solicitante y emite eventos `message.status` con `reason: "cancelled"`.
7. **Soporte piloto tri-estado (`meta`, `waha`, `waha_opt_in`) (P11 & K6):**
   - Un local piloto se activa mediante la variable `LOCALES_AVISOS_POOL` en Kambak. Los locales no listados continúan usando Meta de forma 100% transparente sin alterar su comportamiento ni costo.
8. **Devolución de cupo mensual en Kambak ante fallos terminales (K1 & K5):**
   - Cuando un mensaje en cola es cancelado o termina en `failed` (`expired`, `cancelled`, `opt_out`, etc.), Kambak decrementa automáticamente `crm.m.n` en el cliente para no penalizar su cuota mensual de 4 mensajes.

---

## 5. Supuestos que Dependen de WAHA Real (a Validar el Lunes)

1. **Endpoint de LIDs de WAHA:**
   - Supuesto: `GET /api/{session}/lids/{lid}` devuelve JSON con `{ id, pn }` o `{ phone }`. Si la versión de WAHA en producción formatea distinto, el resolvedor utiliza tolerancias y los fallbacks de payload GOWS y correlación temporal de 72h.
2. **Formato de Webhooks de Estado (`message.status` / `ack`):**
   - Supuesto: WAHA emite eventos con `ack = 2` (recibido / delivered) y `ack = 3` (leído / read).
3. **Simulación de presencia (`iniciarTipeo` / `pararTipeo`):**
   - Supuesto: `POST /api/{session}/presence` acepta `{ presence: "composing" }` y `{ presence: "paused" }`. Las funciones capturan cualquier error de red en presencia sin abortar el envío principal.
4. **Sesiones con nombres alfanuméricos limpios:**
   - Supuesto: Las sesiones en WAHA se nombran con caracteres válidos (ej. `waha-chip-1`, `waha-chip-2`).

---

## 6. Pasos Humanos y Orden Exacto para el Lunes (09:00 AM)

Seguir el runbook detallado en `docs/WAHA_POOL_VALIDACION_REAL.md`:

1. **Infraestructura WAHA:**
   - Levantar instancia de WAHA en VPS/Railway con HTTPS y definir `WAHA_API_KEY`.
   - Configurar webhook global en WAHA hacia: `https://<portal>/api/whatsapp/webhook-waha-pool`.
2. **Chips Físicos:**
   - Insertar chips en los teléfonos de soporte.
   - Escanear QR en la interfaz de WAHA para iniciar sesiones (ej. `chip-1`, `chip-2`).
3. **Base de Datos (Supabase):**
   - En el SQL Editor de Supabase, aplicar la migración `sql/326_waha_pool_v2.sql`.
   - Ejecutar el alta de los números en `ed_numeros_waha` con `estado = 'calentando'` y `tope_hoy = 20`.
4. **Variables en Vercel (`respondo-portal`):**
   - Cargar `WAHA_API_URL`, `WAHA_API_KEY`, `WAHA_POOL_WEBHOOK_SECRETO`, `CRON_SECRET`.
   - Asegurarse de mantener `WAHA_POOL_APAGADO=0`.
5. **Variables en Vercel (`sello-fidelizacion` / Kambak):**
   - Configurar `LOCALES_AVISOS_POOL=<slug-del-local-piloto>`.
6. **Programación del Cron:**
   - En cron-job.org, crear trabajo recurrente cada 1 minuto (o 2 minutos) hacia:  
     `https://<portal>/api/cron/pool-kambak?k=<CRON_SECRET>`
7. **Prueba Piloto en Vivo:**
   - Lanzar una campaña de prueba desde el local piloto seleccionado en Kambak.
   - Verificar en el panel que los mensajes ingresan con "X de Y enviados (Z en cola)".
   - Observar cómo la cola se drena progresivamente a razón segura entre chips.

---

## 7. Riesgos Residuales y Puntos de Atención

1. **Riesgo de Baneo en Chips Nuevos ("Virgencitas"):**
   - Si un chip es nuevo de paquete y nunca ha interactuado en WhatsApp, WhatsApp puede restringirlo incluso con 10 mensajes.  
   - **Recomendación preventiva:** "Calentar manualmente" los chips 2 o 3 días antes de usarlos en campañas masivas (enviar algunos mensajes personales a amigos/familiares para generar reputación en los servidores de WhatsApp).
2. **Suspensión de Batería en Teléfonos Físicos:**
   - En teléfonos Android, si el sistema operativo pone en reposo profundo la app de WhatsApp, la sesión de WAHA puede pasar a `STOPPED`.  
   - **Recomendación:** Desactivar optimización de batería para WhatsApp y mantener los teléfonos conectados al cargador y Wi-Fi estable.
3. **Kill Switch Inmediato:**
   - Si en cualquier momento se sospecha de un comportamiento anormal o falla de WAHA, simplemente establecer `WAHA_POOL_APAGADO=1` en Vercel. En menos de 60 segundos todo el tráfico conmuta automáticamente a Meta Cloud API sin pérdida de datos.
