# Auditoría integral de Tino — Impresora Color (resumen ejecutivo)

Fecha: 22-jul-2026 · Alcance: implementación de Tino sobre Evolution API (Opción A),
cerebro compartido en `respondo-portal`. Trabajo autónomo: auditar, corregir,
mejorar, probar, refactorizar y documentar.

## 1. Estado inicial

Tino ya tenía un cerebro sólido como código (prompt núcleo con reglas
anti-alucinación, Gemini con respaldo, 5 fichas de conocimiento, escalación) y un
endpoint de entrada por Evolution. La cotización de precios fijos y el diccionario
de modismos chilenos se habían cargado y validado el día anterior. **Lo que
faltaba era la parte que el pedido marca como crítica: la convivencia ordenada
entre Tino y la persona que atiende el WhatsApp.**

## 2. Problemas críticos encontrados (y corregidos)

| # | Problema | Gravedad | Causa | Corrección | Prueba | Resultado |
|---|---|---|---|---|---|---|
| 1 | Tino no detectaba cuando una persona tomaba el control desde el WhatsApp | **Crítica** | `parsearEvolution` descartaba todos los `fromMe` | Se procesan los `fromMe`; id desconocido = mensaje humano → pausa Tino y guarda contexto | H3/H5b | ✅ `toma_humana`, modo=humano, 0 envíos |
| 2 | Un webhook duplicado podía generar respuesta doble | **Crítica** | Sin idempotencia | `wa_message_id` + índice único (mig. 212) + pre-chequeo | H2 / I1b | ✅ **212 aplicada**: `duplicado`, 0 envíos, sin filas repetidas |
| 3 | Si un humano respondía mientras Gemini generaba, Tino igual enviaba | **Crítica** | Modo se leía solo al inicio | Re-chequeo de modo justo antes de enviar | H4/lógica | ✅ `silencio_carrera` |
| 4 | El eco del propio mensaje de Tino podía confundirse con intervención humana | Alta | `fromMe` no distinguía origen | Se guarda el id del envío + red de seguridad por texto reciente | H5 | ✅ `eco`, no se pausa |
| 5 | Al reanudar, Tino podía contradecir el precio/acuerdo dado por la persona | Alta | El prompt no distinguía mensajes del equipo humano | Historial marca "Compañero del equipo"; regla 11 del núcleo | H6 | ✅ respetó $30.000, no recotizó |
| 6 | (Revisado) Pausar/reanudar desde el portal | — | Ya existía: server action `cambiarModo` + botones en Conversaciones | Verificado que convive con la toma automática (mismo `modo`); se quitó un endpoint redundante que se había agregado | manual | ✅ ya funcionaba |
| 7 | Gemini lento/503 en producción | Alta | `GEMINI_MODEL=gemini-3.5-flash` | Cambiado a `gemini-2.5-flash` | pruebas | ✅ respuestas rápidas |

## 3. Mejoras realizadas

**Atención híbrida (lo central):** detección automática de toma de control humana,
pausa inmediata de Tino, guardado del mensaje humano como contexto, idempotencia,
anti-carrera, distinción de eco, y respeto a los acuerdos de la persona al reanudar.
Endpoint para pausar/reanudar desde el portal.

**Cotización / comercial:** ficha "Qué datos pedir para cotizar cada producto" —
Tino reconoce los datos ya entregados (por el cliente o por la persona) y pide solo
lo que falta, sin interrogar; da el precio fijo cuando está en rango y deriva sin
inventar cuando no.

**Prompt:** regla 11 (autoridad del mensaje humano) e historial que marca los
mensajes del equipo.

**Técnico / mantenibilidad:** la lógica de entrada se extrajo a `lib/inboundEvolution.ts`
(la ruta HTTP quedó delgada) para poder probarla sin HTTP; helpers reutilizables
(`lib/mensajes.ts`, `lib/estadoChat.ts`); logs útiles en el webhook.

## 4. Archivos

**Nuevos:** `lib/inboundEvolution.ts`, `lib/mensajes.ts`, `lib/estadoChat.ts`,
`app/api/whatsapp/estado/route.ts`, `sql/212_convivencia_tino.sql`,
`docs/CONVIVENCIA_TINO.md`, `scripts/_test_hibrido.ts`, `_test_hibrido2.ts`,
`_test_dificiles.ts` (+ `_test_tino.ts`, `_test_modismos.ts` del día anterior).

**Modificados:** `lib/evolution.ts` (parse con `fromMe`/id, envío devuelve id),
`lib/responderBot.ts` (anti-carrera, guarda id, respeta rol humano),
`lib/promptEmpleado.ts` (regla 11 + historial marcado),
`app/api/whatsapp/webhook-evolution/route.ts` (delgada), `.env.local`/`.env.example`.

**Conocimiento (Supabase, 8 fichas vigentes):** +Precios fijos (con IVA),
+Modismos chilenos, +Datos para cotizar; ficha de políticas con cláusula de
excepción de precios.

## 5. Pruebas ejecutadas

- **Convivencia** (`_test_hibrido*.ts`): H1–H6 arriba. Envío simulado, sin WhatsApp real.
- **Comercial / cotización** (`_test_tino.ts`): precios fijos exactos en rango; deriva fuera de rango; no inventa.
- **Modismos** (`_test_modismos.ts`): panfleto→flyer, calcomanía→sticker, lienzo→lona PVC, carnet→credencial; desambigua "tarjetas".
- **Casos difíciles** (`_test_dificiles.ts`): prompt injection (resistió), fuera de tema (redirige), reclamo (empatiza+escala), fuera de rango (no inventa), solo-precio (pregunta), no-sabe (orienta), datos-ya-dados (no repregunta, avanza).

**Antes → después:** antes Tino habría respondido "encima" de la persona y sin
detectar su intervención; después se aparta, guarda contexto y retoma respetando lo
acordado. Antes el modelo lento se veía como "no responde"; después responde al toque.

## 6. Diferenciación del estado

- **Corregido y validado:** detección de toma de control, silencio bajo control
  humano, eco, anti-carrera, **idempotencia (migración 212 aplicada y probada)**,
  reanudación con respeto al humano, cotización de precios fijos, modismos, casos
  difíciles, y el modelo de Gemini rápido/estable.
- **Ya existía (verificado):** los botones "Tomar la conversación / Pausar /
  Devolver a Tino" en la pantalla de Conversaciones (server action `cambiarModo`).
  Convive bien con la toma de control automática (mismo `modo`). Se quitó un
  endpoint redundante que se había agregado.
- **Requiere info de la dueña:** confirmar precios fijos del catálogo; definir
  palabras/plazos por producto adicionales si aparecen.
- **Requiere decisión de Respondo:** aviso proactivo a Cecilia al escalar
  (hoy ella lo ve en su propio WhatsApp); mensajes de audio/imagen (hoy se piden por texto).

## 7. Riesgos restantes

- Mensajes muy seguidos del cliente: Tino responde a cada uno (no hay "debounce"); aceptable para el volumen de una imprenta.
- Audio/imagen aún no se procesan (se pide texto amablemente).

## 8. Checklist de lanzamiento

- [x] Aplicar `sql/212_convivencia_tino.sql` en Supabase del motor. **(hecho por Marcelo)**
- [ ] Variables en Vercel (Supabase, Gemini con `gemini-2.5-flash`, Evolution + secret).
- [ ] Deploy del portal en Vercel; anotar URL.
- [ ] Repuntar webhook de Evolution a `/api/whatsapp/webhook-evolution?k=<secret>` (MESSAGES_UPSERT, webhook-by-events OFF).
- [ ] Apagar n8n en Railway.
- [ ] Prueba real: escribir al chip desde otro teléfono; luego responder desde el WhatsApp del negocio y verificar que Tino se calla.
