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
| **P0** | M | **HECHO** | `pending` | `sql/326_waha_pool_v2.sql`, `docs/PROGRESO_NOCHE_POOL.md` | Baseline (1196 pass / 5 preexistentes) |
| **P1** | M | Pendiente | - | `lib/inboundWahaPool.ts`, `sql/326_waha_pool_v2.sql` | - |
| **P2** | M | Pendiente | - | `lib/poolSalud.ts`, `lib/wahaPool.ts`, `sql/326_waha_pool_v2.sql` | - |
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
| **K0** | M | En proceso | - | `TAREAS.md`, mapa de arquitectura | - |
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

---

## 3. Registro Detallado por Fase

### Fase P0 (M) — Línea base del Portal
- **Hecho:** Creación de rama `feat/kambak-waha-pool-v2` desde `feat/kambak-waha-pool` (`c7ecfaa`). Verificación de baseline de tests (1196 ok, 5 preexistentes) y lint (0 errores). Creación de `sql/326_waha_pool_v2.sql` y de esta bitácora `docs/PROGRESO_NOCHE_POOL.md`.
- **Archivos:** `sql/326_waha_pool_v2.sql`, `docs/PROGRESO_NOCHE_POOL.md`.
- **Tests:** Baseline ejecutado y validado.
- **Decisiones:** Se preserva intacta la migración 325; todo nuevo esquema se acumulará en la migración 326.
- **Pendientes:** Iniciar P1 (Resolución de LID y BAJA segura).
