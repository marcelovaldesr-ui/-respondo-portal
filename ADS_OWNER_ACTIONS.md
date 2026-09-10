# Marketing — lo que depende de ti

Todo lo que se podía construir sin credenciales externas está construido y probado.
Esto es lo único que no puedo hacer yo, ordenado por prioridad.

**Lo importante antes de empezar:** Marketing **ya sirve sin nada de esto**. De dónde viene cada
venta, qué anuncio trae gente que no cierra y quién llegó por cada aviso se ve desde el primer
día; el estudio creativo y el copiloto funcionan con la llave de Gemini que ya está en Vercel.
Lo de abajo hace que se puedan **guardar** creatividades y campañas, agrega el **costo** y hace
que **Meta aprenda** de tus resultados.

**Estado al 10-sep-2026:** la 302 está aplicada, las tres variables de Meta están en Vercel y la
cuenta «Cecilia Roa» está conectada en Estética Aurora. Lo que queda pendiente es lo marcado
como P0 abajo (la 303) y los puntos 2 a 4.

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
