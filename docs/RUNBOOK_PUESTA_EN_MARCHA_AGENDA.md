# Runbook · Poner la agenda en marcha (paso a paso)

**Fecha:** 31-jul-2026 · **Tiempo total:** ~2 horas · **Estado verificado:** todos
los archivos están en el disco; `node_modules` y `.env.local` existen; rama `main`
con 21 archivos pendientes de commit.

> Haz los pasos **en orden**. Los bloques 1 a 4 dejan la agenda funcionando (es
> lo que necesitas para el 10 de agosto). El bloque 5 es Google, que es
> independiente y puede esperar.

---

## BLOQUE 1 · Migraciones en Supabase (20 min)

### 1.1 Diagnóstico previo — qué hay aplicado hoy

Entra a Supabase → tu proyecto → **SQL Editor** → *New query*. Pega esto y ejecútalo.
**No modifica nada**, solo mira:

```sql
select
  (select count(*) from information_schema.tables
     where table_name in ('ed_servicios','ed_profesionales','ed_horarios',
                          'ed_bloqueos','ed_citas','ed_servicio_profesional')) as tablas_220,
  (select count(*) from information_schema.columns
     where table_name='ed_clientes'
       and column_name in ('slug','reservas_online','confirmacion_automatica',
                           'anticipacion_min_horas','horizonte_dias'))        as cols_220,
  (select count(*) from information_schema.columns
     where table_name='ed_clientes' and column_name='ical_token')             as col_221_ical,
  (select count(*) from information_schema.columns
     where table_name='ed_profesionales'
       and column_name in ('gcal_id','gcal_sync','gcal_ultimo_error',
                           'gcal_ultima_sync'))                              as cols_221_gcal,
  (select count(*) from information_schema.columns
     where table_name='ed_clientes' and column_name='transporte')            as col_216,
  (select pg_get_constraintdef(oid) from pg_constraint
     where conname='ed_seguimientos_tipo_check')                            as check_214;
```

**Cómo leer el resultado:**

| Columna | Si sale 0 (o falta) | Si ya está |
|---|---|---|
| `tablas_220` | falta la 220 → aplícala | debe decir **6** |
| `cols_220` | falta la 220 | debe decir **5** |
| `col_221_ical` | falta la 221 | debe decir **1** |
| `cols_221_gcal` | falta la 221 | debe decir **4** |
| `col_216` | falta la 216 → aplícala también | debe decir **1** |
| `check_214` | si **NO** contiene `recordatorio_cita` → falta la 214 | debe incluir `recordatorio_cita`, `confirmacion_cita`, `encuesta_postventa` |

### 1.2 Aplicar lo que falte, EN ESTE ORDEN

Para cada una: abre el archivo, copia **todo** el contenido, pégalo en el SQL
Editor y dale **Run**.

1. `sql/216_transporte_cliente.sql` — solo si `col_216` dio 0
2. `sql/214_seguimientos_tipos.sql` — solo si `check_214` no tenía `recordatorio_cita`
3. `sql/220_agenda.sql` — **la principal**
4. `sql/221_agenda_calendarios.sql`

> Las cuatro son aditivas e idempotentes: no borran datos y se pueden correr de
> nuevo sin romper nada. Tino y la imprenta no se ven afectados.

### 1.3 Verificar (con los scripts, no a ojo)

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
npx tsx scripts/_verificar_migraciones.ts
npx tsx scripts/_verificar_tino_intacto.ts
```

Esperado: **33 OK / 0 fallos** y **5 OK / 0 fallos**.

El primero no se queda en mirar el esquema: crea un servicio, un profesional y
un horario de prueba en el cliente demo *Estética Aurora*, calcula cupos,
agenda, **intenta agendar dos veces el mismo cupo** (debe rechazarlo con
`cupo_tomado`, esa es la garantía anti doble-reserva), prueba un solape parcial,
cancela y comprueba que el cupo se libera. Al final **borra todo lo que creó**
(imprime cuánto quedó: debe ser 0 y 0).

El segundo confirma que los clientes reales sin agenda —Impresora Color— siguen
exactamente igual: `contextoAgenda` devuelve null y el prompt de Tino no lleva
el bloque de agenda.

> Los scripts cargan solos el `.env.local` gracias a `scripts/_env.ts`; no hace
> falta pasar variables ni flags.

**Si algo falla:** cópiame la salida exacta. No sigas al bloque 2 con
migraciones a medias.

✅ *Verificado el 31-jul-2026: 33/33 y 5/5 en la máquina de Marcelo.*

---

## BLOQUE 2 · Compilar y correr los tests (10 min)

Abre una terminal en la carpeta del portal:

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
```

### 2.1 Verificación de tipos y build

```powershell
npx tsc --noEmit
npm run build
```

Ambos deben terminar sin errores. (Yo ya los corrí sobre una copia exacta y
pasaron; esto confirma que en tu máquina también.)

### 2.2 Los 4 sets de tests

```powershell
npx tsx scripts/_test_agenda.ts
npx tsx scripts/_test_agenda_bot.ts
npx tsx scripts/_test_ical.ts
npx tsx scripts/_test_gcal_firma.ts
```

Resultados esperados: **23, 32, 26 y 9 OK, 0 fallos**. No necesitan base de datos.

---

## BLOQUE 3 · Probar el circuito completo en local (30 min)

```powershell
npm run dev
```

Entra a `http://localhost:3000` y haz login con `marcelo.valdes.r@mail.pucv.cl`
(según el seed, ese correo entra como **Estética Aurora**).

### 3.1 Configurar la agenda — menú lateral → **Agenda**

Deberías ver la pantalla nueva. Si dice *"Falta un paso técnico"*, la 220 no
quedó aplicada: vuelve al bloque 1.

1. **Servicios** → agrega: `Depilación axilas`, 30 min, precio `15000`.
   Agrega otro: `Limpieza facial`, 50 min, `25000`.
2. **Profesionales y horarios** → agrega `Carla`.
   En su fila: deja marcados lunes a viernes, horario `10:00` a `19:00` → *Agregar tramo*.
   Debe aparecer una pastilla por cada día.
3. **Página pública de reservas** → slug: `estetica-aurora` → marca
   *Activar la página pública* → **Guardar configuración**.

### 3.2 Probar la reserva pública

Abre una **ventana de incógnito** en `http://localhost:3000/reservar/estetica-aurora`

- Elige servicio → elige día → elige hora → nombre `Camila Prueba` y teléfono
  `912345678` → **Reservar**.
- Debe mostrar la pantalla de éxito con la fecha.
- Vuelve a `/agenda`: **la cita tiene que aparecer** en el día correspondiente.

✅ Si esto funciona, ya tienes reservas online andando.

### 3.3 Probar que el empleado agenda (lo importante)

> ⚠️ **"Probar ahora" NO sirve para esto.** Esa pantalla usa `/api/probar`, que
> arma el prompt **sin** el bloque de agenda y no ejecuta acciones: es una demo
> conversacional, no el camino real. Si pruebas ahí, Tino inventará horarios.

El camino real es el de los webhooks de WhatsApp. Para ejercitarlo sin mandar un
mensaje de verdad, corre:

```powershell
npx tsx scripts/_test_agenda_e2e.ts
```

Ese script usa el **mismo `responderSiBot`** que los webhooks, con un transporte
falso que captura lo que Tino habría enviado. Crea una agenda de prueba en
Estética Aurora, conversa de verdad con el modelo, verifica que ofrezca horarios
reales (y que **no** mencione ninguno fuera del horario), que la cita quede
creada con la línea `✅ Listo, quedó reservado`, que se programen los
seguimientos, que se registre el resultado para las métricas, que el cupo
desaparezca de la disponibilidad y que un "sí" confirme la cita sin gastar una
llamada al modelo. Al final borra todo.

Esperado: **21 OK, 0 fallos, 0 avisos**.

✅ *Verificado el 31-jul-2026: 21/21 con el modelo y la base reales.*

Si además quieres verlo por WhatsApp de verdad, hay que cargar servicios y
horario en un cliente conectado a WAHA y escribirle desde otro teléfono.

### 3.4 Probar que no se pisan las citas

En `/agenda`, con la cita de Josefa ya creada, abre de nuevo
`/reservar/estetica-aurora` en incógnito y fíjate: **ese horario ya no debe
ofrecerse**. Esa es la garantía anti doble-reserva funcionando.

### 3.5 Probar el enlace de calendario

En `/agenda` → *Ver tus horas en Google Calendar* → botón **Copiar**.
Pega esa URL en el navegador: debe descargarse/mostrarse un archivo de
calendario con tus citas. (En local es `http://localhost:3000/...`; el que sirve
para Google es el de producción, después del deploy.)

---

## BLOQUE 4 · Commit y deploy (15 min)

⚠️ **Ojo con el repo de la web**: tiene 18 archivos modificados, no solo el mío
(Hero.astro, Navbar.astro, package.json, PDFs sueltos…). **No hagas `git add .`
a ciegas** ahí.

### 4.1 Portal

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
git add .
git commit -m "Modulo de agenda: citas, reservas online, empleados que agendan y calendarios"
git push
```

(Aquí sí puedes usar `git add .`: los 21 archivos pendientes son todos de la agenda.)

Verifica en Vercel que el deploy del portal quede en verde.

### 4.2 Web (solo la política de privacidad)

```powershell
cd "C:\Users\marce\web-respondo"
git add respondo-astro/src/pages/privacidad.astro
git commit -m "Politica de privacidad: seccion de Google Calendar y Limited Use"
git push
```

Después del deploy, confirma que <https://www.respon-do.com/privacidad/> muestre
la **sección 5 · Google Calendar y Datos de Usuario de Google**. Esto es
requisito para el bloque 5.

### 4.3 Confirmar el cron de seguimientos

Los recordatorios de cita salen por el cron que ya tienes. Verifica que siga
activo apuntando a:
`https://<tu-portal>.vercel.app/api/cron/seguimientos?k=<tu-secreto>`

---

## BLOQUE 5 · Google (60–90 min, independiente de todo lo anterior)

Sigue `docs/OAUTH_GOOGLE_EXPEDIENTE.md`, que tiene el detalle completo. Resumen
del orden:

1. **A1** Proyecto `Respondo` en Google Cloud + habilitar Google Calendar API.
2. **A2** Pantalla de consentimiento (**sin logo**), con las URLs de tu web.
3. **A3** Verificar `respon-do.com` en Search Console (registro TXT en el DNS).
   ← el paso más lento, hazlo temprano.
4. **A4** Ya está: la política quedó publicada en el bloque 4.2.
5. **A5** Crear credencial OAuth → **guárdame el Client ID y el Client Secret**.
6. **A6** Declarar el scope `calendar.events` y confirmar que la consola lo
   marca como **"Sensible"** (si dice "Restringido", avísame antes de seguir).

### 5.1 (Opcional, pero es lo que da sincronización real ya)

Cuenta de servicio — está en `docs/AGENDA_F5_CALENDARIOS.md`, sección "vía 2":
crear la cuenta de servicio, bajar la llave JSON, poner `GOOGLE_SA_EMAIL` y
`GOOGLE_SA_PRIVATE_KEY` en Vercel, compartir tu calendario con ese correo y
pegar el ID en `/agenda`.

---

## Qué me tienes que pasar cuando termines

1. Resultado de la consulta de verificación (1.3).
2. Si algo falló en el bloque 2 o 3: el mensaje de error exacto.
3. Client ID y Client Secret de Google (bloque 5, paso A5) → con eso construyo
   el botón "Conectar Google Calendar" y puedes grabar el video.

## Checklist

- [ ] 1 · Migraciones 216/214/220/221 aplicadas y verificadas
- [ ] 2 · `tsc`, `build` y los 4 tests en verde
- [ ] 3.1 · Servicios + profesional + horario creados
- [ ] 3.2 · Reserva pública probada y visible en /agenda
- [ ] 3.3 · Tino agendó por "Probar ahora"
- [ ] 3.4 · El horario tomado ya no se ofrece
- [ ] 3.5 · Enlace de calendario descarga el .ics
- [ ] 4.1 · Portal commiteado, pusheado y desplegado
- [ ] 4.2 · Privacidad publicada y visible en la web
- [ ] 4.3 · Cron de seguimientos activo
- [ ] 5 · Google: proyecto, consentimiento, dominio, credencial, scope
