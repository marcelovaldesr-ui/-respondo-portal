# Watchdog Tino (WAHA)

Vigila la sesión de WAHA 24/7 y avisa por Telegram si Tino deja de poder atender.
Reemplaza al watchdog viejo de Evolution (ya eliminado). Sin dependencias (Node 18+).

## Qué hace cada 5 min
1. Lee el estado de la sesión WAHA:
   - **WORKING** → sano.
   - **STOPPED** → intenta arrancarla sola.
   - **FAILED** → intenta reiniciarla sola.
   - **SCAN_QR_CODE** → avisa por Telegram (requiere que re-escanees el QR; esto
     pasa si WhatsApp deslogueó/baneó el número — no se puede automatizar).
2. (Opcional) Canary: envía un mensaje a sí mismo y revisa que no quede en error.
3. Escalera: 1er fallo tolera, 2º auto-recupera, 3º alerta. Máx 1 alerta/hora.

## Paso 1 — Crear el bot de Telegram (5 min, una vez)
1. En Telegram, hablar con **@BotFather** → `/newbot` → nombre "Respondo Watchdog".
2. Copiar el **token** (formato `123456:ABC...`).
3. Escribirle cualquier cosa al bot recién creado.
4. Abrir `https://api.telegram.org/bot<TOKEN>/getUpdates` → copiar el `chat.id`.

## Paso 2 — Deploy en Railway (mismo proyecto que WAHA)
1. Subir esta carpeta a un repo de GitHub (p.ej. `respondo-watchdog-waha`).
2. Railway → proyecto → **+ New → GitHub Repo** → elegir el repo.
3. En **Variables** del servicio, pegar:

| Variable | Valor |
|---|---|
| `WAHA_API_URL` | `https://waha-production-003e.up.railway.app` |
| `WAHA_API_KEY` | (la API key de WAHA) |
| `WAHA_SESSION` | `default` |
| `SELF_NUMBER` | el número del chip, solo dígitos |
| `TELEGRAM_BOT_TOKEN` | (del paso 1) |
| `TELEGRAM_CHAT_ID` | (del paso 1) |
| `CHECK_INTERVAL_MIN` | `5` |
| `CANARY` | `0` (pon `1` si quieres el chequeo de envío a sí mismo) |

4. Settings → **Restart policy: Always**.
5. Deploy. En logs debe salir `Watchdog WAHA iniciado` y llegar el mensaje de
   arranque a Telegram.

## Cuando alerte
- **"pide escanear QR"** → WhatsApp desconectó el número. Entra al panel de WAHA
  (`/dashboard`) y re-escanea. (Con el volumen, esto solo pasa por logout/ban real.)
- **"sin poder atender pese a recuperar"** → revisa el servicio WAHA en Railway.
- **"✅ Recuperado"** → se arregló solo, informativo.
