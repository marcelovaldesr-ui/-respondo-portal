# Convivencia Tino + atención humana (copiloto)

Tino NO reemplaza a la persona que atiende el WhatsApp de Impresora Color: es un
**copiloto**. Empieza conversaciones, responde consultas, cotiza lo que tiene
precio fijo y recopila datos; pero una persona (Cecilia) puede tomar el control
en cualquier momento, y Tino se aparta sin pisarla.

## Estados de una conversación (`ed_chat_estado.modo`)

| Estado | Qué significa | ¿Tino responde? |
|---|---|---|
| `bot` | Tino atiende (AI activo) | Sí |
| `humano` | Una persona tomó el control | No (guarda contexto) |
| `pausado` | Tino detenido a mano | No |

Regla de oro: **Tino nunca reanuda solo por tiempo**. Volver a `bot` es siempre
una acción explícita (persona en el portal). Mientras alguien atiende, Tino calla.

## Ciclo de la conversación

```
1. El cliente escribe ─► webhook Evolution ─► lib/inboundEvolution.ts
2. Se resuelve estado (bot / humano / pausado)
3a. Si modo=bot ─► Tino responde (respeta el historial, incl. lo que dijo la persona)
3b. Si modo≠bot ─► Tino NO responde, pero guarda el mensaje como contexto
4. La persona puede tomar el control escribiendo desde el WhatsApp del negocio
   ─► se detecta (fromMe con id nuevo) ─► modo pasa a "humano" ─► Tino se calla
5. La persona atiende libremente; Tino sigue registrando todo
6. La persona libera el control desde el portal (POST /api/whatsapp/estado, modo=bot)
7. Tino retoma leyendo el contexto: respeta precios/acuerdos que dio la persona
```

## Cómo se detecta la toma de control humana (Opción A / Evolution)

En Opción A, Cecilia usa el MISMO WhatsApp del negocio (el chip). Cuando ella
responde, Evolution manda un evento `fromMe`. El problema: el eco del propio
envío de Tino **también** llega como `fromMe`. Se distinguen así:

1. Al enviar, Tino guarda el `id` que Evolution devuelve (`ed_mensajes.wa_message_id`).
2. Cuando llega un `fromMe`:
   - si su `id` **ya está registrado** → es el eco de Tino (o un reenvío) → se ignora.
   - si su `id` es **desconocido** → lo escribió una persona → **toma de control**:
     se guarda como contexto (`rol=humano`), se pausa Tino (`modo=humano`), no se responde.
3. Red de seguridad ante la carrera "eco antes de guardar el id": si el texto
   `fromMe` coincide con un mensaje de Tino de los últimos ~25 s, se trata como eco.

## Protecciones contra respuestas duplicadas / descoordinadas

- **Idempotencia** (migración 212): índice único `(empleado_id, wa_message_id)`.
  Un webhook repetido no se procesa dos veces → no hay respuestas dobles.
- **Anti-carrera**: antes de ENVIAR, Tino vuelve a leer el modo. Si en los
  segundos que tardó Gemini una persona tomó el control, la respuesta ya obsoleta
  **no se manda** (`accion=silencio_carrera`).
- **Autoridad del humano**: en el prompt, los mensajes de la persona se marcan
  como "Compañero del equipo (persona real)". Regla 11 del núcleo: Tino respeta
  sus precios/condiciones, no la contradice ante el cliente ni repregunta lo ya
  resuelto; si hay contradicción grave, escala en vez de discutir.

## Reanudar / pausar desde el portal

La pantalla de **Conversaciones** ya tiene los botones y están cableados al server
action `cambiarModo` (`app/(portal)/conversaciones/acciones.ts`):
- **Tomar la conversación** → modo `humano` (Tino calla).
- **Pausar asistente** → modo `pausado`.
- **Devolver a Tino / Reactivar** → modo `bot` (reanudar) y además cierra la
  escalación pendiente del chat.

Valida sesión de portal y que el empleado sea del cliente logueado. Es una acción
explícita de la persona: nunca automática por tiempo.

> Nota Opción A: en Evolution, la persona normalmente retoma respondiendo desde su
> propio WhatsApp (se detecta solo). Los botones del portal sirven para monitorear
> y para devolverle el control a Tino cuando termina. Responder al cliente DESDE el
> portal (Compositor) hoy usa la Cloud API (Opción B); para Opción A ella responde
> desde WhatsApp.

## Validación de convivencia (pruebas ejecutadas)

`scripts/_test_hibrido.ts` y `_test_hibrido2.ts` corren contra la base real con un
chat de prueba y **envío simulado** (no se manda WhatsApp real):

| # | Escenario | Resultado esperado | Resultado |
|---|---|---|---|
| H1 | Cliente escribe, modo bot | Tino responde | ✅ respondió, 1 envío |
| H2 | Webhook duplicado (mismo id) | No se reprocesa | ✅ `duplicado`, 0 envíos (212 aplicada) |
| H3 | Persona escribe (fromMe id nuevo) | Toma de control, Tino calla | ✅ `toma_humana`, modo=humano, 0 envíos |
| H4 | Cliente escribe con humano activo | Tino no responde | ✅ `silencio`, 0 envíos |
| H5 | Llega el eco del propio mensaje de Tino | No se pausa | ✅ `eco`, sigue en `bot` |
| H5b | fromMe con texto nuevo | Toma de control | ✅ `toma_humana`, modo=humano |
| H6 | Reanudar tras precio especial del humano | Respeta $30.000, no recotiza | ✅ respondió el plazo, no contradijo |

Idempotencia validada con la migración 212 aplicada (`scripts/_test_idem.ts`):
un webhook duplicado —de cliente o humano— devuelve `duplicado` con 0 envíos y no
crea filas repetidas en la base.
