# Plan de construcción — Opción B (plataforma oficial con inbox propio)

Convertir el portal en lo que son Darwin / respond.io por dentro: un **Tech
Provider** sobre la WhatsApp Cloud API oficial, con **inbox propio** donde el
cliente toma el control. Se construye EN PARALELO a la Opción A (que corre en
Impresora Color en otro carril).

**Terminología (para no confundir):** "Opción A" = no oficial / Evolution / QR.
"Opción B" = oficial / Cloud API / inbox propio. Este documento es solo la B.

---

## La idea clave que hace posible el paralelo

**No se necesita ser Tech Provider ni tener un cliente real para construir y
probar casi toda la B.** Meta da un **número de prueba gratis** en la consola de
desarrollador. Con eso construimos y probamos las Fases 1 a 4 completas. El
registro como Tech Provider y el Embedded Signup (Fases 5-6) recién se necesitan
para conectar clientes reales.

Así avanzamos ~80% de la B mientras la A corre en Impresora Color.

**Prerrequisito técnico:** el webhook de Meta necesita una URL pública HTTPS.
O desplegamos el portal en Vercel (que igual estaba pendiente) o usamos un túnel
(ngrok) para desarrollo. Recomendado: desplegar en Vercel — mata dos pájaros.

---

## Reparto

- **YO (Claude):** todo el código — webhook, envío, cerebro sobre Cloud API,
  inbox, plantillas, Embedded Signup. Leo la configuración de variables de
  entorno, así construyo aunque todavía no tengas la cuenta de Meta.
- **TÚ (Marcelo):** las cuentas y trámites de Meta (dev account, número de
  prueba, tokens, y más adelante el registro de Tech Provider + verificación del
  negocio). Y el deploy a Vercel con tu cuenta.

---

## Fases

### Fase 0 — Cuentas Meta (TÚ, ~30 min)
1. Crear cuenta en developers.facebook.com.
2. Crear una App tipo "Business" y agregarle el producto **WhatsApp**.
3. Meta te da gratis: un **número de prueba**, un **phone_number_id**, un
   **token temporal** (24h) y un lugar para el **webhook + verify token**.
4. Agregar 1-2 números tuyos como "destinatarios de prueba" (para recibir).
Me pasas: phone_number_id y el token (por un canal seguro, no captura pública).

### Fase 1 — Backend enviar/recibir (YO)
- Migración `210_whatsapp_cloud.sql`: columnas que falten en ed_clientes
  (waba_id, token) y `canal` en ed_mensajes.
- Ruta `POST/GET /api/whatsapp/webhook`: verifica el token (GET) y recibe
  mensajes (POST).
- Helper de envío: `POST https://graph.facebook.com/.../messages`.
- Guardar entrantes y salientes en ed_mensajes.
- **Prueba:** te escribo al número de prueba y el mensaje aparece en la base; el
  portal responde.

### Fase 2 — Cerebro sobre Cloud API (YO)
- Cablear: mensaje entra → identificar cliente por phone_number_id → armar
  prompt (se reusa `promptEmpleado.ts`) → Gemini → responder por Cloud API.
- Respetar `ed_chat_estado`: si el chat está en modo humano/pausado, el bot
  calla. Es portar "Probar ahora" a WhatsApp real.
- **Prueba:** le escribes al número de prueba como cliente y Tino responde.

### Fase 3 — Inbox en el portal (YO — la pieza grande)
- Cuadro para escribirle al cliente en la pantalla de Conversaciones.
- Actualización en tiempo real (Supabase Realtime o polling).
- Manejo de la **ventana de 24h**: mostrar si está abierta; si está cerrada,
  solo permitir plantillas.
- Botón "Tomar el control" ya existe (ed_chat_estado); se conecta al envío.
- **Resultado:** el portal deja de ser solo-lectura y se vuelve bandeja real.

### Fase 4 — Plantillas (YO construyo, TÚ/clientes envían a aprobación)
- Envío de plantillas aprobadas para: responder fuera de la ventana de 24h, y
  el outbound de Beto/Vera.
- Meta tarda días en aprobar cada plantilla — se piden con tiempo.

### Fase 5 — Embedded Signup (YO construyo, TÚ registras Tech Provider)
- El botón "Conectar WhatsApp": popup de Meta, el cliente conecta su número
  solo, guardamos su token de negocio.
- Construir sobre **Embedded Signup v4** (la v2 se elimina el 15-oct-2026).
- Requiere: registro como **Tech Provider** + verificación del negocio en Meta
  (trámite tuyo).

### Fase 6 — Salir a producción / migrar (AMBOS)
- App review de Meta, onboarding del primer cliente real.
- Opcional: migrar Impresora Color de A a B (ojo: el número sale de la app del
  teléfono, Cecilia pasaría a contestar desde el inbox — decisión aparte).

---

## Orden recomendado y dependencias

```
Fase 0 (Marcelo) ─┐
                  ├─> Fase 1 ─> Fase 2 ─> Fase 3 ─> Fase 4
Deploy Vercel ────┘                                   │
                                                      v
                              Fase 5 (necesita Tech Provider) ─> Fase 6
```

Puedo empezar YA con la parte de la Fase 1 que no depende de tu cuenta (la
migración y el esqueleto del webhook + el helper de envío, leyendo la config de
variables de entorno). Cuando tengas la Fase 0 lista, conectamos y probamos.

## Primer paso concreto

- **TÚ:** crear la cuenta de desarrollador de Meta + número de prueba (Fase 0).
- **YO:** dejar listo el esqueleto del backend (migración + webhook + envío)
  para que apenas tengas los tokens, probemos.
