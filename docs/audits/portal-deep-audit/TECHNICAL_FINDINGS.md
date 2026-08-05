# Hallazgos técnicos y reauditoría

## Método y línea base

Se inspeccionaron rutas, Server Actions, autorización, usos de `service_role`,
SQL, integraciones, entrada pública, archivos, errores, dependencias y Git. El
worktree ya contenía trabajo no confirmado de Instagram/bot/documentación; se
preservó y no se hizo reset, commit, deploy ni mutación externa.

Línea base: Next 14.2.35, sin lint/test formal y `npm audit --omit=dev` con dos
vulnerabilidades altas. Las sondas Supabase de solo lectura respondieron 401,
por lo que no se atribuye a la base real ningún control no comprobado.

## Hallazgos cerrados en código

| ID | Prioridad | Hallazgo | Corrección |
|---|---|---|---|
| SEC-001 | P0 | secreto real en documentación | reemplazado por placeholders; queda rotación/historial operativo |
| SEC-002 | P1 | cron/webhooks aceptaban configuración ausente | fail-closed, HMAC Meta/IG y secreto WAHA/cron obligatorios |
| DB-001 | P1 | clases sin RLS y RPC `SECURITY DEFINER` públicas | migración 272: RLS, `search_path`, revokes/grants e índice idempotente |
| TEN-001 | P1 | transporte/contacto podían cruzar tenant | transporte discriminado y recursos revalidados por tenant de sesión |
| TEN-002 | P1 | FK simples no garantizaban igualdad de tenant | FK compuestas `NOT VALID`, validaciones y trigger de unión en 272/273 |
| REL-001 | P1 | mensajes fantasma y cierre antes de entrega | entrega confirmada antes de persistencia/cierre; rollback/derivación humana |
| RES-001 | P1 | reserva aceptaba horas manipuladas | recálculo y coincidencia exacta de slot, límites y normalización |
| RES-002 | P1 | doble cupo por concurrencia/reintento | RPC transaccional + índice único parcial en 272 |
| AUTHZ-001 | P1 | `staff` administraba integraciones/configuración | matriz explícita y enforcement en páginas, acciones y APIs |
| META-001 | P1 | onboarding confiaba IDs del SDK y reflejaba errores | pertenencia WABA/teléfono, timeouts, aborto consistente y errores opacos |
| FILE-001 | P1 | MIME/base64 falsificable y descarga en memoria | magic bytes, 8 MB, streaming, reanclado WAHA y allowlist de MIME inline |
| AUTH-001 | P2 | redirect abierto/error de auth reflejado | allowlist same-site y códigos de error estables |
| OAUTH-001 | P2 | state Google reutilizable/fallback débil | HMAC con TTL, comparación constante y clave obligatoria |
| PRIV-001 | P2 | iCal con notas/caché pública/sin revocación | datos mínimos, caché privada, rate limit y rotación auditable |
| PERF-001 | P2 | polling devolvía mensajes antiguos y listados crecían | últimos N correctos; clientes/conversaciones paginados; embudo filtra en DB |
| DEP-001 | P1 | Next 14 vulnerable | Next 16.3, React 19.2, nuevas APIs async, `proxy.ts`, audit 0 |
| OPS-001 | P1/P2 | rate limit por instancia serverless | RPC atómica `ed_consumir_limite`, hash de clave, respaldo local y limpieza |
| REL-002 | P1 | webhook podía perder fallos al responder 200 | inbox durable, reclamo atómico, 5xx, reintento de error/atasco y retención |
| OBS-001 | P2 | sin correlation ID ni auditoría mínima | request IDs, JSON logs redacted y `ed_auditoria_portal` |
| WEB-001 | P2 | sin CSP y errores/cuerpos privados poco acotados | CSP/cabeceras, JSON 4–64 KiB, payload webhook 1 MB y errores opacos |

## Migración 273

`sql/273_operational_hardening.sql` es aditiva y crea:

- `ed_rate_limits` + RPC atómica exclusiva de `service_role`;
- `ed_webhook_eventos` + reclamo idempotente, reintentos y retención;
- `cliente_id`/trigger en `ed_servicio_profesional`;
- `ed_auditoria_portal`;
- RPC de bandeja y resumen de conversaciones, exclusivas de `service_role`.

Debe aplicarse después de 272. El preflight final no borra ni repara datos:
cualquier fila debe analizarse manualmente.

## Validación repetida

| Comando/control | Resultado final |
|---|---|
| `npm ls --depth=0` | exit 0; árbol consistente con Next 16.3/React 19.2 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 19 tests, 0 fallos, sin advertencias de módulo |
| `npm run build` | exit 0, Next 16.3/Turbopack, 39 rutas + Proxy |
| `npm run check` | exit 0 |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| HTTP `/login` local | 200; CSP/HSTS/frame/nosniff/referrer presentes; X-Powered-By ausente |

## Límites de la evidencia

El SQL fue revisado estáticamente, no ejecutado contra PostgreSQL. No hubo
credenciales válidas para pruebas RLS/tenant reales ni cuentas de proveedores
para E2E. Esos límites no son defectos ocultos: están convertidos en gates
explícitos en `REMAINING_RISKS.md`.
