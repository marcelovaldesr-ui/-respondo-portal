# Auditoría técnica profunda del portal

Fecha: 4 de agosto de 2026  
Alcance: `respondo-portal` (no incluye la web pública ni Respondo HQ)  
Conclusión: **el código quedó corregido y validado localmente; producción aún
requiere acciones operativas explícitas**.

## Resultado

La primera revisión encontró fallos de autenticación fail-open, aislamiento
multi-tenant incompleto, reservas públicas manipulables, mensajes fantasma,
adjuntos confiados al MIME del cliente y dependencias vulnerables. La segunda
pasada cerró además permisos por rol, rate limit global, reintentos durables de
webhooks, paginación, trazabilidad, retención de payloads, CSP y rotación iCal.

No se desplegó código, no se aplicó SQL y no se cambiaron credenciales externas.
Por eso “corregido en repositorio” no equivale todavía a “verificado en la base
y proveedores productivos”.

## Correcciones consolidadas

- Secretos, cron y webhooks fallan cerrados; Meta exige HMAC y WAHA un secreto.
- Las migraciones 272/273 endurecen RLS/RPC, relaciones multi-tenant, doble
  inscripción, unión servicio-profesional, auditoría, rate limits e inbox.
- El inbox durable reclama eventos atómicamente, conserva idempotencia, reintenta
  errores/atascos y vacía payloads procesados después de siete días.
- La matriz `dueno`/`staff` vive en `lib/permisos.ts`; configuración,
  conocimiento, insights e integraciones son solo del dueño.
- Clientes y conversaciones paginan desde la base; embudo filtra el período en
  PostgreSQL y los historiales/polling están acotados a los mensajes recientes.
- La reserva pública recalcula el slot, limita y valida bytes, UUID, teléfono,
  tenant y concurrencia antes de crear una cita.
- Los envíos se consideran exitosos solo después de la confirmación del canal;
  un fallo deja la conversación visible para intervención humana.
- Adjuntos: firma binaria, máximo 8 MB, proxy autenticado, host WAHA reanclado,
  streaming y MIME activo reducido a una lista segura.
- Google OAuth usa state firmado y vencible; redirects son locales; iCal es
  privado, sin notas, cacheado como privado y con rotación visible/auditable.
- Next se migró de 14.2.35 a 16.3.0 y React a 19.2.8; `middleware.ts` pasó a
  `proxy.ts` y las APIs asincrónicas de request se adaptaron.
- Se incorporaron ESLint, CSP/HSTS/COOP, request IDs y logs estructurados sin
  cuerpos/tokens/PII en los flujos nuevos.

## Validación final

| Control | Resultado |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` | 19/19, 0 fallos |
| `npm run build` | exit 0, Next 16.3/Turbopack, 39 rutas + Proxy |
| `npm run check` | exit 0 (todos los controles anteriores) |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Cabeceras HTTP locales | CSP, HSTS, X-Frame-Options, nosniff y Referrer-Policy presentes; sin X-Powered-By |

## Condiciones de salida para producción

1. Rotar el secreto que apareció en documentación/historial y actualizar todas
   sus copias en proveedor, cron y Vercel.
2. Reparar las credenciales locales/de staging de Supabase; ejecutar preflights,
   aplicar 272 y luego 273, y probar aislamiento A/B y RLS con roles reales.
3. Cargar todas las variables de `.env.example`, con secretos distintos por
   función, y comprobar que los valores antiguos y requests sin firma fallan.
4. Hacer smoke/E2E con Meta Embedded Signup, WhatsApp, WAHA, Instagram, Google
   OAuth, reserva concurrente y reintento de webhook.
5. Desplegar primero a preview/staging, ejecutar `npm run check` y pruebas HTTP,
   observar auditoría/inbox/latidos y recién después promover.

El resumen operativo para continuar en otra sesión está en
`CLAUDE_HANDOFF.md`; los únicos riesgos no cerrados en código están en
`REMAINING_RISKS.md`.
