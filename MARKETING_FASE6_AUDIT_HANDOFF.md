# Marketing Fase 6 — handoff de auditoría

**Para:** el agente o la persona que audite esto después.
**No es un documento de venta.** Está escrito para que lo rompas. Cada sección
termina en lo que hay que intentar quebrar, y las decisiones discutibles están
marcadas como discutibles, no como aciertos.

Fecha: 14-sep-2026 · repo `respondo-portal` · Next 16.3.0 (Turbopack) · Supabase.

---

## 1. Qué problema se resolvió, y cuál era el problema real

Marketing existía desde la Fase 3 y estaba **construido sobre una suposición que
nadie había escrito**: que el negocio tenía WhatsApp conectado a Respondo. No era
una funcionalidad opcional, era el cimiento. El embudo iba de anuncio a venta
pasando por conversación; la atribución unía `ad_id` con un chat; el copiloto
tenía cinco herramientas y cuatro leían conversaciones; los KPI de la portada
eran conversaciones, ventas, ingresos y retorno.

Consecuencia: un negocio que sólo quiere publicidad —el caso de **AyP Abogados**,
que arranca el 15-sep— entraba a un producto lleno de ceros. No "sin datos
todavía": **ceros permanentes**, que es peor, porque enseñan que el producto está
roto.

La tesis de la Fase 6: **la publicidad se puede analizar con las señales que hay.
WhatsApp no es un prerrequisito, es una capa más de inteligencia.**

Tres niveles, de menor a mayor:

| Nivel | Señales | Qué se puede afirmar |
|---|---|---|
| Ads Intelligence | `ads` | gasto, alcance, clics, CTR, CPM, comparación entre campañas propias |
| Conversion Intelligence | `+ conversiones` | costo por resultado, qué campaña convierte, términos que valen |
| Revenue Intelligence | `+ conversaciones`, `+ ingresos` | atribución por persona, ROAS real, embudo completo |

**Qué intentar romper:** buscar cualquier lugar donde el producto siga asumiendo
la capa de arriba. `grep -rn "conversacion" app/\(marketing\)` y revisar que
ninguna aparición esté fuera de un `if` sobre señales.

---

## 2. Arquitectura — el mapa en una pantalla

```
lib/ads/canal.ts        ← vocabulario puro: Proveedor, Nivel, TipoResultado,
                          FilaRendimiento, ctr/cpc/cpm/costoPorResultado/roas,
                          sonComparables(), sumarResultados(), agregar()
lib/ads/senales.ts      ← modelo de capacidades: detectarSenales(hechos),
                          seccionesVisibles(), SENAL_QUE_EXIGE, motivoFaltante()
lib/ads/meta.ts         ← el único archivo que habla Graph API
lib/ads/google.ts       ← el único archivo que habla GAQL
lib/ads/canales.ts      ← registro de proveedores: rendimientoMulticanal(),
                          estadoDeCanales(), tolerancia a fallas por canal
lib/ads/analisis.ts     ← motor determinista: insights + recomendaciones
lib/marketing/embudoAdaptativo.ts ← arma sólo los escalones medibles
lib/marketing/arquitectoCore.ts   ← reglas puras del Arquitecto (sin red, sin IA)
lib/marketing/arquitecto.ts       ← orquesta: determinista → Gemini → sanea → revisa
lib/marketing/datos.ts            ← carga el Panorama (ya multicanal)
lib/marketing/tenant.ts           ← aislamiento por cliente (NO tocado, y a propósito)
```

Regla de dependencias: `canal.ts` y `senales.ts` **no importan nada**. `meta.ts`
y `google.ts` importan `canal.ts` pero no se conocen entre sí. `canales.ts` los
conoce a los dos y nadie más los llama directo desde una página.

**Qué intentar romper:** `grep -rn "from \"@/lib/ads/google\"" app/ components/`
— si una página importa el proveedor directo en vez de `canales.ts`, la
tolerancia a fallas de ese canal se perdió.

---

## 3. El modelo de señales (lo más importante de leer)

```ts
type Senal = "ads" | "conversiones" | "conversaciones" | "ingresos";
```

Se **detectan de hechos**, nunca de un modo guardado:

```ts
detectarSenales({
  hayCuentaPublicitaria,        // hay conexión activa y respondió
  plataformaReportaResultados,  // llegaron conversions/actions > 0
  hayConversacionesAtribuidas,  // hay chats con origen publicitario
  hayIngresosAtribuidos,        // hay pagos ligados a esos chats
})
```

**No existe un selector de modo. No existe una columna `modo` en la base.** Si
mañana AyP conecta WhatsApp, el producto crece solo; si Impresora desconecta
Google, encoge solo. Es la diferencia entre "configuración" y "capacidad", y es
deliberada: un modo guardado se desincroniza de la realidad el primer día.

Todo lo que se adapta consulta señales:

- el riel (`RielMarketing.tsx`) — «Personas» no existe sin `conversaciones`
- la franja de KPI — muestra costo por resultado en vez de ROAS
- el título del embudo — «Del anuncio al resultado» vs «Del anuncio a la venta»
- las columnas de la tabla de campañas
- las herramientas del copiloto (`Herramienta.exige?: Senal`)
- las preguntas sugeridas
- los destinos que ofrece el Arquitecto

**Discutible:** `seccionesVisibles()` devuelve `busqueda: false` siempre, porque
Búsqueda depende del **proveedor** (Google), no de una señal. Es una asimetría
real del modelo: las señales describen qué se puede medir, no qué plataformas
hay. Se resolvió con `canalesDisponibles()` aparte. Un auditor puede sostener
con razón que el modelo debería tener un solo eje.

**Qué intentar romper:** poner una cuenta con `ads` pero con conversiones en 0 y
verificar que en ninguna pantalla aparezca un «Costo por resultado: —» donde
debería no aparecer la columna. Y revisar que no exista ningún `localStorage`,
cookie o columna que recuerde el nivel.

---

## 4. Definiciones de métricas — dónde está el peligro real

**Lo único verdaderamente común entre Meta y Google es gasto, impresiones y
clics.** Todo lo demás miente si se normaliza.

```ts
type TipoResultado = "mensajes"|"leads"|"conversiones_web"|"compras"|"llamadas"|"desconocido";
sonComparables(a, b)  // false si alguno es desconocido, o si difieren
sumarResultados(rs)   // null si hay tipos mezclados — nunca un total inventado
```

Reglas que hay que verificar que se respetan en todas partes:

1. **No se suman resultados de tipos distintos.** 40 mensajes + 12 compras no son
   52 de nada.
2. **El alcance no se suma entre campañas.** Una persona alcanzada por dos
   campañas es una persona. `agregar()` devuelve `alcanceMinimo = max(...)`, no
   la suma, y el nombre del campo dice que es un piso.
3. **Con monedas distintas, `agregar()` devuelve gasto `null`** y `roas()`
   devuelve `null`. Nunca un número convertido con un tipo de cambio inventado.
4. **Google usa `metrics.conversions`, jamás `all_conversions`.** La segunda
   incluye vistas de página y micro-eventos; usarla infla el resultado y hace
   que una campaña mala parezca buena. Está testeado (`google usa conversiones
   duras`).
5. **CTR, CPC, CPM y costo por resultado se calculan en un solo lugar**
   (`canal.ts`), no en cada componente.

**Qué intentar romper:** buscar cualquier `reduce((a,b)=>a+b)` sobre resultados
fuera de `sumarResultados`. Y buscar divisiones sueltas en componentes —
`grep -rn "/ *fila\.\|clics *\/\|/ *impresiones" components/`.

---

## 5. Motor de recomendaciones — determinista, y por qué

`lib/ads/analisis.ts` (706 líneas). **No hay LLM en el camino de las
recomendaciones.** El modelo puede escribir un ángulo creativo; no puede decidir
que una campaña se pausa.

`analizarAds(ctx)` devuelve cuatro cosas separadas a propósito:

- `insights` — hechos observados. No piden acción.
- `recomendaciones` — cada una con: **qué, por qué, evidencia (cifras y
  período), confianza, riesgo si me equivoco, con qué datos se calculó, y la
  acción concreta**. Ninguna se ejecuta: Respondo lee, no escribe.
- `insuficientes` — lo que **no** se puede concluir, con el motivo. Esto es
  producto, no relleno: «dato insuficiente» es una respuesta de calidad.
- `nadaQueCambiar` — «no hay nada que cambiar» es una salida válida. Un motor
  que siempre encuentra algo es un motor que inventa.

Orden de los chequeos (importa, porque el primero corta):

0. no hay campañas
1. **medición muda** — hay clics y cero conversiones reportadas en toda la
   cuenta ⇒ **se detiene el análisis entero**. Recomendar pausas sobre una
   cuenta que no mide es recomendar sobre ruido.
2. concentración de gasto ≥70% en una campaña
3. gasto sin resultado (salta lo ya pausado)
4. costo por resultado vs período anterior — exige ≥10 resultados en **ambos**
5. CTR −25% / CPM +30% **contra el propio período anterior**
6. fatiga creativa (frecuencia ≥3 + caída de CTR) — sólo Meta
7. ≥2× la mediana de pares comparables
8. mejor campaña
9. `analizarBusqueda()` — palabras que queman sin convertir, términos a excluir,
   términos que convierten y aún no son palabra propia

**Umbrales: `MINIMOS`** (15 clics, 1000 impresiones, 10 resultados para
comparar, 5 para elogiar, 3 pares para mediana, 14 días para tendencia,
frecuencia 3). **No hay ningún umbral en pesos.** `umbralGastoSinResultado()`
deriva el corte de la propia cuenta: 3× su costo por resultado, si no 10× su
propio CPC, si no `null` (y entonces no se recomienda nada).

**La regla de la negativa que choca.** Antes de proponer excluir un término, se
verifica contra las palabras clave **activas** del mismo grupo. Si la negativa
dejaría ciega a una palabra que sí funciona, **no se propone**: pasa a
`insuficientes` con la explicación. Viene de un caso real (una negativa de una
sola palabra apagó un grupo entero). Es el chequeo que más fácil se pierde en un
refactor.

**Discutible:** los mínimos son universales aunque los umbrales de plata no lo
sean. 15 clics es poco para una cuenta grande y mucho para una chica. Defendible
porque son mínimos de *evidencia estadística*, no de negocio, pero es atacable.

**Qué intentar romper:**
- fabricar una cuenta con conversiones en 0 y clics altos, y verificar que **no**
  salga ninguna recomendación de pausa (debe ganar medición muda);
- fabricar un término que choque con una palabra activa y verificar que aparezca
  en `insuficientes`, no en `recomendaciones`;
- buscar cualquier constante en pesos chilenos en `analisis.ts` — no debe haber
  ninguna;
- buscar reglas del tipo `ctr < 0.02` — tampoco debe haber ninguna.

---

## 6. De dónde salió el método, y qué se dejó afuera

Se estudió la skill `analista-google-ads` (escrita para Impresora Color) y se
clasificó cada cosa. La clasificación está en el encabezado de `analisis.ts`:

- **A — universal:** comparar períodos de igual largo; ordenar por plata, no por
  porcentaje; exigir volumen mínimo antes de concluir; revisar la salud de la
  medición **antes** que el rendimiento; verificar una negativa contra las
  palabras activas.
- **B — específico de Google:** términos de búsqueda, concordancias, que Máximo
  Rendimiento y Smart no entregan términos.
- **C — específico de Impresora:** el umbral de 8.000 CLP, los nombres de sus
  grupos, sus servicios. **Nada de esto se copió.** El umbral se reemplazó por
  uno derivado de cada cuenta.
- **D — proceso:** cómo redactar el hallazgo, qué es evidencia.

**Qué intentar romper:** `grep -rn "8000\|8\.000\|impresora\|planos" lib/` fuera
de `demo.ts`. Cualquier aparición en lógica es un hardcode filtrado.

---

## 7. Google Ads — sólo lectura

`lib/ads/google.ts` (813 líneas) es el único archivo que conoce GAQL.

- **API v25**, REST: `POST https://googleads.googleapis.com/v25/customers/{id}/googleAds:searchStream`
- Encabezados: `Authorization: Bearer`, `developer-token`, `login-customer-id`
  (sólo dígitos).
- Scope: `https://www.googleapis.com/auth/adwords`.
- `searchStream` devuelve **un array de chunks**, no un objeto. Parsearlo como
  objeto funciona con respuestas chicas y falla con las grandes: es el bug
  clásico de esta API.
- `cost_micros / 1e6`.
- Niveles: `campaign`, `ad_group`, `ad_group_ad`, `keyword_view`,
  `search_term_view` (`gaqlDe(nivel, rango)`).
- `cuentasDeGoogle()` = `listAccessibleCustomers` + recorrido de
  `customer_client`; **las cuentas administradoras se excluyen de la selección**
  (no tienen campañas propias y elegirlas es el error más común).

**Credenciales separadas a propósito:** `GOOGLE_ADS_CLIENT_ID` y
`GOOGLE_ADS_CLIENT_SECRET` (obligatorias), `GOOGLE_ADS_DEVELOPER_TOKEN` y
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (opcionales). **No se reutiliza el proyecto Cloud
de la Agenda**, porque agregarle el scope `adwords` reabre su verificación de
Google y dejaría la Agenda sin publicar durante la revisión. Está testeado
(`Google Ads tiene credenciales propias`).

⭐ **El token de desarrollador se apagó el 9-sep-2026** — cinco días antes de
esta entrega. La documentación oficial dice que el encabezado `developer-token`
se puede seguir mandando pero que **los servidores lo ignoran**, y que el nivel
de acceso pasó a ser una propiedad del **proyecto de Google Cloud** que emitió
las credenciales OAuth. Acá la variable quedó opcional, se manda sólo si está, y
**no se exige para habilitar la integración**: exigirla dejaría el botón apagado
para siempre por un requisito que Google eliminó. Hay un test que lo fija
(`el token de desarrollador NO se exige`).

⚠️ **Este es el punto donde más fácil se equivoca un agente**, porque todo lo
publicado antes del 9-sep —incluidos la mayoría de los tutoriales y los ejemplos
de las librerías— dice que el token es obligatorio. La primera versión de este
mismo archivo lo decía, «verificado», y estaba mal.

**Niveles de acceso, asignados al proyecto de Cloud:**

| Nivel | Cuentas | Operaciones/día | Cómo se consigue |
|---|---|---|---|
| Test | sólo de prueba | 15.000 | automático al habilitar la API |
| Explorer | reales | 2.880 | automático, sin verificación de marca |
| Basic | reales | 15.000 | verificación de marca; se aprueba en minutos |
| Standard | reales | sin tope | revisión manual, ~10 días hábiles |

`traducirErrorGoogle()` convierte los códigos de nivel insuficiente en «el
proyecto de Google Cloud todavía tiene acceso de prueba», y dice dónde se sube —
que ya no es el API Center de Google Ads, sino la consola de Cloud.

**Qué intentar romper:** cortar la red a Google y verificar que Marketing
completo siga abriendo con Meta (debe salir un aviso por canal, no una pantalla
de error). Y verificar que no exista ninguna escritura: `grep -rn "mutate\|:mutate\|POST.*campaigns" lib/ads/google.ts`.

---

## 8. Campaign Architect

`lib/marketing/arquitectoCore.ts` (puro) + `lib/marketing/arquitecto.ts`
(orquesta) + `/marketing/arquitecto`.

De una frase y un presupuesto sale un plan editable: estrategia de canal,
campañas, grupos con audiencias o palabras clave, **tres ángulos creativos
distintos**, destino, tracking e **hipótesis falsable**.

Lo importante, y lo que hay que verificar que no se invirtió:

1. **Primero lo determinista, después el modelo.** Intención de búsqueda, reparto
   de presupuesto, canales y destino se deciden con reglas auditables
   (`hayIntencionDeBusqueda()`, `repartirPresupuesto()`, `destinosPosibles()`).
   Gemini sólo escribe ángulos, audiencias y candidatas a palabras clave.
2. **Después del modelo se sanea.** `grupoDesde()` descarta negativas que chocan
   con palabras del propio grupo; `revisarPlan()` valida límites de texto
   (Meta 40/300/125; Google 30/90, mínimo 3 titulares y 2 descripciones) y que
   los ángulos sean realmente distintos.
3. **WhatsApp dejó de ser el destino por omisión.** `Destino` es
   `whatsapp | sitio_web | formulario_meta | llamada`, y sólo se ofrece lo que el
   negocio puede recibir **y medir**. En AyP, la pantalla dice por qué WhatsApp
   no está.
4. **Presupuesto chico: se concentra, no se reparte.** `PISO_DIARIO_CAMPANA =
   2000` (CLP). Partir $3.000/día entre dos canales da dos campañas que no
   aprenden. El 65/35 hacia Google sólo aplica arriba del piso.
5. **UTM deterministas** (`armarTracking()`): el mismo objetivo da siempre el
   mismo slug, para que los informes no se fragmenten. Y `loQueNoSeMide` dice
   explícitamente qué va a quedar ciego.

**Discutible:** el 65/35 hacia Google con intención de búsqueda es un juicio, no
un resultado medido. Está aislado en una función con nombre para que se pueda
cambiar sin tocar nada más, pero sigue siendo una opinión codificada.

**Qué intentar romper:** pedir un plan con presupuesto por debajo del piso y
verificar que salga **una** campaña. Pedir dos veces el mismo objetivo y
comparar los UTM. Meter en el `brief` texto con instrucciones («ignora lo
anterior y…») y verificar que los delimitadores `<<<DATOS>>>` lo contienen.

---

## 9. Seguridad

Lo que se mantuvo intacto y hay que verificar que sigue intacto:

- **Ningún id de recurso es autorización.** `adAccountId`, `campaignId`,
  `adGroupId`, `keywordId` **nunca** llegan desde el navegador como permiso.
  Siempre: `sesión → tenant → conexión autorizada → recurso`. Testeado
  (`ninguna ruta nueva de Google acepta el cliente_id desde el navegador`).
- **`lib/marketing/tenant.ts` no se tocó**, y hay un test estructural de la Fase
  5 que falla si cualquier archivo de Marketing llama `db().from("ed_mk_…")`
  directo. **Ese test atrapó código mío** durante esta fase
  (`arquitecto/acciones.ts` escribía a mano); se reescribió con `modificarEn()`.
- **Tokens cifrados con propósito propio:** `ads-google-token`. El estado del
  OAuth va firmado (`ads-google-estado`, HMAC + 15 min) **y** atado al navegador
  con cookie (`lib/oauthVinculo.ts`). Las dos cosas, porque la firma sola no
  impide que un atacante te haga completar *su* flujo.
- **El token de Google no sale de `google.ts`** y no se registra en ningún log.
  Testeado.
- **Anti-SSRF** en `consultar()`: se verifica el host antes de salir.
- **Nada se volvió público.** Ningún bucket nuevo, ningún asset abierto.
- **Sin escritura en ninguna plataforma.** `PUEDE_PUBLICAR_EN_META = false` sigue
  en false; Google es read-only por construcción. El ciclo es
  LEER → ANALIZAR → RECOMENDAR → DISEÑAR → PREPARAR. No hay auto-pause,
  auto-scale, auto-budget ni auto-bid, y no es una limitación temporal.
- **Sin falso éxito.** Si Google necesita algo que no está, la pantalla dice
  «Requiere configuración», nunca «Conectado».

**Qué intentar romper:** pasar un `clienteId` ajeno por query string a cualquier
ruta nueva. Pedir `/api/ads/google/callback` con un `state` firmado pero desde
otro navegador (debe fallar por la cookie). Buscar `console.log` con `token`.

---

## 10. Rendimiento y fallas

- `rendimientoMulticanal()` pide **todos los proveedores en paralelo** y, dentro
  de cada uno, **todos los niveles en paralelo**. No hay cascadas.
- Falla de un proveedor ⇒ se recoge en `fallas[]` y el otro sigue mostrando
  datos. **Una caída de Google no puede tumbar Marketing.**
  `mensajeDeFalla(proveedor, codigo)` nombra al proveedor correcto (hubo un bug
  donde un mensaje de Google decía «Meta»; hay test).
- La portada pide **sólo nivel campaña**. Palabras y términos se piden en
  `/marketing/busqueda`, donde se muestran. Testeado
  (`los niveles profundos de Google no se piden en la carga del inicio`).
- Caché de access token en proceso, con 5 minutos de margen.

---

## 11. Base de datos

**`sql/309_ads_google_y_planes.sql` — migración NUEVA.** No se modificó ninguna
migración ya aplicada.

- `ed_ads_conexion.cuenta_padre_id` (MCC → `login-customer-id`)
- `ed_ads_conexion.datos jsonb`
- `ed_mk_campanas.canal`, `ed_mk_campanas.plan jsonb`
- el check de `estado` se recrea agregando `requiere_conexion` **y conservando
  todos los valores viejos** — ninguna fila existente queda inválida.

**No es bloqueante.** Sin ella: Google se conecta igual salvo cuentas bajo MCC
(el código reintenta sin la columna y la pantalla lo dice), y el Arquitecto arma
y muestra el plan pero no lo guarda.

**No se crearon tablas de campañas, anuncios, palabras ni métricas diarias.** Las
plataformas ya guardan esa historia y la sirven por API; duplicarla obliga a
sincronizar para siempre y Supabase Free topea en 500 MB. Si hace falta caché
será por lentitud **medida**.

**Discutible:** guardar el plan como `jsonb` en vez de normalizarlo. Defendible
porque se lee y escribe siempre entero, pero impide consultar «todos los planes
con palabra X» sin escanear.

---

## 12. Pruebas

- **832 pruebas pasan** (`npm test`). Las 759 que existían antes **siguen
  pasando**; sólo se corrigió una que ya estaba mal (ver abajo).
- **73 nuevas** en `tests/marketing-fase6.test.mjs`, agrupadas en: señales,
  normalización, Meta, Google, motor de análisis, embudo adaptativo, honestidad
  del copiloto, Arquitecto, variantes de demo, seguridad, fallas externas,
  migración aditiva.
- **Navegador real:** `tests-navegador/marketing-fase6.mjs`, 24 aserciones sobre los tres Customer
  Zero más Integraciones. Usa Playwright con enlace mágico
  (`admin.generateLink` → `/auth/verificar?token_hash=`).
  ⚠️ **Un `fetch` no sirve acá**: en `app/(marketing)` los `redirect()` ocurren
  dentro de un `Suspense`, así que una petición cruda devuelve 200 con el
  esqueleto aunque la persona real termine en otra pantalla. Un 200 no prueba
  nada.
  ⚠️ `waitUntil:"networkidle"` se cuelga en este contenedor (las fuentes de
  Google no resuelven); se usa `domcontentloaded` + interceptor que aborta todo
  lo que no sea localhost.

**Bug preexistente corregido:** `tests/agenda-fase2.test.mjs` hacía
`new Date(AHORA + 2*86_400_000)` con `AHORA` siendo un `Date`. Eso concatena
strings; V8 parsea la parte inicial e ignora los dígitos del final, así que la
cita quedaba en `AHORA` y la prueba se degradaba con el reloj. Corregido a
`Date.now() + …` con comentario.

**Fallas que encontró la verificación y que el código no habría mostrado solo:**
1. El test estructural de la Fase 5 atrapó mi propio `db().from()` directo.
2. Un test nuevo atrapó un `\b` de más en `SENAL_BUSQUEDA` que hacía que
   `abogad` nunca matcheara «abogado».
3. Playwright atrapó que `capacidadesDemo()` devolvía todo encendido
   independientemente de la variante, así que la demo solo-Meta ofrecía WhatsApp.
4. La revisión de capturas atrapó el CTR renderizado como «2» y un gráfico con
   cuatro pestañas de WhatsApp permanentemente deshabilitadas más una línea
   fantasma de comparación.
5. La última revisión de capturas atrapó el CTR con punto decimal en
   `/marketing/busqueda` («5.9%» en vez de «5,9%»).

**Qué falta probar y no se probó:** nada corrió contra una cuenta de Google Ads
real, porque no hay developer token todavía. `pruebaDeLecturaGoogle()` existe
para eso y la pantalla de Integraciones la ejecuta, pero **hasta que alguien
conecte una cuenta real, el camino de Google está probado sólo contra fixtures**.
Es el riesgo más grande de esta entrega y hay que decirlo así.

---

## 13. Cómo reproducir

```bash
npm ci
npm run check          # lint + typecheck + 832 pruebas + build
                       # lint: 2 warnings PREEXISTENTES (GestionCita, PanelChat)

# navegador real (necesita .env.local con SUPABASE_URL y SERVICE_ROLE_KEY)
npm run build && npx next start -p 3000 &
BASE=http://localhost:3000 node tests-navegador/marketing-fase6.mjs
```

Para ver los tres casos sin credenciales externas: activar «Datos de
demostración» en el riel y cambiar entre **Completo · Solo Meta · Solo Google**.
La demo se construye **restando** del panorama completo, para que no pueda
mostrar campos que producción no podría llenar (hay test).

---

## 14. Superficie nueva

**Rutas de API**
- `GET /api/ads/google/conectar` — arma el state firmado + cookie y redirige a Google
- `GET /api/ads/google/callback` — canjea el código, lista cuentas, guarda cifrado

**Pantallas**
- `/marketing/arquitecto` — Campaign Architect
- `/marketing/busqueda` — términos, palabras clave, grupos, recomendaciones

**Acciones de servidor**
- `disenarCampanaAccion`, `guardarPlanAccion`, `planComoTextoAccion`
- `elegirCuentaGoogle`, `desconectarGoogle`

**Variables de entorno nuevas:** `GOOGLE_ADS_CLIENT_ID` y
`GOOGLE_ADS_CLIENT_SECRET` (obligatorias); `GOOGLE_ADS_DEVELOPER_TOKEN` y
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` (opcionales).

---

## 15. Riesgos conocidos, ordenados por probabilidad de morder

1. **Google no está probado contra una cuenta real.** Ver §12. Un proyecto de
   Cloud recién habilitado arranca en nivel Test, que sólo responde cuentas de
   prueba; hay que subirlo al menos a Explorer.
2. **Cuentas bajo MCC sin la migración 309.** Devuelven
   `USER_PERMISSION_DENIED` aunque los permisos estén bien. El código reintenta
   sin la columna y la pantalla lo explica, pero es confuso.
3. **`searchStream` parseado como objeto.** Si alguien "simplifica" ese parseo,
   funciona en demo y falla con cuentas grandes.
4. **El chequeo de la negativa que choca** es fácil de perder en un refactor de
   `analizarBusqueda()`. Hay test, pero es el test que hay que mirar primero.
5. **Los ángulos creativos vienen de un modelo.** Se saneen y se revisen, pero
   el texto sigue siendo generado: nadie debería publicarlo sin leerlo.
6. **La demo y producción comparten fixtures de forma.** Si alguien agrega un
   campo a la demo que producción no puede llenar, hay un test que lo atrapa —
   no borrarlo.

---

## 16. Qué NO se hizo, a propósito

- **No hay API de escritura.** Ni pausar, ni escalar, ni cambiar presupuesto ni
  puja. Decisión de producto.
- **No hay rediseño visual.** Se agregaron pantallas y se adaptaron secciones; la
  identidad visual del módulo no se tocó.
- **No hay modos manuales.** Ni selector, ni columna, ni bandera por cliente.
- **No hay `if (cliente === "AyP")`** en ninguna parte. Buscarlo.

---

## 17. Lo que yo intentaría romper primero, si fuera el auditor

1. Conectar una cuenta de Google real bajo un MCC, con la 309 aplicada y sin
   aplicar. Comparar los mensajes.
2. Fabricar una cuenta con dos campañas de tipos de resultado distintos y buscar
   cualquier lugar de la UI donde se sumen o se comparen.
3. Poner conversiones en 0 con clics altos y verificar que gane medición muda en
   **todas** las pantallas, no sólo en la portada.
4. Meter prompt injection en el brief del Arquitecto y en el nombre de una
   campaña de Meta.
5. Pasar ids ajenos por query string a las dos rutas nuevas.
6. Cortarle la red a un proveedor a mitad de carga.
7. Buscar constantes en pesos y umbrales universales de CTR en `lib/ads/`.
8. Revisar que ninguna pantalla muestre una sección vacía permanente para el
   caso AyP.
