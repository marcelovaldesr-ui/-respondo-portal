# Remediación de la auditoría adversarial de Antigravity
## Marketing Fase 6 + Estudio Creativo 2.0 · 15 de septiembre de 2026

Antigravity actuó como red-team y su informe se trató como tal: **ningún hallazgo
se aceptó por venir en el informe**. Cada uno se reprodujo contra el código real
antes de tocar nada, y varios resultaron tener el diagnóstico correcto con la
evidencia inventada. Eso está documentado abajo, hallazgo por hallazgo, porque
un informe de remediación que no distingue entre «lo comprobé» y «me lo
creyeron» vale tan poco como la auditoría que corrige.

Resumen en una línea: **13 hallazgos aceptados, 4 aceptados parcialmente, 2
rechazados**, más 3 defectos que encontramos nosotros y que la auditoría no vio.

---

## 1. Hallazgos ACEPTADOS

| ID | Qué era | Reproducido |
|---|---|---|
| **BUG-02** | Con solo Google conectado, la tarjeta «Invertido» decía `—` y pedía conectar Meta | Sí, en la variante `google` de la demo |
| **BUG-03** | El detalle de campaña llamaba al embudo rígido y buscaba anuncios solo en Meta: 0 anuncios para una campaña de Google | Sí |
| **BUG-04** | `analizarAds` sumaba `f.gasto.valor` de monedas distintas y rotulaba el total con la moneda de la primera fila | Sí, líneas 159 y 242-243 |
| **BUG-05** | Medición muda ⇒ `return` temprano: se apagaban CTR, CPM, frecuencia, fatiga y términos | Sí, línea 296 |
| **BUG-07** | Se recomendaba escalar y reducir presupuesto de campañas `pausada` / `terminada` | Sí |
| **BUG-09** | Colisión de negativas por substring, sin concordancia y sin filtrar palabras pausadas | Sí, línea 663 |
| **BUG-10** | `facturación` en la expresión de mecánica vetaba el producto de un SaaS de facturación | Sí |
| **BUG-11** | `respaldoDisponible` concatenaba `pedido.indicaciones`: el claim se respaldaba a sí mismo | Sí, línea 193 |
| **BUG-12** | Atribución mostraba textos duros de WhatsApp a un anunciante de solo Google | Sí |
| **BUG-13** | Un contexto editado a mano no se podía reconstruir nunca | Sí, línea 210 |
| **BUG-14** | `pedido.objetivo` se inyectaba fuera de los delimitadores de seguridad | Sí |
| **BUG-15** | El copiloto instruía presupuestos entre $2.000 y $10.000 sin mirar la moneda | Sí |
| **BUG-17** | El aviso de proporción decía «Meta la va a recortar» también para Google | Sí |

## 2. Hallazgos aceptados PARCIALMENTE

### BUG-01 — el piso de campaña
**El defecto es real y grave; la evidencia del informe es inventada.**
Antigravity cita dos líneas que no existen en el archivo:

```
    if (diario < PISO_DIARIO_CAMPANA * 2) { … }                    ← no existe
    if (presupuestoTotal < PISO_DIARIO_CAMPANA * 30) { … }         ← no existe
```

El código real era `(r.diario ?? 0) < PISO_DIARIO_CAMPANA` y
`c.presupuestoDiario < PISO_DIARIO_CAMPANA`. La consecuencia que describe —«exige
al menos $60.000 USD mensuales»— sale de esos factores inventados; el umbral real
era US$2.000/día, o sea US$60.000 al mes… por casualidad la misma cifra, con un
razonamiento equivocado. **El defecto se corrigió igual**, porque el problema de
fondo —comparar plata contra una constante sin moneda— es cierto.

### BUG-06 — fatiga creativa
El informe dice que la fatiga se dispara «sin umbral mínimo». **Falso a medias**:
el bloque ya exigía frecuencia ≥ 3 e impresiones ≥ 1.000 antes de mirar el CTR.
Lo único sin umbral era la comparación de CTR (`ctrAhora < ctrAntes`), y ese sí
es un defecto real: 2,50% → 2,49% generaba alerta. Se corrigió esa parte, y se
agregó además el gate que faltaba de verdad y que la auditoría no vio: **no se
exigía volumen en el período ANTERIOR**, así que un CTR calculado sobre 200
impresiones viejas podía «probar» una caída.

### BUG-08 — semántica de conversiones de Google
El diagnóstico es correcto y es el hallazgo más valioso del informe. La
**solución implícita** que propone —agregar `segments.conversion_action_category`
a la consulta de campañas— habría sido peor que el defecto. Verificado en la
referencia de campos de v25: la lista *Selectable with* de ese segmento contiene
solo métricas de conversión (`metrics.conversions`, `metrics.conversions_value`,
`metrics.all_conversions`, `metrics.orders`, `metrics.revenue_micros`…) y **no
contiene `metrics.cost_micros`, `metrics.impressions` ni `metrics.clicks`**. Es
decir: no habría inflado el gasto, habría hecho que Google **rechazara la
consulta** y el panel se quedara sin campañas.

### BUG-19 — fallback de moneda en Google
Real, pero la línea citada (`google.ts:394`) no es ninguno de los tres
fallbacks. Estaban en 202 (lectura de la conexión), 519 (listado de cuentas) y
835 (prueba de lectura). Los tres se corrigieron.

## 3. Hallazgos RECHAZADOS, y por qué

### BUG-18 — «dead code» del developer token · RECHAZADO
El informe lo clasifica como P3 y pide «limpiar dead code». No hay dead code:

```ts
developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() || null,   // línea 99
return cred.developerToken ? { "developer-token": cred.developerToken } : {};  // línea 121
```

El campo se lee, se tipa y se manda condicionalmente. Esa condicionalidad **es
la funcionalidad**, no un resto: una instalación cuyo proyecto de Cloud todavía
tiene el token debe seguir mandándolo, y Google lo ignora si sobra. Borrarlo
rompería a quien lo necesita para ganar cero. No se tocó.

### La colisión de negativas «impresión de planos» · RECHAZADO como colisión
Nuestro propio test de la Fase 6 afirmaba que la negativa
«impresion de planos a1» debía bloquearse por chocar con la palabra clave
«impresion de planos». **Eso era el bug, no la protección.** En Google, excluir
un término MÁS ESPECÍFICO que una palabra clave no la deja ciega: la palabra
sigue sirviendo para todas las demás consultas. La verificación vieja, por ser
un `includes`, bloqueaba exactamente la práctica correcta (excluir basura larga
y conservar la palabra corta). El test se reescribió con la semántica real.

---

## 4. La corrección aplicada

### 4.1 Moneda: el cambio más profundo (BUG-01 / 04 / 15 / 16 / 19)

La regla nueva, escrita en `lib/ads/moneda.ts` y aplicada en todo el módulo:

> **Dinero sin moneda conocida no es dinero comparable.** No se suma con nada, no
> se compara con nada, y se escribe sin símbolo. Nunca se asume CLP y nunca se
> inventa un tipo de cambio.

Herramientas nuevas: `MONEDA_DESCONOCIDA`, `monedaConocida()`, `normalizarMoneda()`,
`montoComparable()`, `mismasMonedas()`, `agruparPorMoneda()`, `sumarPorMoneda()`,
`nombreDeMoneda()`.

**El piso del Arquitecto (BUG-01).** No se cambió un número mágico por otro. Lo
que el piso mide no es plata: es **aprendizaje**, y el aprendizaje se mide en
clics por día, que es una cantidad y no tiene moneda. La plata es la proyección
de esa cantidad, y el único tipo de cambio honesto para hacerla es el de la
propia cuenta:

```
piso = CPC observado de ESTA cuenta × CLICS_DIARIOS_PARA_APRENDER (8)
```

en su propia moneda, sin conversión ninguna. Tres niveles, en orden:

1. **Observado** — hay historia de clics: el piso sale de sus propios datos.
2. **Configurado** — no hay historia: se usa la semilla declarada para esa
   moneda. `PISOS_DIARIOS_SEMILLA` trae **solo CLP**, a propósito: es la única
   moneda de la que este producto tiene evidencia real. Una instalación en otra
   moneda declara la suya en `RESPONDO_PISO_DIARIO_CAMPANA` (formato `USD:5,EUR:4`).
3. **Ninguno** — sin historia y sin configuración, o con moneda desconocida:
   **no se exige piso y se dice por qué**. No saber el piso no es «está bajo el
   piso»: antes esa confusión mataba el segundo canal de una cuenta en dólares.

Además el plan entero pasó a llevar `Monto` (cantidad + moneda) en vez de
escalares: `PlanCampana.presupuestoMensual`, `CampanaPlanificada.presupuestoDiario`
y cada parte del reparto. El compilador es ahora quien impide volver al defecto.

**El motor de análisis (BUG-04).** `analizarAds` particiona por moneda y analiza
cada grupo por separado, con su propio total, su propio umbral y su propia
mediana. Con más de una moneda lo **dice**, en vez de sumar en silencio. El grupo
sin moneda conocida conserva todo lo que se mide en cantidades y pierde solo lo
monetario.

**Los `?? "CLP"` que quedaban.** `datos.ts:492` y `atribucion.ts:299` tenían la
moneda del negocio escrita a mano —y `atribucion.ts` con un comentario encima que
decía «se lee del cliente en vez de asumir CLP», que era falso—. Ahora se lee de
`ed_clientes.moneda` (migración 311 nueva) con la moneda de la instalación como
respaldo. La distinción importa y está escrita en `lib/marketing/monedaNegocio.ts`:
**la moneda de la cuenta publicitaria es un hecho externo que la API entrega o no
—afirmarla sin dato es inventar—; la moneda del negocio es una configuración de
esta instalación, que se declara y se puede cambiar.**

### 4.2 Conversión vs entrega (BUG-05)

La regla no es callarse, es **no opinar sobre conversiones**:

- **se apaga**: costo por resultado, escalar, reducir, mediana entre pares, mejor
  campaña, términos que no convierten.
- **sigue**: CTR, CPM, frecuencia, desgaste creativo, concentración del gasto y
  —nuevo— el reparto del gasto entre términos de búsqueda.

Un negocio con la medición rota es precisamente el que más necesita que alguien
le diga que su anuncio se gastó.

### 4.3 Recomendaciones que se pueden ejecutar (BUG-06 / 07)

- Fatiga: frecuencia suficiente **+** volumen suficiente **en los dos períodos**
  **+** caída relativa ≥ 25% (configurable vía `ctx.umbrales`). Cuando falta
  alguna, la frecuencia se reporta como HECHO y no se recomienda nada.
- `estaActiva()` bloquea escalar, reducir y rotar sobre campañas pausadas o
  terminadas. Los hechos se siguen reportando: gastó lo que gastó.

### 4.4 Términos, palabras y negativas (BUG-09)

Se reemplazó el `includes` por un modelo de la semántica real de Google:

```ts
negativaBloquea(negativa, "exacta" | "frase" | "amplia", palabraClave)
evaluarNegativa(termino, palabrasActivas) → { concordancia, bloqueaEnFrase, bloqueaEnAmplia }
```

Tokeniza por palabras (sin tildes, sin signos), respeta el radio de daño de cada
concordancia, y solo las palabras **activas** pueden vetar una propuesta. La
lección de junio de 2026 quedó mejor expresada que antes: la negativa
«sublimacion» ahora **sí se propone**, en concordancia exacta, **avisando** que
en amplia dejaría sin servir «sublimacion textil». Eso es lo que el dueño
necesitaba leer antes del cambio, no después.

### 4.5 Qué son las conversiones de Google (BUG-08)

`lib/ads/googleConversiones.ts`, nuevo. La composición se pide en una **consulta
separada** que trae identificador, categoría y `metrics.conversions` — jamás
costo, impresiones ni clics. El gasto no puede duplicarse porque no viaja ahí, y
la consulta principal no puede romperse porque no lleva el segmento.

- Las 24 categorías del enum `ConversionActionCategory` de v25 están mapeadas una
  por una; lo que no esté cae en `desconocido`, que no se compara con nada.
- Si una categoría explica ≥ 80% del total, ese es el tipo. Si no, es `mezcla`,
  un tipo nuevo que **no se compara ni se suma**, igual que `desconocido`.
- Sin composición disponible el rótulo es honesto («resultados»), no
  «conversiones del sitio».
- Las acciones blandas de Google (`PAGE_VIEW`, `OUTBOUND_CLICK`, `ENGAGEMENT`,
  `GET_DIRECTIONS`, `STORE_VISIT`) se reconocen y se pesan aparte: son las primas
  hermanas de lo que hace insalvable a `all_conversions`.

### 4.6 Dirección creativa ≠ hecho confirmado (BUG-11)

Dos conceptos que el producto trataba como uno:

| | DIRECCIÓN CREATIVA (`indicaciones`) | HECHO CONFIRMADO (`ContextoComercial`) |
|---|---|---|
| Qué es | tono, ángulo, qué destacar | precios, ofertas, plazos, garantías, pruebas |
| Vida | este anuncio y ninguno más | durable, auditable, visible en «contexto usado» |
| Respalda | **no** | **sí** |

El camino para aportar un dato nuevo legítimo **ya existía** y no hubo que
inventarlo: `corregirContexto` lo guarda y queda `fuente: "declarado"`, la
autoridad más alta de la tabla. Lo que se agregó es que el sistema lo **diga**:
cuando un claim viene de las indicaciones, el defecto es `sin_confirmar` (no
`sin_respaldo`) y el remedio apunta al camino real. En el prompt, los dos van en
bloques distintos con instrucciones distintas.

### 4.7 Contexto reconstruible (BUG-13)

Tres niveles: nada / `refrescar` (respeta la edición manual) / `reconstruir` (la
pisa, pero **reaplica encima** lo que la persona había corregido, que sigue siendo
`declarado`). Lo que se actualiza es la parte que ella nunca tocó, que es justo lo
que quería actualizar. La acción está en «contexto usado», explicada, aparte del
botón de todos los días.

### 4.8 Defectos que encontramos nosotros y la auditoría no vio

1. **`acciones.ts` tiraba a la basura el destino del plan.** Al guardar el
   borrador escribía `destino: "whatsapp"` en duro: un plan que mandaba al sitio
   web se guardaba como campaña de WhatsApp. Es exactamente el supuesto que la
   Fase 6 vino a matar, sobreviviendo en la línea del guardado.
2. **`capacidades.monedaPublicidad` solo miraba Meta.** Un negocio con solo Google
   Ads conectado se quedaba sin moneda aunque su cuenta la declarara. Ahora es la
   moneda única de todos los canales conectados, y `null` cuando hay más de una
   —que es la respuesta correcta, no un caso raro—.
3. **`creatividadesCore.promptCreativo` inyectaba texto de usuario suelto.** El
   mismo patrón de BUG-14, en un archivo que el informe no revisó: `producto`,
   `oferta`, `indicaciones` y el anuncio base iban fuera de todo delimitador.
   Corregido con el mismo bloque `<<<PEDIDO>>>`, y el anuncio base en
   `<<<ANUNCIO BASE>>>` marcado como material, nunca órdenes.

---

## 5. Pruebas agregadas

Cada bug aceptado tiene al menos una prueba que **fallaría antes** y pasa ahora.
`npm test` pasó de **913** a **952**.

| Prueba | Qué demuestra |
|---|---|
| `BUG-01 · un presupuesto sano en dólares NO colapsa a un solo canal` | US$600/mes reparte en dos canales |
| `BUG-01 · un plan en dólares no queda trabado por un piso en pesos` | `revisarPlan` devuelve `[]` |
| `BUG-01 · sin moneda conocida no se exige piso, y no se inventa CLP` | y «20» no se escribe «$20» |
| `BUG-01 · el piso observado manda sobre la semilla configurada` | CPC real × 8 |
| `BUG-01 · un CPC en otra moneda se ignora` | no se inventa tipo de cambio |
| `BUG-01 · el CPC se calcula por moneda y nunca mezcla monedas` | CLP 200 y USD 2 en el mismo lote |
| `BUG-01 · el mínimo por moneda es configuración reemplazable` | parseo de `USD:5,EUR:4` |
| `BUG-04 · dos cuentas en monedas distintas se analizan por separado` | el total es $1.000.000, no 1.005.000 |
| `BUG-04 · el umbral se niega a existir si le pasan monedas mezcladas` | `null` |
| `BUG-04 · una cuenta sin moneda declarada no se convierte en pesos` | ningún `$` en la salida |
| `BUG-05 · con la medición muda sobreviven CTR, CPM y desgaste creativo` | y no hay escalar/reducir |
| `BUG-05 · el reparto del gasto entre términos sigue siendo un hecho` | insight nuevo de entrega |
| `BUG-06 · un CTR de 2,50% a 2,49% NO es desgaste creativo` | tono `neutro`, sin `rotar_` |
| `BUG-06 · una caída material de CTR con frecuencia alta SÍ es desgaste` | el caso verdadero sigue vivo |
| `BUG-06 · sin volumen en el período anterior no se afirma desgaste` | el gate que faltaba |
| `BUG-06 · el umbral de materialidad es reemplazable` | `ctx.umbrales` |
| `BUG-07 · no se propone escalar una campaña pausada` | y activa sí |
| `BUG-07 · no se propone reducir ni rotar una campaña terminada` | el hecho se reporta igual |
| `BUG-08 · segmentar por acción de conversión NO duplica gasto ni clics` | 3 categorías, mismo gasto |
| `BUG-08 · la consulta de composición no pide costo, clics ni impresiones` | invariante del diseño |
| `BUG-08 · una cuenta que mide llamadas no se rotula «conversiones del sitio»` | |
| `BUG-08 · conversiones de varios tipos son una MEZCLA y no se comparan` | |
| `BUG-08 · dos categorías que miden lo mismo NO son una mezcla` | dominancia por tipo |
| `BUG-08 · sin composición disponible el rótulo es honesto, no «web»` | |
| `BUG-08 · las acciones blandas de Google se reconocen y se pesan` | 400 `PAGE_VIEW` + 28 compras |
| `BUG-08 · el mapa cubre el enum ConversionActionCategory completo de v25` | 24 valores, sin huecos |
| `BUG-09 · una negativa de UNA palabra avisa qué mataría en amplia` | el caso «sublimacion» |
| `BUG-09 · un substring que no es una palabra ya NO cuenta como choque` | auto/autor |
| `BUG-09 · una palabra clave PAUSADA no puede vetar una negativa` | |
| `BUG-09 · las tildes no crean términos nuevos ni choques falsos` | |
| `BUG-09 · un término ya excluido en la cuenta no se vuelve a proponer` | usa `search_term_view.status` |
| `BUG-11 · un claim escrito en las indicaciones NO se puede afirmar` | clave `sin_confirmar` |
| `BUG-11 · un precio tecleado en indicaciones tampoco respalda` | |
| `BUG-11 · un hecho CONFIRMADO por el negocio sí respalda` | mismo dato, distinto estatus |
| `BUG-11 · la dirección creativa sigue llegando al modelo, en su propio bloque` | no se castra |
| `ningún texto de usuario se inyecta suelto en el prompt del estudio` | producto, oferta e indicaciones |
| `el generador viejo también delimita producto, oferta e indicaciones` | el defecto que nadie vio |

Más las de los subagentes para BUG-02/03/10/12/14/15/17, y `tests-integracion/google-vs-nativo.integracion.test.mjs` (sección 8).

---

## 6. Resultado final de las suites

```
npx tsc --noEmit          limpio
npm run lint              0 errores, 2 warnings PREEXISTENTES
                          (GestionCita.tsx: useMemo sin usar;
                           PanelChat.tsx: modoVisible sin usar)
npm test                  952 / 952
npm run build             ✓ compilado, 41 rutas
```

**Navegador real** (build de producción en `localhost:3000`, sesión real por
magic link, tres variantes de demo):

```
tests-navegador/marketing-fase6.mjs    TODO VERDE  (27 comprobaciones)
tests-navegador/estudio-2.mjs          TODO VERDE  (24 comprobaciones)
tests-navegador/qa-estudio.mjs         corrido contra Respondo con el modelo real:
                                       estrategia + 3 ángulos distintos, aprobado,
                                       2 llamadas, 12,9 s
```

En esa corrida, la única cifra que el anuncio afirma —«38% menos de horas
perdidas»— viene de una **prueba del conocimiento del negocio**, no de las
indicaciones. Es el comportamiento nuevo funcionando sobre datos reales.

---

## 7. Riesgos que quedan

1. **La composición de conversiones de Google no se ha ejercitado contra una
   cuenta real.** El diseño está verificado contra la documentación y probado
   con fixtures, pero ninguna cuenta ha respondido esa consulta todavía. Falla
   sola por diseño: si Google la rechaza, el panel muestra el rendimiento
   completo y pierde solo el desglose.
2. **La dominancia del 80%** para decidir el tipo de conversión es una decisión
   nuestra, no un dato. Es `DOMINANCIA` y se puede mover; el valor correcto se va
   a saber mirando cuentas reales.
3. **Los 8 clics diarios para aprender** son del mismo orden: una regla de oficio,
   defendible y explícita, no una medición. Está en una constante exportada y
   probada, no en medio de una función.
4. **La semilla de piso solo cubre CLP.** Es deliberado, pero significa que una
   cuenta en otra moneda y sin historia no recibe validación de presupuesto. Lo
   dice en pantalla en vez de callarlo.
5. **`ed_clientes.moneda` todavía no existe en la base** hasta que se corra la
   311. Sin ella todo sigue funcionando con la moneda de la instalación (CLP).
6. **La demo sigue siendo monomoneda.** Los casos multimoneda están cubiertos por
   pruebas unitarias, no por la demo, así que no se pueden «ver» en pantalla.
7. **La reconstrucción de contexto conserva las correcciones por `fuente:
   "declarado"`.** Si en el futuro una corrección se guardara con otra fuente,
   `conservarCorrecciones` dejaría de verla. Está atado a `AUTORIDAD`, que es el
   criterio del módulo, pero es un acoplamiento que conviene recordar.

---

## 8. Qué sigue requiriendo Google Ads real

**Al 15 de septiembre de 2026 la cuenta de Google Ads de Impresora Color no se ha
leído ni una vez desde Respondo. Ningún número de este repositorio ha sido
comparado contra la interfaz de Google. La integración NO está validada.**

Para que mañana se pueda comparar, se agregó
`tests-integracion/google-vs-nativo.integracion.test.mjs`, que **no afirma nada
sobre Google**: vuelca los seis niveles a CSV y comprueba solo coherencia interna.

```bash
RESPONDO_CLIENTE_ID=<uuid> npm run test:integracion
```

Produce `comparacion-google/{cuenta,campana,grupo,anuncio,palabra,termino}.csv`,
en las mismas unidades en que Google los muestra, para abrirlos al lado de la
pantalla y comparar fila por fila:

| Nivel | Qué comparar en Google Ads |
|---|---|
| ACCOUNT | Total de la cuenta, por moneda |
| CAMPAIGN | Campañas → nombre, estado, tipo, presupuesto, impresiones, clics, costo, conversiones |
| AD GROUP | Grupos de anuncios |
| AD | Anuncios (los adaptables se rotulan por id, igual que en Google) |
| KEYWORD | Palabras clave → concordancia y estado |
| SEARCH TERM | Términos de búsqueda → palabra que lo disparó, estado |

Condiciones para que la comparación sea válida, y son la mitad del trabajo:

- Mismo rango de fechas y **la zona horaria de la cuenta**, no la tuya.
- Columna **«Conversiones»**, NO «Todas las conversiones».
- Sin filtros de estado: el volcado incluye las pausadas.
- Diferencias en el último decimal del costo son del redondeo de Google (nosotros
  dividimos micros entre un millón).

Lo que esa comparación va a decidir, y hoy no se puede decidir:

- si `metrics.conversions` de esta cuenta coincide con lo que Google muestra;
- si la consulta de composición funciona en una cuenta real y qué categorías
  devuelve Impresora Color;
- si la partición de gasto entre campaña y grupos cuadra o si hay tipos de
  campaña que no reparten;
- si el CPC observado da un piso diario razonable para esta cuenta.

---

## 9. Owner Actions

### A1 · Aplicar la migración 311

- **QUÉ**: crear la columna `ed_clientes.moneda`.
- **POR QUÉ**: es lo que saca el último `"CLP"` escrito a mano del código. Sin
  ella todo funciona igual, con la moneda de la instalación.
- **DÓNDE**: Supabase → proyecto de Respondo → **SQL Editor** → New query.
- **QUÉ VALOR COPIAR**: el contenido completo de `sql/311_moneda_negocio.sql`.
- **DÓNDE PEGARLO**: en el editor, y **Run**.
- **CÓMO VERIFICAR**: correr
  `select column_name from information_schema.columns where table_name='ed_clientes' and column_name='moneda';`
  Tiene que devolver una fila. Es idempotente: se puede correr dos veces.

### A2 · (Opcional) Declarar la moneda de un negocio

- **QUÉ**: decirle a Respondo en qué cobra un cliente que no cobra en pesos.
- **POR QUÉ**: hoy ninguno lo necesita; el día que haya uno, esto evita que sus
  ingresos salgan rotulados en la moneda equivocada.
- **DÓNDE**: Supabase → SQL Editor.
- **QUÉ VALOR COPIAR**: `update ed_clientes set moneda = 'USD' where id = '<uuid>';`
- **DÓNDE PEGARLO**: en el editor, cambiando `USD` y el uuid.
- **CÓMO VERIFICAR**: abrir Marketing de ese negocio; los ingresos tienen que
  salir con el código de moneda al lado.

### A3 · (Opcional) Mínimo diario por moneda

- **QUÉ**: declarar el piso de aprendizaje para monedas distintas de CLP.
- **POR QUÉ**: sin esto, una cuenta en dólares **sin historia** no recibe
  validación de presupuesto y el plan lo dice. Con historia, el piso sale solo
  del CPC de la cuenta y esta variable no hace falta.
- **DÓNDE**: Vercel → proyecto `respondo-portal` → Settings → Environment Variables.
- **QUÉ VALOR COPIAR**: nombre `RESPONDO_PISO_DIARIO_CAMPANA`, valor `USD:5,EUR:4`.
- **DÓNDE PEGARLO**: en Production (y Preview si quieres probarlo antes).
- **CÓMO VERIFICAR**: redeploy, abrir el Arquitecto de una cuenta en dólares sin
  historia y pedir un plan; la advertencia de «no hay con qué comprobar» debe
  desaparecer.

### A4 · (Opcional) Moneda de la instalación

- **QUÉ**: cambiar la moneda por defecto de los negocios de esta instalación.
- **POR QUÉ**: Respondo nace en Chile y el valor de fábrica es CLP. Solo tiene
  sentido tocarlo si alguna vez se despliega para otro país.
- **DÓNDE**: Vercel → Settings → Environment Variables.
- **QUÉ VALOR COPIAR**: nombre `RESPONDO_MONEDA_NEGOCIO`, valor `CLP`.
- **DÓNDE PEGARLO**: Production.
- **CÓMO VERIFICAR**: un negocio sin `ed_clientes.moneda` tiene que mostrar sus
  ingresos en esa moneda.

### A5 · Publicar los cambios

- **QUÉ**: commit y push de los 40 archivos de esta remediación.
- **POR QUÉ**: Vercel despliega desde `main`; lo que no está en el commit, no se
  despliega. La lista está derivada por comparación de tamaños contra el disco,
  no de memoria: el deploy de la Fase 6 falló por dos archivos olvidados.
- **DÓNDE**: PowerShell, en `C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal`.
- **QUÉ VALOR COPIAR**: ver `AUDIT_FIX_PATHS.txt` y los comandos de la entrega.
- **CÓMO VERIFICAR**: `git status` tiene que quedar limpio, y el deploy de Vercel
  en verde. Si falla el build, comparar el commit contra `AUDIT_FIX_PATHS.txt`.

### A6 · Conectar Google Ads de Impresora Color

- **QUÉ**: completar el OAuth de Google Ads para ese negocio y correr la
  comparación de la sección 8.
- **POR QUÉ**: es lo único que puede convertir «la integración está escrita» en
  «la integración está validada». Hoy no lo está.
- **DÓNDE**: Respondo → Marketing → Integraciones → Google Ads.
- **QUÉ VALOR COPIAR**: nada; el flujo es de botones.
- **DÓNDE PEGARLO**: —
- **CÓMO VERIFICAR**: la tarjeta tiene que mostrar el nombre de la cuenta **y una
  cifra al lado**. Después, correr
  `RESPONDO_CLIENTE_ID=<uuid> npm run test:integracion` y comparar los CSV contra
  la pantalla de Google, con las condiciones de la sección 8.

---

*No se empezó ninguna funcionalidad nueva. Esto cierra Marketing Fase 6.*
