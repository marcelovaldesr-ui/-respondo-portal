# Nivel B — Conectar WhatsApp real (Opción A: Evolution API)

Poner a Tino a responder de verdad en el WhatsApp de Impresora Color, con
Cecilia conservando el control total (contesta desde su teléfono cuando quiere;
el bot se calla apenas ella escribe).

**Ruta elegida:** Opción A — vía no oficial (Evolution API por QR). El bot se
conecta como "dispositivo vinculado" al WhatsApp que ya usa Cecilia.

---

## Reparto del trabajo

- **TÚ (Marcelo):** contratar el servidor, conseguir un número de prueba,
  escanear los QR, correr los comandos que te paso. Son cosas con tu tarjeta y
  tu teléfono que yo no puedo hacer.
- **YO (Claude):** adaptar el flujo de n8n a Evolution, ajustar los prompts,
  cablear la base, y guiarte comando por comando. Puedo ayudarte en las
  interfaces web (Evolution, n8n) con Claude en Chrome.

Regla de oro: **todo se prueba primero con un número de prueba.** Al WhatsApp
real de la imprenta se pasa solo cuando funcione al 100%. Y se arranca **solo
con Tino** — Beto (reactivación) viene después, porque el outbound es lo que más
riesgo de bloqueo trae.

---

## Los pasos, en orden

### Fase 0 — Lo que necesitas conseguir (TÚ)

1. **Un servidor (VPS).** Barato y simple. Opciones: Hetzner (~€4/mes, el mejor
   precio), DigitalOcean ($6), o Contabo. Pide uno con **Ubuntu 22 o 24**, 2 GB
   de RAM basta. Te llega una IP, un usuario y una clave.

2. **Un número de WhatsApp de PRUEBA.** Un chip nuevo/barato o un número
   secundario que NO sea el de la imprenta. Con este probamos todo sin arriesgar
   el número real. (Un WhatsApp normal en un teléfono cualquiera sirve.)

3. **(Opcional) Un bot de Telegram para avisarle a Cecilia.** En la Opción A ella
   ya ve los chats en su WhatsApp, así que el aviso es un extra. Si lo quieres,
   se crea gratis con @BotFather. Ya tenemos experiencia con esto.

### Fase 1 — Montar la infraestructura (TÚ corres, YO te doy los comandos)

4. Entrar al servidor por SSH (te doy el comando exacto según tu proveedor).
5. Instalar Docker (una línea que te paso).
6. Levantar **Evolution API** con Docker (te dejo el archivo listo).
7. Levantar **n8n** con Docker en el mismo servidor (te dejo el archivo listo).
8. Verificar que las dos interfaces abran en el navegador.

### Fase 2 — Conectar el WhatsApp de prueba (TÚ, con el teléfono)

9. Crear una "instancia" en Evolution API (te guío en su panel).
10. Escanear el **QR con el número de PRUEBA**.
11. Mandar un mensaje de prueba y ver que Evolution lo recibe.

### Fase 3 — Cablear el flujo (YO adapto, TÚ importas o me dejas por Chrome)

12. Adapto el flujo `01_inbound_empleado.json` a Evolution: cambian solo 3 de
    sus 17 nodos (la entrada del webhook, el que lee el mensaje, y el que
    responde). El resto —identificar cliente, cargar conocimiento, armar prompt,
    Gemini, escalación— se reusa igual.
13. Reemplazo los placeholders (URL de Supabase, llaves, URL de Evolution).
14. Importar el flujo en n8n y conectar el webhook de Evolution hacia él.
15. Configurar que los mensajes que **Cecilia manda desde su teléfono** también
    lleguen al flujo, para que el bot detecte "humano activo" y se calle.

### Fase 4 — Enganchar Impresora Color (YO)

16. Asociar el número de prueba al cliente Impresora Color en la base, para que
    el flujo sepa a qué negocio pertenece cada mensaje.
17. Cablear el registro de resultados y contactos (ya está documentado).

### Fase 5 — Probar con el número de prueba (TÚ pruebas, YO reviso)

18. Escribirle al número de prueba desde otro teléfono → Tino responde con los
    datos de Impresora Color.
19. Probar el corte de silencio: contestas tú desde el teléfono de prueba → el
    bot se calla en ese chat.
20. Probar una escalación → llega el aviso (y/o queda para que Cecilia entre).
21. Correr el banco de pruebas de Impresora Color antes de dar el go-live.

### Fase 6 — Pasar al WhatsApp real (TÚ)

22. Cuando todo funcione con el número de prueba, escanear el QR con el
    **WhatsApp real de la imprenta**.
23. Arrancar solo con Tino, volumen normal. Vigilar los primeros días.

---

## Lo que ya está listo (no hay que construirlo)

- Las tablas `ed_` en Supabase ✅
- El flujo de n8n (solo hay que adaptarle 3 nodos a Evolution)
- La lógica de "humano activo → bot en silencio" y reactivación por tiempo
- El armado del prompt (el mismo de "Probar ahora", probado con Impresora Color)
- Impresora Color y Tino configurados y probados

## El primer paso concreto

**Contratar el VPS y conseguir el número de prueba.** Todo lo demás depende de
eso. Cuando tengas la IP del servidor y el número, seguimos con la Fase 1.
