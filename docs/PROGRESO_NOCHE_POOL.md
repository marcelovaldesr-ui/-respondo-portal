# Bitácora de Construcción: Pool WAHA Kambak v2 (Trabajo Nocturno)

**Fecha:** 11-12 de octubre de 2026  
**Constructor:** Antigravity  
**Dueño:** Marcelo  
**Ramas activas:**
- **Portal:** `feat/kambak-waha-pool-v2` (desde `feat/kambak-waha-pool` @ `c7ecfaa`)
- **Kambak:** `claude/pool-waha-avisos` (desde `main`)

---

## 1. Tabla de Estado por Fase

### Pista A: Portal (`respondo-portal`)

| Fase | Prioridad | Estado | Commit | Archivos clave | Tests |
|---|---|---|---|---|---|
| **P0** | M | **HECHO** | `8d98997` | `sql/326_waha_pool_v2.sql`, `docs/PROGRESO_NOCHE_POOL.md` | Baseline (1196 pass / 5 preexistentes) |
| **P1** | M | **HECHO** | `679c90d` | `lib/wahaPoolIdentidad.ts`, `lib/inboundWahaPool.ts`, `sql/326_waha_pool_v2.sql` | 7 tests nuevos (80 pasan en total) |
| **P2** | M | **HECHO** | `aedf87c` | `lib/poolSalud.ts`, `lib/wahaPool.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql`, `sql/consultas/kambak_pool_operacion.sql` | 8 tests nuevos (88 pasan en total) |
| **P3** | M | **HECHO** | `8ec07eb` | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | 4 tests nuevos (92 pasan en total) |
| **P4** | M | **HECHO** | `90bc514` | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | 6 tests nuevos (98 pasan en total) |
| **P5** | M | Pendiente | - | `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql` | - |
| **P6** | M | Pendiente | - | `lib/kambakEnvios.ts`, `lib/webhookSalida.ts`, `docs/contrato-eventos-kambak.json` | - |
| **P7** | S | Pendiente | - | `lib/poolSalud.ts`, `sql/consultas/kambak_pool_operacion.sql` | - |
| **P8** | S | Pendiente | - | `lib/inboundWahaPool.ts` | - |
| **P9** | S | Pendiente | - | `lib/poolSalud.ts`, `sql/consultas/kambak_pool_estado.sql` | - |
| **P10** | S | Pendiente | - | `app/api/externo/mensajes/cancelar/route.ts`, `lib/kambakEnvios.ts` | - |
| **P11** | S | Pendiente | - | `lib/kambakEnvios.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql` | - |
| **P12** | C | Pendiente | - | `docs/WAHA_POOL_VALIDACION_REAL.md` | - |
| **P13** | C | Pendiente | - | `app/api/cron/pool-kambak/route.ts`, `KAMBAK.md` | - |

---

### Pista B: Kambak (`sello-fidelizacion`)

| Fase | Prioridad | Estado | Commit | Archivos clave | Tests |
|---|---|---|---|---|---|
| **K0** | M | **HECHO** | `6af03e9` (main) | `TAREAS.md`, mapa de arquitectura | Inspección estática |
| **K1** | M | Pendiente | - | `lib/routes-crm.js`, `lib/messaging.js` | - |
| **K2** | M | Pendiente | - | `lib/routes-respondo.js`, `test/fixtures/` | - |
| **K3** | M | Pendiente | - | `public/panel.html`, `public/js/gestion.js`, `lib/routes-crm.js` | - |
| **K4** | M | Pendiente | - | `lib/bajas.js`, `lib/routes-crm.js` | - |
| **K5** | S | Pendiente | - | `public/js/gestion.js`, `lib/respondo.js` | - |
| **K6** | S | Pendiente | - | `lib/messaging.js`, `lib/respondo.js` | - |
| **K7** | S | Pendiente | - | `public/panel.html`, `public/js/gestion.js` | - |
| **K8** | M | Pendiente | - | `TAREAS.md`, `CAMBIOS.md`, `CONTEXTO.md` | - |
| **K9** | C | Pendiente | - | `test/pool-waha-e2e.test.js` | - |

---

## 2. Decisiones Tomadas (Criterio Conservador)

1. **Línea base (P0):**
   - Confirmado `npm test` con 1196 pasados y 5 fallos preexistentes en `whatsapp-booking-actions.test.mjs`.
   - `npm run lint` con 0 errores y 1 warning preexistente en `app/privacidad/page.tsx`.
   - Archivos protegidos de la Sección 1.2 permanecen 100% intactos.
   - Creación de migración `sql/326_waha_pool_v2.sql` (no aplicada) para contener exclusivamente los cambios de esquema de la noche.
2. **K0 (Mapa Kambak):**
   - Reserva de tarea en `TAREAS.md` realizada mediante commit `6af03e9` a `main`.
   - Rama de trabajo `claude/pool-waha-avisos` creada desde `main`.

---

## 3. Registro Detallado por Fase

### Fase P0 (M) — Línea base del Portal
- **Hecho:** Creación de rama `feat/kambak-waha-pool-v2` desde `feat/kambak-waha-pool` (`c7ecfaa`). Verificación de baseline de tests (1196 ok, 5 preexistentes) y lint (0 errores). Creación de `sql/326_waha_pool_v2.sql` y de esta bitácora `docs/PROGRESO_NOCHE_POOL.md`.
- **Archivos:** `sql/326_waha_pool_v2.sql`, `docs/PROGRESO_NOCHE_POOL.md`.
- **Tests:** Baseline ejecutado y validado.
- **Decisiones:** Se preserva intacta la migración 325; todo nuevo esquema se acumulará en la migración 326.
- **Pendientes:** Iniciar P1 (Resolución de LID y BAJA segura).

### Fase K0 (M) — Lectura y Mapa de Arquitectura Kambak
- **Hecho:** Lectura profunda de `lib/messaging.js`, `lib/respondo.js`, `lib/routes-respondo.js`, `lib/routes-crm.js`, `lib/bajas.js`, `lib/routes-whatsapp.js`, `public/panel.html`, `public/js/gestion.js`, `vercel.json` y `test/`. Reserva registrada en `TAREAS.md` y rama `claude/pool-waha-avisos` creada.
- **Mapa de arquitectura:**
  1. *idempotencyKey:* En `lib/messaging.js`, `respondoKey({ slug, cid, phone, template, values, now })` genera:
     `kambak-` + SHA1(`slug|cid|phone|template|json(values)|YYYY-MM-DD`).digest('hex').slice(0, 32). Estable por día, local, cliente y plantilla.
  2. *Campos enviados al portal:* `{ clienteId: clientId, to: '+56' + phone, template: tpl.meta, language: 'es', variables: values, idempotencyKey: key }` con cabeceras `x-respondo-ts`, `x-respondo-nonce` y `x-respondo-firma: sha256=...`.
  3. *Mapeo queued → en_cola:* `Respondo.send` mapea HTTP 200 con `{ status: 'queued' }` a `{ status: 'enviado', stored: 'en_cola', respondoId: j.id }`. En `messaging.send`, el documento en `outbox` se guarda con `status: out.stored || out.status` (`en_cola`). Sin embargo, en `routes-crm.js` (`runCampaign`), la subcolección `sent/${c.id}` guardaba `st` como `r.status` ('enviado') en vez de 'en_cola', y sumaba cupo antes de tiempo.
  4. *Recepción de eventos y actualización outbox:* Llegan a `POST /api/hooks/respondo` con firma `X-Respondo-Signature`. `lib/respondo.js` valida con `RESPONDO_WEBHOOK_SECRET` y ejecuta `handleEvent`. Para `message.status`, actualiza `outbox` (raíz y local) respetando `RANK` (`simulado: 0, en_cola: 1, enviado: 2, entregado: 3, leido: 4`) sin retroceder. Para `contact.optout` o `message.inbound` con `BAJA_RE`, llama a `applyBaja(p)` que aplica supresión en todos los locales donde el teléfono es cliente.
  5. *Conteo de cupos mensuales:* `lib/routes-crm.js` valida `capUsed(c, now) < CAP_MONTH` (4 al mes) revisando `c.crm.m.n`. Se incrementaba en `sendMarketing` al retornar 'enviado' o 'simulado'. Si un mensaje en cola falla posteriormente, el cupo no era liberado.
  6. *Visualización al dueño del local:* En `public/js/gestion.js` (`pAvisos()`), la lista de campañas muestra `c.stats.enviado` de `c.total`. La función `sendLoop` itera en bloques de 10 hasta `r.status === 'completa'`. Al encolarse mensajes, el panel reportaba "enviados" en vez de mostrar el progreso real de salida diferida por horario/cupo del pool.
- **Archivos:** `TAREAS.md`.
- **Decisiones:** La reserva en `TAREAS.md` se realizó directamente en `main` siguiendo la regla de CLAUDE.md.

### Fase P1 (M) — Identidad Correcta de Remitente (LID) y BAJA Segura
- **Hecho:**
  - Creado módulo `lib/wahaPoolIdentidad.ts`:
    - `resolverTelefonoEntrante(payload, sesion, supa)` con resolución jerárquica: formato directo `@c.us`/`@s.whatsapp.net`, campos alternos de payload GOWS (`remoteJidAlt`, `SenderAlt`, etc.), caché Supabase `ed_waha_lids`, consulta API WAHA (`/api/{session}/lids/{lid}` con timeout 5s), y correlación temporal de 72 horas exigiendo **un único candidato inequívoco**.
    - `analizarIntencionBaja(texto)` con limpieza de puntuación Unicode (incluyendo `¡` y `¿`), detección de comandos unívocos de baja ("baja", "stop", "no mas", etc.) frente a frases ambiguas marcadas como `posibleBaja`.
    - `alertarHqLidNoResuelto` con rate-limit en memoria de 1 hora.
  - Actualizado `sql/326_waha_pool_v2.sql` con tabla `ed_waha_lids` (índice único `(sesion, lid)`, RLS deny-all) y su rollback correspondiente.
  - Modificado `lib/inboundWahaPool.ts`:
    - **Regla de seguridad estricta:** Si el LID no se resuelve, **nunca** se registra BAJA y **nunca** se responde automáticamente; el mensaje se guarda con prefijo `[sin_telefono: LID ...]` y se alerta a HQ para revisión manual.
    - Teléfono verificado con BAJA unívoca: guarda en bandeja, emite `message.inbound` y `contact.optout` a Kambak, registra etiqueta `no_contactar` en contacto, y envía confirmación al remitente (usando su `@lid` original si provino de un LID).
    - Frase con palabra de baja ambigua: guarda con etiqueta `[posible_baja]`, emite `message.inbound`, y notifica informativamente a HQ.
  - Creada suite de pruebas unitarias y de integración `tests/kambak-pool-identidad.test.mjs` con 7 tests exhaustivos cubriendo todos los casos de seguridad y formatos.
- **Archivos:** `lib/wahaPoolIdentidad.ts`, `lib/inboundWahaPool.ts`, `sql/326_waha_pool_v2.sql`, `tests/kambak-pool-identidad.test.mjs`.
- **Tests:** 7 nuevos en `tests/kambak-pool-identidad.test.mjs` (80 tests totales pasando en suite pool de portal). Lint limpio (0 errores en archivos modificados).
- **Decisiones:**
  - *Mocking de wahaPool:* `tests/kambak-pool-webhook.test.mjs` preexistente mockea `@/lib/wahaPool` de forma aislada. Para evitar acoplamiento, `wahaPoolIdentidad.ts` inspecciona variables de entorno directamente (`WAHA_POOL_URL`, `RESPONDO_POOL_SIMULADO`).
  - *Orden de eventos en BAJA:* Al recibir una BAJA verificada, se emite `message.inbound` y luego `contact.optout`, preservando compatibilidad exacta con el webhook de Kambak.
  - *Destino de confirmación:* Si el mensaje provino de un `@lid`, la confirmación se envía a `idRes.chatIdOriginal` para mantener el hilo del cliente en WhatsApp; si vino de teléfono normal, se envía a los dígitos normalizados del teléfono (`chatId`).
- **Pendientes:** Iniciar Fase P2 (Salud del pool: distinguir WAHA caído de número caído).

### Fase P2 (M) — Salud del Pool: Distinguir WAHA Caído de Número Caído
- **Hecho:**
  - Actualizado `lib/wahaPool.ts`:
    - `estadoSesion` ahora clasifica la respuesta retornando `{ ok: true, status, tipo: 'sesion' }`, `{ ok: false, tipo: 'inalcanzable', status, error }` (para timeouts, red, 5xx, 401), o `{ ok: false, tipo: 'sesion', status, error }` (para 404, STOPPED, FAILED, SCAN_QR_CODE, UNPAIRED).
  - Actualizado `sql/326_waha_pool_v2.sql`:
    - Creada tabla `ed_waha_pool_estado` (`pool_inalcanzable_desde`, `alerta_inalcanzable_en`, `alerta_sin_capacidad_en`).
    - Añadidas columnas a `ed_waha_numeros`: `pausado_hasta timestamptz`, `ultimo_ok_en timestamptz`, `ciclos_pausa int default 0`.
    - Rollback correspondiente actualizado.
  - Creado script `sql/consultas/kambak_pool_operacion.sql` para administración manual (reactivación de bloqueados, pausa manual, ver estado global).
  - Actualizado `lib/poolSalud.ts`:
    - Detección de caída global de WAHA: Si **todos** los números activos/calentando son `inalcanzable`, no se cambia el estado de ningún número, se registra en `ed_waha_pool_estado` y se alerta a HQ con rate-limit de 30 minutos.
    - Tolerancia para `inalcanzable` individual: requiere 2 revisiones seguidas antes de pausar el chip.
    - Backoff en fallos transitorios: pausa temporal escalonada (15 min -> 1 h -> 6 h).
    - Bloqueo solo ante señales claras de baneo (`UNPAIRED` / `logged out`) o tras agotar 3 ciclos de pausa sin recuperación.
    - Recuperación automática de `caido` y `pausado` a `activo` tan pronto la sesión vuelve a `WORKING`.
    - Deduplicación de alertas: máx. 1 alerta por número/tipo cada 60 min; aviso informativo "recuperado" al restablecerse.
    - Detección de falta de capacidad (`pool_sin_capacidad`): alerta si quedan 0 números activos con cupo en horario hábil de Chile (09:00 - 21:00), limitada a 1 aviso cada 2 horas.
  - Creada suite de pruebas unitarias y de integración `tests/kambak-pool-salud-v2.test.mjs` con 8 tests nuevos exhaustivos.
- **Archivos:** `lib/poolSalud.ts`, `lib/wahaPool.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql`, `sql/consultas/kambak_pool_operacion.sql`, `tests/kambak-pool-salud-v2.test.mjs`.
- **Tests:** 8 nuevos en `tests/kambak-pool-salud-v2.test.mjs` (88 tests pasando en total). Lint 100% limpio (0 errores, 0 warnings).
- **Decisiones:**
  - *Preservación de estados ante corte de WAHA:* Se evita terminantemente el "flapping" o marcar números como caídos/bloqueados cuando el problema es infraestructura de red o reinicio del contenedor WAHA.
  - *Tolerancia de 2 revisiones:* Un fallo de red aislado no saca el chip de inmediato a pausa; se marca `waha_inalcanzable_1` y solo si persiste en el siguiente cron se aplica el ciclo 1 de enfriamiento (15 min).
  - *Operación manual:* Se entrega `kambak_pool_operacion.sql` para que ante un bloqueo de WhatsApp el operador pueda reactivar limpiamente el chip reseteando `fallos_seguidos`, `ciclos_pausa` y `pausado_hasta`.
- **Pendientes:** Iniciar Fase P3 (Envío robusto con tiempo controlado).

### Fase P3 (M) — Envío Robusto, con Tiempo Controlado
- **Hecho:**
  - Actualizado `sql/326_waha_pool_v2.sql`:
    - Columnas para reintentos en `ed_envios_api`: `intentos int not null default 0`, `proximo_intento_en timestamptz`, `ultimo_error text`.
    - Rollback correspondiente actualizado.
  - Modificado `lib/kambakEnvios.ts` (`drenarColaWaha`):
    - **Concurrencia por número:** Despacho paralelo de hasta 1 envío por número disponible mediante `Promise.allSettled`.
    - **Presupuesto de tiempo:** Límite global de 45 s por corrida, guard de corte a los 35 s para no iniciar nuevos envíos si el cron está por expirar.
    - **Simulación de tipeo realista:** Duración calculada como `min(4500, 700 + largo * 30 + azar(0..800))` ms con `iniciarTipeo` y `pararTipeo`.
    - **Reintento y failover:** Error transitorio (timeout, 5xx, red) incrementa `intentos`, fija `proximo_intento_en = ahora + 2^intentos * 2 min`, almacena `numero_id` del chip fallido y, en el siguiente intento, **excluye** dicho chip para enviar por otro número del pool (failover automático). Al 3er fallo consecutivo se marca `fallido` con `motivo: max_intentos`.
    - **Fallo de sesión vs fallo de envío:** Un fallo de sesión (`STOPPED`, `FAILED`, `desvinculada`, `banned`) cuenta contra el número del pool (registra fallo y posible rotación), pero **no contra el mensaje** (el mensaje retorna a `en_cola` sin consumir cupo de reintento).
    - **Idempotencia fuerte al reclamar:** Transición condicional estricta `update ... where id=... and estado='en_cola' and wamid is null`. Si ya tiene `wamid` o fue reclamada, no se reenvía jamás.
    - **Kill switch en tiempo real:** Verificación de `wahaPoolApagado()` antes de reclamar y justo antes del envío a la red.
  - Creada suite de pruebas unitarias y de concurrencia `tests/kambak-pool-envios-v2.test.mjs` con 4 tests exhaustivos.
- **Archivos:** `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql`, `tests/kambak-pool-envios-v2.test.mjs`.
- **Tests:** 4 nuevos en `tests/kambak-pool-envios-v2.test.mjs` (92 tests pasando en total). Lint 100% limpio (0 errores, 0 warnings).
- **Decisiones:**
  - *Failover inteligente:* En vez de bloquear el mensaje en el mismo chip con problemas, el algoritmo de asignación revisa `f.numero_id` y asigna un chip alternativo disponible del mismo cliente.
  - *Separación de fallos:* Errores del chip (sesión desconectada) nunca penalizan la cuota de 3 intentos del mensaje de marketing.
- **Pendientes:** Iniciar Fase P4 (Cola: filtro, orden, justicia, expiración, reaper, sin capacidad).

### Fase P4 (M) — Cola: Filtro, Orden, Justicia, Expiración, Reaper y Horario de Chile
- **Hecho:**
  - Actualizado `sql/326_waha_pool_v2.sql`:
    - Añadida columna `origen_ref text` a `ed_envios_api` para trazabilidad de local.
    - Añadida columna `actualizado_en timestamptz not null default now()` para soporte del Reaper.
    - Creado índice parcial optimizado `ed_envios_api_cola_waha_idx` sobre `(programado_para, cliente_id, origen_ref) where canal = 'waha' and estado = 'en_cola'`.
    - Rollback correspondiente actualizado.
  - Modificado `lib/kambakEnvios.ts`:
    - `procesarEnvio`: extrae y almacena `origen_ref` desde el payload o metadata (`origen_ref`, `referencia`, `local`, `slug`).
    - `intercalarPorOrigenRef`: función de reparto equitativo round-robin por local que evita que un local con 300 avisos bloquee a otros locales durante horas.
    - `reaperEnviosWaha`: al inicio de cada pasada, detecta filas en `enviando` atascadas > 3 minutos. Si obtuvieron `wamid`, las recupera a `enviado`; si no tienen `wamid`, las pasa a `fallido` con `motivo: estado_incierto` y emite evento `uncertain` a Kambak ("preferimos perder que duplicar").
    - `expirarColaWaha`: detecta avisos en `en_cola` que superan `WAHA_POOL_COLA_MAX_HORAS` (por defecto 48 horas) y los cierra como `fallido` con `motivo: expirado`, emitiendo evento `expired` a Kambak.
    - Fallback a Meta configurable: si no hay capacidad en el pool y `WAHA_POOL_FALLBACK_META=1` está activo, drena por Meta; por defecto (0) espera en cola sin costo Meta adicional.
    - Horario dinámico de Chile: validado contra `America/Santiago` con Intl que gestiona dinámicamente el cambio de horario de verano (DST) entre UTC-3 y UTC-4 sin offsets fijos.
  - Creada suite de pruebas unitarias `tests/kambak-pool-cola-v2.test.mjs` con 6 tests exhaustivos cubriendo justicia, expiración, reaper, fallback y transiciones DST.
- **Archivos:** `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql`, `tests/kambak-pool-cola-v2.test.mjs`.
- **Tests:** 6 nuevos en `tests/kambak-pool-cola-v2.test.mjs` (98 tests pasando en total). Lint 100% limpio (0 errores, 0 warnings).
- **Decisiones:**
  - *Filosofía del Reaper:* Ante un timeout > 3 min sin confirmación de ID de WhatsApp (`wamid`), se asume estado incierto y se descarta reintentar para garantizar cero mensajes duplicados al cliente final.
  - *Intercalación round-robin:* Se particionan los mensajes en memoria por `origen_ref` para alternar la asignación a los chips disponibles.
- **Pendientes:** Pasar a Fase P5 (Contadores y cupos atómicos).

### Fase P5 (M) — Contadores y Cupos Atómicos
- **Hecho:**
  - Actualizado `sql/326_waha_pool_v2.sql`:
    - Creada función SQL `waha_reservar_cupo(p_numero uuid, p_hoy date, p_tope int, p_proximo timestamptz)` que actualiza atómicamente `enviados_hoy` (reseteando a 1 si el día cambió o sumando 1 si coincide), fija `proximo_envio_en` con la pausa calculada, y valida en la cláusula WHERE que no se supere el tope diario ni esté pausado/congelado.
    - Creada función SQL `waha_devolver_cupo(p_numero uuid, p_hoy date)` que devuelve el cupo ante fallos/cancelaciones decrementando `enviados_hoy` y limpiando `proximo_envio_en`.
    - Agregados los rollbacks `drop function if exists` correspondientes.
  - Actualizado `lib/poolNumeros.ts`:
    - `reservarCupoNumero`: ejecuta `waha_reservar_cupo` vía RPC con fallback condicional optimista si la RPC no existe en el entorno. Calcula la pausa aleatoria (60-180 s).
    - `devolverCupoNumero`: ejecuta `waha_devolver_cupo` vía RPC con fallback para rollback de cupo.
    - `elegirNumeroYReservar`: selecciona el mejor chip del pool e intenta reservar atómicamente; si la reserva falla (por concurrencia o tope alcanzado), rota automáticamente al siguiente chip disponible.
  - Creada suite de pruebas unitarias `tests/kambak-pool-cupos-v2.test.mjs` con 6 tests exhaustivos cubriendo reservas vía RPC, carrera concurrente con 1 cupo restante (solo 1 triunfa), rollback ante fallo, cambio de día, fallback y rotación de candidatos.
- **Archivos:** `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql`, `tests/kambak-pool-cupos-v2.test.mjs`.
- **Tests:** 6 nuevos en `tests/kambak-pool-cupos-v2.test.mjs` (104 tests pasando en total). Lint 100% limpio (0 errores, 0 warnings).
- **Decisiones:**
  - *Doble vía RPC + fallback:* Para garantizar que el código funcione tanto en producción Postgres (con la función SQL atómica de migración 326) como en entornos con PostgREST mock o emuladores en memoria, se implementó fallback condicional estricto.
- **Pendientes:** Pasar a Fase P6 (Eventos hacia Kambak en todos los resultados).

### Fase P6 (M) — Eventos hacia Kambak en Todos los Resultados [H11]
- **Hecho:**
  - Creado archivo de contrato versionado `docs/contrato-eventos-kambak.json` (v2.0.0) que documenta y ejemplifica todos los eventos webhook (`message.status`: `sent`, `delivered`, `read`, `failed` con subcódigos `opt_out`, `monthly_cap`, `not_on_whatsapp`, `max_intentos`, `expired`, `cancelled`, `uncertain`; `message.inbound`; `contact.optout`).
  - Actualizado `lib/kambakEnvios.ts` para emitir `message.status` con payload idempotente y sin fugas de datos internos (cero mención a chip, número, sesión o canal) en:
    - Envíos exitosos por pool (`status: "sent"` con `message_id`).
    - Descarte por baja (`status: "failed"` con `reason: "opt_out"`, `error_code: "opt_out"`).
    - Descarte por tope mensual (`status: "failed"` con `reason: "monthly_cap"`, `error_code: "monthly_cap"`).
    - Descarte por número sin WhatsApp (`status: "failed"` con `reason: "not_on_whatsapp"`, `error_code: "not_on_whatsapp"`).
    - Descarte definitivo por agotar reintentos (`status: "failed"` con `reason: "max_intentos"`, `error_code: "max_intentos"`).
    - Expiración de cola > 48h (`status: "failed"` con `reason: "expired"`, `error_code: "expired"`).
    - Recuperación o timeout de Reaper (`status: "sent"` si obtuvo wamid; `status: "failed"` con `reason: "uncertain"`, `error_code: "uncertain"` si expiró sin confirmación).
  - Creada suite de pruebas unitarias `tests/kambak-pool-eventos-v2.test.mjs` con 6 tests exhaustivos cubriendo emisión de cada estado terminal, verificación de contrato fixture, payload sin fugas del pool e idempotencia estricta.
- **Archivos:** `docs/contrato-eventos-kambak.json`, `lib/kambakEnvios.ts`, `tests/kambak-pool-eventos-v2.test.mjs`.
- **Tests:** 6 nuevos en `tests/kambak-pool-eventos-v2.test.mjs` (110 tests pasando en total). Lint 100% limpio (0 errores, 0 warnings).
- **Decisiones:**
  - *Filtrado estricto del payload:* Se garantiza que ningún local reciba en los eventos el identificador de chip ni el nombre de sesión WAHA, preservando total abstracción hacia Kambak.
  - *Emisión en todas las ramas terminales:* Ningún mensaje queda en silencio o en estado eterno "en cola" si el proceso toma una decisión terminal.
- **Pendientes:** Pasar a Fase P7 (Calentamiento y promoción verificado).

### Fase P7 (S) — Calentamiento y Promoción con Verificación [H12]
- **Hecho:**
  - Actualizado `lib/poolNumeros.ts`:
    - Rampa de calentamiento basada en días reales de calendario en huso horario de Chile (`RAMPA_CALENTAMIENTO = [20, 40, 60, 90, 120]`).
    - Soporte para tope máximo global configurable vía variable de entorno `WAHA_POOL_TOPE_MAX` (por defecto 150).
  - Actualizado `lib/poolSalud.ts`:
    - `promoverCalentando`: verificación estricta de días en calentamiento (>= 5 días), estado de sesión en WAHA (`WORKING`), cero fallos seguidos (`fallos_seguidos = 0`), exclusión de promoción automática si nunca tuvo un envío exitoso (`ultimo_ok_en === null`), y comprobación de envíos de prueba previos con alerta informativa a HQ con advertencia si hubo < 3 envíos.
  - Actualizado `sql/consultas/kambak_pool_operacion.sql`:
    - Añadida consulta de alta para nuevos chips en estado de calentamiento con rampa inicial de 20 mensajes.
  - Creada suite de pruebas unitarias `tests/kambak-pool-warmup.test.mjs` con 4 tests cubriendo rampa por días reales, tope configurable por env, y promoción condicional estricta.
- **Archivos:** `lib/poolNumeros.ts`, `lib/poolSalud.ts`, `sql/consultas/kambak_pool_operacion.sql`, `tests/kambak-pool-warmup.test.mjs`.
- **Tests:** 4 tests nuevos en `tests/kambak-pool-warmup.test.mjs` (114 tests del pool pasando en total). Lint 100% limpio (0 errores, 1 warning en página estática ajena).
- **Decisiones:**
  - *Días reales vs contador:* La rampa se calcula determinísticamente a partir de `calentamiento_desde` usando medianoche en huso horario de Chile, evitando derivas por días en los que no hubo envíos.
  - *No promoción a ciegas:* Se protege al pool de activar un chip que nunca ha demostrado ser capaz de emitir mensajes (`ultimo_ok_en === null`).
- **Pendientes:** Pasar a Fase P8 (Respuestas de clientes al número del pool).

### Fase P8 (S) — Respuestas de Clientes al Número del Pool [H13]
- **Hecho:**
  - Actualizado `lib/inboundWahaPool.ts`:
    - Auto-respuesta condicional opcional detrás del feature flag `WAHA_POOL_AUTORESPUESTA=1` (por defecto desactivada, `0`).
    - Límite estricto de frecuencia: máximo 1 auto-respuesta por contacto cada 24 horas (consultando `ed_mensajes` con `rol: 'empleado'`).
    - Búsqueda del nombre del local del último envío en `ed_envios_api` mediante huella SHA-256 (`cliente_id:telefono`). Si se conoce: `"Este número solo envía avisos de {local}. Para consultas, escríbele directamente al local."`; si no se conoce: `"Este número solo envía avisos automáticos. Para consultas, escríbele directamente al local."`.
    - Destino tolerante a hilos `@lid`: responde al chat id original (conservando `@lid` si corresponde para que WAHA rutee al hilo activo).
    - Exclusiones críticas respetadas: nunca responde a grupos (`@g.us`), mensajes broadcast ni estados (`status@`). A solicitudes de `BAJA` nunca responde con auto-respuesta genérica sino con la confirmación de desuscripción.
    - Registro en `ed_mensajes` del asistente humano como trazabilidad.
  - Actualizado `lib/poolNumeros.ts`:
    - Documentado el rol `respuesta` como explícitamente reservado para futuras líneas bidireccionales dedicadas (hoy no se asigna en producción para evitar código muerto o roles engañosos).
  - Creada suite de pruebas unitarias `tests/kambak-pool-respuestas.test.mjs` con 5 tests cubriendo: desactivación por defecto, envío con nombre de local cuando está activo, rate-limit 1/24h, mensajes de grupos ignorados, y desuscripción por BAJA con confirmación exclusiva.
- **Archivos:** `lib/inboundWahaPool.ts`, `lib/poolNumeros.ts`, `tests/kambak-pool-respuestas.test.mjs`.
- **Tests:** 5 tests nuevos en `tests/kambak-pool-respuestas.test.mjs` (119 tests del pool pasando en total). Lint 100% limpio (0 errores, 1 warning en página estática ajena).
- **Decisiones:**
  - *Desacoplamiento estricto:* La función de huella SHA-256 se genera localmente vía `node:crypto` para no forzar la importación de módulos pesados de envío saliente en el flujo de webhooks entrantes, preservando aislamiento modular y compatibilidad de mocks en tests existentes.
- **Pendientes:** Pasar a Fase P9 (Visibilidad operativa).

### Fase P9 (S) — Visibilidad Operativa y Señales de Calidad [H14]
- **Hecho:**
  - Creado `sql/consultas/kambak_pool_estado.sql` con 5 consultas operativas:
    1. Estado de cada número con días reales de calentamiento, cuota, pausas y errores.
    2. Agrupación de la cola en 24h por estado y motivo.
    3. Tasa de entrega y fallo en 24h.
    4. Bajas en 24h y 7 días.
    5. Estado global de conectividad y fecha del último resumen diario.
  - Actualizado `sql/326_waha_pool_v2.sql`:
    - Añadida columna `ultimo_resumen_en timestamptz` a `ed_waha_pool_estado`.
  - Actualizado `lib/poolSalud.ts`:
    - `verificarCalidadPool`: evalúa en ventana de 24 horas:
      - Tasa de fallo > 20% con >= 20 envíos por número: pausa preventivamente el chip durante 1 hora y genera alerta informativa a HQ.
      - Tasa de BAJA > 3% con >= 30 envíos por campaña (`origen_ref`): emite alerta a HQ advirtiendo revisar contenido y segmentación.
    - `emitirResumenDiarioPool`: a partir de las 21:30 Chile, recopila las métricas del día (total procesados, enviados, en cola, fallidos por motivo, bajas y números no activos), envía un resumen consolidado a HQ y marca `ultimo_resumen_en` en `ed_waha_pool_estado` (máximo 1 vez al día).
    - `chequearWahaPool`: ampliado para reportar en `/api/salud` tanto el conteo de números sanos como la cantidad en cola y timestamp del mensaje más antiguo.
  - Creada suite de pruebas unitarias `tests/kambak-pool-visibilidad.test.mjs` con 4 tests cubriendo señales de calidad (fallo y baja), resumen diario a las 21:30 con deduplicación por día, y métricas de `/api/salud`.
- **Archivos:** `sql/consultas/kambak_pool_estado.sql`, `sql/326_waha_pool_v2.sql`, `lib/poolSalud.ts`, `tests/kambak-pool-visibilidad.test.mjs`.
- **Tests:** 4 tests nuevos en `tests/kambak-pool-visibilidad.test.mjs` (123 tests del pool pasando en total). Lint 100% limpio (0 errores, 1 warning en página estática ajena).
- **Decisiones:**
  - *Pausas preventivas automáticas:* La tasa de fallo > 20% aplica una pausa preventiva de 1 hora con enfriamiento en lugar de un bloqueo permanente, permitiendo que la rotación pruebe otros chips sanos mientras el chip afectado descansa.
- **Pendientes:** Pasar a Fase P10 (Cancelar envíos pendientes por campaña).

### Fase P10 (S) — Cancelar Envíos Pendientes (por Campaña)
- **Hecho:**
  - Creado endpoint nuevo y aditivo `POST /api/externo/mensajes/cancelar` (`app/api/externo/mensajes/cancelar/route.ts`):
    - Autenticación estricta HMAC-SHA256 con timestamp y nonce vía `autenticarExterno`.
    - Acepta cancelación por `prefijoIdempotencia`, `idempotencyKeys` (array de strings) o `origenRef`.
    - Regla de oro de seguridad: cancela estricta y exclusivamente filas con `canal = 'waha'` y `estado = 'en_cola'` pertenecientes al `clienteId` autenticado. Nunca toca filas en `enviando`, `sent` ni `fallido`, ni filas de otros clientes.
    - Actualiza el estado a `fallido` con motivo `cancelled` y timestamp `actualizado_en`.
    - Emite evento webhook `message.status` con `reason: "cancelled"` y `error_code: "cancelled"` hacia Kambak para cada fila cancelada, permitiendo sincronización inmediata del outbox y devolución de cupos.
    - Idempotente: si las filas ya fueron canceladas o despachadas, responde `{ ok: true, cancelados: 0 }`.
  - Actualizado `tests/_baseMemoria.mjs` con soporte para operadores `like` e `ilike`.
  - Creada suite de pruebas unitarias `tests/kambak-pool-cancelar.test.mjs` con 4 tests cubriendo: rechazo de peticiones no autenticadas (401), cancelación por prefijo restringida a filas `en_cola` del tenant, idempotencia (0 cancelados en segunda llamada) y cancelación por lista explícita de `idempotencyKeys`.
- **Archivos:** `app/api/externo/mensajes/cancelar/route.ts`, `tests/_baseMemoria.mjs`, `tests/kambak-pool-cancelar.test.mjs`.
- **Tests:** 4 tests nuevos en `tests/kambak-pool-cancelar.test.mjs` (127 tests del pool pasando en total). Lint 100% limpio (0 errores, 1 warning en página estática ajena).
- **Decisiones:**
  - *No mutación del endpoint base:* Se mantuvo intacto `/api/externo/mensajes` para preservar contratos existentes y se creó una sub-ruta aditiva `/cancelar` bajo la misma autenticación HMAC.
- **Pendientes:** Pasar a Fase P11 (Piloto por local / opt-in) y pista Kambak (K5-K8).

