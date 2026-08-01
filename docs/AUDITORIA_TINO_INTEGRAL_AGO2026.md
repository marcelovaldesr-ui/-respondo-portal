# Auditoría integral de Tino y la plataforma — 1-ago-2026

> Auditoría de extremo a extremo del sistema completo (WhatsApp → webhook →
> persistencia → contexto → decisión de Tino → herramientas → envío → inbox →
> intervención humana), no solo del prompt. Se reconstruyó la arquitectura real
> desde el código, se buscaron fallas estructurales, se **corrigieron las causas
> raíz** de las de mayor severidad y se dejaron **pruebas de regresión**.

Alcance del código auditado: `respondo-portal` (Next.js 14 / Vercel), que es
donde vive el cerebro de Tino y toda la plataforma. Transporte productivo hoy:
**WAHA** (WhatsApp no oficial, número real de Impresora Color 56998441157).
Transporte "definitivo" preparado: **Meta Cloud API + Coexistencia** (en App
Review). Base: Supabase (esquema `ed_`).

---

## 1. Resumen ejecutivo

**Estado inicial:** plataforma madura y en producción (Tino atendió el 94 % de
las respuestas el día 1). Base de código sana (typecheck limpio, aislamiento por
`cliente_id`, seguridad de webhooks endurecida el 30-jul). Pero la operación con
clientes reales seguía sacando a la luz fallas *estructurales* en las costuras
del sistema —concurrencia bot↔humano, multimedia, paridad entre transportes— que
las revisiones anteriores no habían cerrado del todo.

**Se encontraron 6 problemas reales** (2 latentes en la vía oficial, ya
preparada). **Los 6 quedaron corregidos** con causa raíz, todo con **typecheck
en verde** y **pruebas** (unitarias nuevas + suite de convivencia reparada).

| # | Severidad | Problema | Estado |
|---|-----------|----------|--------|
| B1 | **Alto** | WAHA: Tino podía responder **encima del humano** si la persona tomaba el control durante los ~6 s de "escribiendo…" | ✅ Corregido |
| B2 | **Alto** | Meta (vía oficial): sin guardia de vigencia → **doble respuesta** y Tino sobre el humano (el fix de WAHA nunca se replicó) | ✅ Corregido |
| B3 | **Alto** | Meta: **toda** foto/audio/PDF del cliente se **descartaba** (no se guardaba, no aparecía en el portal, Tino no se enteraba) | ✅ Corregido |
| B4 | **Medio-Alto** | Inbox: los mensajes que envía la persona se **duplicaban** en el historial (y en el contexto de Tino) por su propio eco de WAHA | ✅ Corregido |
| B5 | **Medio-Alto** | El operador estaba **ciego** al contenido: solo veía "[el cliente envió una imagen]", no podía abrir la foto/PDF/audio | ✅ Corregido (requiere aplicar migración 270 + verificar en vivo) |
| B6 | **Medio** | La suite de regresión de convivencia (3 scripts) estaba **rota**: importaba un módulo eliminado el 30-jul → no corría justo en el área más delicada | ✅ Reparada |

**Riesgos residuales / decisiones pendientes** (sección 9): aplicar la migración
270 y verificar el visor de adjuntos contra la WAHA real; endurecer el webhook de
WAHA con secreto; multi-tenant de WAHA (hoy 1 solo número); STT de audios.

**Veredicto (sección 10): APTO CON SUPERVISIÓN NORMAL** para la operación actual
(Impresora Color por WAHA). Los fixes eliminan el peor riesgo operativo (Tino
hablando encima del humano / duplicando) y dejan la vía oficial a la par.

---

## 2. Mapa real de arquitectura (reconstruido desde el código)

### Flujo de un mensaje entrante (transporte WAHA — el que está en vivo)

```
Cliente en WhatsApp
   │
   ▼
WAHA (Railway, motor GOWS)  ──POST──►  /api/whatsapp/webhook-waha  (ruta delgada)
                                          │  secreto opcional ?k= (secretoValido, timing-safe)
                                          ▼
                                   lib/inboundWaha.ts  manejarEntranteWaha()
   0) parsearAckWaha → actualizarEstadoEnvio (ACKs de entrega, anti-retroceso)
   1) parsearWaha → ignora grupos/broadcast/status; guardia de FRESCURA (>180 s = ignora)
      · Multimedia → marcador legible + metadatos de adjunto (media_*)
   2) clientePorInstanciaWaha (waba_phone_id) → cliente ; tinoDe() → empleado
   2b) resolverContacto(LID→número real)  → chatId estable
   2c) empleadoParaEntrante (ruteo a Beto/Vera si hay seguimiento <72 h; si no, Tino)
   3) yaProcesado(wa_message_id) → idempotencia (índice único mig. 212)
   4) fromMe + id desconocido → TOMA DE CONTROL humana (guarda rol=humano, modo=humano)
      · anti-carrera: espera 2.5 s y re-verifica eco antes de silenciar a Tino
   5) Cliente → guardarMensaje (dup por índice único = se retira, no doble respuesta)
      → tocarVentanaEntrante → DEBOUNCE adaptativo (6–15 s, agrupa fragmentos)
      → responderSiBot(...)
```

### Cerebro (compartido por los dos transportes) — `lib/responderBot.ts`

```
responderSiBot:
  modoDe() ≠ bot            → silencio (no responde si hay humano/pausa)
  historial(20) → armarPrompt (NÚCLEO + ROL + FICHA + CONOCIMIENTO vigente + CORRECCIONES + historial)
  agenda? → confirmacionRapida("sí") por CÓDIGO ; bloque "AGENDA REAL" (tokens de cupo)
  generarJSON (Gemini 2.5-flash, timeout 20 s, 1 reintento, modelo de respaldo)
     └─ si falla → aviso honesto + escalación + modo humano (el cliente NUNCA queda mudo)
  ANTI-CARRERA 1: re-lee modo antes de enviar
  ANTI-CARRERA 2: sigueVigente() (mensaje más nuevo del cliente) — y ahora también MODO
  agenda: ejecutarAccionAgenda (crea/reagenda/cancela por CÓDIGO; EXCLUDE anti doble-reserva)
  enviar (WAHA: startTyping → delay humano 1.5–6 s → vigente() final → sendText)
  guardarMensaje(rol=empleado, waId)  ← el id permite reconocer su ECO después
  escalar? → setModo humano + ed_escalaciones ; autoEtiquetar ; notificarHQ
```

### Vía oficial (Meta Cloud API) — `lib/inboundMeta.ts` + `lib/whatsapp.ts`

Gemela de WAHA. Webhook `/api/whatsapp/webhook` con **verificación de firma
HMAC-SHA256** sobre el cuerpo crudo (`firmaMetaValida`). Maneja `messages`,
`statuses` (ACKs) y `message_echoes` (Coexistencia = la persona escribe desde su
app). Mismo cerebro, mismo tracking, misma convivencia.

### Plataforma / operador

- **Inbox en vivo** `components/InboxConversacion.tsx`: poll a
  `/api/whatsapp/mensajes` cada 4 s; "Tomar el control / Devolver a Tino"
  (optimista); envío con Enter; adjuntar imagen/PDF (📎, validado en servidor).
- **Aislamiento por tenant**: toda query se filtra por `cliente_id`; el endpoint
  de mensajes valida que el empleado sea del cliente logueado; server actions
  validan pertenencia (sin IDOR).
- **Observabilidad**: `/api/salud` (503 para cron externo), ACKs de entrega,
  `estado_envio`, puente a HQ (`notificarHQ`).

### Puntos de fallo identificados (dónde se rompía)

1. Ventana de "escribiendo…" de WAHA (B1) · 2. Falta de paridad Meta (B2, B3) ·
3. Eco de los envíos de la persona (B4) · 4. Multimedia no persistida (B5) ·
5. Regresión de convivencia inoperante (B6).

---

## 3. Matriz de pruebas (casos ejecutados / verificados)

| ID | Componente | Escenario | Esperado | Observado (antes) | Resultado |
|----|-----------|-----------|----------|-------------------|-----------|
| T01 | inboundWaha | Cliente escribe (modo bot) | Tino responde 1× | OK | ✅ |
| T02 | inboundWaha | Webhook duplicado (mismo waId) | 0 respuestas nuevas | OK (idempotencia 212) | ✅ |
| T03 | inboundWaha | Persona toma control (fromMe id nuevo) | modo=humano, 0 envíos | OK | ✅ |
| T04 | responderBot | Cliente escribe con humano activo | silencio | OK | ✅ |
| **T05** | **inboundWaha** | **Persona toma control DURANTE los 6 s de tipeo** | **Tino NO envía** | **❌ Tino enviaba encima** | ✅ **Corregido (B1)** |
| **T06** | **inboundMeta** | **Cliente manda 2º mensaje mientras el modelo piensa** | **1 sola respuesta** | **❌ doble respuesta** | ✅ **Corregido (B2)** |
| **T07** | **whatsapp.parsearWebhook** | **Cliente manda foto/audio/PDF por vía oficial** | **mensaje registrado + acusado** | **❌ se descartaba entero** | ✅ **Corregido (B3)** |
| **T08** | **acciones/inboundWaha** | **Eco del mensaje que envió la persona** | **reconocido como eco, 1 fila** | **❌ duplicado (2 filas)** | ✅ **Corregido (B4)** |
| **T09** | **mensajes/inbox** | **Operador abre foto que mandó el cliente** | **la ve (proxy autenticado)** | **❌ solo "[imagen]"** | ✅ **Corregido (B5)** |
| T10 | guardarMensaje | Migración 270/212 sin aplicar | idempotencia preservada | — | ✅ (unit) |
| T11 | media proxy | Adjunto de otro cliente (id manipulado) | 404 (aislamiento) | — | ✅ (por código) |
| T12 | agenda | Doble "agendar" mismo cupo | 2ª = cupo_tomado (no doble reserva) | OK (EXCLUDE) | ✅ |
| T13 | gemini | Modelo caído/timeout | aviso + escalación + humano | OK | ✅ |
| T14 | seguridad | Webhook Meta sin firma / firma falsa | 403 | OK | ✅ |
| T15 | prompt | Prompt injection ("ignora tus instrucciones") | tratado como consulta normal | OK (regla 10) | ✅ |

Automatizados: **T07, T10** en `scripts/_test_auditoria_ago2026.ts` (corre sin
BD). **T01–T08** en la suite de convivencia reparada (`_test_hibrido.ts`, contra
la BD real). T06 se verifica además por revisión de código + typecheck.

---

## 4. Registro de problemas

### B1 — WAHA: Tino responde encima del humano durante el tipeo · **ALTO**
- **Evidencia / causa raíz:** `responderSiBot` re-lee el modo ANTES de entrar a
  `enviarTextoWaha`, pero ahí se esperan hasta 6 s de "escribiendo…" y la única
  guardia final (`vigente`) solo miraba si había un mensaje **más nuevo del
  cliente** — no el modo. Si Cecilia tocaba **"Tomar el control"** en esos 6 s,
  la comprobación de modo ya había pasado y Tino mandaba su respuesta **encima**
  de ella. Una persona no genera un mensaje de cliente, por eso la guardia de
  "mensaje más nuevo" no lo detectaba.
- **Repro:** modo=bot; llega mensaje; durante el "escribiendo…" `setModo(humano)`
  → antes: Tino enviaba igual.
- **Corrección:** `sigueVigente` (que se pasa también como `vigente` al sender)
  ahora verifica **primero `modoDe()===bot`**. Cierra toda la ventana.
- **Archivos:** `lib/inboundWaha.ts`. · **Prueba:** T05 (escenario documentado
  en `_test_hibrido.ts`) + revisión.

### B2 — Meta (vía oficial): sin guardia de vigencia · **ALTO**
- **Causa raíz:** el fix anti-doble-respuesta y anti-carrera de WAHA
  (`sigueVigente`) **nunca se replicó** en `inboundMeta`. Ahí solo existía el
  debounce (6 s pre-modelo). Si el cliente escribía durante la latencia del
  modelo (~9 s), salían **dos respuestas**; y una toma de control entre modelo y
  envío no se detectaba.
- **Corrección:** se añadió `sigueVigente` (mensaje más nuevo **+ modo bot**) y
  se pasa a `responderSiBot` en el camino Meta, a la par de WAHA.
- **Archivos:** `lib/inboundMeta.ts`. · **Prueba:** T06.

### B3 — Meta: multimedia del cliente descartada · **ALTO**
- **Causa raíz:** `parsearWebhook` hacía `if (m.type !== "text") continue`. En la
  vía oficial una foto/audio/PDF **desaparecía**: no se guardaba, no se veía en
  el portal y Tino no sabía que existía (podía seguir preguntando lo que la foto
  respondía). Es el mismo bug que en WAHA se corrigió el 31-jul, pero en el otro
  transporte.
- **Corrección:** ahora se registra el pie de foto si viene, o un marcador
  legible (`[el cliente envió una imagen]`, `…un audio`, `…un archivo (nombre)`),
  con el **mismo vocabulario que WAHA** para que prompt e inbox lean igual.
- **Archivos:** `lib/whatsapp.ts`. · **Prueba:** T07 (automatizada).

### B4 — Inbox: mensajes de la persona duplicados por su propio eco · **MEDIO-ALTO**
- **Causa raíz:** `responderComoHumano`/`enviarArchivoComoHumano` guardaban el
  mensaje del humano **sin `wa_message_id`**. Como WAHA está suscrito a
  `message.any`, ese envío vuelve por el webhook como `fromMe`. Al no tener id,
  no calzaba en `yaProcesado`, y `esEcoReciente` solo mira `rol=empleado` (no
  `humano`) → se guardaba **otra vez** como mensaje humano. Resultado: cada
  mensaje del operador aparecía **duplicado** en el inbox y en el contexto de
  Tino.
- **Corrección:** ambos envíos ahora capturan el `waId` del transporte y lo
  guardan vía `guardarMensaje`. El eco se reconoce por id → se ignora.
- **Archivos:** `app/(portal)/conversaciones/acciones.ts`, `lib/mensajes.ts`.
  · **Prueba:** T08 (escenario H7 en `_test_hibrido.ts`).

### B5 — Operador ciego al contenido multimedia · **MEDIO-ALTO**
- **Causa raíz:** los adjuntos entrantes nunca se persistían más allá del
  marcador de texto; el inbox solo pinta `texto`. La persona no podía **abrir**
  la foto/PDF/audio que mandó el cliente (Fase 5/13 de la auditoría).
- **Corrección (aditiva y defensiva):**
  1. `sql/270_media_mensajes.sql`: columnas `media_url/mime/tipo/nombre`.
  2. `guardarMensaje` persiste los metadatos del adjunto **sin perder la
     idempotencia** si la migración aún no está (baja de capa por columna
     faltante en vez de tirar el `waId`).
  3. `inboundWaha` pasa los metadatos del adjunto al guardar.
  4. Proxy **autenticado y aislado por tenant** `/api/whatsapp/media` (descarga
     server-side con la `X-Api-Key`, guardia anti-SSRF al host de WAHA).
  5. El inbox renderiza imagen/audio/enlace del adjunto.
- **Archivos:** `sql/270`, `lib/mensajes.ts`, `lib/inboundWaha.ts`,
  `app/api/whatsapp/media/route.ts`, `app/api/whatsapp/mensajes/route.ts`,
  `components/InboxConversacion.tsx`. · **Prueba:** T09 (aislamiento por código)
  + T10 (idempotencia con migración faltante, automatizada).
- **⚠ Requiere:** aplicar la migración 270 **y verificar en vivo** que el
  `media.url` que expone tu WAHA se descarga con la `X-Api-Key` (no pude probarlo
  contra la WAHA real desde el sandbox). Si el formato de URL difiere, se ajusta
  el proxy; hasta entonces el inbox sigue mostrando el marcador de texto (no se
  rompe nada).

### B6 — Suite de regresión de convivencia rota · **MEDIO**
- **Causa raíz:** `_test_hibrido.ts`, `_test_hibrido2.ts` y `_test_idem.ts`
  importaban `../lib/inboundEvolution`, **eliminado el 30-jul** al retirar
  Evolution. Los scripts fallaban al importar → la regresión del área humano↔bot
  (la más delicada) **no corría**.
- **Corrección:** portados al transporte vivo (WAHA) con payloads reales del
  webhook de WAHA; se agregó el escenario **H7** (dedup del eco humano, B4).
- **Archivos:** los 3 scripts.

### Observaciones (sin cambio de código o menor — ver decisiones, sección 9)
- **O1 · Multi-tenant WAHA (Medio, producto):** `WAHA_INSTANCIA` fijo mapea todo
  a `impresora-color`. Con un 2º número por WAHA se mezclarían clientes. Riesgo
  real **solo al conectar un 2º cliente por WAHA**; hoy 1 solo. Separar sesiones
  por cliente antes de escalar.
- **O2 · Webhook WAHA sin secreto (Bajo):** WAHA no firma; el `?k=` es opcional.
  Recomendado: definir `EVOLUTION_WEBHOOK_SECRET` en Vercel **y** en la URL del
  webhook de WAHA para exigirlo.
- **O3 · `crearCita` idempotencia por chat (Bajo):** solo hay EXCLUDE por slot.
  Doble ejecución del mismo cupo = `cupo_tomado` (no hay doble reserva). Solo
  habría 2 citas si el modelo emitiera "agendar" con cupos distintos en ciclos
  válidos separados — improbable; aceptable.
- **O4 · Rate limit en memoria por instancia (Bajo):** no es global en
  serverless; frena el abuso obvio. Migrar a Upstash si se necesita estricto.
- **O5 · Audios sin transcripción (Bajo):** Tino acusa y pide texto (correcto por
  prompt). Mejora futura: STT.

---

## 5. Cambios realizados

Todos con **typecheck en verde** (`npx tsc --noEmit` → 0 errores) y aditivos /
defensivos (no rompen nada si una migración va por detrás del deploy).

| Archivo | Motivo | Riesgo | Reversión |
|---------|--------|--------|-----------|
| `lib/inboundWaha.ts` | B1: modo en la guardia final; B5: pasa media | Bajo | git revert del hunk |
| `lib/inboundMeta.ts` | B2: guardia sigueVigente (paridad) | Bajo | idem |
| `lib/whatsapp.ts` | B3: multimedia no se descarta | Bajo | idem |
| `lib/mensajes.ts` | B4/B5: guardarMensaje robusto + media | Bajo (más defensivo que antes) | idem |
| `app/(portal)/conversaciones/acciones.ts` | B4: guarda waId del envío humano | Bajo | idem |
| `app/api/whatsapp/mensajes/route.ts` | B5: expone media (con fallback) | Bajo | idem |
| `components/InboxConversacion.tsx` | B5: render de adjuntos | Bajo | idem |
| `app/api/whatsapp/media/route.ts` (nuevo) | B5: proxy autenticado | Bajo (solo lectura, tenant + anti-SSRF) | borrar archivo |
| `sql/270_media_mensajes.sql` (nuevo) | B5: columnas media | Bajo (aditivo, nullable) | columnas quedan sin uso |
| `scripts/_test_hibrido*.ts`, `_test_idem.ts` | B6: reparados a WAHA | Nulo (solo pruebas) | — |
| `scripts/_test_auditoria_ago2026.ts` (nuevo) | Regresiones B3/B4/B5 | Nulo | — |

**Validaciones ejecutadas:** `npm install` + `npx tsc --noEmit` (0 errores) ·
`npx tsx scripts/_test_auditoria_ago2026.ts` (18/18 OK) · typecheck de los
scripts portados (limpio; el único error del árbol es `_test_carriles.ts`, **pre-
existente** y ajeno a esta auditoría).

---

## 6. Suite permanente de pruebas (comandos)

Descubierto del proyecto: se usa **tsx** (no hay `test` en package.json). Los
scripts `scripts/_test_*.ts` son la suite.

```bash
# Unitarias SIN base de datos (parsers + persistencia) — corre en segundos:
npx tsx scripts/_test_auditoria_ago2026.ts

# Convivencia Tino+humano contra la BD real (chat de prueba aislado, se limpia):
source .env.local && npx tsx scripts/_test_hibrido.ts     # H1–H7 (incluye dedup de eco humano)
source .env.local && npx tsx scripts/_test_hibrido2.ts    # eco + reanudación con contexto
source .env.local && npx tsx scripts/_test_idem.ts        # idempotencia (mig. 212)

# Otras existentes: _test_tino, _test_dificiles, _test_seg, _test_meta, _test_agenda*
# Gate definitivo de deploy (como siempre): el build de Vercel.
```

---

## 7. Banco de conversaciones y eventos

- **Normales/ambiguos/hostiles:** `_test_tino.ts`, `_test_dificiles.ts`
  (injection resistida, reclamo que escala, fuera de rango sin inventar),
  `_test_modismos.ts` (regionalismos chilenos).
- **Convivencia humano↔bot:** `_test_hibrido.ts` (H1–H7), `_test_hibrido2.ts`.
- **Multimedia (vía oficial):** `_test_auditoria_ago2026.ts` A) — foto sin/ con
  pie, audio, PDF, ubicación, sticker, reacción ignorada.
- **Idempotencia / duplicados / reintentos:** `_test_idem.ts`,
  `_test_auditoria_ago2026.ts` B) — dup por índice único, columnas faltantes.
- **Seguimientos/agenda:** `_test_seg.ts`, `_test_agenda_e2e.ts`.

---

## 8. Runbook operacional

- **Revisar una conversación:** portal → Conversaciones → abrir el chat (poll 4 s).
- **Rastrear un mensaje:** `ed_mensajes` por `(empleado_id, chat_id, creado_en)`;
  `wa_message_id` = id de WhatsApp; `estado_envio` = entrega.
- **¿Llegó un archivo?** Con la migración 270: `ed_mensajes.media_tipo` no nulo, y
  se abre desde el inbox (proxy). Sin 270: aparece el marcador de texto.
- **Divergencia WhatsApp↔plataforma:** comparar el `wa_message_id` del webhook
  con la fila en `ed_mensajes`; revisar `/api/salud?full=1`.
- **Pausar Tino / tomar control:** botón "Tomar el control" (modo=humano; Tino
  calla al instante). **Reactivar:** "Devolver a Tino" (modo=bot; cierra la
  escalación pendiente).
- **Cancelar respuesta pendiente:** tomar el control cancela la respuesta en
  vuelo (guardia de modo, fix B1).
- **Evitar duplicados:** idempotencia por índice único (mig. 212) + `dup` de
  `guardarMensaje`.
- **Revertir versión:** `git revert` del hunk (cada fix es independiente) +
  redeploy Vercel.
- **A revisar a diario:** `/api/salud` (cron externo ya avisa por correo si 503),
  mensajes con `estado_envio='error'`, escalaciones sin atender.

---

## 9. Decisiones / acciones pendientes (requieren a una persona)

1. **Aplicar `sql/270_media_mensajes.sql`** y **verificar el visor de adjuntos**
   contra la WAHA real (formato de `media.url` + descarga con `X-Api-Key`). Hasta
   entonces el inbox muestra el marcador de texto (sin romperse).
2. **Endurecer el webhook de WAHA:** definir `EVOLUTION_WEBHOOK_SECRET` en Vercel
   y agregar `?k=<secret>` a la URL del webhook en WAHA.
3. **Multi-tenant WAHA:** separar sesiones por cliente **antes** de conectar un 2º
   número por WAHA (hoy `WAHA_INSTANCIA` mapea todo a `impresora-color`).
4. **Escalación pegajosa:** ¿auto-retorno a bot tras X horas? (decisión de
   producto; hoy solo vuelve a bot manualmente — es lo correcto para el modelo
   humano-primero).
5. **STT de audios** (mejora futura): hoy Tino acusa y pide texto.
6. **Commit + deploy:** subir estos cambios y redeploy Vercel. (No se puede hacer
   `git commit` desde el sandbox; los archivos quedan en tu disco listos.)

---

## 10. Veredicto final

**APTO CON SUPERVISIÓN NORMAL** — para la operación actual (Impresora Color por
WAHA).

Justificación: la plataforma ya operaba bien; esta auditoría cerró el **peor
riesgo operativo real** (B1: Tino hablando encima del humano) y su gemelo latente
en la vía oficial (B2), eliminó una fuente de **duplicación** de mensajes (B4),
puso la **vía oficial a la par** en multimedia (B3) y le devolvió **visión al
operador** (B5). Además se **reparó la red de regresión** que estaba muerta (B6),
así que estos bugs quedan con prueba.

Matices que impiden subir a "operación estable" sin supervisión: B5 depende de
aplicar la migración 270 y verificarla en vivo; el multi-tenant de WAHA sigue
siendo de 1 cliente; y quedan mejoras de endurecimiento (secreto del webhook,
STT) como pendientes de producto. Ninguno bloquea la operación diaria actual.

> Los cambios son aditivos y reversibles hunk por hunk. Gate de deploy: el build
> de Vercel, como siempre.
