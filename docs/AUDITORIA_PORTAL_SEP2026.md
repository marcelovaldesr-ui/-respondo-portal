# Auditoría integral del portal de Respondo

**11 de septiembre de 2026 · Producto + UX + arquitectura + seguridad + operación**

> Esta es la fase de entendimiento. No hay rediseño ni funcionalidades nuevas. Solo arreglé cuatro cosas porque eran seguridad o riesgo productivo evidente (sección C.0).

---

## Cómo leer este documento

- **Arriba está lo que decide.** Resumen, críticos y roadmap. Lo demás es evidencia.
- **Cada hallazgo importante cita el archivo y la línea**, o dice qué vi en el portal en vivo.
- **[V]** = verificado leyendo código o viéndolo en producción. **[S]** = sospecha fundada que hay que confirmar con la base de datos.

### Qué se hizo y qué no se pudo hacer

| Verificación | Resultado |
|---|---|
| Lectura del código completo (app, components, lib, sql 200–303, tests) | Hecha, con 6 revisiones en paralelo por dominio y verificación propia de los hallazgos críticos |
| Tests unitarios (`npm test`) | **508/508 verdes** (más 2 nuevos míos: 510) |
| Recorrido del portal en producción (tenant Impresora Color), solo lectura | Hecho: Inicio, Conversaciones y un chat, Agenda, Embudo, Clientes, Cobros, Analítica, Informe, Isabel, Información, Probar, WhatsApp, Seguimientos, Marketing, /estado |
| `tsc`, `lint`, `next build` | **No se pudieron correr.** Esta sesión no tenía salida a registry.npmjs.org ni a Supabase desde el entorno de trabajo, y el puente a tu PC no montó (update de Windows del 8-sep). **Antes de desplegar mis cambios hay que correr `npm run check`.** |
| Playwright / flujos que escriben datos (lead nuevo, cobro, cita) | No se hicieron contra producción a propósito. Los flujos se reconstruyeron desde el código |
| Responsive en vivo | Limitado: tu Chrome está al 50 % de zoom y en segundo plano. El responsive se revisó en código |

---

## Resumen en una página

**Qué producto tenemos hoy.** Un portal sorprendentemente completo:
- bandeja con toma de control,
- embudo automático,
- agenda con reserva pública y Google Calendar,
- cobros en el chat,
- seguimientos con plantillas de Meta y juez de IA,
- analítica, informe semanal, Isabel,
- WhatsApp Cloud + Instagram,
- PWA con avisos,
- API para sistemas externos,
- Marketing separado.

La ingeniería de base es seria: webhooks firmados e idempotentes, aislamiento por negocio en todas las acciones revisadas, tokens cifrados, RLS, tests.

**El problema no es que falten funcionalidades. Es que el portal no dice la verdad de forma consistente.** Hay cinco fuentes de desconfianza, todas verificadas:

1. **Números que no cuadran entre pantallas.** "Conversaciones" tiene 8 definiciones distintas. En vivo, Impresora ve *101 conversaciones este mes* en Inicio y *380 en 30 días* en Isabel. "Te esperan" dice 52 en el menú y 53 en Inicio.
2. **Tarjetas que siempre marcan 0.** Beto ("Cotizaciones retomadas", "Clientes reactivados", "Ventas recuperadas") y Vera ("Reseñas") muestran tipos de resultado que **ningún código escribe**. En Impresora, Beto se ve con tres ceros permanentes.
3. **El estado comercial vive en cuatro lugares que no se hablan.** La etapa del embudo, la etiqueta "Falta pago", el cobro y la venta detectada. En vivo: **20 chats con "Falta pago" y 0 cobros pendientes**. Marcar un cobro como pagado no mueve la etapa. El embudo solo se recalcula cuando alguien abre /embudo.
4. **Tino es más chico de lo que el portal comunica.**
   - **No ve imágenes ni escucha audios.** Un audio lo deriva en silencio.
   - En una imprenta la imagen *es* el pedido, y el propio Informe de Impresora lo reporta como la principal frustración.
   - En Impresora, **356 de 519 chats están "con tu equipo" y solo 111 con Tino**. El 28 % de las respuestas las escribe la IA. Tino no recupera el control solo.
5. **Procesos automáticos que fallan en silencio.**
   - Informe semanal: bloqueado desde el 24-30 ago en Impresora.
   - Cola de seguimientos atascable (arreglado hoy).
   - Modo aprobación de Beto que no va a funcionar al encenderlo.
   - Google Calendar que falla abierto.

**Qué haría primero (Fase 0, ~1 semana):** cerrar los riesgos restantes de seguridad y los procesos que fallan en silencio.

**Después (Fase 1, 2-3 semanas):** una sola **"capa de estado comercial"** por contacto (etapa + dinero + próxima cita + próximo seguimiento + qué necesita de ti), calculada en segundo plano. Con ella se reconstruyen Inicio, el panel lateral del chat y el embudo, **sin agregar pantallas**.

**Fase 2:** Tino multimodal (audio e imagen), agenda multi-profesional correcta y Beto visible.

**Lo que no haría:** omnicanal, CRM configurable, RBAC, dashboards, contabilidad, publicar campañas por API.

---

# A. Mapa del producto actual

## A.1 Rutas del portal (menú) — qué es cada una en realidad

| Ruta | Para qué sirve (real) | Quién | Lee | Escribe | Permiso real | Observación clave |
|---|---|---|---|---|---|---|
| **/inicio** | Resumen: esperando, por cerrarse, ahorro, equipo digital, cobros del mes, plan | Dueño y staff | escalaciones, contactos, mensajes, `ed_metricas`, resultados, pagos, cupo | — | cualquier usuario | Mezcla mes calendario, 30 días móviles y datos sembrados (C.2) |
| **/conversaciones** | Bandeja + chat + panel lateral | Staff | contactos (RPC 293), mensajes, estado del chat, pagos, escalaciones | modo, mensajes, etiquetas, cobros, pedido listo | `operar_conversaciones` | 11 chips de filtro; tiempo real por SSE + refresco cada 25 s |
| **/agenda** (+ `/configuracion`, `/clases`) | Calendario, citas manuales, servicios, profesionales, horarios, bloqueos, página pública, Google, iCal | Dueño y staff | citas, servicios, profesionales, horarios, bloqueos, Google freeBusy | todo lo anterior | ver: cualquiera; operar: staff; configurar: dueño | Visible para una imprenta sin agenda (en vivo: "Crear al menos un servicio") |
| **/embudo** | 5 columnas por etapa | Dueño y staff | contactos + señales | **escribe etapas al abrir** + avisa al puente externo | cualquiera | Un GET con efectos secundarios (C.3) |
| **/clientes** (+ `/[chatId]`) | Lista de contactos y ficha con historial | Staff | contactos, mensajes (primeros 1.000), resultados | ficha, nota, reactivar | ver: cualquiera; editar: staff | "Último mensaje" calculado con los *primeros* 1.000 mensajes |
| **/cobros** | Lista de cobros emitidos | Dueño y staff | `ed_pagos` | marcar pagado / anular | cualquiera | En Impresora: $0 y 0 cobros; el pago real va por transferencia fuera del módulo |
| **/analitica** | Ahorro, % IA, fuera de horario, mapa de calor, "¿Vuelve la gente?" | Dueño y staff | todos los mensajes del período (hasta ~100 mil filas) | envía el informe de fidelización al WhatsApp del dueño | cualquiera | Sueldo de referencia fijo de $800.000 para todos los negocios |
| **/insights** ("Informe") | Informe semanal generado por IA | Dueño y staff | 40 conversaciones de la semana | `ed_insights` | ver: cualquiera; generar: dueño | Automático roto (C.1.3) |
| **/isabel** | Preguntas al negocio | Solo dueño | panorama (~25 consultas), historial, fichas, memoria | consultas, correcciones | `preguntar_isabel` | Staff no ve Isabel, pero sí ve Informe y Analítica con el mismo contenido sensible |
| **/informacion** | Conocimiento + logo + configuración de cobros + correcciones + plantillas demo | Dueño | `ed_conocimiento`, `ed_correcciones` | fichas, logo, enlace de pago | `editar_conocimiento` | Mezcla identidad, cobros y conocimiento; botón que carga fichas demo ficticias como reales |
| **/probar** | Chat de prueba con el prompt | Dueño | prompt real sin bloque de agenda | — | página: cualquiera; API: dueño | Por defecto abre **Beto**, no Tino (visto en vivo); staff ve la página pero cada mensaje falla |
| **/whatsapp** | Conexión Meta (Embedded Signup), Instagram, checklist | Dueño | `ed_clientes`, Graph API | credenciales cifradas | `gestionar_integraciones` | Expone jerga técnica (IDs, SQL, migraciones) |
| **Marketing** (`/marketing/*`) | Producto aparte: atribución, campañas, creatividades, copiloto | Dueño | Meta Ads (solo lectura), atribución de contactos | borradores, creatividades | `generar_insights` (dueño) | Bien separado (riel propio, puerta al pie del menú) |

## A.2 Rutas que existen pero no se ven desde el menú

| Ruta | Qué es | Problema |
|---|---|---|
| **/seguimientos** | Aprobación de propuestas de Beto | **No tiene ningún enlace.** Si Beto se enciende en modo aprobación, nadie las verá |
| /agenda/clases, /agenda/configuracion | Subpáginas | Correctas, se llega desde Agenda |
| **/estado** | Diagnóstico de la plataforma | **Cualquier usuario de cualquier negocio ve cuántos clientes, empleados y usuarios tiene Respondo** (en vivo: 7 / 19 / 6) |
| /reservar/[slug] | Reserva pública | Pública, bien validada en el servidor |
| /cita/[token] | Autogestión de la cita (cancelar, reagendar) | Pública con token de 144 bits |
| /api/agenda/ical/[token] | Calendario iCal | Público con token; incluye teléfonos (por diseño) |
| /api/externo/* | API firmada para sistemas del cliente (Gestión de Impresora) | Firma "vieja" sin nonce todavía aceptada |
| /api/integraciones/pedidos | Webhook "pedido listo" desde un ERP | Sin pantalla ni documentación para el cliente |
| /api/salud, /api/version, /api/error-cliente | Monitoreo | Correctos; el detalle de salud reutiliza el secreto del cron |
| /sin-acceso, /sin-permiso, /sin-conexion | Estados del sistema | OK |
| /pauta/* | Redirige a /marketing | OK |

## A.3 Procesos automáticos — un solo cron hace todo

`/api/cron/seguimientos` lo dispara cron-job.org cada 5 minutos, con 60 s de vida. En orden:

1. Genera avisos de mantención.
2. Envía la cola de seguimientos.
3. Informe semanal (lunes).
4. Conversiones a Meta.
5. Destilado nocturno de Isabel.
6. Renovación del token de Instagram.
7. Avisos de cupo.
8. Reintento de webhooks (2 por corrida).
9. Vigilante de chats abandonados (apagado).
10. Reconciliación de etiquetas.
11. Detector de cierres con IA (4 por corrida, global).
12. Archivado de adjuntos (Meta los borra a los 7 días).
13. Generador de seguimientos de cotización (apagado).
14. Latido.

**Riesgo de fondo [V]:** no hay candado contra dos corridas simultáneas. Varios pasos toman "los primeros N sin orden" y tienen el patrón *el primero bloquea a los demás*.

## A.4 Integraciones

- **WhatsApp Cloud API:** canal principal, Coexistencia y plantillas por rubro.
- **WAHA:** código vivo pero dormido.
- **Instagram:** DM, OAuth propio, token renovable.
- **Google Calendar:** cuenta de servicio compartida u OAuth por profesional.
- **Gemini:** Tino, juez, detector de cierres, Isabel, informe, creatividades.
- **Meta Ads:** solo lectura, más la API de Conversiones.
- **Supabase:** base, auth por magic link, Storage con buckets `adjuntos` (privado), `logos` y `creatividades` (públicos).
- **Web Push:** avisos al teléfono.
- **Puente de salida HMAC:** manda al sistema del cliente cada entrante y cada cambio de etapa.

## A.5 Los cuatro empleados: lo que dice el portal vs. lo que hace el código

| | Lo que comunica | Lo que hace de verdad |
|---|---|---|
| **Tino** | "Responde consultas, cotiza y agenda apenas llega el mensaje" | Responde texto con el conocimiento cargado. **No hay tool-calling:** el modelo devuelve un JSON y solo 3 cosas tienen efecto (derivar, cita con token válido y etiquetas). "Cotizar" = poner la etiqueta `cotizacion`: **no genera cotización ni monto**. **No ve imágenes, no transcribe audio** (el audio lo deriva sin responder), no guarda adjuntos de Instagram. El prompt no le dice qué día ni qué hora es (solo las fechas de los cupos de agenda, si hay). No dispara cobros ni avisa pedidos. Agenda solo los primeros 4 servicios |
| **Beto** (`rita` en la base) | "Retoma cotizaciones sin respuesta y despierta clientes dormidos" | Lo único que envía hoy sin intervención son **avisos de mantención** (plantilla de marketing, sin interruptor, necesita datos importados por CSV). El seguimiento de cotizaciones existe, con un juez de IA muy bueno, pero está **apagado** y su modo aprobación **no funcionará** (C.1.4). **No existe** la reactivación automática de dormidos. "Reactivar" es un botón manual. Sus tres métricas en Inicio no las escribe nadie |
| **Vera** | "Pregunta cómo quedó el cliente y pide la reseña en el momento justo" | **Solo una encuesta 1-5 dos horas después de una cita.** Nota 1-3 → deriva a humano. **No pide reseñas** (el código lo dice). No hace postventa de pedidos ni de ventas. Para una imprenta, Vera no hace nada |
| **Isabel** | "Pregúntale lo que quieras: ella leyó todo" | Lee un panorama de conteos a 30 días, 12 chats × 12 mensajes encontrados por búsqueda, 40 fichas, 40 "hechos" de su memoria nocturna y los 2 últimos informes. Cifras honestas en conteos simples, pero: **total de cobros pendientes calculado sobre solo 10 filas**, comparación de conversaciones sesgada al alza, errores de la base convertidos en "0" exactos. No enlaza evidencia a las conversaciones. "Leyó todo" es exagerado: lee una muestra |

**Conclusión:** el portal representa a **cuatro empleados con el mismo peso visual, pero en la práctica hay uno (Tino), medio (Beto, apagado) y dos especializados** (Vera solo agenda; Isabel solo dueño). Mostrar tarjetas en cero de empleados que no trabajan en ese negocio **resta credibilidad a los que sí trabajan**.

---

# B. Lo mejor del producto (no romper)

1. **Ingeniería de mensajería:**
   - webhooks con HMAC sobre el cuerpo crudo, que fallan cerrados,
   - inbox idempotente con tres capas de deduplicación,
   - rescate de mensajes huérfanos,
   - guardia de "sigue siendo el último mensaje" antes y después del modelo,
   - espera anti-ráfaga.
2. **Convivencia humano/IA con Coexistencia:** si alguien escribe desde el teléfono, Tino se calla solo. Pocas herramientas de la competencia lo resuelven.
3. **Ventana de 24 h inteligente:** texto gratis si está abierta, plantilla si no. El selector de plantilla aparece solo cuando corresponde.
4. **Bandeja:**
   - cambio de chat instantáneo (caché + precarga),
   - estado atado a la clave del chat (imposible ver mensajes de uno bajo el nombre de otro),
   - SSE con respaldo,
   - búsqueda sin acentos y con dígitos normalizados.
5. **Juez de IA de cotizaciones:** lee el hilo, nombra lo cotizado y frena a quien ya pagó, pidió devolución o dijo que no. Es un diferenciador real, pero hoy no lo ve nadie.
6. **Detector de cierres con evidencia citada** que bloquea notificaciones de banco falsas.
7. **Agenda:**
   - constraint EXCLUDE en la base contra doble reserva del mismo profesional,
   - reserva pública que valida el horario contra lo ofrecido por el servidor,
   - autogestión por token,
   - "SÍ" confirma por código,
   - clases grupales con cupo atómico.
8. **Aislamiento entre negocios:** todas las acciones toman `clienteId` de la sesión. Los permisos de dueño se exigen en el servidor, no solo en la UI. Buckets privados y proxy de media con validación de tenant.
9. **La regla "nunca un cero falso"** de Marketing (cada métrica con su certeza). Es exactamente lo que le falta al resto del portal.
10. **Archivado de adjuntos** antes de que Meta los borre, **informe de fidelización al WhatsApp del dueño**, **PWA con avisos solo cuando se deriva**.
11. **Marketing bien separado:** grupo de rutas propio, riel propio, demo aislada que nunca guarda.

---

# C. Problemas críticos

## C.0 Lo que arreglé hoy (en tu disco, sin commit)

| # | Qué encontré | Escenario real | Qué cambié |
|---|---|---|---|
| 1 | **XSS almacenado en el portal** [V] | Cualquier número manda por WhatsApp un documento `.html` o `.svg` con un script. El cron lo archiva. Cuando alguien del negocio toca "📎 Abrir", `/api/whatsapp/media` lo devuelve con el tipo declarado **dentro del dominio del portal**, y el script corre con la sesión de esa persona: lee conversaciones y manda mensajes como el negocio | `app/api/whatsapp/media/route.ts`: una sola lista blanca (imagen, audio, video, PDF) para las dos ramas. Todo lo demás se descarga como binario con `nosniff`. Antes, la rama de archivos ya archivados (`sb:`) no filtraba |
| 2 | **Aviso "pedido listo" desde el WhatsApp de otro negocio** [V] | `avisarPedidoListo` validaba el contacto pero no el `empleadoId`, y el cron elige el número de WhatsApp desde el empleado | `accionesPagos.ts`: valida que el empleado sea del negocio (mismo patrón que `cobrarEnChat`) |
| 3 | **Borrado de recordatorios de otro negocio** [V] | Cancelar una cita con un id ajeno no actualizaba nada, pero sí borraba los seguimientos pendientes de esa cita (el borrado no filtraba por negocio) | `lib/agenda.ts` devuelve `encontrada`; `cambiarEstadoCita` solo anula si la cita era del negocio |
| 4 | **Cola de seguimientos que se atasca para todos** [V] | El motor leía solo las 10 filas pendientes más viejas **de todo el sistema**. Las que no pueden salir y quedan pendientes (tope diario alcanzado, texto libre con la ventana cerrada, fila sin texto) volvían a ser las más viejas en cada pasada. **Diez "reactivar cliente" de un negocio en Cloud API cuyos contactos no escriben bastaban para que ningún negocio recibiera recordatorios de citas**, sin ningún error visible | `lib/seguimientos.ts`: lee hasta 40 y corta a los 10 intentos reales. No cambia qué sale, solo evita el atasco. Test nuevo `tests/seguimientos-cola.test.mjs`: **falla con el código anterior y pasa con el nuevo** |

**Para cerrar:** `npm run check` → commit → push. No hay migraciones.

## C.1 Procesos que fallan en silencio

1. **Recordatorios que llegan tarde o después de la cita [V].**
   - El cron solo envía entre 10:00 y 18:59 y no descarta mensajes vencidos.
   - Una cita a las 9:00 recibe "Te esperamos hoy a las 09:00" a las 10:00. Confirmaciones de citas desde las 19:00 dicen "mañana" el mismo día.
   - Una encuesta "gracias por venir hoy" llega al día siguiente, y también a quien no vino.
   - Archivos: `agendaSeguimientos.ts:184-235`, `seguimientos.ts:51-55`.
2. **Tope diario compartido entre todos los tipos (15) y sin caducidad [V].** Una clínica con 6 citas diarias lo agota con confirmaciones, recordatorios y encuestas. Lo que queda afuera sale otro día.
3. **Informe semanal automático bloqueado [V, visto en vivo].**
   - `insightsAuto` procesa 1 cliente por pasada, en orden indefinido.
   - Si ese cliente sale "poca actividad" (una demo, por ejemplo), no se guarda nada y **vuelve a ser el primero en cada pasada**. Nadie más recibe su informe.
   - **Impresora no tiene informe desde el 24-30 ago.**
   - Además, "Generar el de esta semana" crea un informe parcial que bloquea el automático del lunes siguiente (`BotonInforme.tsx:14`, `insightsAuto.ts:62-68`).
4. **El modo aprobación de Beto no va a crear propuestas [V por semántica de Postgres].** El upsert usa `onConflict "cliente_id,chat_id,tipo"` sobre un índice único **parcial** (`sql/297:91-93`). Postgres responde 42P10. **Hay que arreglarlo antes de encender** (`propuestasSeguimiento.ts:62-74`). Además: aprobar no es atómico (dos clics = dos plantillas de $85), un rechazo se vuelve a proponer en la pasada siguiente y el juez vuelve a juzgar a los mismos candidatos cada 5 minutos (hasta ~2.880 llamadas diarias por cliente con el interruptor encendido).
5. **Avisos de mantención de marketing sin interruptor [V].** Beto activo + contactos importados con `ultima_atencion` y `datos.vehiculo` = plantillas de marketing (~$85 cada una en Cloud API con la ventana cerrada) sin aprobación, con el tope de 15 al día como único freno. El texto promete "responde BAJA" y **nada procesa ese BAJA**; `no_contactar` ni siquiera aparece en el editor de etiquetas.
6. **Google Calendar falla abierto y en silencio [V].** Si el token no se descifra, se revoca o freeBusy falla, se ofrecen horas encima de los compromisos personales mientras la pantalla dice "Conectado ✓". Los `fetch` a Google no tienen timeout: si Google está lento, se cuelgan la reserva y Tino.
7. **Derivaciones falsas por presupuesto de tiempo [V código / S frecuencia].** Un mensaje corto espera 20 s (ritmo humano). La primera llamada al modelo queda con techo de ~14 s. Si tarda más, Tino manda "Disculpa, se me complicó…", el chat pasa a humano y llega un push. **Es un candidato a explicar parte de los 45 "Necesita atención" y los 356 chats en manos del equipo**. Hay que medirlo en `ed_escalaciones`.

## C.2 Datos que el dueño ve y no son verdad

1. **Inicio muestra `ed_metricas` [V].** Nada en el portal escribe esa tabla (solo SQL de semilla) y no se valida que la fila sea del mes actual. En demos se ven métricas de julio como si fueran del mes. En Impresora no aparece porque no hay fila.
2. **Tarjetas de Beto y Vera con tipos que nadie escribe** (`inicio/page.tsx:127-142`). Siempre 0 o "—".
3. **"¿Está funcionando?" se oculta cuando la IA envió 0 mensajes**, justo cuando el bot está caído (`inicio/page.tsx:497`).
4. **Chat pausado mostrado como "🤖 Tino está atendiendo este chat"** (`InboxConversacion.tsx:252,444`). En realidad no responde nadie.
5. **Tomar el control cierra la derivación** (`responderChat.ts:124-130`): el chat desaparece de "Te esperan" y del contador del menú **aunque nadie le haya contestado al cliente**.
6. **Isabel:** total de cobros por pagar sumado sobre 10 filas; "conversaciones antes" sesgado; errores convertidos en 0 exactos; fechas de mensajes en UTC.
7. **El Informe dice "81 conversaciones analizadas"** cuando el modelo ve 40, y los "tickets por categoría" los inventa el modelo.
8. **WhatsApp:** un token revocado sigue en verde ("Número conectado") y Instagram en verde con el token vencido.

## C.3 Contradicciones de estado comercial

| Caso | Qué pasa hoy | Evidencia |
|---|---|---|
| El cliente pagó y se marcó el cobro | La etapa no se mueve, "Falta pago" sigue y a los 7 días de silencio el embudo lo marca **Perdido** | `pagos.ts:123`, `embudo.ts:293-300` [V] |
| El detector vio "ya transferí" | Etapa Ganado + `venta_confirmada`, que **se envía a Meta como Purchase**, pero el cobro sigue pendiente | `cierreVentas.ts`, `ads/colaEventos.ts:97-108` [V] |
| Etapa fijada a mano | El detector de pagos la ignora para siempre | `cierreVentas.ts:99` [V] |
| Perdido que vuelve a escribir | Vuelve a **Nuevo** y pierde que estaba cotizado | `reconciliarEstados.ts:190` [V] |
| Embudo vs. Clientes vs. menú | El embudo recalcula y **escribe al abrirse**; Clientes y el menú leen lo guardado. El "perdido por silencio" solo se aplica a los contactos dentro del filtro elegido (14 días por defecto; con el filtro de 7 días nunca ocurre) | `embudo/page.tsx:31`, `embudo.ts:183,287-299` [V] |
| Embudo vs. Beto | Al abrir /embudo, todo cotizado con más de 7 días de silencio pasa a Perdido, y Beto excluye Perdidos: persigue solo cotizaciones de 3 a 7 días, y el resultado depende de si alguien abrió la pantalla | `generadorCotizacionCore.ts:97` [V] |
| En vivo (Impresora) | Chat real: cotización → "datos de transferencia" → "solo faltaría el pago" → el cliente manda una imagen (probable comprobante) → "okey para el lunes". Estado mostrado: **Cotizado + Falta pago + Posible comprador**. Módulo Cobros: 0 | Visto en producción |

## C.4 Agenda multi-profesional

1. **Reagendar con otro profesional [V, Crítica si hay más de un profesional].** La autogestión y Tino ofrecen horas de *cualquier* profesional, pero `reagendar` conserva al profesional original y no valida su horario, bloqueos ni Google. Resultado: cita con alguien que ese día no trabaja (`autogestionDatos.ts:233-238`, `agenda.ts:337-348`).
2. **Botones "15:00 15:00" [V].** `computarSlots` crea un cupo por profesional por hora, y la UI pinta un botón por cupo sin nombre. Detalle y propuesta en E.3.
3. **No existe el mapeo servicio↔profesional en ninguna pantalla** (la tabla existe): el colorista aparece ofreciendo cortes.
4. **Cita manual en un cupo ocupado:** el modal se cierra como si hubiera funcionado y la cita no existe (`NuevaCita.tsx:106-112`).
5. **Cupo tomado entre ver y confirmar:** la página pública muestra el texto crudo `horario_no_disponible` (`ReservaPublica.tsx:255`).

## C.5 Conversación partida entre empleados [V, latente]

El modo (bot/humano) se guarda por **empleado + chat**, y el empleado que atiende cambia según quién mandó el último seguimiento. Resultado: una persona toma el control bajo Beto, el siguiente mensaje va a Tino, que sigue en modo bot, y **Tino responde encima de la persona**, sin ver lo que dijo Beto. Hoy está latente porque Beto y Vera casi no envían. **Se vuelve real apenas se encienda Beto.** Archivos: `seguimientos.ts:385-410`, `responderBot.ts:203-209`.

## C.6 Seguridad pendiente (no arreglada hoy, por orden)

| Sev. | Hallazgo | Fix mínimo |
|---|---|---|
| Media | **OAuth (Instagram, Meta Ads, Google): el `state` no está atado a la sesión ni es de un solo uso.** Un dueño de otro negocio puede mandarle su enlace de autorización a una víctima y, si esa cuenta de Instagram no estaba conectada a otro negocio, quedársela en su tenant (en Google, acceso a eventos del calendario de la víctima) | Cookie httpOnly con nonce en `conectar`; en `callback`, validar cookie + sesión + `clienteId` |
| Media | **Suscripciones push sobreviven a la baja del usuario:** un ex-empleado sigue recibiendo resúmenes de conversaciones en su teléfono | Filtrar por usuarios activos al enviar; borrar al desactivar |
| Media | **Cuenta de servicio de Google compartida:** un negocio puede pegar el `gcal_id` de otro que compartió su calendario con Respondo | `gcal_id` único y modo cuenta de servicio solo para admins, o solo OAuth |
| Media | **Reserva pública como vía de spam:** cualquiera reserva con un teléfono ajeno y el negocio le manda plantillas | Tope diario por slug + captcha liviano; no enviar plantilla a números sin conversación previa hasta que confirmen |
| Baja | `/estado` muestra métricas de toda la plataforma a cualquier usuario | Lista de admins |
| Baja | Logo acepta SVG con el tipo declarado por el navegador (XSS en el dominio de Supabase, no del portal) | Quitar SVG o rasterizar |
| Baja | API externa acepta todavía la firma vieja sin nonce (replay) | `MODO_FIRMA_VIEJA=false` |
| Baja | Secretos en querystring (`?k=`) y `CRON_SECRET` reutilizado en `/api/salud` | Header `Authorization` + secreto propio para salud |
| Baja | `obtenerUsuarioPortal` no mira `ed_clientes.activo`: un negocio dado de baja sigue entrando | Un `.eq` |
| Baja | Clave de cifrado derivada de `SUPABASE_SERVICE_ROLE_KEY`: rotarla deja mudos a todos los clientes | Variable propia antes de tener más clientes |

---

# D. Producto oculto (potente y mal comunicado)

| Capacidad que ya existe | Dónde vive | Cómo se ve hoy | Qué valor comercial tiene |
|---|---|---|---|
| **Juez de IA de cotizaciones** | `juezCotizacion*` | Invisible y apagado | "Beto no molesta a quien ya pagó o dijo que no". Es el argumento contra el spam de seguimientos |
| **Detector de cierres con evidencia** | `cierreVentas.ts` | Etiquetas "Falta pago" / Ganado sin explicación | "Te aviso cuando alguien dice que pagó" |
| **Ventana de 24 h y plantillas por rubro** | `ventana24*`, `plantillasRubro` | Selector de plantilla | "Nunca se te cae un mensaje por las reglas de Meta" |
| **Archivado de adjuntos** | `archivarMedia` | Nada | "Los archivos de tus clientes no desaparecen a los 7 días como en WhatsApp Business" |
| **API externa + puente de salida** | `/api/externo`, `puenteSalida` | Nada | Integración real con el sistema de Impresora (Gestión). Es un caso vendible: "se conecta con tu sistema" |
| **Webhook de pedido listo** | `/api/integraciones/pedidos` | Nada | "Tu ERP avisa y Respondo le escribe al cliente" |
| **Autogestión de citas + "SÍ" que confirma** | `cita/[token]`, `agendaBot` | Enlace en el mensaje | Menos inasistencias |
| **Vigilante de chats abandonados** | `reingresoTino.ts` | Sin pantalla, apagado | "Si tu equipo se olvida de responder, Tino retoma" |
| **Correcciones** (`ed_correcciones`) | prompt | Se listan en Información pero no se pueden crear ni apagar | "Enséñale a Tino con un clic cuando se equivoca" |
| **Memoria de Isabel** (`ed_isabel_saber`) | destilado nocturno | Invisible | "Lo que tus clientes preguntan, objetan y piden, aprendido cada noche" |
| **Informe de fidelización al WhatsApp** | Analítica | Botón escondido | El dueño recibe su resumen sin abrir el portal |
| **Clases grupales, iCal, Google OAuth** | Agenda | Detrás de Configuración | Cierra ventas en gimnasios y estudios |
| **Atribución de anuncios** | `ed_contactos.datos.campana` | Solo en Marketing | "De qué anuncio vino esta venta" dentro del chat |
| **Botones nativos de WhatsApp** | `enviarBotones` | **Código muerto** | Lo que más mejora una demo (ya estaba en la memoria del proyecto) |

---

# E. Oportunidades de alto impacto

Escala de 1 (bajo) a 5 (alto). En Complejidad y Riesgo, más alto es peor. "Tiempo" es con Claude implementando.

| # | Oportunidad | Impacto comercial | Impacto usuario | Complejidad | Riesgo | Tiempo |
|---|---|---|---|---|---|---|
| 1 | **Capa única de estado comercial por contacto** (E.1) | 5 | 5 | 3 | 2 | 1,5 sem |
| 2 | **Tino escucha audios y describe imágenes** (E.2) | 5 | 5 | 3 | 3 | 1 sem |
| 3 | **Inicio = "lo que necesita de ti" + resultados reales** (E.4) | 4 | 5 | 2 | 1 | 4 días (tras #1) |
| 4 | **Panel lateral del chat con "Ahora"** (E.5) | 4 | 5 | 2 | 1 | 3 días (tras #1) |
| 5 | **Beto visible y seguro** (E.6) | 5 | 4 | 3 | 3 | 1,5 sem |
| 6 | **Agenda multi-profesional correcta** (E.3) | 4 | 4 | 3 | 3 | 1 sem |
| 7 | **Usuarios mínimos: invitar, rol, desactivar** (E.7) | 3 | 4 | 1 | 1 | 1-2 días |
| 8 | **Una capa de métricas: Analítica + Isabel con las mismas definiciones** (E.8) | 3 | 4 | 3 | 2 | 1 sem |
| 9 | **Empleados que se muestran según lo que hacen en ese negocio** | 4 | 3 | 1 | 1 | 1 día |
| 10 | **Cobro "por transferencia" y "pagado" en un clic desde el chat** | 4 | 4 | 2 | 2 | 3 días |
| 11 | Webhook de Flow | 3 | 3 | 3 | 3 | 1 sem (condicionado, ver E.9) |

## E.1 La capa de estado comercial

**Decisión:** no agregar pantallas. Crear **una sola función en el servidor** que calcule, por contacto y en el cron (no al abrir pantallas):

- `etapa` (con la regla nueva de E.10) + motivo + desde cuándo;
- `dinero`: cotizado (monto si se detectó), cobros pendientes y pagados, venta detectada;
- `proximo`: próxima cita, próximo seguimiento en cola o propuesta de Beto;
- **`necesita_de_ti`**: una sola razón priorizada, o nada:
  1. derivación abierta,
  2. chat en manos del equipo donde el cliente habló último,
  3. pago informado sin confirmar,
  4. propuesta de Beto por aprobar,
  5. cita sin confirmar mañana;
- `espera_desde`: hace cuánto espera el cliente.

Se guarda en `ed_contactos` (columnas o un jsonb `estado_comercial`). **Todo lo demás lee de ahí:** Inicio, el contador del menú, la bandeja, el panel lateral, el embudo, Clientes e Isabel.

Con esto desaparecen la mayoría de las contradicciones de C.2 y C.3. Y un único efecto de negocio al pagar (quitar "Falta pago", `venta_confirmada` deduplicada por `pago_id`, mover etapa, push) sirve igual para pagos manuales, por detector o por Flow.

## E.2 Tino multimodal

Gemini ya es multimodal y el código ya descarga y archiva la media.

**Decisión:**
- **Audio → transcripción** con el mismo modelo. Se guarda como texto del mensaje ("🎤 transcripción: …") y Tino responde normal.
- **Imagen → descripción corta** que entra al prompt ("el cliente envió un logo circular azul, parece para stickers"). Tino no decide precios por la imagen: la usa para preguntar bien.

**Cuidados:**
- el presupuesto de tiempo (transcribir fuera del camino caliente o con techo propio),
- costo por cliente,
- privacidad: en vivo hay un cliente que reclamó que su foto se "subió a la inteligencia artificial". Hay que decirlo en la política y **no usar imágenes para nada más que responder**.

**Por qué es lo primero de producto:** 23,8 % de los mensajes de Impresora llegan fuera de horario, y hoy cada audio o imagen fuera de horario se queda esperando hasta el día siguiente.

## E.3 Botones "15:00 15:00": solución recomendada

| Opción | Lavado / taller | Barbería / nutricionista | Móvil | Carreras de reserva |
|---|---|---|---|---|
| (a) Deduplicar horas y asignar profesional en el servidor | Ideal | Falla: el cliente quiere a *su* profesional | Óptimo | Mejor: si pierde, prueba con otro profesional libre |
| (b) Elegir "¿Con quién?" antes del horario ("Cualquiera" por defecto) | Bien si se oculta | Ideal | Una fila de chips | Igual que (a) con "Cualquiera" |
| (c) Nombre bajo cada hora | Ruido | Sirve con 2 profesionales, no con 5 | Ilegible | Peor |

**Decisión: (b), con (a) como motor de "Cualquiera".**
- Configuración por negocio: `elección de profesional: no / opcional`. Por defecto según rubro: taller/lavado = no; barbería, estética, salud = opcional.
- Con un solo profesional, el selector no aparece.

**Arquitectura:**
- La disponibilidad devuelve **horas deduplicadas** cuando es "Cualquiera", y la lista de profesionales habilitados para ese servicio. Paginar por días, no por cantidad de cupos: hoy el tope de 120 cupos cuenta duplicados y con 3 profesionales se ven solo ~2 días.
- Una función de servidor `asignarProfesional(servicio, inicio, preferido?)` elige por **menor carga del día** (desempate por orden configurable), intenta crear la cita y, si la base responde "cupo tomado", prueba con el siguiente.
- **La misma función la usan la reserva pública, la autogestión (arregla C.4.1), Tino y la cita manual.**
- **Tino** deduplica las horas antes de aplicar la cuota por día, conoce los nombres y, al reagendar, prefiere al mismo profesional.
- **Requisito previo:** la pantalla de "quién hace qué servicio".

## E.4 Inicio: prioridad y accionabilidad

Estructura propuesta, **sin agregar gráficos**:

1. **"Necesita de ti" (una lista, ordenada por espera).** Reemplaza "Te están esperando". Viene de `necesita_de_ti`: derivaciones + chats del equipo sin responder + pagos por confirmar + propuestas de Beto + canal caído (WhatsApp desconectado, token vencido, Google caído). Cada fila tiene **un** botón con la acción ("Responder", "Confirmar pago", "Aprobar").
2. **"Resultados de este mes" (datos reales).** Cotizaciones enviadas, ganados, cobrado y por cobrar. Todo con la etiqueta "este mes" y la misma definición que Analítica. Nada sembrado.
3. **"Tu equipo esta semana" en una sola fila.** Solo los empleados que trabajan en ese negocio, con 1-2 cifras que existan: *Tino: 212 respuestas · 36 cotizaciones · 16 derivadas*. Beto aparece cuando esté encendido. Vera, cuando haya agenda.
4. **"¿Está funcionando?"** siempre visible, con un estado de salud explícito ("Tino respondió hace 4 min" / "⚠ Tino no responde desde las 14:10").
5. Por cerrarse queda como enlace al embudo con montos, no como lista duplicada.

## E.5 Panel lateral del chat

Hoy el primer lugar lo ocupa "Quién atiende", que repite la barra superior, y la etapa se ve pero **no se edita**.

**Decisión:**
- **Arriba, un bloque "Ahora"** con:
  1. una frase de acción ("Responder: pidió una persona hace 42 min" / "Confirmar pago: dijo que transfirió");
  2. espera y ventana ("te escribió hace 2 h · puedes escribir libre 21 h más");
  3. etapa **editable** + motivo;
  4. dinero: cobros con monto y cotización detectada;
  5. lo próximo: cita, seguimiento o propuesta;
  6. nota interna **editable**.
- **Abajo, plegado:** etiquetas, historial, "Ficha completa".
- **Se quita:** "Quién atiende", "Mensajes: N" y la lista cruda de resultados.
- **Botones de la barra:** "Agendar hora" solo si hay agenda (hoy aparece en la imprenta). "Cobrar" solo si hay enlace, más **"Registrar pago"** para transferencias, que hoy son el caso real.

## E.6 Beto visible y seguro

Antes de encender el seguimiento de cotizaciones en Impresora:
1. Arreglar el upsert (C.1.4) y hacer la aprobación atómica.
2. Memoria del juez: no volver a juzgar ni proponer lo rechazado o frenado en N días.
3. Cola por cliente con caducidad por tipo: un recordatorio vencido no sale; una cotización no se persigue después de 30 días.
4. Candado del cron (una corrida a la vez).
5. `/seguimientos` en el menú (grupo Vender) con contador.
6. Registrar si salió plantilla o texto y su costo aproximado. Mostrar "lo que hizo Beto esta semana: 8 retomadas, 3 respondieron, 1 frenada porque ya había pagado".
7. **BAJA funcional**: palabra reservada → `no_contactar`, y la etiqueta visible en el editor.
8. Interruptor explícito para mantención (hoy no tiene).

## E.7 Usuarios, roles y permisos

**Estado:**
- Login por magic link.
- Un email pertenece a un solo negocio (`UNIQUE`).
- Dar de alta a alguien = insertar una fila en `portal_usuarios` por SQL.

**Veredicto: construir la pantalla mínima (1-2 días). No hacer RBAC.**
- **Qué incluye:** en Configurar, una pantalla "Equipo" (solo dueño) con lista (email, rol, activo, último acceso si se puede) y tres acciones: **Invitar** (email + rol → inserta la fila; opcionalmente `inviteUserByEmail` de Supabase), **Cambiar rol** y **Desactivar**.
- **Guardas:** no desactivarse a sí mismo, no dejar el negocio sin dueño, borrar las suscripciones push al desactivar (C.6), auditoría en `ed_auditoria_portal`.
- **Permisos a corregir de paso:**
  - staff ve Analítica, Informe y Cobros con los totales, pero no Isabel: decidir un criterio único (J);
  - Probar visible y roto para staff;
  - Agenda visible sin servicios.

## E.8 Analítica + Informe + Isabel

**Comprobado:** hoy son **tres productos separados**, sin capa común de métricas. Isabel dice "el número bueno es el de Analítica" y usa otra definición.

**Decisión:**
- **Una sola capa de métricas** (`lib/metricas.ts`) con definiciones canónicas: conversación = contacto con al menos un mensaje entrante en el período, en hora de Chile; esperando = `necesita_de_ti`; ganado = etapa ganado en el período; cobrado = `ed_pagos` pagado en el período.
- **Menú "Entender" pasa de 3 ítems a 2:** **Resultados** (Analítica, qué pasó) e **Isabel** (por qué). El **Informe semanal se muestra dentro de Isabel** como primera tarjeta ("Lo que pasó la semana pasada"), y ya es la fuente que Isabel lee.
- **Métricas comerciales solo con datos confiables:**
  - leads = contactos nuevos con entrante;
  - con intención = etiqueta `posible_comprador`;
  - cotizaciones = `cotizacion_enviada`;
  - ganados;
  - cobrado;
  - tiempo de primera respuesta. **Hoy no existe en ningún lado:** se puede calcular desde `ed_mensajes`.
  - Montos de venta solo cuando provienen de un cobro o de un registro manual, **nunca estimados**.
- **Ahorro:** configurable por negocio (sueldo de referencia) y sin contar recordatorios automáticos como "mensajes atendidos".

## E.9 Cobros y Flow

**Distinción que el sistema tiene que respetar:**

| Evento | Fuente | Significado |
|---|---|---|
| Dijo que pagó | Detector de cierres (IA) | Señal. Requiere confirmación |
| Venta registrada | `ed_resultados.venta_confirmada` | Hoy lo crea la IA: **no debería enviarse a Meta como Purchase sin confirmación** |
| Oportunidad ganada | Etapa | Estado comercial |
| Cobro pagado | `ed_pagos` | Dinero confirmado (manual o proveedor) |

**Decisión:**
1. **Fase 1:** unificar el efecto de "pago confirmado" (E.1). Agregar **"Registrar pago"** en el chat para transferencias (monto opcional). Cuando el detector ve "ya transferí", en vez de marcar Ganado directo, crea un **"pago por confirmar"** que aparece en "Necesita de ti" con un botón.
2. **Webhook de Flow: fase 2 y condicionado.** Impresora usa un botón de monto variable. Antes de construir hay que verificar en la documentación oficial de Flow si ese botón entrega confirmación por API con la referencia. Si no la entrega, la integración útil es generar un **link de pago por cobro** (`payment/create` con la referencia como `commerceOrder`) y recibir `urlConfirmation`. **No construir conciliación bancaria, boletas ni pagos parciales.**

## E.10 ¿Nuevo / Interesado / Cotizado / Ganado / Perdido sigue siendo correcto?

**No del todo.**
- "Interesado" es una clasificación débil del modelo que no ayuda a decidir nada.
- Falta el momento donde más plata se pierde: **"aprobó y no ha pagado"**. Hoy es la etiqueta "Falta pago", con 20 chats en Impresora.
- "Ganado = compró **o agendó**" mezcla reserva con venta.

**Decisión: seguir con 5 etapas, pero estas:**

| Etapa | Imprenta / retail | Servicios con agenda | Regla |
|---|---|---|---|
| **Consulta** | Consulta | Consulta | Escribió |
| **Cotizado** | Cotizado | Cotizado / pidió hora | Se envió precio |
| **Comprometido** | **Por pagar** | **Agendado** | Aprobó sin pagar / cita futura |
| **Ganado** | Pagado | Atendido | Pago confirmado / cita completada |
| **Perdido** | Perdido | Perdido / no vino | Rechazo explícito, o silencio configurable |

- "Posible comprador" queda como **etiqueta**, no como etapa.
- "Sin respuesta" es una **señal** con días configurables por rubro (una imprenta B2B necesita más de 7).
- La reapertura de un perdido vuelve a la etapa anterior, no a Consulta.
- **La etapa se calcula en el cron, nunca al abrir la pantalla.**

---

# F. Quick wins (cada uno ≤ 1 día, valor evidente)

1. **Arreglar el informe semanal bloqueado:** seguir al siguiente cliente cuando uno sale "poca actividad"; el botón manual genera la **semana pasada** si no existe.
2. **Upsert de propuestas de Beto** (select + insert/update) y aprobación condicionada a `estado='propuesto'`.
3. **Chat pausado:** "Pausado · nadie responde" + botón "Reanudar a Tino".
4. **"Te esperan" = derivación abierta o (equipo a cargo y cliente habló último).** Aplicarlo en el RPC y en el contador del menú.
5. **Ocultar lo que no aplica:**
   - tarjetas de Vera y Agenda sin servicios;
   - "Agendar hora" en rubros sin agenda;
   - "Cobrar" sin enlace;
   - Beto sin automatizaciones encendidas;
   - bloque de `ed_metricas` si no es del mes actual.
6. **"Probar ahora" abre Tino por defecto** e incluye el bloque de agenda. Oculto para staff.
7. **Mostrar `/seguimientos` en el menú** cuando `cotizacion_seguimiento` esté encendido.
8. **Motivo en la tarjeta del embudo** ("cerrada por 7 días sin respuesta") y "+N más" enlazado a Clientes filtrado.
9. **Separadores de día en el chat** y autor real en mensajes humanos ("Cecilia", no "Tú").
10. **Reserva pública:** mostrar el mensaje real y recargar cupos cuando la hora se ocupa; los formularios de configuración de agenda devuelven error visible (hoy fallan en silencio y se limpian).
11. **Informe:** "40 conversaciones leídas de 81"; quitar los "tickets" inventados.
12. **Información:** sacar "Plantillas de rubro (demo)" del portal del cliente; sección "Otras" para categorías que hoy no se ven pero están activas.
13. **WhatsApp:** quitar SQL, comandos y números de migración de la pantalla; estado real del token (verde solo si Graph responde).
14. **/estado solo para admins de Respondo.**
15. **Fechas en hora de Chile** en Cobros (inicio de mes), Isabel e historial de Clientes.
16. **Timeouts** en los `fetch` a Google (5 s) y aviso visible cuando la sincronización falla.
17. **Isabel:** try/catch en el cliente (hoy un timeout reemplaza toda la pantalla por el error) y total de cobros pendientes con un `sum` real.

---

# G. Cambios grandes (solo los que justifican el esfuerzo)

1. **Capa de estado comercial + "Necesita de ti"** (E.1, E.4, E.5). Es la columna vertebral que vuelve coherente todo lo demás. Sin ella, cada pantalla sigue inventando su definición.
2. **Tino multimodal** (E.2). Es lo que más cambia la experiencia del cliente final en la imprenta y en cualquier rubro visual.
3. **Motor de seguimientos v2** (E.6): cola por cliente con caducidad, candado, memoria del juez, visibilidad y costo. **Condición para vender a Beto.**
4. **Agenda multi-profesional correcta** (E.3). **Condición para vender a barberías, clínicas y centros de salud.**
5. **Modo del chat por contacto, no por empleado** (C.5), con una sola línea de historial para el prompt. Tiene que ir **antes** de encender Beto.

---

# H. Cosas que NO haría todavía

| Idea típica de SaaS | Por qué no |
|---|---|
| Bandeja omnicanal (correo, Messenger, webchat) | WhatsApp-first. Instagram ya duplica la superficie de errores (sin anti-ráfaga, sin guardia de modo, sin adjuntos). Primero dejar Instagram al nivel de WhatsApp |
| Pipelines configurables, campos personalizados, más de 5 etapas | El ICP no los mantiene. Un embudo que el dueño tiene que configurar es un embudo abandonado |
| RBAC granular, equipos, permisos por conversación | Dueño/staff alcanza. Falta la pantalla de usuarios, no más roles |
| Dashboards configurables, gráficos nuevos, exportaciones | Los números actuales ni siquiera coinciden entre sí |
| Contabilidad, boletas, conciliación bancaria | Fuera del foco. Flow ya emite comprobante válido como boleta |
| Publicar campañas por API (`ads_management`) | Ya se decidió: asesor, no ejecutor |
| Constructor visual de flujos o chatbot | Contradice el posicionamiento "empleado digital". El valor está en que no se configura |
| Unificación automática de contactos WhatsApp↔Instagram por heurística | Riesgo de mezclar personas distintas. A lo sumo, un "vincular manual" más adelante |
| Editor tipo Notion para el conocimiento | Basta una lista compacta con buscador y edición en panel |
| App móvil nativa | La PWA ya avisa al teléfono |
| A/B testing de prompts, analítica de "sentimiento" | Sin volumen para que sea significativo |
| SLA, turnos, asignación automática entre agentes | Los equipos son de 1 a 3 personas |
| Rediseño visual "moderno" (gradientes, glass, animaciones) | El problema es jerarquía y verdad de los datos, no estética |

---

# I. Roadmap propuesto

**Fase 0 — Riesgos y procesos silenciosos (1 semana)**
- Commit de los 4 fixes de hoy tras `npm run check`.
- Informe semanal (F.1).
- Propuestas de Beto (F.2).
- Recordatorios: caducidad y ajuste de hora (C.1.1).
- `reagendar` que respete el profesional (C.4.1).
- Google: timeouts y error visible.
- OAuth `state` atado a la sesión.
- Push al desactivar.
- `/estado`.
- Firma vieja apagada.
- Timeout de Tino: medir en `ed_escalaciones` cuántas derivaciones son "se me complicó", y ajustar la espera anti-ráfaga o el techo del modelo.
- Candado del cron.

**Fase 1 — Coherencia y UX (2-3 semanas)**
- Capa de estado comercial (E.1) + etapas nuevas (E.10), calculadas en el cron.
- Inicio (E.4), panel lateral (E.5), bandeja ("Te esperan" y pausado).
- "Registrar pago" y efecto único de pago.
- Usuarios mínimos (E.7) y criterio único de qué ve el staff.
- Mostrar solo los empleados y módulos que aplican a cada negocio.
- Quick wins F.3 a F.17.
- Capa de métricas (E.8) y menú "Entender" en 2 ítems.

**Fase 2 — Producto (3-4 semanas)**
- Tino multimodal (E.2).
- Modo del chat por contacto (C.5) → Beto v2 visible y encendido en Impresora (E.6).
- Agenda multi-profesional (E.3) + pantalla "quién hace qué".
- Instagram al nivel de WhatsApp (anti-ráfaga, guardia de modo, adjuntos, canal correcto en el prompt).
- Botones nativos de WhatsApp.
- Flow, si se verifica (E.9).

**Fase 3 — Refinamiento**
- Sistema visual (tokens de tipografía y color, componentes de chip, estado y tabla).
- Responsive del calendario.
- Rendimiento (resumen del menú en cada navegación, Analítica paginada en la base, Isabel con caché del panorama).
- Configuración de agenda en 3 pasos.
- Información como lista con buscador.

---

# Anexo 1 — Auditoría visual

- **Identidad:** el portal usa **índigo `#4F46E5` + coral**, consistente con la decisión de marca del 3 de julio. El prompt de esta auditoría habla de *azul profundo + cian*. Queda como decisión (J.1): **no recoloreé nada**.
- **El coral significa dos cosas:** Tino y "alguien te espera". Una señal de urgencia no puede ser el color de un empleado.
- **Tipografía sin sistema:** **495 tamaños arbitrarios** (`text-[13px]`, `text-[12.5px]`, `text-[13.5px]`…) conviven con los tokens `--t-*`, y hay un token usado que no existe (`--t-mini`). La jerarquía se siente plana y chica (12-13 px dominante).
- **Anchos máximos distintos por pantalla:** 3xl (Cobros), 4xl (Información, Probar), 760 px (WhatsApp) y completo (Conversaciones, Embudo, Clientes). En pantallas anchas, Inicio (máx. 1.400 px) deja mucho espacio vacío a la derecha, y Cobros y Probar se ven comprimidos.
- **Emojis como íconos de interfaz** ("🤖", "🙋", "💲", "📎", "🎤"): suman informalidad en un producto B2B que quiere sentirse como Linear o Stripe. Reemplazar por el set de íconos que ya existe en el Sidebar.
- **Colores sueltos** (`#F1F2F7` ×17, `#B33A3A` ×13, `#166534` ×10, y el verde de WhatsApp en el punto de conexión), en lugar de `--ok`, `--alerta` y `--peligro`.
- **Estados vacíos y de carga:** un solo `loading.tsx` genérico para todo el portal. Estados vacíos redactados distinto en cada módulo. Formularios de agenda sin mensajes de éxito ni de error.
- **Jerga interna expuesta:** `waba_id`, IDs en fuente monoespaciada, `update ed_clientes…`, `npx tsx`, "falta la migración 283", "#1690130", nombres técnicos de plantillas (`pedido listo`).
- **Responsive (en código):** el calendario del portal arranca en vista semana con ancho mínimo de 820 px; en móvil debería partir en lista o día. Hay objetivos táctiles de 36 px (mínimo recomendado: 44).

# Anexo 2 — Rendimiento (lo que sí puede doler)

1. **Cada navegación del portal** ejecuta en el layout el RPC de resumen de la bandeja, que recorre **todos los contactos** con un join lateral. En Inicio corre **dos veces**. Con 10 mil contactos pesa en cada clic.
2. **Analítica** trae todas las filas de mensajes del período en hasta ~100 idas y vueltas de 1.000 filas, y crea un `Intl.DateTimeFormat` **por fila**. Hay que moverlo a una agregación en la base.
3. **El embudo escribe en la base y espera hasta 4 s** avisando al puente externo, dentro de un GET.
4. **Isabel:** ~25 consultas en cada carga de la página, repetidas en cada pregunta. La búsqueda de respaldo recorre todo el historial con `ilike` y sin índice.
5. **La bandeja hace `router.refresh` cada 25 s:** rehace layout, lista, resumen (dos veces) y detalle.
6. **SSE limitado a 6 conexiones por minuto por usuario:** revisar más de 6 chats en un minuto degrada a sondeo cada 1,5 s.
7. **Tope silencioso de 1.000 filas de PostgREST** en `resumenEmpleados` (tarjetas de Inicio), citas de disponibilidad y ficha de clientes.

# Anexo 3 — Evidencia en vivo (Impresora Color, 10-sep 23:33)

- Menú: Conversaciones **52**, Embudo **103**. Inicio: "Te están esperando **53**", la más antigua **40 días**. Tarjeta de Tino: "16 esperando por ti" (solo las del mes).
- Bandeja: Todas 519 · Te esperan 52 · **Con tu equipo 356** · **Atiende Tino 111** · Cotización 157 · Posible comprador 132 · Necesita atención 45 · Cliente 21 · **Falta pago 20** · Reclamo 4 · Resuelto 1.
- Analítica 30 días: **28 %** de las respuestas por IA (35 % últimas 24 h) · **23,8 %** de los mensajes fuera de horario · ahorro estimado $161.478 · horas agendadas 0.
- Cobros: **$0 cobrado, 0 pendientes**, con cobros "activados" en Información.
- Isabel: "**380** conversaciones en 30 días · 53 esperando · 0 cobros pendientes". Inicio: "**101** conversaciones este mes".
- Informe: el último es del **24-30 ago**. No hay de 31 ago-6 sep.
- Informe del 24-30 ago (texto del modelo): *"frustración con el asistente que no puede ver imágenes, no procesa audios y a veces no tiene toda la información"*.
- Agenda: vacía ("Crear al menos un servicio") pero en el menú. Seguimientos: vacío, sin enlace. Probar ahora: abre **Beto** por defecto.
- Marketing: "Meta conectada" y, en la misma pantalla, el botón "Conectar Meta" del onboarding.
- /estado: "Clientes 7 · Empleados IA 19 · Usuarios del portal 6", visible para el usuario de Impresora.

---

# J. Decisiones que necesitan de ti

Todo lo demás lo decidí arriba. Estas cinco dependen de información o preferencias que solo tú tienes:

1. **Paleta del portal.** El portal está en índigo + coral (lo que decidiste el 3 de julio y usa la web). En este encargo escribiste "azul profundo + cian". ¿Cambió la identidad o fue un recuerdo de la paleta anterior? **Mi recomendación:** mantener índigo + coral y solo separar el coral de "urgencia" (Anexo 1). Recolorear todo no mueve ninguna venta.
2. **¿Tino recupera el control solo?** Hoy, una vez que el equipo toma un chat, Tino no vuelve nunca (356 de 519 chats). Opción: vuelve cuando el cliente escribe y el equipo lleva más de N horas sin escribir en ese chat, siempre que no haya una derivación abierta. **Mi recomendación:** activarlo con N = 12 h fuera de horario y 24 h en horario. Pero cambia cómo trabaja Cecilia: hay que preguntarle a ella.
3. **Qué ve el staff.** Hoy ve Analítica, Informe, Cobros (con totales) y el Embudo, pero no Isabel ni Marketing. **Mi recomendación:** staff ve lo operativo (Conversaciones, Agenda, Clientes, Embudo sin montos) y el dueño ve lo financiero y lo analítico. Depende de cómo trabajan tus clientes con sus empleados.
4. **Encender Beto en Impresora** (seguimiento de cotizaciones), una vez hecha la Fase 0 y la corrección C.5. ¿En modo aprobación (Cecilia aprueba cada una) o automático con tope diario? **Mi recomendación:** aprobación las primeras 2 semanas y luego automático con tope de 10 al día. Considera que desde el 1-oct Meta cobra también los mensajes de servicio.
5. **Privacidad de imágenes y audios con IA** (E.2). Antes de que Tino procese media hay que publicarlo en la política de privacidad, que además está pendiente por la Ley 21.719 y por Meta. ¿La redacción legal la cierras tú con alguien, o la preparo yo para que la revise un abogado?
