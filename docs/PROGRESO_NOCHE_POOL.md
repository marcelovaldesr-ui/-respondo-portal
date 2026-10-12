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
| **P2** | M | **HECHO** | `(este commit)` | `lib/poolSalud.ts`, `lib/wahaPool.ts`, `lib/poolNumeros.ts`, `sql/326_waha_pool_v2.sql`, `sql/consultas/kambak_pool_operacion.sql` | 8 tests nuevos (88 pasan en total) |
| **P3** | M | Pendiente | - | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | - |
| **P4** | M | Pendiente | - | `lib/kambakEnvios.ts`, `sql/326_waha_pool_v2.sql` | - |
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
- **Pendientes:** Pasar a Fase P3 (Envío robusto con tiempo controlado).

