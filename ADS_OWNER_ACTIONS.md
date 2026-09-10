# Pauta — lo que depende de ti

Todo lo que se podía construir sin credenciales externas está construido y probado.
Esto es lo único que no puedo hacer yo, ordenado por prioridad.

**Lo importante antes de empezar:** Pauta **ya sirve sin nada de esto**. De dónde viene cada
venta, qué anuncio trae gente que no cierra y quién llegó por cada aviso se ve desde el primer
día. Lo de abajo agrega el **costo** y hace que **Meta aprenda** de tus resultados.

---

## P0 — Bloquea la sección de conexión

### Aplicar la migración `sql/302_ads.sql`

**Por qué:** crea la tabla donde se guarda la cuenta publicitaria conectada y la cola de
conversiones. Sin ella, la pantalla de Conexión no puede guardar nada.

**Dónde:** Supabase → SQL Editor → pestaña nueva con el `+` (si reusas una vieja puede estar
apuntando al motor de logs y tira «Backend error»).

**Qué copiar:** el contenido completo de `sql/302_ads.sql`.

**Cómo verificar:** la consulta del final tiene que devolver `conexion = 1`, `eventos = 1` y
`dataset = 1`.

**Si no la aplicas:** el resto de Pauta funciona igual. La pantalla de Conexión muestra el
checklist pero no puede conectar Meta.

---

## P1 — Necesario para ver el gasto

### 1. Crear la aplicación de Meta para Pauta

**Por qué:** para leer cuánto se gastó en cada anuncio hace falta una app de Meta con Login de
Facebook. Sin esto, Pauta muestra los resultados pero no el costo, y las métricas de gasto
aparecen como «no disponible» en vez de como cero (a propósito).

**Dónde:** [developers.facebook.com](https://developers.facebook.com) → Mis aplicaciones → Crear
aplicación → tipo **Empresa**.

Dentro de la app:

1. Agregar el producto **Inicio de sesión con Facebook**.
2. En su configuración, agregar esta **URI de redireccionamiento válida**:
   `https://respondo-portal.vercel.app/api/ads/callback`
   ⚠️ Tiene que ser **exacta**, con `https` y sin barra final. Un `/` de más es el error que nos
   costó una tarde con el OAuth de Google.
3. En **Permisos y funciones**, pedir acceso a `ads_read` y `business_management`.
   ⚠️ **NO pidas `ads_management`.** Respondo no crea, no pausa ni cambia presupuestos —
   pedirlo alargaría la revisión para una capacidad que decidimos no construir.

**Qué copiar:** el **Identificador de la aplicación** y la **Clave secreta** (Configuración →
Básica).

**Dónde ponerlo:** Vercel → proyecto `respondo-portal` → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `META_ADS_APP_ID` | el identificador de la app |
| `META_ADS_APP_SECRET` | la clave secreta |

⚠️ `META_ADS_APP_SECRET` **no** lleva el prefijo `NEXT_PUBLIC_`. Con ese prefijo se publicaría en
el navegador de cualquiera que abra el portal.

**Cómo verificar:** entra a `/pauta/conexion`. El texto «todavía no está habilitada» tiene que
desaparecer y en su lugar aparecer el botón **Conectar Meta**. Apretarlo te lleva a Meta, y al
volver deberías ver tu cuenta publicitaria con su moneda y su zona horaria.

---

### 2. Averiguar qué exige `whatsapp_business_manage_events`

**Por qué:** es el permiso que hace falta para devolverle a Meta las ventas que ocurren en
WhatsApp. Toda la infraestructura está escrita y probada (la cola, la deduplicación, los
reintentos, el hash del teléfono), pero **no puedo confirmar el requisito sin entrar a la
consola de la app**. La documentación de Meta menciona además *Ads Management Standard Access*
—1.500 llamadas con menos de 10% de error en 15 días— y **no lo pude verificar en una segunda
fuente oficial**.

**Dónde:** developers.facebook.com → tu app de WhatsApp (la que ya existe, no la nueva) →
**Permisos y funciones** → buscar `whatsapp_business_manage_events`.

**Qué mirar:** si dice «Acceso avanzado disponible» o si exige una revisión previa.

**Cómo verificar:** con el permiso concedido, en `/pauta/conexion` pegas el identificador del
conjunto de datos y los eventos empiezan a pasar de «por enviar» a «enviados».

**Si esto resulta caro:** avísame y lo evaluamos. El resto de Pauta no depende de esto.

---

## P2 — Cuando lo anterior esté

### 3. El identificador del conjunto de datos, por cada cliente

**Por qué:** es la dirección a la que se le mandan las conversiones. Sin él, los eventos se
encolan y no salen (que es el estado correcto, no un error).

**Dónde:** Meta → Administrador de Eventos → el conjunto de datos asociado a la cuenta de
WhatsApp del cliente → copiar el identificador (un número largo).

**Dónde ponerlo:** `/pauta/conexion`, campo «Identificador del conjunto de datos». Es por
negocio, no global.

**Cómo verificar:** el checklist marca «Devolverle las ventas a Meta» en verde, y abajo aparecen
las píldoras con el estado de la cola.

---

### 4. Configurar el enlace de pago en los clientes que no lo tengan

**Por qué:** sin él, Pauta puede decir cuántas ventas trajo cada anuncio, pero no cuánta plata.
Es lo que convierte «14 ventas» en «$890.000», y sin eso el retorno no se puede calcular.

**Dónde:** `/informacion` de cada cliente.

**Cómo verificar:** la columna «Cobrado» de `/pauta/anuncios` deja de estar en raya.

---

## Lo que NO necesitas hacer

- **Business Verification**: no hace falta para `ads_read` en modo desarrollo con tus propias
  cuentas. Sí va a hacer falta el día que un cliente distinto de ti conecte la suya.
- **Método de pago en la app de Meta**: leer no cuesta.
- **Nada para que funcione la atribución.** Esa parte ya está andando.
