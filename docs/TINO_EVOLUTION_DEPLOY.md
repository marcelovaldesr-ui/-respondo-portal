# Tino por WhatsApp (Opción A / Evolution) — sin n8n

El cerebro de Tino ahora corre como **código dentro del portal** (Vercel), no en n8n.
Evolution recibe el WhatsApp del chip y le pega directo a un endpoint del portal.

```
WhatsApp (chip 56985761941)
        │
        ▼
Evolution API (Railway)  ──POST webhook──▶  Portal /api/whatsapp/webhook-evolution
                                                     │
                                     mismo cerebro (lib/responderBot.ts):
                                     historial → prompt → Gemini(+respaldo) → responder
                                                     │
                                        Evolution sendText  ──▶  responde al cliente
                                                     │
                                     guarda en ed_mensajes / ed_contactos / ed_chat_estado
```

## Piezas nuevas (ya escritas)
- `lib/evolution.ts` — parseo del webhook de Evolution + envío por `sendText` + mapeo instancia→cliente.
- `app/api/whatsapp/webhook-evolution/route.ts` — recibe el mensaje, lo guarda y dispara el cerebro.
- `lib/responderBot.ts` — se le agregó un transporte `enviar` opcional (Evolution). La Opción B (Meta) sigue igual.

## Variables de entorno (Vercel + local)
Las que ya usaba el portal: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`,
`GEMINI_MODEL`, `NEXT_PUBLIC_SITE_URL`.

Nuevas para Evolution:
| Variable | Valor |
|---|---|
| `EVOLUTION_API_URL` | `https://evolution-api-production-3386.up.railway.app` |
| `EVOLUTION_API_KEY` | apikey global de Evolution → Railway → servicio **Evolution API** → **Variables** → `AUTHENTICATION_API_KEY` (la misma con que entras al Manager) |
| `EVOLUTION_WEBHOOK_SECRET` | `2jQZ3kScL2T61EgUZNnRylJgXp40W6S2` (ya generado, en `.env.local`) |

## Pasos de deploy (una vez)
0. **Aplica la migración `sql/212_convivencia_tino.sql`** en el Supabase del motor
   (SQL editor). Agrega `ed_mensajes.wa_message_id` + índice único → habilita la
   idempotencia y la detección de toma de control humana. Sin ella el bot funciona
   igual, pero un webhook duplicado podría generar una respuesta doble.
0b. En Vercel usa **`GEMINI_MODEL=gemini-2.5-flash`** (estable y rápido; el anterior
   `gemini-3.5-flash` era lento y daba 503).
1. **Pega la apikey** de Evolution en `EVOLUTION_API_KEY` (en `.env.local` y luego en Vercel).
2. **Sube a GitHub** el portal (rama main).
3. **Vercel** → New Project → importa el repo `-respondo-portal` → pega TODAS las variables de arriba → Deploy. Anota la URL de producción (ej. `https://respondo-portal.vercel.app`).
4. **Repunta el webhook de Evolution** al portal (reemplaza la URL de n8n):
   - Evolution Manager → instancia `impresora-color` → **Webhook**.
   - URL: `https://<tu-portal>.vercel.app/api/whatsapp/webhook-evolution?k=2jQZ3kScL2T61EgUZNnRylJgXp40W6S2`
   - Eventos: **MESSAGES_UPSERT** (solo ese).
   - **Webhook by events: OFF** (una sola URL, sin sufijo por evento).
5. **Apaga n8n** en Railway (ya no se usa) para no pagarlo ni recibir dobles.

## Prueba (end to end)
Desde OTRO teléfono, escríbele al chip **+56 9 8576 1941**:
- "Hola, ¿hacen tarjetas de presentación?" → Tino responde usando solo la info del negocio.
- "¿Cuánto cuestan 1000 flyers?" → Tino NO inventa precio: pide datos y deriva a Cecilia.
- "¿Hacen despacho a domicilio?" → Tino responde **no, retiro en Arauco 1060, Chillán**.

Verifica en Supabase: `ed_mensajes` (entrante + respuesta), `ed_contactos` (el número), `ed_chat_estado` (modo bot).

## Notas
- El endpoint responde 200 siempre (Evolution reintenta si no; evita duplicados).
- Ignora grupos, difusiones y mensajes propios (`fromMe`).
- Solo procesa texto; audio/imagen es fase posterior.
- Si `EVOLUTION_WEBHOOK_SECRET` está seteado, exige `?k=` correcto (evita mensajes falsos).
- Escalación: si Tino deriva, el chat pasa a modo `humano` y Cecilia sigue en su propio WhatsApp.
```
