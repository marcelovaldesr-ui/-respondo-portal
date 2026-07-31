# Módulo de Agenda — Entrega F0→F4 (31-jul-2026)

Implementación de la decisión agenda-first (ver `SPEC_MODULO_AGENDA.md`).
**Verificado en sandbox contra una copia exacta del proyecto:** `tsc --noEmit`
limpio, `next build` de producción exitoso (todas las rutas nuevas compilan) y
55 tests unitarios en verde (`scripts/_test_agenda.ts` 23/23 + 
`scripts/_test_agenda_bot.ts` 32/32, incluido el cambio de hora de sept-2026).

## Garantía: Tino en Impresora Color NO cambia

- Los webhooks (WAHA/Meta), el debounce, las anti-carreras, el eco, la
  convivencia con Cecilia: **ni una línea tocada**.
- `responderBot` y `armarPrompt` solo cambian si el cliente TIENE agenda
  (servicios activos + migración 220). Para un cliente sin agenda,
  `contextoAgenda()` devuelve `null` y el flujo es byte a byte el de siempre.
- La migración 220 es solo aditiva (tablas nuevas + columnas con default
  inofensivo: `reservas_online=false`). Se puede aplicar en caliente.
- Si la migración NO está aplicada, todo el código nuevo degrada en silencio
  (la página /agenda lo explica; el bot sigue normal).

## Archivos NUEVOS

| Archivo | Qué es |
|---|---|
| `sql/220_agenda.sql` | Migración: ed_servicios/profesionales/servicio_profesional/horarios/bloqueos/citas + EXCLUDE anti doble-reserva + config en ed_clientes + RLS |
| `lib/agendaCore.ts` | Núcleo PURO: slots, zona horaria Chile (Intl), formateo. Sin dependencias |
| `lib/agenda.ts` | Capa de datos (contrato AccionesAgenda): disponibilidad, crearCita (traduce 23P01→cupo_tomado), reagendar, cambiarEstado, citasDe |
| `lib/agendaBot.ts` | F2: bloque "AGENDA REAL" para el prompt (tokens C1/V1), ejecución de agendar/reagendar/cancelar, confirmación rápida por "SÍ" |
| `lib/agendaSeguimientos.ts` | F3: confirmación T−24h, recordatorio T−3h, encuesta Vera T+2h sobre ed_seguimientos + anulación al cancelar |
| `app/(portal)/agenda/page.tsx` + `acciones.ts` | F4: pantalla Agenda del portal (citas por día, estados, cita manual, CRUD servicios/profesionales/horarios/bloqueos, config página pública) |
| `app/reservar/[slug]/page.tsx` + `components/ReservaPublica.tsx` | F1: página pública de reservas (sin login), 3 pasos, éxito con botón a WhatsApp del negocio |
| `app/api/reservas/route.ts` + `app/api/reservas/disponibilidad/route.ts` | F1: API pública con rate-limit, honeypot, tope por teléfono; misma vía crearCita que WhatsApp |
| `scripts/_test_agenda.ts` / `scripts/_test_agenda_bot.ts` | 55 tests sin BD: `npx tsx scripts/_test_agenda.ts` |

## Archivos MODIFICADOS (4, cambios mínimos)

| Archivo | Cambio |
|---|---|
| `lib/promptEmpleado.ts` | `armarPrompt` acepta un 4º parámetro OPCIONAL `bloqueExtra` (el bloque de agenda). Sin él, prompt idéntico al actual |
| `lib/responderBot.ts` | Si `agenda != null`: (1) confirmación rápida "SÍ" sin modelo, (2) bloque en el prompt, (3) tras las anti-carreras, ejecuta la acción de agenda y ajusta el texto (la confirmación la redacta código). Sin agenda: flujo intacto |
| `middleware.ts` | `/agenda` y `/whatsapp` agregados a rutas protegidas (`/reservar` y `/api/reservas` quedan públicos a propósito) |
| `components/Sidebar.tsx` | Ítem "Agenda" con su icono |

## Cómo funciona el agendamiento por WhatsApp

1. `contextoAgenda` arma el bloque con cupos REALES (máx 8, ids `C1…`) y citas
   vigentes del contacto (`V1…`).
2. El modelo solo puede ELEGIR tokens; el contrato JSON suma la llave
   `"cita": {"cupo":"C2","nombre":"Camila"}` (o `reagendar_cita`/`cancelar_cita`).
3. Código valida el token, crea la cita (constraint de Postgres impide doble
   reserva incluso si web y WhatsApp chocan en el mismo segundo) y agrega la
   línea "✅ Listo, quedó reservado…". Si el cupo se lo ganó otro, reemplaza la
   respuesta con alternativas reales.
4. Al crear la cita se programan los seguimientos (los envía el cron existente
   `/api/cron/seguimientos`, con horario hábil y tope diario de siempre).
5. Si el cliente responde "SÍ" a la confirmación → la cita pasa a `confirmada`
   por código, sin gastar una llamada al modelo.

## LO QUE TIENES QUE HACER TÚ (en orden)

1. **Aplicar 2 migraciones en Supabase** (SQL editor, en este orden):
   `sql/214_seguimientos_tipos.sql` (ya estaba pendiente) y luego
   `sql/220_agenda.sql`. La verificación al final del 220 debe decir
   `tablas_agenda = 6` y `cols_config = 5`.
2. **`npm run build` local y git commit/push** (regla de siempre: el commit lo
   haces tú, nunca el sandbox).
3. **Probar el circuito completo en local** (10 min):
   - Entrar a `/agenda` → crear 1 servicio, 1 profesional con horario, activar
     página pública con slug.
   - Abrir `/reservar/<slug>` en ventana incógnita → reservar → ver la cita en
     `/agenda`.
   - En "Probar ahora" o por WhatsApp de prueba: pedir hora → elegir cupo →
     dar nombre → debe llegar el "✅ Listo, quedó reservado".
4. **Cron**: verificar que el cron externo que ya pega a
   `/api/cron/seguimientos?k=…` siga activo (los recordatorios salen por ahí).
5. **(Cuando quieras activar un piloto)** cargar servicios reales del cliente.
   Impresora Color NO necesita nada: sin servicios, Tino sigue igual.
6. **(F5, sin apuro pero PARTIR YA)** crear el proyecto OAuth en Google Cloud
   para Calendar (la verificación tarda semanas).

## Qué queda para las fases siguientes

- F5 Google Calendar (export + free/busy) — bloqueado por el OAuth de Google.
- F6 adaptador AgendaPro (misma interfaz `AccionesAgenda`).
- Cupos grupales (`ed_servicios.cupo > 1`) para clases — fase wellness.
- Plantillas Meta para confirmaciones fuera de ventana 24h (cuando Opción B
  esté en producción).
