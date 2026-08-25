# Auditoría de la plataforma y hacia dónde apuntar

**Fecha:** 21 de agosto de 2026
**Alcance:** `respondo-portal` en su estado actual, cruzado contra el catálogo de las 34
herramientas de Vita y el playbook de lecciones (`ChatBot Ventas/Vita/`).
**Método:** todo lo que se afirma acá se verificó leyendo el código, no la memoria ni los
documentos comerciales. Donde no pude verificar, lo digo.

---

## 1. Qué logramos, en una frase

**Tino dejó de ser un bot que contesta y pasó a ser un empleado que opera un turno
completo.** Esa es la diferencia entre lo que había en julio y lo que hay hoy.

Concretamente, en agosto se cerraron cuatro cosas que antes rompían el producto:

| Qué | Por qué importaba |
|---|---|
| **Agenda multi-rubro** con autogestión y calendarios | El *job* que se vende. Sin esto Tino solo conversa. |
| **Cupos y excedentes medidos** | Se empezó a medir la unidad que se cobra. Antes se vendía a ciegas. |
| **Tokens cifrados** (WhatsApp e Instagram) | Con el token en texto plano, cualquiera con acceso a la base podía escribir haciéndose pasar por el negocio. |
| **Plantillas de Meta** | El seguimiento **no podía funcionar** por Cloud API y fallaba en silencio. Beto y Vera existían en el papel, no en la realidad. |

Lo último es el más importante y el menos visible: **Beto y Vera no eran vendibles hasta
esta semana.** Ahora lo son — con un bloqueante operativo pendiente (el método de pago del
WABA).

---

## 2. Inventario verificado: qué hay hoy

### Módulos del portal
`inicio` · `conversaciones` · `agenda` · `clientes` · `embudo` · `analitica` · `insights` ·
`informacion` · `probar` · `whatsapp`

### Canales
WhatsApp por **WAHA** (solo Impresora Color) y por **Cloud API** (todo cliente nuevo),
más **Instagram Direct** (enviado a revisión de Meta el 19-ago).

### Lo que Tino sabe hacer por su cuenta

Tino no usa *function calling*: responde con un JSON estructurado que el sistema
interpreta. Sus acciones con efecto real son **tres**, y las tres son de agenda:

- `agendar`
- `reagendar_cita`
- `cancelar_cita`

Todo lo demás que hace —cotizar, calificar, derivar— vive en el texto de la conversación,
no en un cambio de estado del negocio.

**Esta es la observación central de la auditoría.** Volveremos a ella en el punto 3.

### Empleados que existen en código
`tino` · `rita` (marca: **Beto**) · `vera`.

**`isabel` no existe en la plataforma.** Ver punto 4.

---

## 3. Las tres brechas de Vita, verificadas contra nuestro código

El playbook de agosto proponía tres jugadas. Las revisé una por una contra el repositorio
para ver cuánto seguía siendo cierto.

### Brecha 1 · Cobrar dentro de la conversación — **abierta, y es la más grande**

Vita tiene `create_plan_purchase` y `generate_payment_link`.

**Nosotros no tenemos una sola línea de código de pagos.** Busqué `webpay`, `transbank`,
`fintoc`, `mercadopago`, `flow`: cero resultados en `lib/` y en `app/`.

> ⚠️ Aviso de método: `lib/presupuesto.ts` **no** es un cotizador. Es el presupuesto de
> *tiempo* de las funciones de Vercel. El nombre engaña.

**Por qué importa comercialmente:** es lo único que separa «un asistente que agenda» de
«una operación que produce ingresos». Mientras Tino agenda y deja que el negocio cobre
después, el cliente puede atribuirle el mérito a su propio equipo. Cuando el link de pago
sale en la conversación, **el ingreso queda trazado a Tino** — y ahí el precio deja de
compararse contra un chatbot y empieza a compararse contra un vendedor.

Es exactamente el salto de categoría que hizo Vita para pasar de $50.000 a $699.990.

### Brecha 2 · El CRM — **NO estaba abierta; lo resolvimos distinto**

> ⚠️ **Corrección.** La primera versión de este documento decía que «el embudo es una foto
> que alguien mantiene a mano». **Es falso** y lo escribí sin leer `cargarEmbudo()`.

Lo que hay de verdad: el motor devuelve `accion`, `lead.clasificacion`, `escalar` y
`trigger`; `etiquetasDesdeMotor()` los convierte en etiquetas; `etapaSegunSenales()` mapea
esas etiquetas a una etapa; y `cargarEmbudo()` **recalcula y escribe** cuando la etapa
cambió de verdad. Hay además un `ORDEN` que impide retroceder solo y un `etapaManual` que
respeta la corrección humana.

O sea: **el embudo sí se mueve solo.** La diferencia con Vita no es que ellos escriban el
CRM y nosotros no — es **quién decide**:

| | Vita | Respondo |
|---|---|---|
| Quién mueve la etapa | El agente llama `move_patient_funnel_stage` con el nombre que él elija | El sistema la **deriva** de un vocabulario fijo de señales |
| Etapas | Configurables por institución | Cinco, fijas en código |
| Si el modelo se equivoca | Mueve mal la etapa | No puede: solo existen las señales que sabe emitir |
| Auditable | Depende del criterio del modelo | Determinista y reproducible |

**Nuestro diseño es defendible y encaja con lo que vendemos** («no inventa»). Las brechas
reales son otras, más chicas: las etapas **no son configurables por cliente** y el recálculo
ocurre **al abrir la página**, no al llegar el mensaje — decisión consciente para no
mantener otro cron, pero significa que un tablero cerrado está desactualizado.

### Brecha 3 · Botones nativos de WhatsApp — **abierta, y es barata**

`lib/whatsapp.ts` **sabe recibir** respuestas de botón (`interactive.button_reply`,
`list_reply`) pero **no sabe enviarlos**.

Es la mejora de mejor relación esfuerzo/efecto de toda la lista: cambia la sensación del
producto en la demo (se ve nativo, no un bot que pide que escribas «1») y reduce los
malentendidos de la conversación. Un día de trabajo, como mucho.

### Otras de la lista, más chicas

| Jugada | Estado |
|---|---|
| No agendar en feriados | 🟡 parcial — `feriado` solo aparece en `lib/clases.ts` |
| Etiquetas automáticas | ✅ `etiquetasDesdeMotor()` las escribe desde la salida del motor |
| Atribución de campaña (`detect_and_attribute_campaign`) | ❌ — verificado: **no leemos el `referral` que Meta manda** en los mensajes de Click-to-WhatsApp |
| Escalamiento con reglas (`notify_responsible`) | 🟡 detectamos y marcamos (`escalar`, `reclamo`, `esperandoHumano`); **falta avisarle a una persona** |
| Enviar imágenes nativas | ✅ |
| Seguimientos programados y cancelables | ✅ (esta semana) |

---

## 4. Un hallazgo que no venía de Vita: la web promete un empleado que no existe

`respondo-astro` publica **cuatro** empleados —Tino, Beto, Vera e **Isabel**— con página
propia (`/empleados/isabel`), foto y descripción:

> «Le responde a tu propio equipo sobre tus documentos internos —políticas, precios,
> contratos— citando de dónde salió cada dato.»

Y el bloque de equipo afirma:

> «No son cuatro bots sueltos: trabajan juntos en la misma plataforma y comparten la memoria
> de cada cliente.»

**En la plataforma solo existen `tino`, `rita` y `vera`.** Isabel no está construida.

Esto cae justo en el error nº3 que le anotamos a Vita en su propia checklist —*no prometer
funciones no construidas*— y es más grave para nosotros que para ellos, porque nuestra
diferenciación declarada es la honestidad y la cercanía. Si un prospecto pide ver a Isabel
en la demo, no hay demo.

**Hay dos salidas y las dos son legítimas:** construir una primera versión de Isabel (es la
más simple del roster: preguntas y respuestas sobre documentos del cliente, sin escribirle a
nadie) o sacarla de la web hasta que exista. Lo que no se puede es dejarla publicada como
está.

> Detalle menor del mismo orden: existen `beto.astro` **y** `rita.astro` como páginas
> separadas. El rol interno se llama `rita` y la marca es Beto; conviene que la web no
> muestre las dos.

---

## 5. Hacia dónde apuntar, en orden

El criterio de orden es: **primero lo que desbloquea vender, después lo que sostiene lo
vendido, al final lo que amplía.**

### Ahora (esta semana)

1. **Método de pago del WABA.** Bloquea a Beto y Vera por completo. No es código.
2. **Subir la recategorización de `cotizacion_pendiente`.** Está sin commitear; el catálogo
   declara $18 para algo que Meta cobra a $85.
3. **Decidir qué pasa con Isabel.** Es una decisión de 5 minutos con consecuencias
   comerciales.

### Antes del primer cliente que paga

4. **Fase 1 de la migración (G1-G3).** Verificado que sigue abierto: `DEBOUNCE_MS = 6000`
   fijo en `lib/inboundMeta.ts`, sin «escribiendo…» y sin la guardia anti-fantasma.
   **No es preparación para migrar Impresora: es el estado en que recibiríamos al primer
   cliente nuevo**, porque todo cliente nuevo entra por Cloud API. Hoy ese camino conversa
   peor que el de WAHA.
5. **Botones nativos.** Un día, y cambia la demo.

### El salto de categoría (próximas 4-6 semanas)

6. **Link de pago en la conversación.** Empezar por **un** proveedor y **un** caso: cobrar
   la reserva de una cita. No construir un módulo de pagos genérico.
7. **Etapas configurables por cliente** y recálculo al llegar el mensaje, no al abrir la
   página. (El embudo ya se mueve solo — ver la corrección del punto 3.)
8. **Avisarle a una persona cuando hay que escalar.** Hoy se marca el chat y se espera que
   alguien lo vea. Copiar el criterio de `urgency` de Vita: en «normal» no se le dice nada
   al cliente; en «urgente» se le avisa honestamente que se alertó a alguien.
9. **Leer el `referral` de Click-to-WhatsApp.** Meta ya lo manda; hoy lo tiramos. Es saber
   qué aviso trajo a cada cliente sin instrumentar nada.

### Ampliación (cuando haya 3-5 clientes pagando)

8. Isabel de verdad (base de conocimiento interna con citas de la fuente).
9. Atribución de campaña, etiquetas automáticas, feriados, escalamiento con reglas.
10. Panel de configuración por cliente — el paso 4 de la evolución hacia SaaS.

---

## 6. Lo que NO haría ahora

- **Un módulo de pagos completo.** Un caso, un proveedor, un flujo. La tentación va a ser
  modelar planes, suscripciones y descuentos como Vita; ellos tienen ese modelo porque
  venden gimnasios con mensualidad, no porque haga falta para cobrar una cita.
- **Perseguir las 34 herramientas de Vita.** Más de la mitad son de su modelo de datos
  sanitario. Copiar el catálogo es copiar su negocio, no mejorar el nuestro.
- **Migrar Impresora Color todavía.** No paga plan y es el conejillo de indias ideal
  *después* de la Fase 1, no antes.
- **Multi-sede, multi-idioma o app móvil.** Nadie lo ha pedido.

---

## 7. Riesgos abiertos

| Riesgo | Estado |
|---|---|
| Fallo del portal «i is not a function» | Dejó de reproducirse, sin causa confirmada. Mapas de origen activos esperando el próximo caso. |
| `productionBrowserSourceMaps` publicando el código del cliente | ⚠️ **activo**. Quitar cuando se cierre el anterior. |
| Ley 21.719 (datos personales, Chile) | Aplica en **dic-2026**. Falta razón social, términos y política de datos publicados. |
| `prompt-nucleo.md` maestro desfasado respecto de `lib/promptEmpleado.ts` | Abierto. Riesgo de que alguien edite el archivo equivocado. |
| `AvisoVersion` y `VigilanteDeVersion` duplicados | Abierto, de bajo impacto. |
| Verificación de negocio del WABA (`not_verified`) | Limita el tier de envío. Importa si RS-Shop expande a sus ocho sucursales. |

---

## 8. La conclusión, sin adornos

La plataforma **ya sostiene el producto que se está vendiendo**: agenda, conversación,
seguimiento, dos canales, cupos medidos y tokens cifrados. Eso no es poco y es lo que había
que tener antes de cobrar.

Lo que falta no es *más plataforma*: es **una capacidad que cambie de qué se está hablando
en la reunión de ventas.** Hoy Respondo compite en la categoría «asistente que atiende», y
en esa categoría el techo de precio lo pone el chatbot más barato del mercado.

Cobrar dentro de la conversación y escribir el CRM solo son las dos que mueven a Respondo a
la categoría «esto opera parte de tu negocio». Es la misma jugada que hizo Vita — y la
hicieron, conviene recordarlo, **sin escribir una línea de código nueva**: cambiaron la
narrativa. Nosotros necesitamos las dos cosas, porque queremos que la narrativa sea cierta.
