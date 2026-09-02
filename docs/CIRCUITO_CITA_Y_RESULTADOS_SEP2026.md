# Se cerró el circuito de la cita y el motor de resultados

**Fecha:** 1-sep-2026 · **Al cerrar:** 285 tests en verde · typecheck (app y
scripts) limpio · lint limpio.

> Ejecuta el "orden acordado" de `docs/AUDITORIA_OLA1_AGO2026.md` (auditoría
> del 26-ago, sección de circuitos abiertos): cerrar la cita, completar el
> motor de resultados donde es seguro hacerlo, y dar al dueño un informe que
> pueda reenviar. La propia auditoría lo dijo entonces: esto vale más que
> cualquier función de Tecnom, porque sin esto el panel de fidelización que ya
> existe muestra ceros para siempre.

---

## 1 · Vera cierra la cita sola — cuando el cliente confirma, no cuando pasa la hora

### El problema

`cambiarEstado` (marcar una cita `completada` o `no_show`) era un botón que
nadie apretaba nunca. La cita del 4-ago de Impresora seguía en `confirmada`
tres semanas después. Consecuencia: "clientes que vuelven" quedaba en 0% para
siempre y la inasistencia en "—", que es justo la métrica que más vende
(nuestro caso publicado de OdontoAndrauss es "−38% de horas perdidas por
inasistencia").

### La solución

`lib/encuestaCore.ts` (12 tests) reconoce, con un regex ANCLADO de punta a
punta —el mismo rigor que ya usaba `esTextoDeConfirmacion` para el "SÍ" de la
cita—, cuando el cliente contesta la encuesta de Vera ("de 1 a 5, ¿cómo lo
evaluarías?") con una nota clara: "5", "un 4", "4/5", "5 estrellas", "nota 3".
Un número dentro de una frase más larga ("tuve 2 problemas con el servicio")
**no cuenta como nota** — fail-closed a propósito, porque esto dispara cerrar
una cita real y escribir una fila permanente.

`encuestaRapida` (`lib/agendaBot.ts`) hace tres cosas **por código, sin
modelo**, apenas detecta la nota:

1. Escribe `ed_resultados` (`encuesta_respondida`) con el puntaje — hoy
   simplemente no existía ningún lugar donde esa nota se guardara.
2. Cierra la cita como `completada`. **A propósito no se cierra sola por el
   solo paso del tiempo**: eso infla el retorno y esconde la inasistencia
   real. Solo se cierra cuando el cliente confirma que lo atendieron de
   verdad.
3. Si la nota es 1-3, deriva a una persona de inmediato: silencia a Vera en
   ese chat, registra la escalación y avisa al teléfono del equipo —
   garantizado por código, no por instrucción de prompt que el modelo puede o
   no seguir.

### El fallback: la franja "Por cerrar" en /agenda

No toda la gente contesta encuestas. Para esos casos hay una sección nueva en
la agenda: citas cuya hora ya pasó y siguen abiertas, con los dos botones que
ya existían (Completada / No llegó) reutilizados tal cual. Es el cierre
manual para lo que el cierre automático no alcanza a cubrir.

### Archivos

`lib/encuestaCore.ts` (puro, 12 tests) · `lib/agendaSeguimientos.ts`
(`encuestaPendiente`, mismo patrón que `confirmacionPendiente`) ·
`lib/agendaBot.ts` (`encuestaRapida`) · `lib/responderBot.ts` (enganchado
antes de llamar al modelo, igual que la confirmación de cita) ·
`app/(portal)/agenda/page.tsx` (franja "Por cerrar").

---

## 2 · El motor de resultados: un tipo más, con cuidado de no repetir el error de "reactivado"

`ed_resultados` tiene diez tipos declarados desde la migración 201; en
producción se escribía solo uno (`agendamiento`). Se sumaron dos, ambos por el
mismo punto único de escalación en `responderBot.ts` — cubre a Tino, Rita y
Vera sin tocar cada rol por separado:

- `encuesta_respondida` (sección 1, arriba).
- `cliente_molesto`: cualquier escalación con trigger `sentimiento_negativo`,
  venga de donde venga.

**A propósito NO se completaron los demás tipos** (`venta_confirmada`,
`cliente_reactivado`, `resena_conseguida`...). La propia auditoría de agosto
advirtió algo que sigue vigente: **"reactivado" ya tiene DOS fuentes de
verdad** en el portal — este motor (el tipo `cliente_reactivado`, sin usar) y
el cálculo de `/analitica` desde citas + seguimientos (el que sí se muestra
hoy). Sumar una tercera sin decidir cuál manda deja al portal mostrando
números distintos en dos pantallas del mismo negocio. **Esa decisión sigue
pendiente y es de producto, no de código** — cuál fuente prevalece cuando
ambas midan algo distinto.

---

## 3 · El informe reenviable — lo que le faltó a Gaspar

Cuando la decisión de RS-Shop subió de Gaspar a gerencia, él no tenía un solo
número que reenviar. Ahora en `/analitica`, junto al panel "¿Vuelve la
gente?", hay un botón **"Enviar a mi WhatsApp"** (dueño-only) que compara los
últimos 30 días contra los 30 anteriores y manda un mensaje listo para
reenviar:

```
📊 Resumen de RS-Shop — últimos 30 días

Horas agendadas: 42 (+8 vs. período anterior)
Clientes que volvieron: 61% (+5 pts vs. período anterior)
Inasistencia: 12% (-3 pts vs. período anterior)
Reactivados por seguimiento: 5 (+2 vs. período anterior)

Datos reales de tu WhatsApp — nada estimado.
```

Reglas de honestidad, con test para cada una: si no hay período anterior con
datos, **no se inventa ninguna comparación** — se omite la flecha entera, no
se muestra un falso "+100%". Si el período no cerró ninguna cita, se omite la
línea de inasistencia en vez de mostrar un 0% que en realidad es "no hay
dato". La inasistencia solo se compara contra un período anterior que
**también** cerró citas.

⚠️ Dice "últimos 30 días", no "agosto 2026": es una ventana móvil que se
recalcula cada vez que se aprieta el botón, no un corte de mes calendario —
decir otra cosa sería prometer una precisión que este número no tiene.

Se envía con el MISMO mecanismo que ya usan los avisos de cupo
(`configPorCliente` + `enviarTexto` en Cloud, `enviarTextoWaha` en WAHA) al
`telefono_escalacion` configurado en Información — nada nuevo que aprender a
mantener. Si no hay teléfono configurado, el botón lo dice con claridad en vez
de fallar en silencio.

### Archivos

`lib/fidelizacionCore.ts` (`textoInformeFidelizacion`, puro, 9 tests) ·
`lib/fidelizacion.ts` (`calcularFidelizacion` ahora acepta un `hasta`
opcional para poder pedir el mismo cálculo con un corte en el pasado, sin
duplicar ninguna regla; `enviarInformeFidelizacion`) ·
`app/(portal)/analitica/acciones.ts` · `components/analitica/EnviarInforme.tsx`.

---

## Prueba manual

1. **Cierre de cita:** en un chat con una cita agendada, esperar (o simular)
   el mensaje de la encuesta de Vera → contestar "5" → debe llegar el
   agradecimiento, la cita debe pasar a "completada" en /agenda, y debe
   aparecer una fila `encuesta_respondida` en la base.
2. **Nota mala:** contestar "2" a la encuesta → debe derivar a una persona
   (el chat pasa a modo humano) y debe aparecer una escalación con trigger
   `sentimiento_negativo`.
3. **Franja "Por cerrar":** en /agenda, una cita cuya hora ya pasó y nadie
   cerró debe aparecer en la sección nueva con los dos botones.
4. **Informe:** en /analitica, apretar "Enviar a mi WhatsApp" → debe llegar el
   mensaje al `telefono_escalacion` configurado en Información.

---

## Lo que queda abierto, a propósito

- **La fuente de verdad de "reactivado"** — decisión de producto, no de
  código. Mientras no se decida, el tipo `cliente_reactivado` de
  `ed_resultados` se queda sin usar.
- **El informe es manual, no un cron mensual.** Se decidió así porque un botón
  que funciona cuando el dueño lo necesita (para una reunión puntual, no solo
  el primer día del mes) es más útil que un envío automático de fecha fija —
  y no cierra la puerta a agregarlo después colgado del cron de seguimientos,
  si algún cliente lo pide.
