# Marketing — lo que depende de ti

Todo lo que se podía construir sin credenciales externas está construido y probado.
Esto es lo único que no puedo hacer yo, ordenado por prioridad.

**Lo importante antes de empezar:** Marketing **ya sirve sin nada de esto**. De dónde viene cada
venta, qué anuncio trae gente que no cierra y quién llegó por cada aviso se ve desde el primer
día; el estudio creativo y el copiloto funcionan con la llave de Gemini que ya está en Vercel.
Lo de abajo hace que se puedan **guardar** creatividades y campañas, agrega el **costo** y hace
que **Meta aprenda** de tus resultados.

**Estado al 14-sep-2026:** la 302 está aplicada, las tres variables de Meta están en Vercel y la
cuenta «Cecilia Roa» está conectada en Estética Aurora. Lo que queda pendiente es lo marcado
como P0 abajo (la 303) y los puntos 2 a 4.

---

## Fase 6 (14-sep-2026) — Google Ads como segundo canal

Marketing ya no supone que el negocio tiene WhatsApp. **AyP Abogados puede usarlo desde el
primer día con sólo Meta conectado**, y no le aparecen secciones vacías: el producto detecta
qué señales hay y se adapta solo. Eso ya está andando y **no depende de nada de lo de abajo**.

Lo de abajo es lo que hace falta para que **Google Ads** lea de verdad. Sin esto, la tarjeta de
Google en `/marketing/integraciones` dice «Requiere configuración» —que es su estado real— y el
resto de Marketing funciona igual.

---

### G1. Aplicar la migración `sql/309_ads_google_y_planes.sql`

**Qué:** correr esa migración en Supabase.

**Por qué:** agrega `cuenta_padre_id` (la cuenta administradora por la que hay que entrar para
leer una cuenta que cuelga de un MCC) y las columnas `canal` y `plan` donde el Arquitecto guarda
el plan de campaña. Sin ella, Google se conecta igual salvo cuentas bajo un MCC, y el Arquitecto
arma y muestra el plan pero no lo puede guardar.

**Dónde:** Supabase → SQL Editor → **pestaña nueva con el `+`** (si reusas una vieja puede estar
apuntando al motor de logs y tira «Backend error»).

**Qué valor copiar:** el contenido completo del archivo `sql/309_ads_google_y_planes.sql`.

**Dónde pegarlo:** en esa pestaña del SQL Editor, y apretar Run.

**Cómo verificar:** la consulta del final tiene que devolver `cuenta_padre = 1`, `datos = 1`,
`plan = 1`, `canal = 1`. Después, en `/marketing/arquitecto`, diseña una campaña y apreta
«Guardar plan»: tiene que abrirse su ficha sin aviso de migración faltante.

**Es aditiva.** No modifica ninguna migración ya aplicada y conserva todos los estados viejos de
`ed_mk_campanas`: ninguna fila existente queda inválida.

---

### G2. Crear el proyecto de Google Cloud y el cliente OAuth

**Qué:** un proyecto nuevo en Google Cloud con un **ID de cliente OAuth de tipo aplicación web**.

**Por qué —y por qué NO reusar el de la Agenda:** el proyecto que ya usa Respondo para Google
Calendar está publicado y verificado. Agregarle el scope `https://www.googleapis.com/auth/adwords`
**reabre su verificación**, y mientras Google la revisa la Agenda queda sin publicar. Son dos
proyectos a propósito, no por descuido.

**Dónde:** console.cloud.google.com → selector de proyecto arriba → **Proyecto nuevo** →
nombre sugerido `Respondo Ads`. Después, dentro de ese proyecto:
APIs y servicios → **Pantalla de consentimiento de OAuth** (tipo Externo, nombre «Respondo»,
correo de asistencia el tuyo) → y luego **Credenciales** → Crear credenciales → **ID de cliente
de OAuth** → tipo **Aplicación web**.

**Qué valor copiar:** en «URI de redireccionamiento autorizados», agregar exactamente:

```
https://respondo-portal.vercel.app/api/ads/google/callback
```

⚠️ Sin barra final, y con `https`. Si además vas a probar en tu máquina, agrega una segunda
línea con `http://localhost:3000/api/ads/google/callback`.

**Dónde pegarlo:** en el campo «URI de redireccionamiento autorizados» de esa pantalla.

**Cómo verificar:** al guardar, Google te muestra un **Id. de cliente** (termina en
`.apps.googleusercontent.com`) y un **Secreto del cliente**. Los necesitas en G4.

⚠️ En «Público» de la pantalla de consentimiento, **agrégate como usuario de prueba** con tu
correo mientras la app esté en modo de prueba. Si no, Google te rechaza con «acceso bloqueado».

---

### G3. Subir el nivel de acceso del proyecto (esto reemplaza al «developer token»)

**Qué:** pedirle a Google que tu proyecto de Cloud pueda leer **cuentas reales**.

⚠️ **Ojo con lo que vas a encontrar buscando.** Hasta el **9 de septiembre de
2026** esto se hacía pidiendo un «token de desarrollador» en el **Centro de API**
de una cuenta administradora de Google Ads. **Google apagó ese sistema.** Casi
todos los tutoriales que vas a encontrar —y varias librerías— siguen explicando
el camino viejo. Si entras al Centro de API, la propia pantalla te dice que las
solicitudes ya no se procesan.

**Por qué:** ahora el nivel de acceso es una propiedad del **proyecto de Google
Cloud** que creaste en G2. Un proyecto recién habilitado queda en nivel
**Prueba**, que sólo responde cuentas de prueba: con ese nivel la conexión
funciona pero la cuenta de Impresora devuelve vacío.

**Dónde:** console.cloud.google.com → tu proyecto `Respondo Ads` → buscar
**«Google Ads API»** en el buscador de arriba → **Habilitar** → y después, en la
página **Descripción general (Overview)** de esa API, abrir la sección
**«Upgrade access level» / «Subir nivel de acceso»**.

**Qué valor copiar:** nada que copiar. Se aprieta **«Apply for access»** y se
completa un formulario corto. Cuando pregunte para qué la vas a usar, algo así:

> «Respondo reads advertising performance and, with customer authorization, can
> create and manage Google Search campaigns (always created paused).»

⚠️ Corregido el 22-sep-2026: antes decía «sólo lectura», y desde que existe el
publicador de campañas de Búsqueda eso ya no es cierto. Lo que se declara a
Google tiene que ser lo que el producto hace. (Al 22-sep la solicitud de
Explorer se resetea sola sin pedir ningún texto; ver
`docs/GOOGLE_ADS_EXPLORER_SUPPORT_PACKET.md`.)

**Dónde pegarlo:** en ese formulario de la consola de Cloud.

**Qué nivel pedir:**

| Nivel | Cuentas reales | Tope diario | Qué exige |
|---|---|---|---|
| Prueba | no | 15.000 | es lo que tienes al habilitar |
| **Explorer** | **sí** | 2.880 | nada más — automático |
| Basic | sí | 15.000 | verificación de marca (se aprueba en minutos) |
| Standard | sí | sin tope | revisión manual, ~10 días hábiles |

⭐ **Con Explorer te alcanza para partir.** 2.880 operaciones al día es muchísimo
para leer una o dos cuentas. Pide **Basic** sólo cuando tengas varios clientes;
lo único que agrega es la verificación de marca del proyecto, que se aprueba en
minutos. **Standard no lo necesitas.**

**Cómo verificar:** en esa misma página de Descripción general, el nivel de
acceso del proyecto tiene que dejar de decir «Test». Y en Respondo, si conectas
antes de tenerlo, la pantalla no miente: traduce el error de Google y te dice
**«el proyecto de Google Cloud todavía tiene acceso de prueba»**, en vez de
mandarte a revisar permisos que están bien.

---

### G4. Pegar las variables en Vercel

**Qué:** dos variables obligatorias y una opcional.

**Por qué:** son las credenciales que el código exige antes de siquiera mostrar
el botón «Conectar Google Ads». Mientras falte alguna, la tarjeta dice su estado
real.

**Dónde:** Vercel → proyecto `respondo-portal` → **Settings** → **Environment Variables**.

**Qué valor copiar y dónde pegarlo:**

| Variable | Valor | De dónde sale | ¿Obligatoria? |
|---|---|---|---|
| `GOOGLE_ADS_CLIENT_ID` | el Id. de cliente | G2 | **sí** |
| `GOOGLE_ADS_CLIENT_SECRET` | el Secreto del cliente | G2 | **sí** |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | el número de tu cuenta administradora de Google Ads, **sólo dígitos** (`1234567890`, sin guiones) | ads.google.com, arriba a la derecha | sólo si las cuentas de tus clientes cuelgan de tu MCC |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | — | — | **no. No la pongas** |

⚠️ **`GOOGLE_ADS_DEVELOPER_TOKEN` ya no hace falta.** El código la acepta si
existe (y la manda, porque no cuesta nada), pero Google la ignora desde el
9-sep-2026. No pierdas tiempo consiguiéndola.

⚠️ **Ninguna** lleva el prefijo `NEXT_PUBLIC_`. Con ese prefijo se publicarían en
el navegador de cualquiera que abra el portal.

⚠️ Después de agregarlas hay que hacer **Redeploy**: las variables no se aplican
al deploy que ya está corriendo.

**Cómo verificar:** entra a `/marketing/integraciones`. La tarjeta de Google Ads
tiene que dejar de decir «Requiere configuración» y mostrar el botón **Conectar
Google Ads**.

---

### G4-bis. PUBLICAR LA APP — sin esto, la conexión se cae cada 7 días

⚠️ **Esto faltaba en este documento y no es opcional.** Se descubrió el
15-sep-2026, montando el proyecto de verdad.

**Qué:** cambiar el estado de publicación de la app de OAuth de **Prueba** a
**En producción**, en *Google Auth Platform → Público → Publicar app*.

**Por qué:** Google lo dice con todas las letras en su documentación:

> «A Google Cloud Platform project with an OAuth consent screen configured for
> an external user type and a publishing status of "Testing" is issued a refresh
> token expiring in 7 days»

y en la ayuda de la consola:

> «Authorizations by a test user will expire seven days from the time of
> consent. If your OAuth client requests an `offline` access type and receives a
> refresh token, that token will also expire.»

Respondo guarda exactamente ese refresh token. Con la app en **Prueba**, la
conexión de Google Ads de cada cliente se muere a los siete días y hay que
reautorizar a mano. El portal lo va a decir bien —«el permiso venció, hay que
volver a autorizarlo»— pero es un parche que dura otra semana.

La excepción de Google no aplica acá: solo vale si los únicos permisos pedidos
son nombre, correo y perfil. `adwords` no es ninguno de esos.

**«Interno» no es una salida.** Ese modo no tiene el vencimiento de 7 días, pero
exige Google Workspace y que TODOS los usuarios sean de la misma organización.
Los clientes conectan con cuentas `@gmail.com`, así que está descartado —en la
consola el botón «Marcar como interno» aparece deshabilitado, por eso mismo—.

**Dónde:** *Google Auth Platform → Público → Publicar app*.

**Qué necesitas antes:** el botón está deshabilitado hasta completar
*Información de la marca*: nombre de la app, correo de asistencia, **página
principal**, **política de privacidad**, **condiciones del servicio** y
**dominios autorizados**.

⚠️ **`respondo-portal.vercel.app` NO sirve como dominio autorizado.** Google
exige un dominio que puedas verificar como tuyo en Search Console, y `vercel.app`
es un dominio compartido de Vercel. Usa **`respondo.cl`**, que sí es de Respondo,
y verifícalo primero en Search Console. Las URIs de redirección del cliente OAuth
pueden seguir apuntando a `vercel.app`: son cosas distintas.

**Sobre la verificación:** `adwords` es un permiso **sensible**, y la
documentación de verificación de Google dice que las apps que piden permisos
sensibles «must complete Google's OAuth app verification before being granted
access». Lo que NO pude confirmar en la documentación oficial es qué pasa
exactamente con una app publicada pero **sin** verificar —si funciona igual
mostrando la pantalla de «Google no verificó esta app», que es el
comportamiento que se observa en la práctica, o si queda bloqueada—. **No lo des
por hecho:** publica, intenta conectar, y si aparece esa pantalla de advertencia,
entra por *Configuración avanzada → Ir a Respondo (no seguro)*. Si en cambio te
bloquea, hay que completar la verificación antes de seguir.

**Cómo verificar:** en *Público*, el estado de publicación tiene que decir **En
producción** y no **Prueba**. Y la prueba de verdad: una conexión que siga viva
ocho días después.

---

### G5. Conectar la cuenta de Impresora Color

**Qué:** apretar el botón y elegir la cuenta.

**Por qué:** es el único paso que no puedo hacer yo, porque abre el diálogo de Google con tu
sesión.

**Dónde:** `/marketing/integraciones`, botón **Conectar Google Ads**, entrando como Impresora
Color.

**Qué valor copiar:** nada. Google te va a mostrar la lista de cuentas a las que tienes acceso.

**Dónde pegarlo:** elige la cuenta de **Impresora Color**. ⚠️ **Las cuentas administradoras no
aparecen en la lista** y es a propósito: un MCC no tiene campañas propias, y elegirlo es el error
más común de esta integración.

**Cómo verificar:** la tarjeta queda en verde con el nombre de la cuenta, y abajo aparece la
**prueba de lectura real** (gasto y clics de los últimos días, traídos de Google en vivo). Si esa
prueba falla, la tarjeta lo dice con el motivo; **nunca dice «conectado» sin haber leído**.

Después, `/marketing/busqueda` se llena con los términos de búsqueda reales y `/marketing` empieza
a mostrar las campañas de Google junto a las de Meta.

---

### Lo que NO necesitas hacer para Google

- **Nada para AyP Abogados.** Sólo Meta, que ya está conectado. Google es para Impresora.
- **No pidas `adwords` con acceso de escritura.** Respondo **no publica ni modifica** campañas en
  Google, igual que no lo hace en Meta. Lee, analiza, recomienda y deja el plan listo para pegar.
- **No hace falta verificación de la app de Google** mientras seas tú quien conecta las cuentas.
  El día que un cliente distinto conecte la suya van a faltar el logo y la política de privacidad
  publicada — lo mismo que ya está anotado para Meta.
- **Nada para el Arquitecto de campañas ni para las recomendaciones.** Funcionan con la
  `GEMINI_API_KEY` que ya está en Vercel, y el motor de recomendaciones **no usa modelo**: es
  determinista.

---

## P0 — Bloquea guardar creatividades y campañas

### Aplicar la migración `sql/303_marketing.sql`

**Por qué:** crea `ed_mk_creatividades` y `ed_mk_campanas` (lo que el negocio escribe en el
estudio y en el asistente) y el bucket público `creatividades` para las imágenes generadas.
Sin ella se puede generar texto e imagen y ver la vista previa, pero al apretar «Guardar» la
pantalla dice que falta la migración. Las pantallas de Campañas, Estudio creativo, Nueva
campaña y Nueva creatividad muestran un aviso mientras no esté.

**Dónde:** Supabase → SQL Editor → pestaña nueva con el `+`.

**Qué copiar:** el contenido completo de `sql/303_marketing.sql`.

**Cómo verificar:** la consulta del final tiene que devolver `creatividades = 1`,
`campanas = 1` y `bucket = 1`. Después, en `/marketing/creatividades/nueva`, genera una
creatividad y guárdala: tiene que abrirse su ficha con el aviso «Creatividad guardada».

**Si no la aplicas:** el resto de Marketing funciona igual (inicio, campañas de Meta,
atribución, personas, copiloto, demo).

---

## P0 (ya aplicada) — Migración `sql/302_ads.sql`

**Por qué:** crea la tabla donde se guarda la cuenta publicitaria conectada y la cola de
conversiones. Sin ella, la pantalla de Conexión no puede guardar nada.

**Dónde:** Supabase → SQL Editor → pestaña nueva con el `+` (si reusas una vieja puede estar
apuntando al motor de logs y tira «Backend error»).

**Qué copiar:** el contenido completo de `sql/302_ads.sql`.

**Cómo verificar:** la consulta del final tiene que devolver `conexion = 1`, `eventos = 1` y
`dataset = 1`.

**Si no la aplicas:** el resto de Marketing funciona igual. La pantalla de Integraciones muestra el
checklist pero no puede conectar Meta.

---

## P1 — Necesario para ver el gasto

### 1. Pegar las credenciales de la app de Meta en Vercel

**Ya está hecho todo lo demás.** El 10-sep configuré la app contigo: se llama **Respondo Ads**,
identificador `1771222117337476`, con el caso de uso de la API de marketing, la URI de
redireccionamiento cargada, la categoría puesta y el «ajuste» de inicio de sesión creado. La
verificación de empresa del portafolio Respondo ya estaba completa.

**Lo único que falta es esto, porque no manipulo claves en texto plano:**

Configuración → Básica → copiar el **Identificador** y la **Clave secreta** («Mostrar»), y
ponerlas en Vercel → proyecto `respondo-portal` → Settings → Environment Variables:

| Variable | Valor |
|---|---|
| `META_ADS_APP_ID` | `1771222117337476` |
| `META_ADS_APP_SECRET` | la clave secreta de Configuración → Básica |
| `META_ADS_CONFIG_ID` | `1059116083654119` |

⚠️ `META_ADS_APP_SECRET` **no** lleva el prefijo `NEXT_PUBLIC_`. Con ese prefijo se publicaría en
el navegador de cualquiera que abra el portal.

⚠️ Después de agregarlas hay que hacer **Redeploy**: las variables no se aplican al deploy que ya
está corriendo.

**Por qué son tres y no dos.** Este tipo de app usa «Inicio de sesión con Facebook para empresas»,
donde los permisos NO viajan en la URL: viven en un ajuste que se referencia por su identificador.
Lo probé a mano: **sin el `config_id`, el diálogo de Meta abre sin error y dice «Respondo Ads
recibirá tu nombre y foto de perfil»** — el token vuelve sin acceso a ninguna cuenta publicitaria,
la pantalla diría «conectada» y el gasto nunca aparecería. Un fallo que no da error es peor que uno
que sí. El código ahora exige las tres variables antes de mostrar el botón.

**Cómo se configuró el ajuste, para que quede escrito:**

| Opción | Elegido | Por qué |
|---|---|---|
| Variación | General | No es el registro insertado de WhatsApp |
| Identificador de acceso | **Usuario del sistema** | Da acceso continuo a las cuentas publicitarias |
| Caducidad | **Nunca** | Un token de 60 días obliga a cada negocio a reconectar cada dos meses, y entre medio el costo se apaga sin aviso. El permiso es de solo lectura y se guarda cifrado |
| Activos | Solo **cuentas publicitarias**, obligatorio | Nada de páginas, catálogos, píxeles ni Instagram |
| Permiso de tarea | **ANALYZE** | «Acceder a informes y ver anuncios». Meta pone **MANAGE** por defecto y eso sí deja tocar campañas — se cambió a mano |
| Permisos | `ads_read`, `business_management` | Sin `ads_management` |

**Cómo verificar:** entra a `/marketing/integraciones`. El texto «todavía no está habilitada» tiene que
desaparecer y aparecer el botón **Conectar Meta**. Al apretarlo, Meta tiene que mostrarte una
pantalla que dice **«Selecciona los activos comerciales…»** con el portafolio y la cuenta
publicitaria. Si en cambio solo dice «recibirá tu nombre y foto de perfil», falta el
`META_ADS_CONFIG_ID`.

---

### 2. Pedir acceso avanzado para devolverle las ventas a Meta

**Por qué:** es lo que hace que Meta reparta tu presupuesto hacia los avisos que traen
compradores en vez de hacia los que traen conversaciones. Toda la infraestructura está escrita y
probada (la cola, la deduplicación, los reintentos, el hash del teléfono).

**Verificado el 10-sep en la documentación oficial de Meta** (Conversions API for Business
Messaging). Hacen falta **tres cosas**, no una:

| Qué | Dónde se pide |
|---|---|
| Acceso avanzado a `whatsapp_business_management` | Permisos y funciones de tu app de WhatsApp |
| Acceso avanzado a `whatsapp_business_manage_events` | Lo mismo |
| **Ads Management Standard Access** | Se gana con uso: **1.500 llamadas exitosas a la Marketing API en 15 días, con menos de 10% de error** |

⚠️ **El tercero es el que manda.** No se pide con un formulario: se acumula usando la API. Y las
llamadas que hace Marketing para leer el gasto **cuentan**, así que la forma de conseguirlo es tener la
acción 1 andando y dejarla correr. No es trabajo tuyo, es tiempo.

**Dónde:** developers.facebook.com → tu app de WhatsApp (la que ya existe, no la nueva) →
**Permisos y funciones** → buscar los dos permisos y apretar «Solicitar acceso avanzado».

**Cómo verificar:** con los permisos concedidos, los eventos empiezan a pasar de «por enviar» a
«enviados» en `/marketing/integraciones`.

⚠️ **Lo más importante de este punto:** la documentación dice textualmente que **Meta NO deduplica
los eventos** de esta API — «we highly encourage advertisers to perform deduplication before
sending them». O sea que el `evento_id` determinista y la llave única de la tabla no son una
precaución: son obligatorios. Sin eso, la misma venta contada dos veces le enseña a Meta un número
falso y el presupuesto se reparte mal. Ya está resuelto en el código.

**Si esto resulta caro o lento:** el resto de Marketing no depende de esto.

---

## P2 — Cuando lo anterior esté

### 3. El identificador del conjunto de datos, por cada cliente

**Por qué:** es la dirección a la que se le mandan las conversiones. Sin él, los eventos se
encolan y no salen (que es el estado correcto, no un error).

**Hay dos caminos, y el segundo es mejor:**

*a) A mano, desde Meta.* Administrador de Eventos → el conjunto de datos asociado a la cuenta de
WhatsApp del cliente → copiar el identificador (un número largo).

*b) Pidiéndoselo a la API.* Verificado en la documentación oficial: se crea con **una sola
llamada**, usando el identificador de la cuenta de WhatsApp del cliente y su token:

```
POST https://graph.facebook.com/v21.0/{WABA_ID}/dataset
```

Devuelve el `dataset_id` directamente. Necesita los mismos permisos de la acción P1.2.

⭐ **Decisión tomada:** por ahora el campo se pega a mano. **En cuanto el permiso esté concedido
reemplazo el campo por un botón** que hace esa llamada y guarda el número solo. No lo construyo
antes porque no habría forma de probarlo.

**Dónde ponerlo mientras tanto:** `/marketing/integraciones`, campo «Identificador del conjunto de datos».
Es por negocio, no global.

**Cómo verificar:** el checklist marca «Devolverle las ventas a Meta» en verde, y abajo aparecen
las píldoras con el estado de la cola.

---

### 4. Configurar el enlace de pago en los clientes que no lo tengan

**Por qué:** sin él, Marketing puede decir cuántas ventas trajo cada anuncio, pero no cuánta plata.
Es lo que convierte «14 ventas» en «$890.000», y sin eso el retorno no se puede calcular.

**Dónde:** `/informacion` de cada cliente.

**Cómo verificar:** la columna «Cobrado» de `/marketing/atribucion` deja de estar en raya.

---

## Lo que NO necesitas hacer

- **Business Verification**: ya está hecha. El portafolio Respondo aparece como «Verificación de
  la empresa y el acceso completada».
- **Revisión de la aplicación**: no la necesitas todavía. En modo desarrollo la app funciona con
  tus propias cuentas publicitarias; la revisión recién hace falta el día que un cliente distinto
  de ti conecte la suya. Para ese día van a faltar el ícono de 1024x1024 y la URL de la política
  de privacidad publicada (que además es lo mismo que pide la ley 21.719 en diciembre).
- **Publicar campañas desde Respondo (`ads_management`)**: no está pedido a propósito. Exige
  revisión de app y abre la puerta a cambiar presupuestos por error. El asistente arma la campaña
  completa y la deja lista para pegar en Meta («Copiar configuración» + «Continuar en Meta»);
  el estado «Publicada» está reservado en la base para cuando exista el permiso, y ninguna
  pantalla lo escribe a mano. Si algún día lo quieres, el cambio es una constante
  (`PUEDE_PUBLICAR`) en `app/(marketing)/marketing/campanas/acciones.ts` más el permiso.
- **Nada para el estudio creativo ni el copiloto**: usan `GEMINI_API_KEY` que ya está en Vercel
  (texto con `gemini-2.5-flash`, imagen con `gemini-2.5-flash-image`; verificado con tu llave:
  ~5 s y ~90 KB por imagen). Si alguna vez quieres cortar el gasto de imágenes, basta con quitar
  la llave: el estudio sigue funcionando sin imagen y lo dice.
- **Nada para la demo**: «Datos de demostración» es un interruptor abajo a la izquierda del riel,
  dura un día, no toca la base y sirve para mostrar el producto completo (Gráfica Andina) a un
  prospecto sin conectar nada.
- **Método de pago en la app de Meta**: leer no cuesta.
- **Nada para que funcione la atribución.** Esa parte ya está andando.
