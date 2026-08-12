# Las 3 integraciones pendientes — paso a paso

Estado al 12-ago-2026. **Todo lo que depende del código ya está hecho y
desplegado.** Lo que queda son pasos en paneles externos (Meta, Google,
cron-job.org) que solo puedes hacer tú.

Orden recomendado: **A → B → C**. A es de 5 minutos y cierra un punto ciego
real; B es la que tiene un plazo externo (Google revisa); C puede esperar.

---

## A · Cerrar el punto ciego del vigilante (5 min, hazlo primero)

Entra a **cron-job.org**, al job *"Respondo · vigilante de salud"*, y confirma
que la URL sea exactamente:

```
https://respondo-portal.vercel.app/api/salud?k=<CRON_SECRET>
```

El valor de `CRON_SECRET` está en las variables de entorno de Vercel.

**Por qué importa:** sin el secreto en la URL, dos chequeos nuevos no corren:

| Chequeo | Qué detecta |
|---|---|
| `tokens_clientes` | Que a un cliente real se le venció o revocó el token de WhatsApp. Hoy nadie se enteraría hasta que reclame. |
| `waha_un_solo_cliente` | Que alguien quedó mal configurado en WAHA. |

Es el mismo patrón del apagón de 21 horas: el vigilante mirando el lugar
equivocado. Verificado hoy: `/api/salud` responde `{"estado":"ok"}` en
producción, así que el endpoint está vivo — solo falta el secreto.

**Cómo saber que quedó bien:** abre esa URL con el secreto en el navegador.
Debe devolver un JSON con `chequeos` adentro, incluyendo `tokens_clientes` y
`waha_un_solo_cliente`. Si solo ves `{"estado":"ok"}`, el secreto no está
llegando.

---

## B · Google Calendar — enviar a verificación

**Estado verificado hoy:** la conexión OAuth **funciona**. Dra. Valentina Rojas
está conectada con `hirespondo@gmail.com`, `gcal_modo = oauth`, sincronización
activa. O sea, lo técnico está probado en vivo.

Lo que falta es el trámite con Google.

### B.1 — Revocar el acceso (si no lo hiciste ya)

`myaccount.google.com/connections` → **Respondo** → quitar acceso.

Sin esto, Google muestra la pantalla resumida de "ya tiene cierto acceso" en vez
de la pantalla completa de permisos — y esa es justamente la que el revisor
necesita ver. Fue lo que invalidó el video anterior.

### B.2 — Grabar de nuevo

El guion completo está en `guion_video_oauth_google.md` (te lo pasé). Los dos
puntos que hundieron la toma anterior:

1. **La pantalla de permisos completa**, sin cortar ni acelerar. Tiene que verse
   el nombre "Respondo", la cuenta elegida y el permiso de Calendar.
2. **La prueba de uso**, que faltaba entera: crear una cita en la agenda →
   mostrarla apareciendo en Google Calendar → cancelarla en el portal →
   mostrarla desapareciendo.

> Ahora tienes una ventaja que antes no: **la agenda del portal por fin muestra
> las citas**. Cuando grabaste la vez pasada estaba rota por el join ambiguo, así
> que ni siquiera habrías podido mostrar el paso 7 del guion.

### B.3 — Enviar

YouTube como **No listado** → copiar enlace → **Centro de verificación** en
Google Auth Platform → pegar el enlace y los tres textos que ya están escritos
en el guion (justificación del scope, uso de los datos, descripción corta).

Google demora típicamente 3-5 días hábiles.

---

## C · WhatsApp coexistencia — conectar el número de Cecilia

**Estado verificado hoy en la base:**

```
transporte       : waha              ← cambia solo a 'cloud' al conectar
waha_instancia   : impresora-color   ← intacto: el rollback está disponible
waba_id          : vacío             ← se llena al conectar
waba_token       : vacío             ← se llena al conectar
```

Todo listo para conectar. El paso a paso completo está en
`docs/COEXISTENCIA_PASO_A_PASO.md`; acá va lo esencial.

### C.1 — Campos del webhook en Meta

App **Respon.do** → **WhatsApp → Configuración** → sección Webhook →
*Administrar*. Además de `messages`, activa:

| Campo | Para qué |
|---|---|
| `smb_message_echoes` | **El crítico.** Cuando Cecilia responde desde su teléfono, el portal se entera y Tino se hace a un lado. Sin esto, Tino le contesta encima al cliente. |
| `smb_app_state_sync` | Sincroniza los contactos de su agenda. |
| `history` | Permite importar conversaciones pasadas. |

### C.2 — Conectar

Portal como Impresora Color → **WhatsApp** → *Conectar WhatsApp* → elegir
"conectar el número que ya uso en la app". Cecilia confirma en su teléfono
(recibe un mensaje de la cuenta oficial de Facebook Business → *Conectar* →
*Confirmar*) y pega el código.

Requisitos de su lado: app de WhatsApp Business **2.24.17 o superior**, y el
número con actividad reciente (el de ella la tiene de sobra).

### C.3 — Verificar antes de cantar victoria

La página debe mostrar **Modo: Coexistencia**. Si dice "Solo API", **avísame
antes de seguir** — significa que Cecilia perdería el uso desde su teléfono.

Después prueba estas tres, en orden:

1. Escríbele desde otro teléfono → Tino responde.
2. Que Cecilia conteste desde su app en esa conversación → en el portal pasa a
   modo humano y Tino se calla.
3. Responde desde el inbox del portal → llega.

**Rollback si algo sale mal**, una línea en Supabase:

```sql
update ed_clientes set transporte = 'waha' where nombre = 'Impresora Color';
```

**No sincronizar el historial:** el portal ya tiene esas conversaciones desde
WAHA; importarlas duplicaría todo en el inbox y en las métricas.

---

## D · Instagram — lo que realmente falta

**Corrección respecto de lo que teníamos anotado:** la migración 271 **ya está
aplicada** (`ig_user_id`, `ig_token`, `ig_token_vence` existen y el canal
`instagram` está habilitado en `ed_mensajes`). Ese pendiente ya no existe.

**Limpieza hecha hoy:** el código tenía un respaldo que buscaba por `ig_page_id`,
una columna que nunca existió —era para el camino con Login de Facebook, que se
descartó a propósito—. No daba compatibilidad con nada: solo gastaba una
consulta que siempre fallaba, por cada mensaje que no calzara a la primera. Se
quitó.

Lo que falta es todo en el panel de Meta:

1. **Crear la app de Instagram**, aparte de la de WhatsApp. Es a propósito: un
   rechazo de Instagram no puede tocar WhatsApp, que es lo que da ingresos hoy.
2. **Configurar Login de Instagram** (no el de Facebook) y pedir los permisos
   `instagram_business_basic` e `instagram_business_manage_messages`.
3. **Webhook**: `https://respondo-portal.vercel.app/api/instagram/webhook`, con
   el verify token que definas.
4. **Variables en Vercel**: `IG_VERIFY_TOKEN`, `IG_APP_SECRET`, `IG_TOKEN`.
5. **Enviar a revisión.** La verificación del negocio ya está hecha y se hereda
   del portafolio; solo se revisa la app.

**Límite del canal que hay que tener claro antes de vender Instagram:** la
ventana de 24 horas de Instagram **no tiene plantillas** para reabrirse. Beto no
puede hacer seguimiento por este canal. Hay que decidir si se le avisa al
cliente o si Beto simplemente no opera en Instagram.

**Mi recomendación:** deja Instagram para después de que WhatsApp coexistencia
esté andando. No por lo técnico, sino para no tener dos colas de revisión de
Meta en paralelo y que un rechazo confunda de cuál venía.
