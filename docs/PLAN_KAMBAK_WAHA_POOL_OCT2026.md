# Plan de construcción — Grupo de números WAHA para las campañas de Kambak (11-oct-2026)

**Para:** Antigravity (constructor) · **Dueño:** Marcelo · **Estado:** PLAN, nada construido.

## 0. Objetivo en una frase
Que las **campañas de marketing de los locales de Kambak** salgan por un **grupo de números WhatsApp conectados por WAHA** (rotando, con tope diario y calentamiento) en vez de por plantillas de Meta (80 CLP c/u), **sin tocar nada de lo que hoy funciona con Meta**.

Por qué: con 300 clientes aceptados × 4 campañas, Meta cuesta ~96.000 CLP/mes por local; por WAHA ~2.000–3.000. Los números en riesgo son los nuestros, no los de los locales.

## 1. REGLA DE ORO: no afectar Meta
1. **Todo lo nuevo es aditivo** y queda **apagado por defecto**. Hoy `canal_marketing = 'meta'` para todos → comportamiento idéntico al actual.
2. **Cero cambios** en estos archivos (solo leer/reutilizar):
   - `lib/waha.ts`, `lib/inboundWaha.ts`, `app/api/whatsapp/webhook-waha/route.ts` (WAHA legado de UN negocio; sigue como está)
   - `lib/whatsapp.ts`, `lib/inboundMeta.ts`, `lib/plantillas.ts`, `lib/plantillasKambak.ts`
   - migraciones existentes (322–324 y anteriores)
3. **Cambios mínimos permitidos** (solo ramas nuevas protegidas por el interruptor):
   - `lib/kambakEnvios.ts` → un desvío en `procesarEnvio`/`despachar`/`drenarCola`
   - `app/api/cron/seguimientos/route.ts` → agregar pasos nuevos AL FINAL del orden (los de Kambak ya van primero; no moverlos)
   - `app/api/salud/route.ts` → un chequeo nuevo que se **omite** si el grupo no está configurado
4. **Variables de entorno NUEVAS con nombre propio.** NO reutilizar `WAHA_API_URL/WAHA_API_KEY/WAHA_SESSION/WAHA_INSTANCIA` (son del WAHA legado y `/api/salud` las lee; reutilizarlas rompería la salud otra vez).
5. **Solo `marketing` va por WAHA.** `authentication` (código) y `utility` siguen por Meta siempre.
6. Interruptor de emergencia que vuelve todo a Meta en ≤60 s sin desplegar (ver §3).

## 2. Arquitectura (resumen)
```
Kambak ──POST firmado──> /api/externo/mensajes (igual que hoy)
                              │ procesarEnvio: mismas barreras (baja, tope 4/mes, horario, idempotencia)
                              ▼
        ¿categoría = marketing  Y  ed_clientes.canal_marketing = 'waha'  Y  WAHA_POOL_APAGADO != 1?
              │ no → camino Meta actual (SIN CAMBIOS)
              │ sí → registra en ed_envios_api estado 'en_cola' (canal='waha'), responde status:"queued"
                              ▼
        cron (cada 1 min) → drenarColaWaha():
           por cada número activo con cupo y pausa cumplida → toma 1 envío →
           verifica que el número tenga WhatsApp → "escribiendo…" → sendText → marca enviado
                              ▼
        WAHA (Railway, servicio NUEVO) ──webhook──> /api/whatsapp/webhook-waha-pool
           message.ack → estado entregado/leído → evento message.status a Kambak
           message (entrante) → BAJA ⇒ no_contactar + contact.optout; otro texto ⇒ bandeja + message.inbound
           session.status → estado del número (caído/bloqueado) → alerta + saca del reparto
```
La decisión de canal se toma **al despachar**, no al encolar: si se apaga el interruptor, lo que ya estaba en cola sale por Meta.

## 3. Interruptores
| Interruptor | Dónde | Efecto |
|---|---|---|
| `ed_clientes.canal_marketing` (`'meta'` default \| `'waha'`) | por cuenta, migración 325 | Elige canal para marketing de esa cuenta |
| `WAHA_POOL_APAGADO=1` | Vercel | Kill switch global → todo marketing por Meta |
| `RESPONDO_POOL_SIMULADO=1` | Vercel preview | No llama a WAHA; ids `sim.…`; para probar el circuito |

## 4. Modelo de datos (migración `sql/325_waha_pool.sql`, idempotente, NO se aplica sola; RLS deny-all)
- `alter table ed_clientes add column if not exists canal_marketing text not null default 'meta' check (canal_marketing in ('meta','waha'));`
- `ed_waha_numeros`: `id uuid pk`, `cliente_id uuid → ed_clientes`, `sesion text unique` (nombre de sesión en WAHA), `telefono_hash text`, `etiqueta text`, `estado text check in ('calentando','activo','pausado','caido','bloqueado','retirado')`, `rol text check in ('envio','respuesta')`, `calentamiento_desde date`, `tope_diario int default 150`, `enviados_hoy int default 0`, `dia date`, `ultimo_envio_en timestamptz`, `proximo_envio_en timestamptz`, `ultimo_error text`, `fallos_seguidos int default 0`, `creado_en`.
- `alter table ed_envios_api add column if not exists canal text not null default 'meta' check (canal in ('meta','waha'));`
  `alter table ed_envios_api add column if not exists numero_id uuid references ed_waha_numeros(id);`
- Rollback documentado al pie (`drop table …`, `drop column …`). Verificación: `select estado, count(*) from ed_waha_numeros group by 1;`

## 5. Fases (cada una con su criterio de término; no avanzar sin cumplirlo)

### Fase 1 — Cimientos sin efecto
- Migración 325 + `sql/consultas/kambak_pool_alta.sql` (alta de números a mano).
- `lib/wahaPool.ts` (módulo NUEVO e independiente, con sesión como **parámetro**): `enviarTextoPool(sesion, destino, texto)`, `existeEnWhatsApp(sesion, tel)` (`/api/contacts/check-exists`), `estadoSesion(sesion)`, `iniciarTipeo/pararTipeo`. Env: `WAHA_POOL_URL`, `WAHA_POOL_API_KEY`.
- `lib/poolNumeros.ts` (lógica pura + DB): `topeDelDia(numero, hoy)` con rampa de calentamiento (ej. día1 20, día2 40, día3 60, día4 90, día5 120, luego `tope_diario`), `elegirNumero(clienteId, ahora)` (activos con cupo, sin `proximo_envio_en` futuro; el de menos envíos hoy, desempate por el más antiguo), `registrarEnvio(numero)` (suma, fija `proximo_envio_en = ahora + aleatorio 60–180 s`), `registrarFallo/Exito` (contador de fallos).
- **Término:** tests nuevos verdes; `npm test` sin cambios en los demás; ningún archivo de la lista §1.2 modificado (`git diff --stat`).

### Fase 2 — Envío (detrás del interruptor)
- `lib/kambakEnvios.ts`: si `categoria==='marketing'` y canal waha activo → **siempre** `en_cola` (`canal='waha'`, `programado_para=ahora`), respuesta `queued`. Resto igual.
- `drenarColaWaha()` (en `lib/kambakEnvios.ts` o archivo nuevo): reusa las MISMAS comprobaciones de `drenarCola` (baja, tope mensual, horario 9–21) y además: `elegirNumero` → `existeEnWhatsApp` (si no existe: `omitido`, motivo `sin_whatsapp`, no cuenta cupo) → tipeo → envío del texto de `textoDe(p, params)` → `registrarEnvio`. Máx **1 envío por número por pasada**; presupuesto de 25 s como hoy.
- Registro en bandeja igual que `despachar` (conversación del número de Kambak).
- Cron: agregar paso `cola_waha_kambak` (después de `cola_kambak`).
- **Término:** en preview con `RESPONDO_POOL_SIMULADO=1`, una campaña de 50 destinatarios sale repartida entre 2 números simulados, respeta tope diario, pausas, horario y baja; con `canal_marketing='meta'` el comportamiento es **idéntico** al de hoy (test de regresión).

### Fase 3 — Entrada: acks, bajas y respuestas
- Ruta nueva `app/api/whatsapp/webhook-waha-pool/route.ts` (copiar el patrón del webhook legado: secreto `?k=` con `WAHA_POOL_WEBHOOK_SECRET`, inbox idempotente con `procesarConInbox`, 5xx para reintentar).
- Enrutar por `session` → `ed_waha_numeros` → cliente. Reutilizar `esMensajeDeBaja/registrarBaja/CONFIRMACION_BAJA` (`lib/bajas.ts`) y el emisor de eventos hacia Kambak exactamente como lo hace `lib/inboundMeta.ts` en sus ramas de `esSoloMensajeria` (líneas ~118 y ~394). Cuenta de solo mensajería: **no** llamar a ningún modelo.
- `message.ack` → actualizar `ed_envios_api` y emitir `message.status` (`sent/delivered/read/failed`).
- **Término:** tests con payloads WAHA de ejemplo: "BAJA" marca `no_contactar` y emite `contact.optout`; ack actualiza estado; evento repetido no duplica.

### Fase 4 — Salud y rotación automática
- `session.status` y un paso de cron `salud_pool` (consulta `estadoSesion` de cada número cada pasada): `FAILED/STOPPED/SCAN_QR_CODE` → `caido`; ≥3 `fallos_seguidos` o error de "logged out/ban" → `bloqueado`/`pausado` y **sale del reparto**.
- Al caer/bloquearse un número: promover un `calentando` ya listo a `activo` si existe; alerta (push/correo que ya usa el portal) a Marcelo con el nombre del número.
- Chequeo opcional en `/api/salud`: **omitido si `WAHA_POOL_URL` no está** (para no repetir el "degradado permanente").
- **Término:** simulando un número caído, el reparto lo salta y llega la alerta.

### Fase 5 — Variación de texto (anti-patrón de masivo)
- `textoWaha(plantilla, params, semilla)`: 2–3 variantes del saludo/cierre **solo para WAHA** (`textoDe` queda intacto para Meta); la línea "Responde BAJA…" **siempre** presente. Semilla por número de teléfono para que sea estable.
- **Término:** test que garantiza que ninguna variante omite la línea de baja ni cambia las variables.

### Fase 6 — Operación (opcional, después del piloto)
- Pantalla mínima de solo lectura en el portal: números, estado, enviados hoy, fallos. Alta/baja de números sigue por SQL.
- Si la cola por cron se queda corta, mover el despacho a un worker pequeño en Railway.

## 6. Infraestructura que arma una PERSONA (en paralelo, no bloquea a Antigravity)
1. **Railway:** servicio WAHA NUEVO (imagen `devlikeapro/waha`, motor GOWS), con **volumen** montado en `/app/.sessions`. Variables: `WAHA_API_KEY` (generar con `openssl rand -hex 32`), `WHATSAPP_DEFAULT_ENGINE=GOWS`, `WHATSAPP_HOOK_URL=https://<portal>/api/whatsapp/webhook-waha-pool?k=<secreto>`, `WHATSAPP_HOOK_EVENTS=message,message.ack,session.status`. Secretos solo en Railway/Vercel, nunca en el repo ni en chats.
2. **Vercel (portal):** `WAHA_POOL_URL`, `WAHA_POOL_API_KEY`, `WAHA_POOL_WEBHOOK_SECRET`.
3. **Chips:** 2 para el piloto + 1 de reserva. Un número por sesión; escanear el QR en el panel de WAHA. **Calentar 5–7 días** con uso normal antes de ponerlos en `activo`.
4. **Aplicar la migración 325** en Supabase (SQL editor) y dar de alta los números (`kambak_pool_alta.sql`).

## 7. Piloto y despliegue
1. Preview + `RESPONDO_POOL_SIMULADO=1` → circuito completo sin enviar nada.
2. Producción con `canal_marketing='meta'` (nada cambia) → verificar que `/api/salud` y los tests de Kambak siguen verdes.
3. **Un solo local**, 2 números, campaña chica a gente que aceptó. Mirar: entregados, fallos, bajas, estado de sesiones.
4. Si limpio una semana → ampliar locales y números. Si algo raro → `WAHA_POOL_APAGADO=1` (vuelve a Meta).

## 8. Reglas para quien construya
- Rama nueva `feat/kambak-waha-pool`, **desde la rama que ya contiene `lib/kambakEnvios.ts`** (hoy el árbol tiene cambios sin commitear en otra rama: no mezclar, no pisar).
- No commitear a `main`, no aplicar migraciones, no tocar secretos ni `.env*`.
- Cada fase: tests nuevos en `tests/` (estilo `.mjs` de `kambak-envios.test.mjs`), `npm test` y lint verdes. Debe seguir pasando `kambak-*.test.mjs` y `waha-bloqueo.test.mjs` **sin editarlos**. (Nota: 5 tests de `whatsapp-booking-actions` ya fallaban antes; no son de este trabajo.)
- Al terminar cada fase: resumen de archivos tocados y confirmación de que la lista de §1.2 no cambió.

## 9. Riesgos conocidos
- **Bloqueo de números:** esperado; el diseño lo absorbe (rotación, repuesto, tope, calentamiento, verificación de que el número existe, bajas respetadas).
- **Cron cada 5 min limita el ritmo** (≈1 mensaje por número por pasada): bajar a cada 1 min o worker (Fase 6).
- **Tope mensual compartido:** el portal cuenta marketing por teléfono entre todos los locales (ver `KAMBAK.md`); se mantiene igual en ambos canales.
- **No hay verificación del repo de Kambak** (`sello-fidelizacion`): su contrato con el portal no cambia (`queued` ya está soportado), pero conviene confirmarlo.
