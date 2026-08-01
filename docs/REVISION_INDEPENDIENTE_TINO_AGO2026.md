# Revisión independiente de la auditoría de Tino — 1-ago-2026 (2ª pasada)

> Validación independiente del trabajo hecho en `AUDITORIA_TINO_INTEGRAL_AGO2026.md`.
> No se aceptó ninguna conclusión del informe anterior sin evidencia propia: se
> reconstruyó el inventario desde el disco, se reprodujo la carrera original con
> un WhatsApp falso, se ejecutaron las suites contra la **base real** y el
> **WAHA real** (cosas que la 1ª pasada no pudo hacer), y se hicieron controles
> negativos (quitar el fix y ver el test fallar).

## 1. Verificación del trabajo anterior

Integridad primero: **los 14 archivos escritos al disco son byte-idénticos** a
los validados (md5 disco = md5 sandbox, 14/14) — el riesgo histórico de
truncamiento del mount no ocurrió. `git status`/diffstat coinciden con lo
declarado (+338/−85 en 10 modificados + 4 nuevos).

| Fix | Afirmación del informe anterior | Verificación independiente | Estado |
|-----|-------------------------------|---------------------------|--------|
| B1 (Tino sobre el humano en la ventana de tipeo, WAHA) | Corregido con chequeo de modo en `sigueVigente` | **Reproducida la carrera real** con servidor WAHA falso: la toma de control se dispara EXACTAMENTE durante el `startTyping` → `sendText` **no sale** ("guardado sin enviar (obsoleto)"). **Control negativo**: quitando la línea del fix, el test **falla** (sendText sale encima del humano) → el fix es necesario y suficiente, y el test lo detecta. Script permanente: `scripts/_test_carrera_humano.ts`. | ✅ Verificada completamente |
| B2 (paridad Meta: `sigueVigente`) | Corregido | Revisión de código línea a línea: la guardia es idéntica a la de WAHA (mensaje más nuevo + modo) y se pasa a `responderSiBot`. No ejecutable en vivo (vía oficial sin tráfico real aún); typecheck limpio. | ✅ Verificada (por código; latente hasta que la vía oficial opere) |
| B3 (Meta descartaba multimedia) | Corregido | Suite unitaria independiente ejecutada: imagen sin/con pie, PDF con nombre, audio, ubicación, sticker, reacción ignorada — todo pasa. **PERO se encontró una regresión introducida** (ver problema N1). | ⚠ Verificada CON regresión encontrada y corregida |
| B4 (mensajes del humano duplicados por su eco) | Corregido guardando el waId del envío | **Ejecutado contra la base real** (H7): el eco del mensaje humano con id conocido produce `filas=1` (no se duplica) y no cambia el modo. Nota: la acción reportada es `duplicado`, no `eco` (misma protección, etiqueta distinta — la expectativa del test anterior era imprecisa; corregida). | ✅ Verificada completamente |
| B5 (operador ciego al multimedia) | "Corregido; requiere aplicar migración 270 y verificar URL de WAHA" | **La migración 270 YA está aplicada en la base** (verificado por consulta real: columnas `media_*` existen). El embed FK del proxy funciona (probado contra PostgREST). **PERO el visor como quedó NO habría funcionado**: tu WAHA es tier **CORE** y el webhook llega con `hasMedia=true, media=null` — nunca hay URL que guardar (ver problema N2, corregido en esta pasada). | ⚠ Insuficiente como estaba → **completada y verificada en vivo** |
| B6 (suite de convivencia rota) | Reparada (portada a WAHA) | **Ejecutadas de verdad** contra la base real: `_test_idem` 4/4 y `_test_hibrido` H1–H7 todos con el resultado esperado, con el cerebro real (Gemini) y envío mockeado. En H6, Tino respetó el precio del humano ($30.000) sin recotizar. | ✅ Verificada completamente (ejecución real, no solo lectura) |

**Pendientes del informe anterior contrastados con la realidad:**

- "Aplicar migración 270" → **ya estaba aplicada** (pendiente obsoleto).
- "Endurecer webhook WAHA con secreto" → **ya estaba en producción**: POST sin
  `?k=` → 403; con el secreto → 200 (probado contra el deploy real). Pendiente obsoleto.
- "Multi-tenant WAHA" → sigue vigente (1 sesión, mapeo fijo `impresora-color`). Real.
- "STT de audios" → sigue vigente (decisión de producto). Real.

## 2. Problemas adicionales encontrados (y corregidos)

### N1 — Regresión del fix B3: respuestas interactivas degradadas · **MEDIO (latente)**
- **Qué pasaba:** el fix B3 procesa todo lo no-texto con marcador de adjunto. Un
  mensaje Meta tipo `button`/`interactive` (el cliente TOCÓ "Confirmar" o eligió
  de una lista) quedaba como "[el cliente envió un archivo]" — Tino trataría una
  confirmación como un documento ilegible. Antes del fix B3 se descartaba
  (igualmente malo); el fix lo convirtió en registro engañoso.
- **Corrección:** `parsearWebhook` ahora extrae el texto tocado
  (`button.text` / `interactive.button_reply.title` / `list_reply.title`) y lo
  registra como texto del cliente; interactivo sin título se ignora.
- **Prueba:** 4 casos nuevos en `scripts/_test_auditoria_ago2026.ts` (22/22 ✅).

### N2 — El visor de adjuntos (B5) era inerte en WAHA Core · **MEDIO-ALTO**
- **Qué pasaba (verificado en vivo):** tu WAHA es tier **CORE** (GOWS 2026.7.2).
  En Core, el webhook trae `hasMedia: true` pero `media: null` → `media_url`
  quedaría NULL para siempre y el proxy no tendría nada que servir. Además,
  cuando Core SÍ entrega una URL (pidiéndola por API con `downloadMedia=true`),
  la devuelve con host `http://localhost:8080` (no conoce su URL pública) — y el
  anti-SSRF del proxy la habría rechazado.
- **Corrección (verificada contra el WAHA real):**
  1. `lib/waha.ts` → `mediaDeMensajeWaha(chatId, waId)`: resuelve el media bajo
     demanda por id de mensaje (`GET /chats/{chat}/messages/{id}?downloadMedia=true`
     — probado que funciona en Core), y `reanclarUrlWaha()`: re-ancla SIEMPRE el
     path sobre `WAHA_API_URL` → el localhost se vuelve URL pública y el SSRF
     queda eliminado por construcción (cualquier host guardado termina re-anclado
     al WAHA propio; probado con `169.254.169.254`).
  2. El proxy `/api/whatsapp/media` usa esa resolución cuando `media_url` es NULL
     (el caso normal en Core) y cachea la URL resuelta.
- **Evidencia en vivo:** imagen real de la imprenta resuelta → URL pública →
  descarga HTTP 200 (`image/jpeg`, 85.747 bytes) con api key, **401 sin ella**.
- **Prueba permanente:** `scripts/_test_media_waha.ts` (6/6 ✅, re-ejecutable).
- **Límite conocido (best-effort):** contactos que llegan por LID puro pueden no
  resolver (se reconstruye el id como `false_<número>@c.us_<id>`); en ese caso el
  visor muestra solo el marcador — nunca rompe.

### N3 — Hallazgos menores (anotados, sin cambio de código)
- **Render inicial del inbox sin media:** `mensajesIniciales` (server render) no
  incluye `media`; el adjunto aparece al primer poll (≤4 s). Cosmético.
- **Debounce Meta fijo en 6 s** vs adaptativo 6–15 s en WAHA: brecha de paridad
  menor; relevante recién cuando la vía oficial tenga tráfico fragmentado.
- **`wa_message_id` histórico sin normalizar:** filas importadas el 31-jul
  guardan el id serializado completo (`false_..._<ID>`), el código nuevo guarda
  el sufijo GOWS. No rompe idempotencia (los históricos no se re-entregan por la
  guardia de frescura), pero conviene saberlo al depurar.
- **H7 etiqueta:** el eco humano se ataja como `duplicado` (idempotencia general)
  antes de llegar a la rama `eco`. Mismo efecto; expectativa del test corregida.

## 3. Regresiones introducidas por la auditoría anterior

Una encontrada: **N1** (interactivos degradados por B3). Corregida y con prueba.
No se encontraron otras: typecheck limpio, las suites reales pasan, y los flujos
de texto/convivencia/idempotencia se comportan igual o mejor que antes.

## 4. Pruebas ejecutadas (esta pasada)

| Comando | Alcance | Resultado |
|---------|---------|-----------|
| `npx tsc --noEmit` | Proyecto completo | ✅ 0 errores |
| `npx tsx scripts/_test_auditoria_ago2026.ts` | Parsers Meta (incl. interactivos) + guardarMensaje por capas | ✅ 22/22 |
| `npx tsx scripts/_test_idem.ts` | **Base real**: idempotencia webhook duplicado (cliente y humano) | ✅ 4/4 esperados |
| `npx tsx scripts/_test_hibrido.ts` | **Base real + Gemini real**: convivencia H1–H7 | ✅ 7/7 esperados |
| `npx tsx scripts/_test_carrera_humano.ts` | **Carrera B1 reproducida** (WAHA falso, toma de control durante el tipeo) | ✅ y ❌ al quitar el fix (control negativo) |
| `npx tsx scripts/_test_media_waha.ts` | **WAHA real**: resolución de media + re-anclaje + auth | ✅ 6/6 |
| Sondas HTTP producción | Webhook sin/con secreto (403/200), `/api/salud` (ok) | ✅ |
| Consultas PostgREST reales | Migración 270 aplicada, embed FK del proxy, columnas 212/213 | ✅ |

Chats de prueba usados: `569HYBTEST01`, `569IDEMTEST9`, `569RACETEST1` — todos
limpiados; verificado por consulta directa que no quedaron restos. Cero mensajes
a WhatsApp real (mock o servidor falso en todos los casos).

## 5. Cobertura funcional de esta revisión

Conversaciones (real, H1–H7) · Multimedia (unit Meta + WAHA real bajo demanda) ·
Plataforma (código del inbox/poll; sin navegador en esta pasada) · Intervención
humana (real + carrera reproducida) · Estados (modoDe/setModo en vivo) ·
Idempotencia (real) · Base de datos (migraciones verificadas por consulta) ·
Integraciones (WAHA real: sesión WORKING, webhook con secreto y reintentos 3×;
Gemini real) · Concurrencia (carrera B1 determinista) · Recuperación (por código:
fallback del modelo ya verificado el 30-jul) · Defensivo (secreto en prod,
aislamiento del proxy, anti-SSRF probado con host malicioso).

**No cubierto en esta pasada** (sin cambio de veredicto): UI en navegador real
(dos pestañas, reconexión), carga/percentiles bajo ráfaga, y la vía oficial de
Meta con tráfico real (sigue en App Review).

## 6. Cambios adicionales de esta pasada

| Archivo | Cambio | Riesgo | Reversión |
|---------|--------|--------|-----------|
| `lib/whatsapp.ts` | N1: interactivos/botones → texto tocado | Bajo (vía oficial aún sin tráfico) | revert del hunk |
| `lib/waha.ts` | N2: `mediaDeMensajeWaha` + `reanclarUrlWaha` (nuevas, no tocan flujo existente) | Bajo | revert del hunk |
| `app/api/whatsapp/media/route.ts` | N2: resolución bajo demanda + re-anclaje + cacheo | Bajo (solo lectura + update best-effort de media_url) | revert del archivo |
| `scripts/_test_auditoria_ago2026.ts` | +4 casos interactivos | Nulo | — |
| `scripts/_test_hibrido.ts` | Expectativa H7 precisada | Nulo | — |
| `scripts/_test_carrera_humano.ts` (nuevo) | Regresión permanente de la carrera B1 | Nulo | — |
| `scripts/_test_media_waha.ts` (nuevo) | Regresión permanente del visor de media | Nulo | — |

## 7. Pendientes reales (los únicos que quedan)

1. **Commit + deploy** (Marcelo): nada de esto corre en producción hasta el push
   a Vercel. La migración 270 ya está aplicada, así que tras el deploy el visor
   de adjuntos queda operativo de inmediato.
2. **Multi-tenant WAHA** antes de conectar un 2º número por WAHA (decisión de
   arquitectura; hoy 1 sesión fija).
3. **STT de audios** (decisión de producto).
4. **QA visual en navegador** (dos pestañas, reconexión, móvil) — recomendable
   como pasada aparte con la extensión de Chrome.
5. Los tests `scripts/_t*` están en `.gitignore`: `git add -f` si se quieren
   versionar (recomendado para `_test_carrera_humano` y `_test_media_waha`).

## 8. Veredicto final (independiente)

**APTO CON SUPERVISIÓN NORMAL** — se CONFIRMA el veredicto anterior, ahora con
evidencia de ejecución real que la 1ª pasada no tenía: la carrera humano↔bot
está controlada por código (probado con reproducción determinista y control
negativo), la idempotencia y la convivencia pasan contra la base y el cerebro
reales, y el visor de multimedia —que tal como estaba **no habría funcionado**
en tu tier de WAHA— quedó completado y verificado contra el WAHA real.

Lo que separa esto de "operación estable" no son bugs conocidos sino cobertura:
falta QA visual de navegador, carga sostenida medida, y que la vía oficial
opere con tráfico real. Nada de eso bloquea la operación diaria actual con
supervisión normal (revisar "Te esperan" + `/api/salud` ya monitoreado por cron).
