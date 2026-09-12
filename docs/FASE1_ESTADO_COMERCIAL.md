# Fase 1 — Estado comercial y experiencia operativa

Trabajo hecho sobre el código de Fase 0 (base `origin/main` 6811494). Todo lo de
Fase 0 —seguridad, multi-negocio, observabilidad y consistencia— sigue en pie:
no se revirtió ninguna de sus reglas ni se borró ninguna de sus pruebas.

**No se desplegó nada. Beto sigue apagado. No se envió ningún mensaje real.**

---

## A. Arquitectura

**Decisión: el estado comercial se DERIVA, no se guarda.** No hay tabla nueva ni
migración. Una conversación no tiene un "estado CRM" propio: tiene hechos
(etapa, etiquetas, cobros, derivaciones, citas, propuestas, quién habló último)
que ya viven repartidos en la base, y el estado es lo que esos hechos dicen.

Tres capas, en este orden:

1. **Núcleo puro** (`lib/estadoComercialCore.ts`): recibe los hechos de una
   conversación y devuelve etapa + motivo, estado de pago, atención requerida y
   su prioridad, oportunidad abierta, estado de Beto, siguiente acción y
   actividad reciente. No toca base de datos ni red: se puede probar entero.
2. **Cargador por lotes** (`lib/estadoComercial.ts` + `estadoComercialFilas.ts`):
   trae los hechos de MUCHAS conversaciones con un número fijo de consultas
   (`.in(chat_id)` en lotes de 200), nunca una consulta por cliente.
3. **Vista** (`lib/estadoComercialVista.ts` y los componentes): textos, tonos y
   agrupaciones. Ninguna regla de negocio vive acá.

Por qué así y no una tabla CRM: una tabla nueva habría que mantenerla al día
desde siete escritores distintos (motor, cron, portal, puente, detector de
cierres…). El primer día en que uno falle, la tabla miente y nadie se entera.
Derivar cuesta unas consultas más por pantalla y no puede desincronizarse.

Catálogos compartidos que salieron de acá: `lib/etapasCore.ts` (etapas, motivos
de pérdida, textos de motivo) y `lib/derivacionesCore.ts` (por qué se derivó una
conversación). Los dos son puros y los usan a la vez el portal, el motor de Tino
y la reja de Beto, para que "perdido por silencio" signifique lo mismo en todas
partes.

---

## B. Mapa de fuentes (de dónde sale cada cosa)

| Dato | Fuente autoritativa | Quién escribe |
|---|---|---|
| Etapa del embudo | `ed_contactos.etapa` (+ `etapa_motivo`, `etapa_en`, `etapa_manual`) | embudo (señales y reloj), detector de cierres, reconciliador, personas |
| Etiquetas | `ed_contactos.etiquetas` | motor de Tino, portal, cierres |
| ¿Lo atiende una persona? | `ed_chat_estado.modo` **por empleado** | portal e inbox |
| Último mensaje y quién habló | `ed_contactos.ultimo_mensaje_*` (trigger 250) | trigger de `ed_mensajes` |
| Derivaciones | `ed_escalaciones` (abiertas = `atendida_en` nulo) | motor, portal |
| Cobros | `ed_pagos` (`pendiente`/`pagado`/`anulado`) | portal |
| "Dijo que pagó" | etiqueta `pago_por_confirmar` + `ed_resultados.venta_confirmada` | detector de cierres |
| Cotización | etiqueta `cotizacion` / etapa `cotizado` | motor de Tino |
| Seguimientos de Beto | `ed_seguimientos` + `ed_propuestas_seguimiento` | generador y juez |
| Citas | `ed_citas` | agenda |
| Informe de Isabel | `ed_insights` | Isabel |

El detalle completo (columnas, contradicciones conocidas, quién manda cuando dos
fuentes discrepan) quedó en las notas de trabajo; lo importante para el producto
es la regla: **una sola fuente por dato, y la pantalla nunca inventa una
segunda**.

**`ed_metricas` es una métrica zombie.** Busqué escritores en el portal (incluida
toda la historia de git), en Hqrespondo, en el motor respondo-2.0, en los
workflows n8n del repo, en el watchdog y en el bot de Instagram: **nadie escribe
esa tabla salvo las semillas de demo**. Inicio la mostraba igual. Se quitó de
Inicio (la tabla no se borra, por si la usa algo fuera de mi alcance). En
"Decisiones" va la consulta SQL para confirmarlo contra la base viva.

---

## C. Reglas de atención y prioridad

"Necesita tu atención" no es otra bandeja: es lo que el NEGOCIO tiene que hacer.

| Grupo | Qué entra |
|---|---|
| Urgente | cliente molesto, pidió hablar con una persona |
| Para hoy | tema delicado, problema técnico, el asistente no pudo, cliente esperando, dice que pagó — **de las últimas 24 horas** |
| Esta semana | lo mismo, entre 1 y 7 días |
| Por decidir | sugerencia de Beto por aprobar, falta el pago, cita que pasó sin cerrar |
| Más de 7 días | cualquiera de los anteriores con más de 7 días encima |

La prioridad la da la señal; el reloj solo decide en qué montón cae. Se separó
«Esta semana» al mirar Impresora en producción: «Para hoy» juntaba 75
conversaciones, casi todas de 4 a 7 días, y el rótulo dejaba de ser cierto.

Detalles que importan:

- **Nada de puntajes de IA.** La prioridad sale de señales reales y es
  reproducible: dos personas mirando los mismos datos ven el mismo orden.
- Un pendiente de hoy le gana a una derivación urgente de hace semanas: lo viejo
  se agrupa aparte para que no tape lo de hoy.
- "Cliente esperando" solo aplica si la conversación está en manos de una persona
  (o pausada), el cliente habló último y hace menos de 30 días.
- **"Ya lo atendí" ahora sirve de verdad:** al cerrar la derivación, esa
  conversación deja de pedir atención hasta que el cliente vuelva a escribir.
- Dos derivaciones de la misma clase son UNA fila, con la fecha de la más
  antigua.
- Cuando una conversación tiene varias cosas pendientes, la que se ofrece como
  siguiente acción es la de más peso, no la más antigua: si el cliente dijo que
  pagó, la acción es **confirmar el pago**, no «responder».

**Siguiente acción** (determinista, una por conversación): responder ·
confirmar pago · revisar sugerencia · enviar cobro · ver cita · devolver al
asistente · retomar.

---

## D. Cambios en Inicio

Inicio se rehizo para responder "¿qué pasa con cada cliente y qué tengo que
hacer?":

- **A · Necesita tu atención** — agrupado por urgencia, dice POR QUÉ y DESDE
  CUÁNDO, con el botón de la acción que corresponde. Los de más de 7 días van
  colapsados. Si hay más filas de las que caben, se despliegan ahí mismo (antes
  mandaba a la bandeja, que solo muestra derivaciones y no pagos ni sugerencias).
- **B · Por cerrarse** — cobros enviados esperando pago (con monto real de
  `ed_pagos`), cotizaciones en conversación, sin respuesta e interesados
  recientes. **No inventa ingresos:** solo hay monto donde hay un cobro emitido.
- **C · Tu equipo digital** — Tino, Beto, Vera e Isabel: qué está haciendo cada
  uno y qué resultado dio, con cifras registradas. Lo apagado se dice apagado
  ("El seguimiento automático de cotizaciones está apagado"), no se disfraza de
  actividad.
- **D · ¿Está funcionando?** — cuatro cifras confiables: conversaciones del mes,
  % de respuestas del asistente, tiempo ahorrado (marcado como estimado) y
  cobrado y confirmado (solo el dueño). Sin zombis y sin competir con Analítica.

Fuera de Inicio: `ed_metricas`, el "dinero ahorrado" inventado y la franja de
notificaciones permanente (ahora es un botón en la cabecera).

El dinero (cobrado, plan) lo ve solo el dueño.

---

## E. Cambios en Conversaciones (ficha lateral)

La ficha lateral no se reconstruyó: se reordenó con la misma jerarquía que usa
Inicio, alimentada por el mismo núcleo, de modo que la lista y la ficha nunca se
contradicen.

Orden: **Siguiente acción** (con su botón) → **Estado comercial** (etapa +
motivo + "antes estaba perdido", pago, seguimiento, próxima cita) → **Atención**
→ **Cliente** (canal, de qué anuncio llegó, desde cuándo, ventana de 24 h) →
**Qué pasó** (actividad) → cobros, pedido listo, etiquetas y nota, que ya
existían.

Además: el botón dice "Devolver a <el empleado que atiende ESE chat>", no
siempre "Tino"; y bajo 1280 px, donde la ficha es un cajón sobre el chat, al
tocar una acción el cajón se cierra (antes la acción quedaba detrás).

---

## F. Cambios secundarios

- **Embudo**: sigue con sus 5 etapas. Mover a Perdido ahora pregunta el motivo
  (sin respuesta · no le interesó · eligió a otro · pidió que no lo contacten ·
  otro). El motivo se ve en la tarjeta. "Pidió que no lo contacten" pone además
  la etiqueta que todo el producto ya respeta.
- **Pérdida anterior**: al reabrirse una conversación perdida se conserva por qué
  se perdió (en `datos.ultima_perdida`), y la ficha lo muestra. Sin migración.
- **Beto y "sin respuesta"**: perdido por silencio sigue siendo retomable; una
  pérdida explícita no, nunca. Y si alguien marca "no le interesó" y después
  devuelve la conversación al asistente, el cierre automático por silencio repite
  ese motivo en vez de convertirlo en "sin respuesta" (que sí sería retomable).
- **Seguimientos**: aprobar un envío pagado es solo del dueño; el staff ve las
  sugerencias y puede descartarlas. Sin RBAC nuevo.
- **Pagos**: tres estados distintos —esperando pago, dice que pagó (por
  confirmar) y confirmado—. Ganado ≠ pagado. Se puede registrar un pago recibido
  sin cobro previo, y un doble clic no duplica la plata.
- **Cerrar sesión y push**: al salir, ese navegador se desuscribe y la
  suscripción se borra en el servidor (por una cookie con la huella del
  endpoint), así el dueño no recibe avisos en el teléfono del local.
- **Orígenes/OAuth**: `lib/origenes.ts` centraliza el origen canónico y una lista
  explícita de orígenes de confianza; sin comodines, sin redirecciones armadas
  con lo que venga en la petición. Los enlaces (magic link, iCal, reservas,
  OAuth de Google/Instagram/WhatsApp) usan esa función.

---

## G. Decisiones visuales

Evolución acotada a lo que se tocó, no rediseño:

- Paleta: azul profundo `#1d3f8f` para acciones, cian `#0e7490` para acentos,
  neutros limpios, densidad B2B y tipografía legible (nada bajo 12 px).
- Se evitó: glassmorphism, degradados, sombras grandes, tarjetas dentro de
  tarjetas, pastillas en todo y animación decorativa.
- Referencias de calidad: Linear, Stripe, Intercom, Vercel.
- Los tokens nuevos (`--azul`, `--cian`, `--t-meta`) y las clases (`btn-azul`,
  `btn-fila`, `estado`, `rotulo`, `lista-filas`) conviven con el índigo actual.
  Cambiar el índigo global a azul en TODO el portal es una decisión aparte (ver M).
- Componentes consolidados solo donde había duplicación real: estado de etapa,
  estado de pago, estado genérico, avatar de empleado y "vacío".

---

## H. Rendimiento

Sin cascada por cliente. Inicio hace un número FIJO de consultas, no una por
conversación:

- 8 consultas de candidatos (incluida la cifra canónica de derivadas),
- hasta 8 consultas de hechos por cada 200 conversaciones candidatas,
- ~10 conteos de cabecera (equipo, cupo, pagos).

Hay una prueba automática que lo verifica: con 150 conversaciones más, el número
de consultas no cambia. La conversación abierta pasó de 7 a 10 consultas (todas
en paralelo) para traer propuestas, seguimientos y citas.

Las consultas tienen tope explícito (PostgREST corta en 1.000 filas sin avisar).
Si algo se corta, Inicio lo dice con un aviso en vez de mostrar un panorama
incompleto como si fuera completo.

---

## I. Pruebas

**684 pruebas pasando** (base de Fase 0: 640, ninguna borrada). Nuevas:

- `tests/estado-comercial.test.mjs` — prioridad, atención, estados de pago
  (incluido el caso "ganada a mano hoy con un cobro de hace 5 meses"), Beto,
  acciones contextuales, permisos de aprobación, coherencia del estado derivado y
  una matriz que verifica que la ficha y la reja de Beto digan lo mismo.
- `tests/estado-comercial-cargador.test.mjs` — armado de hechos, empleado y modo
  igual que la bandeja, aislamiento entre negocios, número constante de
  consultas, pago recibido (incluido el doble envío), motivos de pérdida y el
  caso "no le interesó" + "que la maneje el asistente" + cierre por silencio.
- `tests/origenes.test.mjs` — orígenes de confianza.
- `tests/push-vigentes.test.mjs` — resincronización y borrado por huella.

Typecheck diferencial contra la base: **sin errores nuevos**.

---

## J. Capturas antes / después

En `_fase1_respaldo/capturas/`:

- **Antes** (producción, Impresora, 11-sep): `antes_inicio.jpg`,
  `antes_conversacion.jpg`, `antes_embudo.jpg`.
- **Después** (render real de los componentes nuevos con datos ficticios del
  mismo volumen): `despues_inicio_escritorio.png`,
  `despues_inicio_escritorio_antiguos.png`, `despues_inicio_movil.png`,
  `despues_ficha_lateral.png` (4 casos: pago informado, perdido con Beto
  apagado, pidió persona reabierto, sugerencia de Beto vista por staff),
  `despues_embudo_tarjetas.png`.

Las de "después" son render estático: en este contenedor no hay `npm install`
(la política de red bloquea el registro). El recorrido con datos reales lo hago
en tu Chrome cuando levantes `npm run dev` (ver M).

---

## K. Archivos modificados

68 archivos (21 nuevos). Lista completa en `docs/FASE1_ARCHIVOS.txt`.

---

## L. Lo que NO se hizo (a propósito)

- **No se habilitó Beto** ni se envió ningún mensaje. Sigue apagado.
- **No se desplegó** ni se tocó producción. No hay migración nueva.
- **No se creó una tabla CRM** ni una pantalla por empleado: si después de usar
  esto una semana falta un lugar donde "ver a Vera entera", lo evaluamos; hoy no
  hay dato suficiente para justificar cuatro pantallas más.
- **No se borró `ed_metricas`** de la base, solo de la pantalla.
- **No se tocó `lib/ads/*` ni `(marketing)`** (área de la otra sesión).
- Quedan documentadas tres cosas menores que decidí no arreglar ahora:
  "Por cerrarse" no muestra los perdidos por silencio de 8 a 30 días (son el
  territorio de Beto, y Beto está apagado); Inicio pide el contexto del negocio
  antes de todo lo demás (un viaje en serie, ~100 ms); y el enlace mágico en
  desarrollo desde otra máquina de la red apunta a producción.

---

## M. Decisiones que dependen de ti

### 1. Confirmar que `ed_metricas` está muerta en la base viva

Yo verifiqué todo el código. Lo que no puedo ver desde acá son triggers en la
base y workflows de n8n editados en la UI. Corre esto en Supabase:

```sql
-- ¿Alguien escribió algo en los últimos 90 días?
select max(creado_en) as ultimo, count(*) as filas
from ed_metricas
where creado_en > now() - interval '90 days';

-- ¿Hay funciones o triggers que la escriban?
select p.proname
from pg_proc p
where pg_get_functiondef(p.oid) ilike '%ed_metricas%';
```

Si el primero devuelve 0 filas y el segundo nada, está confirmada como zombie y
se puede borrar la tabla más adelante. Si devuelve datos recientes, dime y
reviso qué la escribe antes de decidir.

### 2. Orígenes de confianza (Supabase y Vercel)

- En Supabase → Authentication → URL Configuration: deja **Site URL** con el
  dominio de producción y en **Redirect URLs** solo URLs exactas (producción y,
  si la usas, `http://localhost:3000/**`). **Sin comodines** de previews tipo
  `https://*.vercel.app`.
- En Vercel, si trabajas con un dominio extra (staging o un dominio propio),
  agrégalo como variable `NEXT_PUBLIC_ORIGENES_PERMITIDOS` con los orígenes
  exactos separados por coma (por ejemplo
  `https://portal.respondo.cl,https://staging.respondo.cl`). Si no la defines,
  solo vale el dominio canónico: es lo más seguro y probablemente lo que quieres.

### 3. ¿Cambio el índigo por el azul nuevo en TODO el portal?

Hoy el azul nuevo está solo en lo que toqué (Inicio, ficha, embudo, cobros). El
resto sigue índigo. Son dos colores parecidos conviviendo.

| Opción | A favor | En contra |
|---|---|---|
| Dejarlo así | Cero riesgo; cada pantalla se moderniza cuando se toca | Dos azules conviviendo un tiempo |
| Cambio global ahora | Coherencia inmediata | Toca ~40 archivos que no revisé en esta fase |

Mi recomendación: dejarlo así y hacer el cambio global como primer paso de la
fase siguiente, con capturas antes/después de cada pantalla.

### 4. ¿Hace falta una sección "Equipo"?

Mi recomendación: **no por ahora**. La tarjeta de "Tu equipo digital" en Inicio
ya dice qué hace cada uno y qué resultado dio, y cada enlace lleva al lugar donde
se trabaja. Cuatro pantallas nuevas serían cuatro lugares más que mantener al
día. Si al usarlo echas de menos algo concreto, lo agregamos con ese caso en la
mano.

### 5. Beto sigue apagado

Toda la interfaz de Beto ya es honesta (sugerida, esperando aprobación,
programada, enviada, descartada) y aprobar un envío pagado es solo tuyo. Cuando
quieras encenderlo lo hacemos en un paso aparte, mirando primero cuántas
sugerencias genera en seco.

### 6. Recorrido real

Cuando puedas, levanta `npm run dev` en tu PC y avísame: recorro Inicio,
Conversaciones (varios clientes), Embudo y la vista de staff en tu Chrome con
datos reales, y arreglo lo que aparezca.

### 7. Migraciones duplicadas — resuelto

Había dos archivos con el número 304. El de Beto pasó a ser
`sql/306_propuestas_memoria.sql` (304 lo ocupa `304_marketing_endurecimiento.sql`,
ya aplicada, y 305 la autorización fail-closed). El contenido no cambió y sigue
sin aplicar: se corre solo cuando decidas encender el seguimiento de Beto, y
requiere la 297.
