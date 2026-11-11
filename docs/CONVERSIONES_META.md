# Conversiones a Meta (WhatsApp) — cómo funciona y cómo activarla

Función general de Respondo, por negocio. Devuelve a Meta lo que pasó en las
conversaciones que llegaron desde un anuncio **Click-to-WhatsApp (CTWA)**, para que
Meta optimice por gente que cotiza y compra, no solo por gente que escribe.

API usada: **Conversions API for Business Messaging** (Graph v21.0).
Primer negocio: Impresora Color (calendarios 2027, regla: 500 unidades o más).

---

## Qué se envía

| Evento | Cuándo | Valor |
|---|---|---|
| `LeadSubmitted` | La IA leyó **producto + cantidad** en la conversación | 0 |
| `QualifiedLead` | La cotización cumple la **regla del negocio**, o alguien apretó «Cotización calificada» | 0 |
| `Purchase` | Alguien apretó **«Marcar como venta»** y escribió el monto neto | monto neto CLP |

- Solo conversaciones con `ctwa_clid` (vinieron de un anuncio). Las que llegan desde la
  web siguen el mismo flujo del asistente, pero no generan eventos.
- **Meta no deduplica**: lo hacemos nosotros. Un `LeadSubmitted` y un `QualifiedLead`
  por conversación, para siempre. Un `Purchase` por venta marcada.
- Cero datos personales: el payload lleva solo `whatsapp_business_account_id` y `ctwa_clid`.
- `Purchase` **no** sale de cada pago registrado: una imprenta cobra abono y saldo, y
  serían dos compras para un pedido.

## Piezas

| Pieza | Dónde |
|---|---|
| Migración (flag, config, cotización, registro) | `sql/331_conversiones_meta.sql` |
| Config por negocio y regla de calificación | `lib/ads/conversionesConfig.ts` |
| Extracción estructurada (prompt + schema + fusión) | `lib/ads/cotizacionCore.ts` |
| Extractor (corre en el cron, no en el turno de Tino) | `lib/ads/extraccionCotizacion.ts` |
| Payload, dedupe, reintentos | `lib/ads/eventos.ts` |
| Cola, envío, dataset, evento de prueba | `lib/ads/colaEventos.ts` |
| Botones de la conversación | `components/inbox/VentaMeta.tsx` + `app/(portal)/conversaciones/accionesConversionesMeta.ts` |
| Panel de configuración | `components/marketing/ConfigConversiones.tsx` (Marketing → Integraciones) |
| Tests | `tests/ads-eventos.test.mjs`, `tests/conversiones-meta.test.mjs` |

Todo corre en el cron único (`/api/cron/seguimientos`), cada 5 minutos: primero
`extraccion_cotizaciones`, después `conversiones_pauta`. Si Meta falla, el evento queda
`fallido` y se reintenta (5 min, 25 min, 2 h, 10 h; máximo 5 intentos). La conversación
con el cliente nunca se entera.

Cada envío queda en `ed_ads_eventos` con payload, respuesta de Meta, estado
(`pendiente` / `enviado` / `fallido` = reintentando / `descartado` = no se envía, con motivo)
y si fue de prueba.

**Con el flag apagado (el valor por defecto) nada de esto corre y la pantalla de
conversación no muestra nada nuevo.**

---

## Activar un negocio nuevo — paso a paso

### Una sola vez para Respondo (ya hecho o por hacer en la app de Tech Provider)
1. En developers.facebook.com → la app de WhatsApp de Respondo → **Revisión de la app →
   Permisos y funciones**: pedir **acceso avanzado** a `whatsapp_business_manage_events`.
2. Agregar ese permiso a la configuración del **registro insertado** (Embedded Signup),
   para que los negocios nuevos lo traigan desde el inicio.

### Por cada negocio
1. **Token con el permiso.** El WhatsApp del negocio tiene que estar conectado con un
   token que incluya `whatsapp_business_management` y `whatsapp_business_manage_events`.
   Si se conectó antes del paso anterior, reconectarlo (o usar un System User con ambos).
2. Portal → **Marketing → Integraciones → API de conversiones → Ver detalles**.
3. Apretar **«Obtener o crear desde WhatsApp»**. Respondo le pide a Meta el dataset de la
   WABA (lo crea si no existe) y lo guarda. Si Meta responde con un error de permisos,
   aparece ahí mismo: falta el paso 1.
4. En **«Regla de cotización calificada»**, escribir producto, otros nombres y cantidad
   mínima. Ejemplo Impresora: `calendarios` · `calendario, almanaque` · desde `500`.
5. Elegir qué eventos se informan (por defecto, los tres).
6. **Prueba:** en el Administrador de eventos de Meta → el dataset → **Probar eventos**,
   copiar el código (`TEST…`), pegarlo en «Código de prueba», **Guardar** y apretar
   **«Enviar evento de prueba»**. El evento tiene que aparecer en Probar eventos.
   (No consume la deduplicación: no impide que después salga el evento real.)
7. Marcar **«Enviar los resultados de las conversaciones de anuncios a Meta»** y **Guardar**.
8. Ajustar el asistente para la campaña (ficha de conocimiento del negocio, no código).
9. Explicar al equipo del negocio los dos botones de la conversación:
   **«Marcar como venta»** (monto neto, sin IVA) y **«Cotización calificada»**.

### Para apagarlo
Desmarcar el interruptor y Guardar. Lo ya enviado queda registrado; no sale nada nuevo.
