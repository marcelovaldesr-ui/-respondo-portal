# Instagram Direct — lo que falta hacer a mano

Estado del código: **listo y probado**. Lo que sigue es todo en el panel de Meta
y en Vercel.

---

## Antes que nada: ¿esto afecta la revisión de WhatsApp?

**No, si Instagram va en una app aparte.** Y esa es la recomendación.

- La **verificación del negocio** (los ~20 días que estás esperando) se hace
  sobre el **portafolio comercial**, no sobre la app. Una vez aprobada, sirve
  para todas las apps de ese portafolio — incluida la de Instagram. No se
  duplica el trámite ni se reinicia.
- La **revisión de la app** sí es por app y por permiso. Manteniéndolas
  separadas, un rechazo de Instagram no toca la app de WhatsApp, que es la que
  hoy genera los ingresos.
- Sí conviene **verificar en el panel** que el portafolio es el mismo. Si la
  app de Instagram queda colgando de otro portafolio, la verificación no se
  hereda y arrancas de cero.

> Riesgo asumido: no encontré documentación de Meta que diga si se puede tener
> dos revisiones en curso a la vez. Por eso lo de la app aparte no es solo
> higiene — es lo que hace que la pregunta deje de importar.

---

## Decisión técnica que ya tomé por ti

Meta ofrece **dos caminos** para los DMs y elegí el segundo:

| | Login de Facebook | **Login de Instagram** ✅ |
|---|---|---|
| Página de Facebook | **Obligatoria** y vinculada | No hace falta |
| Permisos a aprobar | 4 | **2** |
| Cómo conecta el cliente | Con su Facebook | Con su Instagram |

**Por qué:** en una pyme chilena la página de Facebook suele estar abandonada, a
nombre de un ex empleado o de la agencia que les hizo el logo. Pedirle al dueño
de una automotora que recupere el acceso a una página que no usa, para conectar
el Instagram que sí usa todos los días, mata la venta en la reunión.

---

## Paso 1 — Aplicar la migración

En el editor SQL de Supabase, pegar **`sql/271_instagram.sql`**.

Agrega `ig_user_id`, `ig_token`, `ig_token_vence` a `ed_clientes`. Sin esto,
Instagram no puede funcionar para más de un negocio.

---

## Paso 2 — Crear la app en Meta

1. developers.facebook.com → **Crear app** → tipo **Negocio**.
2. Asociarla al **mismo portafolio comercial** que la de WhatsApp. ← importante
3. Agregar el producto **Instagram** → *API de Instagram con inicio de sesión de
   Instagram*.
4. Anotar el **ID de app de Instagram** y el **secreto de app de Instagram**
   (están en esa misma sección, no arriba en la app de Meta).

---

## Paso 3 — Variables en Vercel

| Variable | De dónde sale |
|---|---|
| `IG_APP_SECRET` | Secreto de la app de Instagram (paso 2) |
| `IG_VERIFY_TOKEN` | Lo inventas tú. Cualquier texto largo al azar |
| `IG_TOKEN` | Token de la cuenta de pruebas (paso 5). Solo para probar |

> `IG_APP_SECRET` **no es opcional**: si falta, el webhook rechaza todo. Es a
> propósito. Un webhook abierto permite que un tercero haga que el asistente le
> escriba a cuentas arbitrarias desde el Instagram del cliente.

Después de agregarlas: **volver a desplegar**, si no Vercel no las toma.

---

## Paso 4 — Webhook

En la app → Instagram → Webhooks:

- **URL de devolución de llamada:** `https://<tu-dominio>/api/instagram/webhook`
- **Token de verificación:** el mismo `IG_VERIFY_TOKEN`
- **Campo a suscribir:** `messages`

Meta hace un GET al momento de guardar. Si responde bien, queda verde de
inmediato. Si no, revisar que el despliegue con las variables ya haya terminado.

---

## Paso 5 — Conectar tu Instagram de prueba

La cuenta tiene que ser **profesional** (Empresa o Creador). Una cuenta personal
no recibe DMs por API.

Del flujo de conexión sacas dos datos que hay que guardar en la base:

```sql
update ed_clientes
set ig_user_id = '<ID de la cuenta profesional>',
    ig_token   = '<token de larga duración>',
    ig_token_vence = now() + interval '60 days'
where nombre = 'Impresora Color';
```

> El token dura **60 días**. El cron lo renueva solo cuando quedan menos de 15.
> Sin eso, el canal se apagaría en silencio a los dos meses: las conversaciones
> siguen entrando, el asistente "responde", y los mensajes no llegan a nadie.

---

## Paso 6 — Probar

```bash
npx tsx scripts/_test_instagram.ts
```

Prueba el camino completo contra la base con el envío simulado. Después:
mandarle un DM real a la cuenta desde otro teléfono y ver que Tino conteste.

---

## Paso 7 — Enviar a revisión

Permisos a pedir: **`instagram_business_basic`** e
**`instagram_business_manage_messages`**.

Lo que hunde estas solicitudes, en orden:

1. **El revisor no puede probarlo.** Tiene que poder reproducir el flujo
   completo. El video no reemplaza esto.
2. **El caso de uso no se lee como atención al cliente.** `manage_messages` es
   estrictamente para conversación negocio↔cliente. Si suena a marketing masivo
   o a difusión, rechazo.
3. **El webhook no responde** al momento de la prueba.

**El video** debe mostrar, sin cortes: una persona manda un DM al Instagram del
negocio → aparece en el portal → el asistente responde → el dueño toma el
control y contesta él. Ese último tramo es el que demuestra que hay un negocio
real atendiendo, no un bot suelto.

**Sobre los 25 usuarios de prueba:** son personas con cuenta de desarrollador de
Meta a las que les das un rol en la app. **No son clientes.** No sirve para
vender el servicio antes de la aprobación — sí sirve para que José y Tomás
prueben con sus propios Instagram mientras esperamos.

---

## Riesgos que conviene tener a la vista

- **La ventana de 24 h no tiene plantillas.** En WhatsApp una conversación
  cerrada se reabre con una plantilla. En Instagram no: pasadas 24 h desde el
  último mensaje de la persona, no se le puede escribir y punto. Esto **rompe
  el seguimiento de Beto en este canal** — hay que decidir si se le avisa al
  dueño o si Beto simplemente no opera por Instagram.
- **La misma persona aparece dos veces** si escribe por WhatsApp y por
  Instagram. Es correcto: el IGSID no es un teléfono y no hay forma honesta de
  cruzarlos. Vale la pena que lo sepas antes de que un cliente lo pregunte.
- **Tope de DMs automáticos por hora.** Para el volumen de una pyme no es
  problema, pero conviene confirmarlo en la documentación antes de prometerle
  algo a un cliente con mucho tráfico.
