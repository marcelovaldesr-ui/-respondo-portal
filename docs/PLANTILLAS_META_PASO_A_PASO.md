# Plantillas de Meta — alta, aprobación y verificación

**Estado del código:** listo y con typecheck limpio (19-ago-2026).
**Falta:** dar de alta las 7 plantillas en el WABA de cada cliente. Sin eso, Beto y Vera
siguen sin poder escribir fuera de la ventana de 24 horas.

---

## 1. Por qué hacía falta esto

Meta solo acepta texto libre durante las **24 horas siguientes al último mensaje que
escribió el cliente**. Todo lo que hacen Beto y Vera es lo contrario: escribirle a alguien
que no ha escrito hace semanas. Fuera de esa ventana, un `type: "text"` se rechaza con el
error **131047**.

Antes de este cambio, `lib/whatsapp.ts` solo sabía armar `type: "text"`. Es decir: el rol
de seguimiento que le vendimos a RS-Shop no podía funcionar. Ahora el cron decide solo:

- **Ventana abierta** → texto libre. Es gratis y se lee más natural.
- **Ventana cerrada** → plantilla aprobada, que dice **exactamente lo mismo** porque el
  texto se renderiza desde el mismo cuerpo.
- **Ventana cerrada y sin plantilla** (el botón manual de reactivación del portal, donde
  la persona escribe el mensaje a mano) → no se envía, **no se quema el intento**, y queda
  pendiente. Si el cliente escribe en las horas siguientes, sale solo.

---

## 2. Qué se tocó en el código

| Archivo | Qué cambió |
|---|---|
| `lib/plantillas.ts` | **Nuevo.** Catálogo: cuerpo, categoría, variables y ejemplos de las 7 plantillas, más `render()` y las validaciones de las reglas de Meta. |
| `lib/ventana24.ts` | **Nuevo.** `ventanaAbierta()`: mira si el cliente escribió en las últimas 24 h. Consulta por **todos** los empleados del negocio, porque la ventana es del número, no de Tino. Ante la duda devuelve `false`. |
| `lib/whatsapp.ts` | `enviarPlantilla()` — POST `type: "template"` con `name`, `language` y los parámetros del body. |
| `lib/seguimientos.ts` | `programarSeguimiento` acepta `paramsPlantilla` y renderiza el texto desde el cuerpo aprobado. El transporte ahora recibe `{tipo, plantilla, params}` y puede devolver `omitido: true` sin consumir el intento. |
| `lib/agendaSeguimientos.ts` | Los tres seguimientos de cita (confirmación, recordatorio, encuesta de Vera) programan con plantilla. El nombre del negocio se resuelve dentro de la función, no en los cuatro puntos que crean citas. |
| `app/api/cron/seguimientos/route.ts` | Elige texto libre o plantilla según la ventana. |

**No hubo migración**: `ed_seguimientos` ya traía `plantilla_meta` y `variables`.

---

## 3. Las 7 plantillas

Se dan de alta en **Meta Business Suite → WhatsApp Manager → Plantillas de mensajes →
Crear plantilla**, una por una, en el WABA del cliente.

Para cada una:

- **Nombre:** exactamente el de abajo (minúsculas y guion bajo; si no calza, el envío
  falla con el error 132001).
- **Categoría:** la indicada. Meta reclasifica por su cuenta si cree que corresponde otra.
- **Idioma:** Español (`es`). No `es_MX` ni `es_AR`: el código pide `es`.
- **Encabezado, pie y botones:** ninguno. Solo cuerpo.
- **Cuerpo:** copiar y pegar tal cual, respetando los saltos de línea.
- **Ejemplos:** Meta los pide para revisar; usar los de la columna "ejemplo".

### 3.1 `cita_confirmacion` — utilidad

```
Hola {{1}}, te esperamos mañana para tu {{2}} ({{3}}).

¿Nos confirmas que vienes? Si necesitas moverla o anularla, puedes hacerlo acá:
{{4}}

Cualquier duda, respóndenos por este mismo chat.
```

`{{1}}` nombre · `{{2}}` servicio · `{{3}}` día y hora · `{{4}}` enlace de gestión
Ejemplos: `Cristian` · `mantención programada` · `jueves 21 a las 10:00` · `https://respondo.cl/cita/abc123`

### 3.2 `cita_recordatorio` — utilidad

```
Hola {{1}}, te recordamos tu {{2}} de hoy a las {{3}}.

Si no vas a poder llegar, avísanos acá y liberamos la hora:
{{4}}

¡Te esperamos!
```

`{{1}}` nombre · `{{2}}` servicio · `{{3}}` hora · `{{4}}` enlace de gestión
Ejemplos: `Cristian` · `mantención programada` · `10:00` · `https://respondo.cl/cita/abc123`

### 3.3 `encuesta_postventa` — utilidad · **Vera**

```
Hola {{1}}, gracias por venir hoy a {{2}}.

De 1 a 5, ¿cómo evaluarías la atención? Tu respuesta la lee el equipo, no un buzón.
```

`{{1}}` nombre · `{{2}}` nombre del negocio
Ejemplos: `Cristian` · `RS-Shop`

### 3.4 `mantencion_toca` — **marketing** · **Beto**

```
Hola {{1}}, te escribimos de {{2}}. Según nuestro registro, tu {{3}} ya está en fecha de {{4}}.

Si quieres, te dejamos la hora coordinada por acá. Y si prefieres que no te escribamos más, respóndenos BAJA y no volvemos a molestarte.
```

`{{1}}` nombre · `{{2}}` negocio · `{{3}}` moto · `{{4}}` próximo servicio
Ejemplos: `Cristian` · `RS-Shop` · `KTM 390 Duke 2023` · `su próxima mantención`

> Es la única de categoría marketing (≈ $85 en vez de ≈ $18) porque es la única donde el
> negocio inicia algo nuevo en vez de continuar una transacción del cliente. La salida
> ("respóndenos BAJA") va en el cuerpo a propósito: Meta mira eso al revisar plantillas de
> marketing, y además es lo correcto.

### 3.5 `cotizacion_pendiente` — utilidad · **Beto**

```
Hola {{1}}, te escribimos de {{2}} por la cotización de {{3}} que nos pediste.

¿Sigue en pie? Si nos dices que sí, la retomamos hoy mismo.
```

`{{1}}` nombre · `{{2}}` negocio · `{{3}}` lo cotizado
Ejemplos: `Cristian` · `RS-Shop` · `kit de arrastre para KTM 390 Duke`

### 3.6 `repuesto_llego` — utilidad · **Beto**

```
Hola {{1}}, buenas noticias: llegó el {{3}} que estabas esperando en {{2}}.

Queda reservado a tu nombre. ¿Lo pasas a buscar o prefieres que lo despachemos?
```

`{{1}}` nombre · `{{2}}` negocio · `{{3}}` repuesto
Ejemplos: `Cristian` · `RS-Shop` · `kit de arrastre`

### 3.7 `moto_lista` — utilidad · **Beto**

```
Hola {{1}}, tu {{3}} ya está lista para retirar en {{2}}.

Te esperamos en el horario que te acomode. Si necesitas coordinar el retiro, respóndenos por acá.
```

`{{1}}` nombre · `{{2}}` negocio · `{{3}}` moto
Ejemplos: `Cristian` · `RS-Shop` · `KTM 390 Duke`

---

## 4. Reglas de Meta que ya están cubiertas

`validarCuerpo()` en `lib/plantillas.ts` las chequea, y de hecho **cazó dos plantillas mal
escritas** antes de mandarlas a revisión: `cita_confirmacion` y `cita_recordatorio`
terminaban con la variable del enlace, cosa que Meta rechaza.

- El cuerpo no puede empezar ni terminar con una variable.
- Dos variables no pueden ir pegadas.
- La numeración va de 1 a N sin saltos.
- Máximo 1024 caracteres.
- Un **valor** de variable no puede traer saltos de línea, tabs ni 4 espacios seguidos.
  De eso se encarga `limpiarParam()` en cada envío: un nombre copiado de un Excel trae
  cualquiera de las tres cosas más seguido de lo que uno cree.

---

## 5. Cómo verificar que quedó bien

1. **Que Meta las aprobó.** En WhatsApp Manager las 7 deben aparecer en verde. Suele
   tardar de minutos a 24 horas. Si alguna queda en rojo, el motivo aparece al costado.

2. **Que el nombre y el idioma calzan.** Un `132001` en el log del cron significa que la
   plantilla no existe con ese nombre/idioma en ese WABA. Es el error más común y no tiene
   nada que ver con el texto.

3. **Prueba de punta a punta**, con un número propio que **no** haya escrito en 24 h:
   agendar una cita para pasado mañana y verificar que la confirmación sale como plantilla.
   Si sale como texto libre es que la ventana estaba abierta — hay que probar con un
   número frío de verdad.

4. **Que el portal muestra lo mismo que llegó al teléfono.** Es la garantía del diseño: el
   texto de `ed_mensajes` se renderiza desde el mismo cuerpo. Si difieren, alguien editó
   `plantillas.ts` sin volver a dar de alta la plantilla.

---

## 6. Lo que todavía falta para que Beto funcione completo

Las plantillas resuelven **cómo** se manda. Falta el **cuándo y a quién**:

1. **Importar la lista de clientes** (nombre, teléfono, moto, fecha de última atención,
   qué se le hizo) a `ed_contactos`. Hoy no existe un importador.
2. **Generar los seguimientos.** El motor es inerte a propósito: no crea filas solo. Falta
   la pieza que, con el intervalo de mantención configurado, calcule a quién le toca
   ahora y programe el `mantencion_toca`. Los tres de la agenda ya se generan solos;
   los de Beto no.
3. **El botón manual de reactivación** (`cliente_inactivo`, texto libre desde el portal)
   sigue sin poder salir fuera de la ventana. Hoy queda pendiente en silencio; conviene
   que el portal lo advierta al escribirlo, o convertirlo en una plantilla con variables.

Con 1 y 2 hechos, Beto queda operativo. Vera ya lo está: su encuesta se programa sola al
cerrarse cada cita.
