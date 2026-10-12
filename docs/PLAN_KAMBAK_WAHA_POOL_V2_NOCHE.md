# Plan v2 (trabajo largo / nocturno) — Pool WAHA de Kambak: endurecer el portal + integrar la web de Kambak

**Para:** Antigravity · **Dueño:** Marcelo · **Fecha:** 11-oct-2026 · **Base:** `feat/kambak-waha-pool` @ `c7ecfaa` (fases 1–5 de `PLAN_KAMBAK_WAHA_POOL_OCT2026.md`, ya hechas).
**Nadie está despierto mientras trabajas.** No hagas preguntas: decide con el criterio conservador de este plan, anótalo en `docs/PROGRESO_NOCHE_POOL.md` (sección "Decisiones") y sigue.

---
## 0. Objetivo
Dejar el circuito **completo y robusto de punta a punta**, listo para que el lunes solo falten: chips, servidor Railway, variables en Vercel, migraciones y escaneo de QR.
Circuito: *local de Kambak lanza campaña en `kambak.cl/panel` → Kambak valida consentimiento/bajas/tope → Respondo encola → pool WAHA envía de a poco en horario → acks y respuestas vuelven → Kambak muestra progreso real y respeta BAJAS.*

## 1. REGLAS DE ORO (no negociables)
1. **Meta no cambia.** Con `canal_marketing='meta'` (default) todo se comporta exactamente como hoy. Test de regresión obligatorio por fase que toque `kambakEnvios.ts`.
2. **Archivos protegidos (cero cambios):** `lib/waha.ts`, `lib/inboundWaha.ts`, `app/api/whatsapp/webhook-waha/route.ts`, `lib/whatsapp.ts`, `lib/inboundMeta.ts`, `lib/plantillas.ts`, `lib/plantillasKambak.ts`, migraciones 322–325 (**no editar 325; los cambios van en 326 nueva**).
3. **Nada se aplica a producción.** No ejecutes SQL contra ninguna base real, no llames a WAHA real, no uses claves reales, no corras scripts que modifiquen datos reales. Solo tests, mocks, modo simulado y emulador de Firestore.
4. **Nunca** subas claves/tokens/.env. **Nunca** menciones WAHA, "no oficial", números del pool ni `canal` en nada visible para los locales (HTML público, textos de UI, políticas, respuestas de API que lleguen a la web de Kambak). Los locales solo ven "Avisos".
5. Español simple, breve, profesional en textos para el usuario.
6. Solo `marketing` va por pool. `authentication`/`utility` siguen por Meta.
7. Si dudas entre "enviar" y "no enviar", **no envíes** (un aviso perdido es mejor que un aviso duplicado o a quien dijo BAJA).

## 2. Protocolo de trabajo nocturno
- **Dos repos, dos ramas:**
  - Portal: rama nueva `feat/kambak-waha-pool-v2` desde `feat/kambak-waha-pool` (HEAD `c7ecfaa`). Un commit por fase (`feat(kambak): v2 Fase P3 - …`), `git push -u origin` tras cada commit.
  - Kambak (`fideliza98-lab/sello-fidelizacion`, privado): seguir su `CLAUDE.md` al pie de la letra: leer README, GUIA-PARA-DESARROLLO, CONTEXTO, TAREAS, CAMBIOS; **reservar archivos en TAREAS.md con un commit pequeño a `main` (única excepción)**; trabajar en rama `claude/pool-waha-avisos`; commits pequeños en español; `git pull --rebase origin main` antes de empujar; **abrir Pull Request, NO mergear**; pruebas en `test/` con emulador de Firestore. Si el emulador no se puede instalar/ejecutar, escribe igual las pruebas, córrelas lo que se pueda con mocks y déjalo documentado como "pendiente de correr con emulador".
- **Antes de cada fase:** leer el código real involucrado (no asumir). **Después:** `npm test` (portal) + `npm run lint` (0 errores) + `git diff --stat` contra la lista protegida. Hay 5 fallos preexistentes en `whatsapp-booking-actions.test.mjs`: no son tuyos, no los toques, no aparezcan más.
- **Bitácora:** crea `docs/PROGRESO_NOCHE_POOL.md` y actualízala al terminar cada fase: hecho / archivos / tests (n) / decisiones / pendientes. Es lo primero que Marcelo leerá.
- **Si una fase se traba >45 min:** documenta el bloqueo, deja lo estable, avanza a la siguiente. Nunca dejes `npm test` rojo (por tu causa) en un commit.
- **Orden y prioridad:** M = imprescindible, S = recomendado, C = si sobra tiempo. Hazlas en este orden; las C solo después de terminar todas las M y S.
- **Informe final:** `docs/INFORME_NOCHE_POOL_V2.md` (qué cambió, archivos, cómo probar, qué falta, riesgos) + PR de Kambak con descripción equivalente.

## 3. Hallazgos de la revisión del código v1 (lo que hay que corregir)
| # | Hallazgo | Gravedad | Fase |
|---|---|---|---|
| H1 | Entrante: `chatId = from.replace(/\D/g,"")` falla con ids tipo `…@lid` → BAJA/respuestas pueden asociarse al teléfono equivocado o a ninguno | **Crítica** | P1 |
| H2 | `revisarSaludPool`: si WAHA no responde (caída de Railway) marca **todos** los números `caido` y no se recuperan solos | Alta | P2 |
| H3 | 3 fallos (aunque transitorios) → `bloqueado` terminal | Alta | P2 |
| H4 | Un error de envío deja la fila `fallido` para siempre: sin reintento ni cambio de número | Alta | P3 |
| H5 | "Escribiendo…" se inicia y se detiene al instante (no simula nada) | Media | P3 |
| H6 | Riesgo de pasar `maxDuration 60 s` del cron (pausas, secuencial) | Alta | P3 |
| H7 | Consulta de cola sin filtro `canal`, sin orden, sin justicia entre locales | Media | P4 |
| H8 | Sin expiración de cola, sin plan si no hay números activos | Alta | P4 |
| H9 | Filas atascadas en `enviando` sin reaper | Alta | P4 |
| H10 | Contadores `enviados_hoy` con lectura-modificación-escritura no atómica | Media | P5 |
| H11 | Kambak no recibe `message.status` cuando el pool omite/falla/expira → filas eternas en "en cola" | **Crítica** | P6 |
| H12 | Promoción `calentando→activo` sin verificar sesión `WORKING` ni días reales | Media | P7 |
| H13 | Rol `respuesta` declarado y nunca usado; clientes que responden a un número que no es del local | Media | P8 |
| H14 | Sin vista operativa del pool (¿cuántos envié hoy, quién está caído?) | Media | P9 |

---
# PISTA A — PORTAL (`respondo-portal`, rama `feat/kambak-waha-pool-v2`)

## Fase P0 (M) — Línea base
- Crear rama, correr `npm test` y `npm run lint`, anotar baseline en la bitácora (esperado: 1196 ok, 5 fallos preexistentes).
- Crear `sql/326_waha_pool_v2.sql` **vacío con cabecera** (se llena en fases siguientes; idempotente; rollback al pie; NO se aplica). Todo cambio de esquema de la noche va aquí.

## Fase P1 (M) — Identidad correcta del que escribe (LID) y BAJA segura  [H1]
Problema: con el motor GOWS, WhatsApp puede entregar el remitente como `NNN@lid` (id anónimo) y no como teléfono. Hoy se trata como si fuera teléfono.
Hacer:
1. **Investiga en la documentación oficial de WAHA** (waha.devlike.pro: sección LIDs / mensajes `message` payload / GOWS) cómo vienen `from`, `participant`, y los campos alternativos con el teléfono real (p.ej. `_data.Info.SenderAlt`, `remoteJidAlt`, u otros) y qué endpoint resuelve lid→teléfono (`/api/{session}/lids/...`). **No inventes nombres de campos:** implementa un extractor tolerante que pruebe varios caminos conocidos y que esté cubierto por fixtures de test con las variantes (con `@c.us`, `@s.whatsapp.net`, `@lid` con alt, `@lid` sin alt).
2. Nuevo `resolverTelefonoEntrante(payload, sesion)` en `lib/inboundWahaPool.ts` (o `lib/wahaPoolIdentidad.ts`): orden de resolución: (a) campo alterno del payload; (b) caché `ed_waha_lids` (migración 326: `sesion`, `lid`, `telefono`, `creado_en`, unique `(sesion,lid)`; RLS deny-all); (c) llamada a WAHA para resolver lid (con timeout 5 s, solo si pool configurado y no simulado); (d) correlación: último envío hacia ese contacto en esa sesión **solo si es inequívoco** (un único candidato en últimas 72 h). Si nada resuelve → `resultado: 'no_resuelto'`.
3. **Regla de seguridad:** si el teléfono no se resuelve, **no se registra BAJA sobre nada, no se responde automático**; se guarda el mensaje en la bandeja marcado `sin_telefono`, se loguea y se avisa a HQ (`notificarHQ`) con límite de 1 aviso/hora. Si el texto es una BAJA no resuelta, el aviso debe decir que requiere revisión manual.
4. La confirmación de BAJA se envía al **mismo id con que llegó el mensaje** (chat id original, incluido `@lid`) para que le llegue a quien escribió, aunque no haya teléfono.
5. Detección BAJA robusta: normalizar mayúsculas, acentos, espacios y signos ("baja", "BAJA.", "dar de baja", "no más", "stop", "cancelar suscripción"); lista pequeña y explícita; ante duda (frase larga con la palabra baja dentro de otra cosa) NO es baja pero sí entra a bandeja con etiqueta `posible_baja` y aviso a HQ.
6. **Alcance de la BAJA (decisión por defecto, documentarla):** la BAJA recibida por un número del pool se aplica **a nivel de pool** (ese teléfono no vuelve a recibir marketing WAHA de ningún local; `no_contactar`) **y** se emite `contact.optout` indicando el contexto del último envío (referencia/local, si existe) para que Kambak la aplique a ese local. Si Kambak puede suprimir en todos los locales sin romper su modelo, lo decidirá la Pista B (ver K4); el portal solo garantiza el nivel pool + el evento.
Tests: fixtures reales-simulados de los 4 formatos; BAJA con lid resuelto; lid no resuelto → nada registrado + alerta; correlación ambigua → no resuelve; texto falso positivo; idempotencia al repetir el webhook.
Criterio: ningún camino registra BAJA/respuesta sobre un teléfono no verificado.

## Fase P2 (M) — Salud del pool: distinguir "WAHA caído" de "número caído"  [H2, H3]
1. `estadoSesion` debe diferenciar: `{ok:true,status}` · `{ok:false,tipo:'inalcanzable'}` (timeout/red/5xx/401 del servidor) · `{ok:false,tipo:'sesion', status}` (sesión inexistente/STOPPED/FAILED/SCAN_QR_CODE).
2. En `revisarSaludPool`: si **todas** las consultas son `inalcanzable` → el problema es el servidor: **no cambiar estado de ningún número**; registrar `pool_inalcanzable_desde` (usa tabla de estado simple `ed_waha_pool_estado`, fila única, en 326) y alertar a HQ una vez cada 30 min; el envío se detiene solo (el envío falla/espera). Si solo algunas son inalcanzables → tratar cada una individualmente con tolerancia (2 revisiones seguidas antes de marcar).
3. Estados y recuperación: añadir columnas en 326: `pausado_hasta timestamptz`, `ultimo_ok_en timestamptz`, `ciclos_pausa int default 0`. Fallos transitorios → `pausado` con enfriamiento 15 min → 1 h → 6 h (backoff) y vuelve a `activo` solo si la sesión está `WORKING` y pasó `pausado_hasta`. `bloqueado` **solo** con señales claras (sesión desvinculada/`logged out`/baneo, o 3 ciclos de pausa seguidos sin recuperación). `caido` se recupera solo al volver `WORKING`. `bloqueado` requiere intervención manual (documentar el SQL de reactivación en `sql/consultas/kambak_pool_operacion.sql`).
4. Alertas con deduplicación (misma alerta máx. 1 vez/hora) y un mensaje de "recuperado".
5. Si quedan **0 números activos con cupo** en horario: alerta `pool_sin_capacidad` (1/2 h).
Tests: WAHA inalcanzable no cambia estados; recuperación; backoff; bloqueo por señal clara; no flapping; alertas deduplicadas.

## Fase P3 (M) — Envío robusto, con tiempo controlado  [H4, H5, H6]
1. **Concurrencia por número:** en cada pasada, procesar **un envío por número en paralelo** (`Promise.allSettled`) en vez de secuencial. Presupuesto total de la pasada: **≤ 45 s** (guard de tiempo; no iniciar trabajo nuevo pasado 35 s). Nada de `sleep` largos dentro del cron: las "pausas entre mensajes" se implementan con `proximo_envio_en` (60–180 s), no durmiendo.
2. **Escribiendo realista:** presencia de tipeo con duración `min(4500, 700 + largo_texto*30 + azar(0..800))` ms; luego enviar. Debe caber en el presupuesto (máx. 5 s por envío).
3. **Reintento y failover:** columnas en 326 sobre `ed_envios_api`: `intentos int default 0`, `proximo_intento_en timestamptz`, `ultimo_error text`. Error transitorio (timeout, 5xx, red) → fila vuelve a `en_cola`, `intentos+1`, `proximo_intento_en = ahora + (2^intentos)·2 min`, y se **excluye el número que falló** en el siguiente intento. Máx. 3 intentos; luego `fallido` definitivo con código. Errores definitivos (número sin WhatsApp, destinatario inválido) → no se reintenta. Un fallo de sesión (desvinculada/baneada) cuenta contra el número, no contra el envío (el envío vuelve a la cola).
4. Idempotencia fuerte al reclamar: la transición `en_cola→enviando` debe ser **condicional** (`update … where estado='en_cola' and id=… returning`), y si ya hay `wamid` no se reenvía jamás.
5. Mantener `esWahaMarketing` y kill switch; verificar `WAHA_POOL_APAGADO=1` en mitad de una pasada (leer el flag antes de cada envío).
Tests: reintento cambia de número; 3 intentos y cierra; sin duplicados con reclamo concurrente (simular dos pasadas simultáneas); presupuesto de tiempo respetado con 8 números simulados lentos; kill switch a mitad de pasada.

## Fase P4 (M) — Cola: filtro, orden, justicia, expiración, reaper, sin capacidad  [H7, H8, H9]
1. Consulta de cola waha: `canal='waha' and estado='en_cola' and programado_para<=ahora and (proximo_intento_en is null or <=ahora)`, orden `programado_para asc`, límite acotado; índice parcial en 326 (`create index if not exists … where canal='waha' and estado='en_cola'`).
2. **Justicia entre locales:** si hay varios locales (campo de referencia/local que venga en el envío — **verifica cuál existe** en `ed_envios_api`/payload de `/api/externo/mensajes`; si no hay, agrega columna `origen_ref text` en 326 y guárdala desde `metadata`/`referencia` si el contrato ya lo trae sin cambiar su forma), repartir cupos por turnos (round-robin) para que una campaña de 300 no bloquee a otro local por horas.
3. **Expiración:** `WAHA_POOL_COLA_MAX_HORAS` (default 48). Pasado ese tiempo: `fallido` con `error='expirado'` + evento a Kambak (P6). Un aviso de promoción de hace 3 días no debe salir.
4. **Reaper:** filas `enviando` > 3 min sin `wamid` → `fallido` con `error='estado_incierto'` (no reenviar: preferimos perder que duplicar) + evento; con `wamid` → `enviado`. Corre al inicio de cada pasada.
5. **Sin capacidad:** si no hay números activos y pasan > 6 h en horario, alerta. Fallback a Meta **solo** con `WAHA_POOL_FALLBACK_META=1` (default **0**, porque cuesta dinero; documentarlo). Con kill switch sigue saliendo por Meta como hoy.
6. Horario: respetar 9–21 Chile **por hora real de Chile** (verifica uso de zona horaria y cambio de horario de verano: Chile cambia de hora en septiembre/abril; el cálculo debe usar `America/Santiago` con Intl, no offsets fijos). Tests con fechas alrededor del cambio de hora.
Tests: orden, justicia con 2 locales, expiración, reaper, sin capacidad, zona horaria.

## Fase P5 (M) — Contadores y cupos atómicos  [H10]
- Función SQL en 326 `waha_reservar_cupo(p_numero uuid, p_hoy date, p_tope int, p_proximo timestamptz)` que haga el `update … set enviados_hoy = case when dia=p_hoy then enviados_hoy+1 else 1 end, dia=p_hoy, proximo_envio_en=…, ultimo_envio_en=now() where id=p_numero and (dia is distinct from p_hoy or enviados_hoy < p_tope) and (proximo_envio_en is null or proximo_envio_en<=now()) returning …`. `elegirNumero` + reserva usan esta función (vía `rpc`) y, **si el entorno de test no tiene RPC**, un camino equivalente con update condicional optimista. Si la reserva falla, probar el siguiente número.
- La "pausa aleatoria 60–180 s" se calcula en la reserva. Rollback del envío fallido devuelve el cupo (`waha_devolver_cupo`).
Tests: dos reservas simultáneas no superan el tope; devolución de cupo; cambio de día.

## Fase P6 (M) — Eventos hacia Kambak en TODOS los resultados  [H11]
1. **Lee primero** `lib/webhookSalida.ts` y el contrato (`KAMBAK.md`) y `lib/respondo.js` de Kambak (Pista B) para usar **exactamente** los estados que Kambak ya entiende (`queued`, `sent`, `delivered`, `read`, `failed`, …). No inventes nombres: si necesitas uno nuevo (`expired`, `cancelled`), documéntalo y coordina con K2.
2. Emitir `message.status` en: encolado (ya respondido como `queued` en la API), **enviado por pool** (`sent`), `delivered`, `read`, **omitido** (baja, tope mensual, número sin WhatsApp → `failed` con `errorCode` claro: `opt_out`, `monthly_cap`, `not_on_whatsapp`), **fallido definitivo**, **expirado**, **cancelado** (P10), **estado_incierto**.
3. Los eventos usan la misma firma/reintentos de `webhookSalida` y son idempotentes. **No incluir** en el payload nada del número/sesión/canal (los locales no deben saberlo). Mantener campo opcional `channel` fuera del evento.
4. Archivo de contrato versionado: `docs/contrato-eventos-kambak.json` con un ejemplo de cada evento (lo usará Kambak como fixture).
Tests: cada resultado emite exactamente un evento terminal; payload sin datos del pool; idempotencia.

## Fase P7 (S) — Calentamiento y promoción con verificación  [H12]
- `promoverCalentando`: exigir `calentamiento_desde` ≥ 5 días **y** sesión `WORKING` **y** `fallos_seguidos=0` **y** que durante el calentamiento haya habido actividad (≥ N envíos de prueba o, si no hay, advertencia en el aviso de promoción). Promoción deja alerta informativa a HQ (no automática si el número nunca tuvo `ultimo_ok_en`).
- Rampa por días reales desde `calentamiento_desde` (no por contador de promoción); documentarla. Tope diario máximo por número configurable por env `WAHA_POOL_TOPE_MAX` (default 150).
- Script `sql/consultas/kambak_pool_operacion.sql`: alta, pausa manual, retiro, reactivar bloqueado, ajustar tope, ver estado.
Tests de rampa por fecha y promoción condicionada.

## Fase P8 (S) — Respuestas de clientes al número del pool  [H13]
Los clientes contestarán "¿hay mesa?" a un número que no es del local. Diseño conservador:
- Guardar en bandeja y emitir `message.inbound` (ya existe).
- **Auto-respuesta opcional** detrás de `WAHA_POOL_AUTORESPUESTA=1` (default **0**): una sola vez por contacto cada 24 h: "Este número solo envía avisos de {local}. Para consultas, escríbele directamente al local." (el nombre del local sale del último envío; si no se conoce, texto sin nombre). Nunca responder a BAJA con nada distinto de la confirmación. Nunca a grupos/estados.
- Eliminar o documentar como reservado el rol `respuesta` (no dejar código muerto engañoso).
Tests: autorespuesta limitada 1/24 h, desactivada por defecto, no en grupos.

## Fase P9 (S) — Visibilidad operativa  [H14]
- `sql/consultas/kambak_pool_estado.sql`: vista de estado por número (estado, enviados hoy/tope, último envío, último error, fallos, días de calentamiento), cola (en_cola/enviando/fallidos 24 h por motivo), tasa de entrega/lectura, bajas últimas 24 h/7 d.
- **Resumen diario** a las 21:30 Chile por `notificarHQ`: enviados, entregados, fallidos por motivo, bajas, en cola, números no activos. Una vez al día (marca de último resumen en `ed_waha_pool_estado`).
- `/api/salud`: añadir métricas (activos, en cola, más antigua en cola) solo si el pool está configurado.
- Dos señales de calidad: si la **tasa de fallo** de un número en 24 h > 20 % con ≥ 20 envíos → `pausado` preventivo y alerta; si la **tasa de BAJA** de una campaña > 3 % → alerta HQ "revisar contenido/segmentación".

## Fase P10 (S) — Cancelar envíos pendientes (por campaña)
Un local se equivoca y lanza la campaña errónea; hay que poder detenerla.
- Endpoint **nuevo y aditivo** `POST /api/externo/mensajes/cancelar` (misma firma HMAC, ts/nonce) con `{ "prefijoIdempotencia": "…" }` o `{ "idempotencyKeys": […] }`; cancela solo filas `en_cola` del tenant que lo firma (nunca `enviando`/enviadas), responde conteo, emite evento `message.status` `cancelled` por fila (o el estado acordado en P6). **Verifica** el formato de `idempotencyKey` que genera Kambak (K0) para que el prefijo corresponda a una campaña.
- No modifica `/api/externo/mensajes` existente.
Tests: cancela solo en_cola, solo del tenant, firma inválida rechazada, idempotente.

## Fase P11 (S) — Piloto por local (opt-in) sin tocar el contrato existente
Para probar con un solo local antes de abrir a todos:
- Migración 326: ampliar el check de `canal_marketing` a `('meta','waha','waha_opt_in')`.
- Con `waha_opt_in`, el portal usa pool **solo si** la petición trae el campo opcional `canalMarketing:'waha'` en el cuerpo (campo extra opcional; peticiones antiguas sin el campo siguen por Meta). Con `waha` usa pool siempre salvo que la petición pida `meta`. Documentar la matriz en `KAMBAK.md`.
- Validar el cuerpo de forma tolerante (campo desconocido nunca rompe, valor inválido se ignora → Meta).
Tests de la matriz completa (3 valores de tenant × 3 de petición).

## Fase P12 (C) — Validación con WAHA real (lunes) y simulador de carga
- `docs/WAHA_POOL_VALIDACION_REAL.md`: lista de comprobaciones con comandos listos (curl/PowerShell) para el lunes: estado de sesión, check-exists, envío a número propio, entrega del webhook (con `?k=`), nombres reales de ack, comportamiento con `@lid`, qué responde WAHA ante sesión desvinculada. Incluye "qué mirar y cómo ajustar" para cada duda abierta de v1.
- `WAHA_POOL_DEBUG_PAYLOADS=1`: loguea la **forma** (claves, no contenido ni teléfonos) de los primeros 50 eventos recibidos, para ajustar extractores sin exponer datos.
- Test de carga simulado: 4 números, 3 locales, 900 mensajes, horario 9–21, verificar: ningún número supera su tope, pausas respetadas, justicia entre locales, cero duplicados, kill switch intermedio devuelve a Meta, un número que cae a mitad de camino no pierde mensajes.

## Fase P13 (C) — Documentación
Actualizar `KAMBAK.md` (contrato final, estados, variables de entorno completas con defaults, interruptores, runbook de incidentes: número caído, WAHA caído, ola de bajas, ban), y `PLAN_…_OCT2026.md` con nota "superado por v2 en lo que difiera". Lista final de variables nuevas: `WAHA_POOL_URL`, `WAHA_POOL_API_KEY`, `WAHA_POOL_WEBHOOK_SECRET`, `WAHA_POOL_APAGADO`, `RESPONDO_POOL_SIMULADO`, `WAHA_POOL_COLA_MAX_HORAS`, `WAHA_POOL_FALLBACK_META`, `WAHA_POOL_AUTORESPUESTA`, `WAHA_POOL_TOPE_MAX`, `WAHA_POOL_DEBUG_PAYLOADS`.

## Cron dedicado (parte de P3/P13)
Crear ruta aditiva `app/api/cron/pool-kambak/route.ts` (misma autenticación de cron que las demás, `maxDuration 60`) que ejecuta SOLO: reaper → `drenarColaWaha` → (cada 5 pasadas) `revisarSaludPool`. Motivo: hoy la cola corre dentro de `seguimientos` cada 5 min y con 1 envío por número por pasada eso limita a ~144/día por número; un cron propio cada **1 minuto** permite el ritmo de la pausa 60–180 s. Los pasos ya agregados en `seguimientos` se mantienen como respaldo (el reclamo atómico evita duplicados). Tarea humana: crear job en cron-job.org cada 1 min (documentar en `KAMBAK.md`).

---
# PISTA B — KAMBAK (`fideliza98-lab/sello-fidelizacion`, rama `claude/pool-waha-avisos`)

Seguir `CLAUDE.md` del repo (ya resumido en §2). Respetar zonas de archivos de CONTEXTO.md §7. Cambios mínimos y sin romper lo que funciona (producción kambak.cl, base Firestore única compartida: **solo emulador**).

## K0 (M) — Lectura y mapa
Leer: `lib/messaging.js`, `lib/respondo.js`, `lib/routes-respondo.js`, `lib/routes-crm.js` (`runCampaign`, `CAP_MONTH`, `CRM_HOURS`, audiencias, lotes de 10, "continuar envío"), `lib/bajas.js`, `lib/routes-whatsapp.js` (BAJA_RE/applyBaja), `public/panel.html`, `public/js/gestion.js` (sección Avisos), `vercel.json`, `test/`. Entregar en la bitácora un **mapa breve**: cómo se arma `idempotencyKey`; qué campos se mandan al portal; cómo se guarda `queued`→`en_cola`; cómo llegan eventos y cómo se actualiza `outbox`; dónde se cuentan cupos mensuales; cómo se muestran resultados al local. Reservar archivos en TAREAS.md (commit a `main`) **antes** de tocarlos.

## K1 (M) — Semántica de "en cola" en el flujo de campaña
Con Meta, `runCampaign` espera la respuesta y cuenta "enviados". Con pool, el portal responde `queued` y el envío real ocurre horas después.
- Verifica que `runCampaign` trate `queued` como **aceptado** (no error, no reintento, no doble envío al "continuar envío"), que `sent` subcollection registre el estado y que el cupo mensual (CAP_MONTH 4) **cuente los en cola** (para no exceder el tope) y **libere** los fallidos definitivos/cancelados/expirados (decide y documenta).
- Que "continuar envío" nunca duplique un destinatario ya `en_cola`/`enviado`.
- Tests con emulador: campaña de N destinatarios con proveedor simulado que responde `queued`; relanzar no duplica; cupo mensual coherente.

## K2 (M) — Eventos de estado completos
- Asegurar que el manejador de eventos soporte todos los estados de P6 (`sent`, `delivered`, `read`, `failed` con código, y los nuevos `expired`/`cancelled` si se acordaron) sin retroceder estados (RANK) y que un `failed` posterior a `queued` marque el destinatario como no entregado y **libere cupo** según K1.
- Idempotencia: el mismo evento dos veces no cambia nada.
- Usar como fixtures los ejemplos de `docs/contrato-eventos-kambak.json` del portal (copiarlos a `test/fixtures/`).

## K3 (M) — Progreso real de la campaña en el panel
En `panel#avisos`, para campañas con envíos pendientes:
- API de lectura (aditiva) que agregue por campaña: `en cola`, `enviados`, `entregados`, `leídos`, `no entregados`, `bajas`, y estimado de término ("Se enviará de a poco entre 9:00 y 21:00. Término estimado: …").
- UI mínima y sobria: barra de progreso + contadores; refresco cada 30 s mientras haya pendientes; textos en español simple; **sin mencionar canal, números ni WhatsApp no oficial**.
- Si se lanza fuera de horario (9–21 Chile): mensaje claro "Tus avisos comenzarán a salir mañana a las 9:00".
- Respetar CSP estricta de `vercel.json` (sin inline script nuevo si no estaba permitido).
- Tests de la API de agregación; revisión manual guiada del HTML (describir en la bitácora cómo verlo con el emulador).

## K4 (M) — BAJAS coherentes entre locales
- Revisar cómo `contact.optout` del portal se aplica hoy (¿por local o global?). **Decisión por defecto:** aplicar la baja al **local del último envío** y, además, a **todos los locales** del mismo cliente final si el modelo de supresiones de Kambak lo permite sin cambios grandes (el mensaje dice "no recibir más avisos"); si no es simple, solo al local de origen y dejar el nivel global documentado como pendiente (el portal ya bloquea a nivel pool, así que no se enviará más por WAHA).
- Consentimiento: toda audiencia debe excluir bajas **antes** de encolar; test de que una baja recibida mientras había envíos en cola evita los que aún no salieron (el portal re-chequea al despachar; Kambak debe reflejar el estado `failed/opt_out`).
- Mostrar "Bajas" en el resumen de campaña.

## K5 (S) — Cancelar envíos pendientes desde el panel
Botón "Cancelar envíos pendientes" en el detalle de campaña (con confirmación) → llama a `/api/externo/mensajes/cancelar` del portal (P10) con el prefijo de idempotencia de la campaña; actualiza `outbox`/`sent` de los cancelados y libera cupo. Solo visible para el dueño del local. Tests.

## K6 (S) — Piloto por local
Si P11 está hecha: configuración **interna** (no visible para el local; por ejemplo campo en el documento del local solo editable por admin o variable `LOCALES_AVISOS_POOL=slug1,slug2` en Vercel) que añade `canalMarketing:'waha'` al cuerpo solo para esos locales. Sin cambios de UI. Documentar en CAMBIOS.md la variable (sin valores). Tests: local en lista → manda el campo; fuera de lista → no.

## K7 (S) — Costo y textos
Revisar si el panel/UI muestra costo o texto asociado a plantillas de Meta (aprobación, categoría, 80 CLP, "plantilla pendiente") que ya no aplique cuando el aviso sale por pool; neutralizar sin mencionar el canal. Mantener la línea "Responde BAJA para no recibir más avisos." en todo texto de marketing (la agrega el portal; Kambak no debe duplicarla).

## K8 (M) — Documentación del repo de Kambak
- `TAREAS.md`: reserva al inicio, marcar completado al cierre.
- `CAMBIOS.md`: cambios fuera del código (variables de Vercel nuevas **sin valores**: p.ej. `LOCALES_AVISOS_POOL`; nada de DNS/consolas). 
- `CONTEXTO.md`: sección corta y **solo técnica interna**: "Entrega diferida de avisos (estado en_cola)". No tocar archivos públicos ni políticas.
- PR con resumen: qué cambió, archivos, cómo probar, qué falta, riesgos.

## K9 (C) — Contrato y pruebas extremo a extremo "por fixtures"
Pruebas en Kambak que alimentan el manejador con la secuencia completa de eventos del contrato (`queued → sent → delivered → read`, `queued → failed(opt_out)`, `queued → expired`, `queued → cancelled`, BAJA entrante) y verifican `outbox`, `sent`, cupos, supresiones y el agregado que muestra el panel.

---
## 4. Qué debe decirme Antigravity al final (sección obligatoria del informe)
1. Tabla fase → hecho / parcial / no hecho, con commit.
2. Resultado de `npm test` y `npm run lint` (portal) y de la suite de Kambak (con/sin emulador).
3. `git diff --stat` contra la rama base confirmando archivos protegidos intactos.
4. **Lista de decisiones tomadas por su cuenta** (para que Marcelo las revise).
5. Lista de supuestos que dependen de WAHA real (para validar el lunes).
6. Pasos humanos finales y orden exacto del lunes (chips, Railway, variables, migraciones 325 y 326, alta de números, QR, cron-job.org cada 1 min, `canal_marketing`, piloto con un local).
7. Riesgos residuales y cualquier cosa que le haya parecido peligrosa.

## 5. Criterios de aceptación globales
- Con `canal_marketing='meta'` y pool sin configurar: **cero diferencias** observables (tests de regresión).
- Con pool simulado: campaña de ≥300 destinatarios de 2–3 locales fluye de punta a punta, sin duplicados, respetando horario, tope diario/mensual, pausas, BAJAS y kill switch.
- Ningún camino registra BAJA o respuesta sobre un teléfono no verificado.
- Todo resultado de envío termina en un evento hacia Kambak; no quedan filas eternas en "en cola".
- Los locales no pueden ver, por UI ni API, nada del pool.
- Tests nuevos por fase; suites existentes sin regresiones nuevas; lint en 0.
