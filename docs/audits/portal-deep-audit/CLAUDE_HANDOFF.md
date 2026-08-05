# Handoff para Claude · reauditoría Respondo Portal

Fecha de sincronización: 4 de agosto de 2026.

## Estado en una frase

El repositorio quedó endurecido y `npm run check` pasa completo con Next 16;
**no desplegar todavía** hasta rotar el secreto expuesto, recuperar acceso a
Supabase y aplicar/verificar `272` y `273` en staging.

## Contexto de colaboración

- El worktree ya estaba sucio antes de esta auditoría, especialmente por trabajo
  de Instagram, bot, cron y documentación. Esos cambios pertenecen al
  usuario/Claude y fueron preservados; no hacer reset ni revert masivo.
- No se hizo `git commit`, push, deploy, migración, envío externo ni rotación de
  credenciales.
- La aplicación en alcance es `respondo-portal`, no `web-respondo` ni HQ.

## Qué quedó implementado

### Seguridad y tenant

- Fail-closed para Meta/Instagram/WAHA/cron/salud; comparación constante y HMAC.
- Reserva pública valida bytes, tipos, UUID, teléfono, tenant y slot recalculado.
- Envíos humanos/bot no persisten respuestas no entregadas; fallos derivan a
  humano y conservan el caso visible.
- Adjuntos validan magic bytes y tamaño; proxy autenticado hace streaming,
  reancla WAHA y no presenta HTML/SVG como contenido inline.
- Redirects locales, state OAuth Google con HMAC/TTL y errores de proveedor
  opacos con request ID.
- CSP/HSTS/COOP/nosniff/frame/referrer/permissions y sin `X-Powered-By`.

### Roles

Fuente única: `lib/permisos.ts`.

| Capacidad | dueño | staff |
|---|---:|---:|
| operar conversaciones/clientes/embudo/agenda | sí | sí |
| configurar agenda | sí | no |
| editar conocimiento | sí | no |
| generar insights | sí | no |
| gestionar integraciones | sí | no |

El sidebar oculta las secciones no autorizadas y servidor vuelve a exigir el
permiso; la UI no es la barrera de seguridad.

### Resiliencia/operación

- `lib/seguridad.ts`: límite local rápido + RPC global hasheada; si 273 falta,
  cae a local y alerta una vez por minuto.
- `lib/webhookInbox.ts`: reclamo idempotente, estados procesando/procesado/error,
  máximo 8 intentos, recuperación de atascados y payload vaciado a 7 días sin
  borrar la clave idempotente.
- Los tres webhooks limitan cuerpo a 1 MB, validan JSON y devuelven 5xx con
  `Retry-After` cuando el procesamiento/inbox falla.
- El cron reintenta hasta dos eventos por latido para no agotar sus 60 s y limpia
  buckets antiguos.
- Request IDs/logs estructurados redacted y auditoría best-effort de
  integraciones/rotación iCal.

### Rendimiento

- `/clientes`: búsqueda, etapa, count y página se resuelven en DB.
- `/conversaciones`: RPC paginada de 50, filtros/summary/tags en DB y navegación
  que conserva filtros. Si 273 aún no existe usa fallback explícito de 100 filas.
- Embudo aplica el período en DB antes de cargar relaciones.
- Detalle/polling conserva solo los 500/200 mensajes más recientes en el orden
  correcto.

### Plataforma

- Next 14.2.35 → 16.3.0; React/ReactDOM → 19.2.8.
- `middleware.ts` fue reemplazado por `proxy.ts`.
- `cookies()`, `headers()`, `params` y `searchParams` usan las APIs async de
  Next 16.
- ESLint 9 + config flat; scripts `lint`, `typecheck`, `test`, `check`.
- 19 pruebas focalizadas: archivos, OAuth, permisos, redirects, reservas,
  secretos/HMAC e idempotency keys.

## SQL nuevo o modificado

1. `sql/272_security_hardening.sql`
   - RLS para clases, `search_path` seguro, revokes/grants de RPC;
   - índice anti doble inscripción;
   - FK compuestas multi-tenant `NOT VALID`.
2. `sql/273_operational_hardening.sql`
   - `ed_rate_limits` + `ed_consumir_limite`;
   - `ed_webhook_eventos` + `ed_reclamar_webhook`;
   - trigger tenant de `ed_servicio_profesional`;
   - `ed_auditoria_portal`;
   - RPC paginadas/resumen de conversaciones.

Orden obligatorio: **272 → 273**. Ambas son aditivas, pero índices/constraints
pueden revelar duplicados o relaciones históricas corruptas. Ejecutar preflight,
revisar cada fila y no borrar automáticamente.

## Validación ya ejecutada

```text
npm run check          PASS
  eslint               PASS
  tsc --noEmit         PASS
  node:test            19/19 PASS
  next build           PASS (Next 16.3, 39 rutas + Proxy)
npm audit --omit=dev   PASS, 0 vulnerabilidades
HTTP /login local      200, cabeceras de seguridad presentes
```

Fuentes oficiales usadas para la migración:
[Next 15 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-15),
[Next 16 upgrade](https://nextjs.org/docs/app/guides/upgrading/version-16) y
[ESLint en Next](https://nextjs.org/docs/app/api-reference/config/eslint).

## Lo que falta y no debe confundirse con deuda de código cerrada

1. Rotar `EVOLUTION_WEBHOOK_SECRET` (y cualquier reutilización) y verificar que
   el valor anterior deja de funcionar; evaluar historial Git.
2. Corregir acceso al Supabase de staging: durante la auditoría las sondas de
   lectura devolvieron HTTP 401.
3. Aplicar 272/273 en staging y probar RLS/roles/tenant A-B, RPC, trigger,
   idempotencia y concurrencia; luego promover con respaldo.
4. Configurar todas las variables de `.env.example`, incluidas las públicas y
   privadas de Embedded Signup.
5. E2E real: Meta onboarding + webhook firmado, WAHA pairing/webhook, Instagram,
   Google OAuth, reserva simultánea, caída de proveedor y reintento del cron.
6. Confirmar que el CSP no bloquea el Embedded Signup en preview.

## Secuencia recomendada al retomar

```text
git status --short
npm ci
npm run check
npm audit --omit=dev
```

Después: staging SQL 272/273 → preflight/validación → preview Vercel → E2E →
observación de `ed_webhook_eventos`, `ed_auditoria_portal` y latidos → producción.

Los gates completos están en `REMAINING_RISKS.md`; el mapa de flujos está en
`ARCHITECTURE_MAP.md`. Si Claude agrega cambios, debe volver a ejecutar
`npm run check` y actualizar este handoff, sin reescribir el trabajo concurrente.
