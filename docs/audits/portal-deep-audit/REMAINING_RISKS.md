# Riesgos reales pendientes tras la reauditoría

Este listado excluye problemas ya corregidos en el repositorio. Lo pendiente
requiere estado externo, datos reales o una decisión de producto/operación.

| ID | Prioridad | Riesgo pendiente | Acción necesaria |
|---|---|---|---|
| R-01 | P0 operativo | Un secreto retirado del árbol puede seguir activo y permanece en el historial Git. | Rotarlo en proveedor/Vercel/cron, probar rechazo del anterior y decidir si limpiar historial. |
| R-02 | P0 operativo | No se verificó el Supabase real: las credenciales locales usadas en la auditoría respondieron HTTP 401. | Corregir el entorno y probar RLS anon/authenticated/service-role, permisos y aislamiento tenant A/B. |
| R-03 | P0/P1 operativo | `272_security_hardening.sql` y `273_operational_hardening.sql` no están aplicadas. Sin 273, el código usa respaldo local/acotado y no tiene inbox/rate limit global durables. | Preflight en staging, corregir explícitamente cualquier dato histórico, aplicar 272→273, validar RPC/triggers/índices y promover. |
| R-04 | P1 operativo | Meta, WAHA, Instagram y Google no se probaron con cuentas reales después del hardening/upgrade. | E2E de onboarding, firma, entrega/fallo/reintento, OAuth, renovación de token y Embedded Signup bajo CSP. |
| R-05 | P2 producto | El magic link implícito aún procesa sesión en navegador; CSP necesita `unsafe-inline` por compatibilidad Next/SDK. | Evaluar `token_hash`/OTP server-side o PKCE cross-device y, si se cambia, regresión completa del correo/acceso. |
| R-06 | P2 calidad | Las 19 pruebas son focalizadas/puras; falta una suite integrada con Supabase y proveedores simulados. | Crear fixtures A/B y pruebas HTTP de IDOR, RLS, concurrencia, webhook at-least-once y fallos parciales. |
| R-07 | P2 operación | El procesamiento inicial de webhooks sigue siendo síncrono; la durabilidad evita pérdida, pero una función puede expirar después de efectos externos. | Observar tiempos; si crece el volumen, separar recepción/worker manteniendo la misma tabla inbox e idempotencia. |
| R-08 | P2 escala | La paginación usa offset y el embudo consulta el período completo. Es correcto al volumen actual, no óptimo para millones de filas. | Migrar a cursor estable `(fecha,id)` y agregados/materialización cuando las métricas lo justifiquen. |
| R-09 | P2 operación | La auditoría durable es best-effort y cubre acciones sensibles seleccionadas; aún no tiene visor ni alerta. | Añadir consulta/retención/alertas operativas según requisitos de cumplimiento. |
| R-10 | P2 datos | Las FK `NOT VALID` y el trigger de unión frenan corrupción nueva, pero no reparan filas históricas cruzadas o sin tenant. | Ejecutar preflights, revisar cada fila y validar constraints solo después de sanear datos conscientemente. |
| R-11 | P2 privacidad | iCal sigue siendo un bearer URL con datos mínimos de cita; ahora puede rotarse, pero quien tenga el enlace vigente puede leerlo. | Tratarlo como secreto, rotarlo tras sospecha y considerar un feed sin teléfono si el negocio no lo necesita. |
| R-12 | P3 proceso | `npm run check` existe, pero no se verificó un pipeline CI remoto que lo haga obligatorio. | Configurar el proveedor CI del equipo y proteger la rama antes de escalar colaboradores. |

La salida de producción está bloqueada por R-01, R-02 y R-03. R-04 debe
completarse en preview/staging antes de promover.
