# Cron de seguimientos y vigilancia — 1-ago-2026

## Por qué existe este documento

El 1-ago quedó una pregunta sin respuesta: *¿el cron sigue llamando a
`/api/cron/seguimientos`?* Nadie recordaba dónde estaba configurado, y desde
afuera no se podía saber: el endpoint responde `403` sin la llave, y una base
sin seguimientos vencidos se ve **exactamente igual** esté el cron vivo o
muerto.

Lo revisé contra la base de producción:

```
Total de seguimientos: 5
Enviados en los últimos 7 días: 0
Último envío registrado: 19-jul, 15:22 (cotizacion_sin_respuesta)
Pendientes VENCIDOS: 0
Programados a futuro: 0
```

Nada vencido, pero tampoco nada reciente y nada por delante. **La base no podía
responder la pregunta.** Por eso ahora hay un latido.

Esto no es un detalle: los recordatorios de cita y las confirmaciones del módulo
de agenda dependen ENTERAMENTE de ese cron. Si deja de correr no falla nada
visible — los clientes simplemente no reciben su recordatorio, y el negocio se
entera cuando alguien no llega.

---

## Lo que se agregó

| Archivo | Qué hace |
|---|---|
| `sql/260_latidos.sql` | Tabla `ed_latidos`: una fila por proceso periódico. |
| `lib/latidos.ts` | `registrarLatido()` / `leerLatido()` / `estadoDelCron()`. Todo defensivo: si la migración no está aplicada, no rompe nada. |
| `app/api/cron/seguimientos/route.ts` | Deja el latido al final de cada corrida, **aunque no haya enviado nada**. |
| `app/api/salud/route.ts` | Nuevo chequeo `cron_seguimientos`. Si el cron lleva más de **90 minutos** sin correr, `/api/salud` devuelve **HTTP 503**. |
| `scripts/_diag_cron.ts` | Diagnóstico contra la base: enviados recientes, vencidos, futuros y un veredicto. |

Los 90 minutos de tolerancia dejan pasar muchos fallos seguidos de un cron de 5
minutos antes de gritar: suficiente para un reinicio de Vercel o un hipo del
servicio, sin falsas alarmas.

"Nunca corrió" **no** cuenta como caído — si contara, una instalación nueva
nacería en rojo. Se informa aparte con su propio texto.

---

## PASO 1 · Aplicar la migración (2 min)

Supabase → SQL Editor → pegar el contenido de `sql/260_latidos.sql` → Run.
Es aditiva: crea una tabla nueva y no toca nada existente.

## ES UN SOLO CRON PARA TODO

No hay que armar uno por módulo. De este endpoint cuelgan:

| Qué | De quién |
|---|---|
| Confirmación y recordatorio de cita | Agenda |
| Encuesta de postventa tras la cita | Agenda + Vera |
| Cotización sin respuesta, reactivación | Beto |
| Informe semanal de los lunes | Analítica |

Los recordatorios de la agenda no tienen mecanismo propio: se escriben en
`ed_seguimientos` con tipo `recordatorio_cita` y los manda este mismo proceso.
Configurarlo para la agenda activa todo lo demás de una.

## PASO 2 · Crear el cron en cron-job.org (5 min)

1. Entra a <https://console.cron-job.org> (cuenta gratis).
2. **Create cronjob**.
3. Title: `Respondo · seguimientos`
4. URL:
   ```
   https://respondo-portal.vercel.app/api/cron/seguimientos?k=TU_SECRETO
   ```
   `TU_SECRETO` es el valor de `CRON_SECRET` en Vercel, o el de
   `EVOLUTION_WEBHOOK_SECRET` si `CRON_SECRET` no está definido (el código usa
   el primero que encuentre, en ese orden).
5. Schedule: **Every 5 minutes**.
6. Guardar y darle a **TEST RUN**. Debe responder `200` con un JSON tipo
   `{"enviados":0,"detalle":[]}`.

> **Por qué cada 5 y no cada hora:** la ruta tiene `maxDuration = 60`, así que
> una corrida se corta al minuto. Por eso el informe semanal procesa pocos
> clientes por vez y deja el resto para la corrida siguiente. Corriendo seguido,
> los pendientes se completan solos; corriendo una vez al día, no.
>
> Correr seguido no manda nada de más: las salvaguardas viven en
> `lib/seguimientos.ts` (horario hábil de Chile, tope diario, `max_intentos`,
> `no_contactar`). Si no hay nada vencido, la corrida no hace nada y termina.

## PASO 3 · Crear el vigilante (5 min)

Un segundo cronjob que NO hace trabajo, solo mira:

1. Title: `Respondo · vigilante de salud`
2. URL: `https://respondo-portal.vercel.app/api/salud`
3. Schedule: **Every 30 minutes**
4. En **Notifications**, marcar *notify on failure*.

Como `/api/salud` devuelve **503** cuando algo está roto —base caída, WAHA
desconectado, mensajes entrando sin respuesta, **o el cron detenido**—
cron-job.org manda el correo solo. Sin desplegar nada extra.

## PASO 4 · Confirmar que quedó andando (1 min, media hora después)

```powershell
npx tsx scripts/_diag_cron.ts
```

O desde el navegador, con la llave:
`https://respondo-portal.vercel.app/api/salud?k=TU_SECRETO`
→ busca la línea `cron_seguimientos`. Debe decir `hace X min · N corridas`.

---

## Lo que ya NO va a volver a pasar

Antes: *"¿estará corriendo el cron?"* → nadie sabía, y averiguarlo requería
provocar un envío real.

Ahora: `/api/salud` lo dice en una línea, el vigilante avisa por correo cuando
se detiene, y `_diag_cron.ts` da el detalle completo contra la base.
