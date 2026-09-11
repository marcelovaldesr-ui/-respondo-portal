# Fase 0 — Estabilización del portal

**11 de septiembre de 2026 · Continuación de `docs/AUDITORIA_PORTAL_SEP2026.md`**

> Esta fase no rediseña nada. Su objetivo es que cada número, estado y proceso importante del portal tenga una razón consistente detrás, y que cualquier falla crítica deje rastro visible.
>
> **No hay commit.** Los cambios están en tu disco, en `respondo-portal/`, listos para revisar. Antes de desplegar hay que correr lo de la sección J.

---

## Cómo leer este documento

- **A** es el resumen: qué quedó resuelto y qué no.
- **B a G** son la evidencia: bugs, cambios por archivo, pruebas, métricas, jobs y seguridad.
- **H a K** son para decidir y desplegar: qué no se tocó, qué archivos cambian, qué correr antes y qué sigue.
- Las decisiones abiertas se cerraron **al final**. Lo que tienes que correr está en `docs/FASE0_PENDIENTES_MARCELO.md`.
- **[V]** = verificado con código y prueba automática. **[S]** = sospecha que hay que confirmar con la base (hay SQL de solo lectura en J).

---

## A. Resumen ejecutivo

### Criterios de salida

| Criterio | Estado |
|---|---|
| Los 4 arreglos de la auditoría revisados adversarialmente | ✅ Revisados. El de la cola de seguimientos estaba **incompleto** y se terminó (B1). |
| Vulnerabilidades críticas nuevas arregladas | ✅ 11 hallazgos multi-negocio cerrados, casi todos con prueba (sección G). |
| Tests / typecheck / lint / build conocidos | ⚠️ **Tests: 595/595 verdes.** Typecheck: sin errores nuevos en un chequeo diferencial. **Lint y build no se pudieron correr aquí** (sin acceso a npm). Hay que correr `npm run check` en tu PC (J). |
| Métricas principales reconciliadas | ✅ "Conversaciones", "Te esperan", "Seguimientos enviados" y "cobros pendientes" salen de una definición única (E). |
| Tarjetas de Beto y Vera con datos reales | ✅ Se quitaron los ceros estructurales y se muestra lo que sí se registra. |
| Informe semanal funcionando y observable | ✅ Causa raíz encontrada y arreglada, más alerta de cobertura en `/api/salud`. |
| Beto en modo aprobación funcional pero apagado | ✅ Defectos B4–B7, B28 y B29 arreglados. Ciclo completo probado sin enviar nada. **Nada se encendió.** |
| Estado honesto de Google Calendar | ✅ Conectado / Necesita reconexión / Error de acceso / Con errores, según lo que respondió Google. |
| Procesos silenciosos con observabilidad mínima | ✅ Los 14 pasos del cron dejan registro por paso, sin tabla nueva. |
| Documento de lo que queda para Fase 1 | ✅ Sección K. |

### Lo más importante, en seis líneas

1. **El informe semanal de Impresora no salía porque otro negocio lo tapaba.** El proceso intentaba un solo negocio por corrida, sin orden. Uno con "poca actividad" no guarda nada, así que quedaba primero para siempre. Ahora recorre todos, reintenta cada negocio a lo sumo una vez por hora, y `/api/salud` avisa si un negocio con actividad no tiene informe.
2. **El modo aprobación de Beto nunca habría funcionado.** Toda propuesta fallaba al guardarse, con un error SQL (42P10) que solo quedaba en el log. Además:
   - aprobar dos veces programaba dos mensajes pagados;
   - el juez de IA se volvía a pagar cada 5 minutos por los mismos chats;
   - desde el día 7 de silencio el embudo cerraba justo las cotizaciones que Beto debía retomar.

   Todo arreglado y probado de punta a punta. **Sigue apagado.**
3. **Los pasos del cron fallaban en silencio.** Ahora cada paso registra si corrió, si falló, el error y el negocio afectado. Tres fallos seguidos o cinco errores en seis horas ponen `/api/salud` en 503.
4. **Los números ahora cuadran.**
   - "101 vs 380 conversaciones": la portada leía los mensajes sin paginar y se cortaba en 1.000 filas.
   - "52 vs 53 esperando": se contaban filas en vez de conversaciones.
   - Los mensajes descartados se contaban como enviados.
5. **"El cliente dijo que pagó" ya no es "pago confirmado".**
   - La venta puede quedar ganada, pero queda la etiqueta *Pago por confirmar* hasta que una persona marca el cobro.
   - Marcar el cobro como pagado ahora sí mueve la conversación.
   - A Meta solo se le informa una compra con el cobro confirmado.
6. **Abrir /embudo ya no escribe en la base ni avisa a Gestión.** Lo hace el cron una vez por hora.

---

## B. Bugs encontrados (por severidad)

### CRÍTICO

**B1. Cola de seguimientos: el arreglo de la auditoría era parcial [V].**
- **Problema.** La auditoría amplió la lectura a 40 filas. Pero las filas atascadas (tope diario, texto libre con la ventana de 24 h cerrada, filas sin texto) seguían al frente. Con más de 40 así, ningún otro negocio recibía recordatorios.
- **Arreglo.**
  - Tope diario alcanzado → la fila pasa a mañana 10:00 de Chile.
  - Ventana cerrada → se corre 2 horas, y a los 7 días se descarta con motivo.
  - Sin texto → se descarta con motivo.
- **Prueba.** `tests/seguimientos-cola.test.mjs`: "60 pospuestos no tapan a otro negocio".

**B2. Recordatorios de citas vencidas se mandaban tarde [V].**
- **Problema.** Un recordatorio atrasado (por ejemplo, por el atasco de B1) salía igual. El cliente recibía "te esperamos hoy a las 09:00" a las 10:00, o la encuesta de una cita cancelada.
- **Arreglo.** Antes de enviar se revisa la cita, filtrando por su negocio:
  - confirmación: no con menos de 12 h de anticipación;
  - recordatorio: no con menos de 15 min;
  - encuesta: no más de 20 h después;
  - nada si la cita está cancelada o fue no-show.
- **Prueba.** `tests/seguimientos-core.test.mjs` y la cola.

**B3. Informe semanal bloqueado en silencio [V].** Detalle en F.

**B4. Beto modo aprobación: toda propuesta fallaba al guardarse [V].**
- **Problema.** `upsert` con `onConflict` contra un índice único **parcial** (`where estado='propuesto'`). Postgres lo rechaza con 42P10. `/seguimientos` habría quedado vacío para siempre.
- **Arreglo.** Buscar la propuesta viva y actualizarla, o insertar una nueva. Si choca (23505), se actualiza.
- **Prueba.** `tests/beto-aprobacion-ciclo.test.mjs` reproduce el 42P10 con una base en memoria que emula el índice parcial.

### ALTO

**B5. Aprobar una propuesta no era atómico [V].**
- **Problema.** Dos clics (o dos personas) programaban dos mensajes de marketing (~$85 c/u) al mismo cliente.
- **Arreglo.** La propuesta se reclama con `update … where estado='propuesto'` y solo gana uno. Si programar falla, vuelve a "propuesto".
- **Prueba.** "Doble clic: exactamente UNA programación".

**B6. El juez de Beto se pagaba cada 5 minutos por los mismos chats [V].**
- **Problema.** Un candidato frenado o rechazado no dejaba memoria. En modo aprobación las propuestas no gastaban cupo, así que el juez corría hasta el tope diario en cada pasada, todo el día.
- **Arreglo.**
  - El "no" del juez se guarda (estado `frenado`, migración 304) y no se reevalúa hasta que haya un mensaje nuevo en la conversación.
  - Un juez **sin veredicto** (modelo caído) se reintenta al día siguiente.
  - En modo aprobación el límite es la lista: propuestas pendientes ≤ tope.
- **Pruebas.** "Segunda pasada: sin volver a pagar al juez ni duplicar", "rechazo no reaparece", "juez sin veredicto".

**B7. El cierre por silencio del embudo dejaba a Beto sin cotizaciones que retomar [V].**
- **Problema.** El embudo pasa a `perdido · sin_respuesta` toda cotización con 7 días sin respuesta y le quita la etiqueta. Beto busca cotizaciones con 3 a 30 días de silencio y descartaba los perdidos. Desde el día 7 ninguna calificaba, y una propuesta hecha el día 6 vencía al aprobarla.
- **Arreglo.** Un perdido *por silencio* sigue siendo retomable (el juez decide si hubo cotización). Un perdido por otro motivo, no. **Ver decisión 2.**
- **Prueba.** Test dedicado en el ciclo de Beto.

**B8. Cruce de negocios en la disponibilidad pública [V].**
- **Problema.** `ed_servicio_profesional` se leía solo por servicio. Un mapeo viejo servicio(A) → profesional(B) hacía que la página de reservas de A usara las horas y el Google Calendar (con el token) de B.
- **Arreglo.** Se cruza con los profesionales del negocio.
- **Prueba.** `tests/disponibilidad-tenant.test.mjs`.

**B9. WAHA fallaba abierto [V].**
- **Problema.** Si no se podía verificar quién es el dueño de la única sesión de WAHA (error de base, o una llamada sin `clienteId`), el mensaje salía por el WhatsApp de Impresora.
- **Arreglo.** Sin verificación, no se envía.
- **Prueba.** `tests/waha-bloqueo.test.mjs`.

**B10. «Agendado» se podía borrar en masa [V].**
- **Problema.** Si la lectura de citas activas fallaba (o venía cortada en 1.000 filas), el cron le quitaba «Agendado» a contactos de todos los negocios y avisaba cada cambio a Gestión.
- **Arreglo.**
  - Un error corta el paso.
  - La ausencia de cita se confirma negocio por negocio antes de quitar la etiqueta.
- **Prueba.** `tests/reconciliar-agendado.test.mjs`.

**B11. A Meta se le informaba como compra un pago que el cliente solo dijo haber hecho [V].**
- **Problema.** `venta_confirmada` del detector de cierres, que un modelo lee en el chat, se mandaba como `Purchase`.
- **Arreglo.** Solo el cobro marcado como pagado genera `Purchase`. Hoy está inerte porque nadie tiene dataset configurado.

### MEDIO

- **B12. Métricas descuadradas.** Ver E.
- **B13. Descartados contados como enviados [V].**
  - **Problema.** `descartar()` pone `enviado_en`. Contaban como envío en:
    - el tope diario (15 recordatorios vencidos agotaban el cupo);
    - las tarjetas de la portada, la fidelización y la ficha del cliente;
    - el ruteo de respuestas: un descartado "reclamaba" la respuesta del cliente para Beto o Vera;
    - la detección de confirmaciones y encuestas.
  - **Arreglo.** Filtro `variables->>descartado is null` en los 7 consumidores.
  - **Límite.** Las filas `no_contactar` cerradas antes de hoy no tienen marca.
- **B14. Tarjetas de Beto y Vera en cero permanente [V].** Mostraban tipos que ningún proceso escribe. Ver E.
- **B15. Google Calendar decía «Conectado ✓» con errores [V].** Además:
  - un refresh token ilegible no dejaba rastro;
  - una lectura exitosa no limpiaba errores viejos de lectura;
  - las llamadas a Google no tenían timeout.
- **B16. Marcar un cobro como pagado no movía la conversación [V].** «Falta pago» seguía visible con la plata en la cuenta.
- **B17. Abrir /embudo escribía en la base y avisaba a Gestión [V].** Además, elegir «Todas» podía cerrar cientos de conversaciones viejas desde un GET, y un mismo chat podía recibir dos cambios en paralelo con resultado incierto.
- **B18. Avisos push a usuarios dados de baja [V].** El aviso trae nombre y trozo del mensaje del cliente.
- **B19. CSRF de OAuth [V].** Google, Instagram y Meta Ads: alguien podía hacer que otra persona conectara SU cuenta al negocio del atacante.
- **B20. `gcal_id` libre con la cuenta de servicio compartida [V].** Un negocio podía pegar el calendario de otro.
- **B21. Correo sin verificar [S].** El portal no exigía `email_confirmed_at`. Solo es explotable si la confirmación de correo está apagada en Supabase, pero se cierra en código igual.
- **B22. Detector de destilado de Isabel:** negocios sin empleados ocupaban la corrida cada madrugada, y entraban negocios inactivos.
- **B23. Renovación de tokens de Instagram:**
  - sin timeout;
  - un guardado fallido contaba como "renovado";
  - reintentaba cada 5 min tokens ya vencidos.

### BAJO

- **B24.** `/estado`: cualquier usuario logueado veía los conteos globales de Respondo.
- **B25.** Inicio del mes anclado a −04:00: en horario de verano la primera hora del mes quedaba fuera.
- **B26.** Chat pausado mostraba "Tino está atendiendo".
- **B27.** El detector de cierres procesaba siempre al mismo negocio primero, e incluía inactivos.
- **B28.** Tope diario de Beto contado en día UTC (cambiaba a las 20:00–21:00 de Chile).
- **B29.** Seguimiento de cotizaciones: un error leyendo cobros pagados se ignoraba (fail-open sobre plata).

---

## C. Cambios por archivo, explicados desde el producto

### Procesos automáticos y observabilidad
| Archivo | Qué cambia para el negocio |
|---|---|
| `lib/procesosCore.ts` (nuevo) | Reglas del registro por proceso:<br>• un día sin trabajo no borra un fallo anterior;<br>• los errores se guardan sin tokens, teléfonos ni correos. |
| `lib/procesos.ts` (nuevo) | Guarda el estado de cada paso del cron en `ed_latidos` (clave `proceso:<paso>`). Dos viajes a la base por corrida. |
| `app/api/cron/seguimientos/route.ts` | • Cada paso corre protegido y deja su resultado.<br>• El envío de seguimientos antes no tenía `try`: si lanzaba, se caía el cron entero.<br>• Candado para que dos corridas simultáneas no manden el mismo mensaje dos veces.<br>• Paso nuevo: etapas del embudo. |
| `app/api/salud/route.ts` | Dos chequeos nuevos, solo con `?k=`: `procesos_cron` y `informes_semanales`. |
| `app/estado/page.tsx`, `lib/adminRespondo.ts` (nuevo) | Conteos globales y tabla de procesos solo para correos en `RESPONDO_ADMIN_EMAILS`. |

### Informe semanal
| Archivo | Qué cambia |
|---|---|
| `lib/insightsAuto.ts` | • Recorre todos los negocios, en orden fijo.<br>• "Poca actividad" no ocupa el cupo.<br>• Cada negocio se intenta como mucho una vez por hora.<br>• Se completa cualquier día, no solo el lunes.<br>• Un informe parcial generado a mano a mitad de semana se rehace.<br>• Errores por negocio.<br>• Nueva función de cobertura. |
| `lib/insights.ts` | Marca `omitido` (poca actividad, sin empleados) para no confundirlo con un error. |

### Seguimientos (Beto, Vera, recordatorios)
| Archivo | Qué cambia |
|---|---|
| `lib/seguimientosCore.ts` (nuevo) | Reglas puras: vigencia de la cita, "mañana 10:00 de Chile", pospuestos, marca de descartado. |
| `lib/seguimientos.ts` | • Cola que no se atasca.<br>• Vigencia de citas.<br>• Descartes con motivo.<br>• El tope diario y el ruteo de respuestas ignoran descartados.<br>• Errores de envío por negocio. |
| `lib/agendaSeguimientos.ts` | Anular recordatorios de una cita acotado a su negocio. Confirmación y encuesta ignoran descartados. |
| `lib/propuestasCore.ts` (nuevo) | Memoria de decisiones (propuesto / rechazado / frenado / sin veredicto) y vigencia al aprobar. |
| `lib/propuestasSeguimiento.ts` | • Guardar propuesta sin el upsert roto.<br>• Aprobar atómico.<br>• Revisa si el cliente escribió, compró o pidió que no le escriban.<br>• Respeta el tope diario (si está lleno, sale mañana 10:00 y avisa). |
| `lib/generadorCotizacion.ts` | • Memoria de propuestas.<br>• Cupo de la lista en modo aprobación.<br>• Falla cerrado si no puede leer cobros, previos o memoria.<br>• Día de Chile.<br>• Juez inyectable para pruebas. |
| `lib/generadorCotizacionCore.ts` | Perdido por silencio sigue siendo retomable. |
| `lib/juezCotizacion.ts` | Un error leyendo el hilo ya no se interpreta como "hilo vacío = no hay cotización". |
| `components/PropuestasLista.tsx`, `app/(portal)/seguimientos/acciones.ts` | Muestran el aviso "sale mañana a las 10:00" y retiran de la lista las propuestas vencidas. Solo copy. |
| `sql/304_propuestas_memoria.sql` (nuevo) | Agrega el estado `frenado` y un índice. **No envía ni enciende nada.** |

### Métricas y tarjetas
| Archivo | Qué cambia |
|---|---|
| `lib/metricas.ts` (nuevo) | Definiciones únicas: conversaciones activas, "te esperan", paginado sin tope de 1.000. |
| `lib/resumen.ts` | Tarjetas del equipo:<br>• mensajes paginados (en paralelo);<br>• "esperando por ti" por conversación y de cualquier fecha;<br>• seguimientos sin descartados y por tipo. |
| `lib/contadores.ts` | El menú usa la función única de "te esperan". |
| `app/(portal)/inicio/page.tsx` | • "N conversaciones este mes" con la definición canónica.<br>• Beto: Seguimientos enviados / Respondieron / Por aprobar.<br>• Vera: Encuestas enviadas / respondidas / Clientes molestos.<br>• El bloque mensual solo si es del mes en curso.<br>• "¿Está funcionando?" visible aunque el asistente haya respondido 0.<br>• "este mes" junto al equipo. |
| `lib/isabel.ts`, `lib/isabelDatos.ts`, `lib/isabelCore.ts` | Mismo "te esperan" que el menú. Lista de derivaciones por conversación. Total real de cobros pendientes. |
| `app/(portal)/analitica/page.tsx` | "Conversaciones" pasa a **"Conversaciones respondidas"**: mide otra cosa a propósito. |
| `lib/fechas.ts` | Inicio de mes exacto en hora de Chile. |
| `lib/fidelizacion.ts`, `lib/clientes.ts` | Ignoran descartados. |

### Cobros
| Archivo | Qué cambia |
|---|---|
| `lib/etiquetasCiclo.ts`, `lib/etiquetas.ts` | Etiqueta nueva **«Pago por confirmar»**. Sobrevive a ganado y se va con perdido o con el pago confirmado. |
| `lib/cierreVentas.ts` | "Pagado" detectado → ganado + «Pago por confirmar» (salvo que ya haya un cobro confirmado). El aviso dice "Informa que pagó · falta confirmar el pago". |
| `lib/pagos.ts` | Marcar pagado → ganado (si la etapa no es manual) y se quitan «Falta pago» y «Pago por confirmar». |
| `lib/ads/colaEventos.ts` | `Purchase` solo desde cobros confirmados. |
| `app/(portal)/conversaciones/page.tsx` | Prioridad visual de la etiqueta nueva. |

### Embudo
| Archivo | Qué cambia |
|---|---|
| `lib/embudo.ts` | La página calcula en memoria y no escribe. `recalcularEtapasEmbudo` persiste y avisa. Un chat ya no recibe dos cambios en paralelo. |
| `lib/embudoCron.ts` (nuevo) | Una vez por hora, ventana de 14 días (la misma que la página por defecto), negocios rotando. |

### Google Calendar
| Archivo | Qué cambia |
|---|---|
| `lib/estadoGoogleCore.ts` (nuevo) | Estado honesto a partir de lo que respondió Google. |
| `lib/agendaGoogle.ts` | • Anota errores de freeBusy (también de la cuenta de servicio y por calendario) y el token ilegible.<br>• Limpia solo errores de lectura cuando vuelve a funcionar.<br>• No reescribe el mismo error.<br>• Filtra por negocio. |
| `lib/googleCalendar.ts`, `lib/googleOAuth.ts` | Timeout de 8 s. `freeBusy` informa errores por calendario. **La disponibilidad sigue calculándose igual** (si Google falla, se ofrecen horas como antes). |
| `app/(portal)/agenda/configuracion/page.tsx` | Muestra el estado real y el aviso de calendario ajeno. |
| `app/(portal)/agenda/acciones.ts` | No acepta un calendario que otro negocio ya tiene sincronizado. |

### Seguridad multi-negocio y otros
| Archivo | Qué cambia |
|---|---|
| `lib/tenant.ts` (nuevo), `app/(portal)/conversaciones/accionesPagos.ts` | Validación única de empleado + contacto del negocio (arreglo de la auditoría, revisado). |
| `lib/mediaSegura.ts` (nuevo), `app/api/whatsapp/media/route.ts` | Cabeceras seguras de adjuntos (arreglo de la auditoría, revisado y extraído). |
| `lib/agenda.ts`, `lib/agendaBot.ts`, `lib/autogestionDatos.ts` | `cambiarEstado` informa si encontró la cita. Anulación con negocio. Profesionales acotados al negocio. |
| `lib/waha.ts` | Falla cerrado. |
| `lib/auth.ts`, `lib/authCore.ts` (nuevo) | Exige correo verificado. |
| `lib/push.ts`, `components/pwa/Notificaciones.tsx` | Avisos solo a usuarios activos. El navegador se vuelve a atar a la sesión actual al abrir Inicio. |
| `lib/oauthVinculo.ts` (nuevo) + `app/api/{google,instagram,ads}/{conectar,callback}/route.ts` | Cookie que ata el `state` al navegador que inició la conexión. |
| `lib/reconciliarEstados.ts` | «Agendado» falla cerrado. Errores por subpaso. |
| `lib/instagram.ts`, `lib/isabelDestilado.ts`, `lib/avisosCupo.ts` | Errores estructurados, timeouts y orden (ver F). |
| `components/InboxConversacion.tsx` | "está pausado en este chat · nadie responde automáticamente". Solo copy. |

---

## D. Pruebas agregadas o modificadas

**595 pruebas, todas verdes** (antes de la auditoría: 508). Todas corren sin red ni base real. Ningún test manda nada a nadie.

**Herramientas nuevas de prueba**
- `tests/_supaFalso.mjs`: anota cada consulta y sus filtros.
- `tests/_baseMemoria.mjs`: emula lo necesario de PostgREST, incluidos los índices únicos **parciales** (reproduce el 42P10).

| Archivo | N.º | Qué protege |
|---|---|---|
| `seguimientos-cola.test.mjs` | 10 | Cola sin atasco entre negocios, tope a mañana 10:00, citas vencidas, tope sin descartados, errores sin chat_id |
| `seguimientos-core.test.mjs` | 6 | Vigencia de citas, mañana 10:00 con cambio de horario, pospuestos |
| `beto-aprobacion-ciclo.test.mjs` | 11 | Ver lista abajo |
| `informe-semanal-auto.test.mjs` | 9 | "Poca actividad" no tapa, parcial se rehace, martes completa, reintento por hora, cobertura desde el martes |
| `procesos.test.mjs` | 9 | Fallo/éxito/sin trabajo, alerta por fallos seguidos o frecuentes, limpieza de secretos, nunca lanza |
| `metricas-canonicas.test.mjs` | 6 | "Te esperan" por conversación, conversaciones activas, paginado serie y paralelo |
| `resumen-empleados.test.mjs` | 1 | >1.000 mensajes, descartados fuera, esperando por chat |
| `estado-google.test.mjs`, `agenda-google-estado.test.mjs` | 4 + 2 | Estados honestos; error de lectura anotado y limpiado; error de escritura no se borra |
| `pago-confirmado.test.mjs` + `etiquetas-ciclo.test.mjs` (mod.) | 3 + 1 | Pago informado ≠ confirmado; etapa manual respetada; aislamiento |
| `embudo-solo-lectura.test.mjs` | 3 | La página no escribe; el cron sí, solo en su negocio; una vez por hora |
| `disponibilidad-tenant.test.mjs` | 1 | Mapeo cruzado ignorado |
| `waha-bloqueo.test.mjs` | 2 | Falla cerrado |
| `auth-core.test.mjs` | 1 | Correo sin verificar no entra |
| `push-vigentes.test.mjs` | 1 | Usuario dado de baja no recibe |
| `oauth-vinculo.test.mjs` | 2 | `state` de otro navegador no conecta |
| `reconciliar-agendado.test.mjs` | 2 | Lectura fallida no borra «Agendado» |
| `admin-respondo.test.mjs` | 1 | `/estado` falla cerrado |
| `tenant.test.mjs`, `media-segura.test.mjs`, `anular-seguimientos-cita.test.mjs` | 4 + 4 + 3 | Los arreglos de la auditoría |
| `generador-cotizacion.test.mjs` (mod.) | +1 | Perdido por silencio retomable |

**Qué cubre `beto-aprobacion-ciclo.test.mjs`**
- 42P10 reproducido;
- ciclo completo: reja → juez → propuesta → aprobación → programación → envío por plantilla con la ventana cerrada, respetando horario, `no_contactar` y negocio;
- doble clic;
- vencida al aprobar;
- tope a mañana;
- lista llena;
- rechazo;
- fail-closed de cobros;
- sin veredicto;
- perdido por silencio.

**Verificación extra.** Se hicieron pruebas de mutación: se revirtieron a mano arreglos clave (reclamo atómico, memoria de propuestas, filtro de descartados) y las pruebas fallaron como correspondía. También se hizo una revisión adversarial independiente del diff completo. Encontró 7 defectos en mis propios cambios, todos corregidos antes de cerrar:
- el choque embudo ↔ Beto (B7);
- bloqueo de calendario que apagaba una sincronización ajena;
- limpieza de errores de escritura;
- cast de tipos que habría fallado en `tsc` real;
- juez sin veredicto repagado;
- lectura en serie en la portada;
- alerta permanente por un token de Instagram vencido.

---

## E. Métricas: antes → problema → final

### Matriz

| Métrica | Inicio (antes) | Analítica | Isabel (antes) | Definición canónica (final) |
|---|---|---|---|---|
| **Conversaciones** | `ed_metricas.conversaciones` si existía (de cualquier mes) o **suma por empleado** de chats distintos en `ed_mensajes` desde el día 1, **sin paginar** (se corta en 1.000 filas) | Chats con ≥1 respuesta (IA o equipo) en N días, paginado | Contactos con `ultimo_mensaje_en` en los últimos 30 días (conteo exacto) | **Conversación activa** = contacto con ≥1 mensaje de cualquiera en el período. `lib/metricas.ts → contarConversacionesActivas`. Inicio: mes calendario de Chile. Isabel: 30 días móviles. Analítica se renombra **"Conversaciones respondidas"** (otra medida, a propósito). |
| **Personas que escribieron** | — | Chats con ≥1 mensaje del cliente | — | Sin cambio (solo Analítica, nombre claro). |
| **Te esperan** | Filas de `ed_escalaciones` sin atender | — | Filas sin atender | **Conversaciones con ≥1 derivación sin atender** (RPC de la bandeja, migración 293; respaldo: chats distintos). Menú, chip de bandeja, Inicio e Isabel usan `contarEsperando`. |
| **"N esperando por ti"** (tarjeta del empleado) | Filas creadas **este mes** sin atender | — | — | Conversaciones distintas del empleado con derivación abierta, de cualquier fecha. |
| **Seguimientos enviados / respondieron** | Incluía descartados | Fidelización incluía descartados | — | Solo envíos reales: `enviado_en` no nulo **y** `variables.descartado` nulo. |
| **Tarjeta Beto** | Cotizaciones retomadas / Clientes reactivados / Ventas recuperadas (**nadie escribe esos tipos**) | — | — | Seguimientos enviados · Respondieron · Por aprobar (si hay). |
| **Tarjeta Vera** | Encuestas respondidas / **Reseñas conseguidas** (nadie lo escribe) / Clientes molestos | — | — | Encuestas enviadas · Encuestas respondidas · Clientes molestos. |
| **Cobros pendientes (total en $)** | — | — | Suma sobre los **10** más antiguos | Total real (hasta 1.000 cobros). La lista sigue mostrando los 10 más antiguos, y se dice. |
| **Bloque del mes** | Último `ed_metricas` no basal, aunque fuera de otro mes | — | — | Solo si es del mes en curso. Hoy esa tabla solo la llenan las semillas de demo (decisión 3). |

### Por qué "101 vs 380" y "52 vs 53"

- **101 vs 380.** La causa principal es el corte silencioso de 1.000 filas: con ~8.000 mensajes al mes, la portada veía un octavo. Se sumaban dos diferencias más: mes corrido (11 días) contra 30 días, y la suma por empleado. Después del arreglo, Inicio muestra los contactos con actividad desde el 1 de septiembre. Será menor que los 380 de Isabel **solo porque la ventana es más corta**, y ahora cada pantalla dice su ventana.
- **52 vs 53.** Un chat con dos derivaciones abiertas contaba doble en la portada. Ahora las cuatro pantallas cuentan conversaciones.

**Zonas horarias.** Los cortes por mes usan medianoche exacta de Chile. Las ventanas móviles (30 días, 24 h) son por milisegundos y no dependen de la zona.

---

## F. Jobs: antes → solución → cómo sabríamos si falla

**Cómo se ve ahora.** Cada paso escribe en `ed_latidos` la fila `proceso:<paso>` con:
- `ultimo_estado`, `ultimo_exito_en`, `ultimo_fallo_en`, `ultimo_error`;
- `fallos_seguidos`;
- los últimos 10 errores con `clienteId` y fecha;
- `resumen` con conteos y `duracion_ms`.

**Se lee en**
- `/api/salud?k=…` → `procesos_cron`. **503** si un paso lleva 3 corridas fallidas seguidas, o 5 errores en 6 horas.
- `/api/salud?k=…` → `informes_semanales`. **503** desde el martes si un negocio con ≥10 mensajes la semana pasada no tiene informe completo.
- `/estado`, solo `RESPONDO_ADMIN_EMAILS` → tabla de procesos.
- SQL: `select clave, ultimo_en, detalle from ed_latidos where clave like 'proceso:%';`

| Paso (`proceso:`) | Antes | Solución | Cómo sabríamos |
|---|---|---|---|
| `seguimientos` | Sin `try`: si lanzaba, se caía todo el cron. Errores de envío solo en la respuesta. | Protegido. Errores de envío por negocio. "Fuera de horario" = sin trabajo. | 5 envíos fallidos en 6 h → 503 |
| `informe_semanal` | 1 negocio por corrida, sin orden. "Poca actividad" bloqueaba a todos. Solo lunes. Un parcial manual bloqueaba el lunes. Errores como texto. | Ver B3/C | Error del modelo por negocio + chequeo de cobertura desde el martes |
| `generador_seguimientos` | `console.error` | Registrado | Fallos seguidos |
| `conversiones_pauta` | Errores en texto | Errores registrados | Fallos |
| `destilado_isabel` | Sin empleados ocupaba la corrida. Inactivos incluidos. Errores escondidos. | Marca el día, filtra activos y ordena. El tope cuenta solo llamadas al modelo. | Errores por negocio |
| `tokens_instagram` | Sin timeout. Guardado fallido contaba como éxito. Reintentaba vencidos cada 5 min. | Timeout 10 s. Guardado verificado. Excluye vencidos. Un intento por negocio por hora. | Errores por negocio (el token vencido se ve en la pantalla del canal) |
| `avisos_cupo` | Errores en texto | Errores por negocio | Errores |
| `reintento_webhooks` | Conteo de fallidos invisible | Un entrante no reprocesado = error | Errores |
| `vigilante_abandonadas` | `console.error` | Registrado | Fallos |
| `reconciliar_estados` | Subpasos tragaban errores; «Agendado» fallaba abierto | Errores por subpaso; fail-closed | Errores |
| `etapas_embudo` (nuevo) | Pasaba al abrir la página | Una vez por hora, 14 días | Fallos |
| `detector_cierres` | Mismo negocio siempre primero, inactivos | Rotación, activos | Fallos |
| `archivado_adjuntos` | Invisible | Error solo si **todos** fallan (uno suelto es normal) | Errores |
| `seguimiento_cotizaciones` | Errores como detalle con chat_id | Errores por negocio sin chat_id. Falla cerrado ante lecturas fallidas. | Errores |
| **Candado** | Dos corridas simultáneas podían duplicar envíos | `limitarDistribuido("cron:seguimientos", 1, 55)` | Respuesta `{"omitido":"otra corrida en curso"}` |

**Por qué no hay tabla nueva.** `ed_latidos` (migración 260) ya existía para esto: una fila por proceso con `detalle` jsonb. Un historial completo de corridas no aporta más que "último estado + últimos 10 errores" para detectar fallas, y crecería sin límite.

---

## G. Seguridad multi-negocio

| # | Hallazgo | Riesgo | Arreglo | Prueba |
|---|---|---|---|---|
| G1 | Mapeo servicio(A) → profesional(B) en la reserva pública | Horas y Google Calendar de otro negocio | Intersección con profesionales del negocio. Filtro por negocio en Google. | `disponibilidad-tenant` |
| G2 | WAHA fail-open | Mensajes por el WhatsApp de otro negocio | Fail-closed | `waha-bloqueo` |
| G3 | «Agendado» borrado en masa entre negocios | Estados falsos + avisos a Gestión | Fail-closed + confirmación por negocio | `reconciliar-agendado` |
| G4 | CSRF de OAuth (Google, Instagram, Ads) | Cuenta de la víctima conectada a otro negocio | Cookie HttpOnly con huella del `state` | `oauth-vinculo` |
| G5 | Push a usuarios dados de baja | Conversaciones del negocio en un teléfono ajeno | Solo usuarios activos. Se re-ata el navegador a la sesión. | `push-vigentes` |
| G6 | Correo sin verificar [S] | Suplantación si Supabase no exige confirmación | Exige `email_confirmed_at` | `auth-core` |
| G7 | `gcal_id` de otro negocio | Leer ocupados / escribir eventos en calendario ajeno | Rechaza calendarios ya sincronizados por otro negocio | (acción de servidor; lógica en consulta) |
| G8 | Anular recordatorios de cita sin negocio (auditoría) | Borrar seguimientos de otro negocio | Acotado a empleados del negocio | `anular-seguimientos-cita` |
| G9 | Validación empleado/contacto en cobros (auditoría) | Cobrar en chat de otro negocio | `lib/tenant.ts`, fail-closed | `tenant` |
| G10 | Aprobar propuesta de otro negocio | Mensaje pagado ajeno | Reclamo con `cliente_id` en el WHERE | ciclo de Beto |
| G11 | `/estado` global | Conteos de Respondo visibles para clientes | Solo admins | `admin-respondo` |

**Límites conocidos**
- G7 no impide que alguien registre un calendario ajeno **antes** que su dueño (Fase 1: verificar propiedad).
- G4 requiere que el portal se use en el mismo dominio que `NEXT_PUBLIC_SITE_URL`, que es también donde vuelven los proveedores (decisión 4).

---

## H. Lo que deliberadamente NO se cambió

- **Rediseño, Inicio nuevo, Equipo IA, visión/audio.** Nada. Solo copy donde un texto mentía.
- **`reingreso_activo`.** No se cambió. ⚠️ Corrección del 11-sep: decía «apagado», pero el chequeo de procesos en producción muestra que el vigilante sí trabaja, y lo tiene encendido Impresora, por decisión de Marcelo. Se queda así.
- **Beto en Impresora.** `cotizacion_seguimiento` sigue en `false` y el modo por defecto es aprobación. No se tocó ningún dato de producción.
- **Usuarios y permisos.** No se reconstruyó nada. Solo se agregó un permiso de dueño para aprobar mensajes pagados de Beto (ver decisiones al final).
- **freeBusy.** Ante un fallo de Google se siguen ofreciendo horas (fail-open), como antes. Lo nuevo es que el fallo queda visible.
- **Webhook de Flow.** No hizo falta para corregir fallas actuales. Ver K.
- **Motivo `pago_detectado` hacia Gestión.** Se mantiene: es un contrato con un sistema externo.
- **Tablas nuevas para observabilidad.** No se crearon; se reutilizó `ed_latidos`.
- **Vista canónica del estado comercial.** No se implementó (principio acordado para Fase 1).
- **Archivos de Marketing de otra sesión** (`components/marketing/*`, `lib/ads/*` salvo `colaEventos.ts`). No se tocaron.
- **URL de medios de WAHA guardada al ver un adjunto.** Clasificada C (no persistir), no corregida: requiere decidir el archivado de WAHA (K).

### Estados que se calculan al abrir una pantalla

| Estado | Dónde | Clase | Qué se hizo |
|---|---|---|---|
| Etapas del embudo | `/embudo` | **B**: dependía de abrir la página, avisaba a Gestión, podía cambiar en masa | **Arreglado:** página solo lectura + cron por hora |
| Estado de Google Calendar | Reserva pública, autogestión de citas | **B**: anónimos disparan refresco de token y escrituras | **Mitigado:** filtro por negocio, no reescribe el mismo error. Fase 1: sacar la escritura de la lectura pública. |
| URL temporal de medios WAHA | `/api/whatsapp/media` | **C** | Fase 1 |
| Contadores de rate-limit | Varias rutas GET | **A** (contador por naturaleza) | Ninguno |
| Callbacks OAuth / enlace mágico | GET por protocolo | **A** | CSRF cerrado (G4) |
| Copiloto de Marketing con `?q=` | `useEffect` al cargar | **B** (llamada paga por recarga) | No tocado (Marketing). Fase 1: exigir clic. |
| "Te esperan", conversaciones, tarjetas | Inicio, menú, Isabel | **A** (derivado al leer) | Unificado (E) |

---

## I. Archivos modificados

**Nuevos (código):**
- `lib/adminRespondo.ts`
- `lib/authCore.ts`
- `lib/embudoCron.ts`
- `lib/estadoGoogleCore.ts`
- `lib/mediaSegura.ts`
- `lib/metricas.ts`
- `lib/oauthVinculo.ts`
- `lib/procesos.ts`
- `lib/procesosCore.ts`
- `lib/propuestasCore.ts`
- `lib/seguimientosCore.ts`
- `lib/tenant.ts`

**Nuevos (SQL):** `sql/304_propuestas_memoria.sql`

**Nuevos (pruebas):**
- `tests/_supaFalso.mjs`
- `tests/_baseMemoria.mjs`
- 20 archivos `*.test.mjs` de la tabla D, más `tests/seguimientos-cola.test.mjs` reescrito (ya estaba en tu disco desde la auditoría)

**Modificados — app:**
- `app/(portal)/agenda/acciones.ts`
- `app/(portal)/agenda/configuracion/page.tsx`
- `app/(portal)/analitica/page.tsx`
- `app/(portal)/conversaciones/accionesPagos.ts`
- `app/(portal)/conversaciones/page.tsx`
- `app/(portal)/inicio/page.tsx`
- `app/(portal)/seguimientos/acciones.ts`
- `app/api/ads/callback/route.ts`
- `app/api/ads/conectar/route.ts`
- `app/api/cron/seguimientos/route.ts`
- `app/api/google/callback/route.ts`
- `app/api/google/conectar/route.ts`
- `app/api/instagram/callback/route.ts`
- `app/api/instagram/conectar/route.ts`
- `app/api/salud/route.ts`
- `app/api/whatsapp/media/route.ts`
- `app/estado/page.tsx`

**Modificados — components:**
- `components/InboxConversacion.tsx`
- `components/PropuestasLista.tsx`
- `components/pwa/Notificaciones.tsx`

**Modificados — lib:**
- `lib/ads/colaEventos.ts`
- `lib/agenda.ts`
- `lib/agendaBot.ts`
- `lib/agendaGoogle.ts`
- `lib/agendaSeguimientos.ts`
- `lib/auth.ts`
- `lib/autogestionDatos.ts`
- `lib/avisosCupo.ts`
- `lib/cierreVentas.ts`
- `lib/clientes.ts`
- `lib/contadores.ts`
- `lib/embudo.ts`
- `lib/etiquetas.ts`
- `lib/etiquetasCiclo.ts`
- `lib/fechas.ts`
- `lib/fidelizacion.ts`
- `lib/generadorCotizacion.ts`
- `lib/generadorCotizacionCore.ts`
- `lib/googleCalendar.ts`
- `lib/googleOAuth.ts`
- `lib/insights.ts`
- `lib/insightsAuto.ts`
- `lib/instagram.ts`
- `lib/isabel.ts`
- `lib/isabelCore.ts`
- `lib/isabelDatos.ts`
- `lib/isabelDestilado.ts`
- `lib/juezCotizacion.ts`
- `lib/pagos.ts`
- `lib/propuestasSeguimiento.ts`
- `lib/push.ts`
- `lib/reconciliarEstados.ts`
- `lib/resumen.ts`
- `lib/seguimientos.ts`
- `lib/waha.ts`

**Modificados — tests:**
- `tests/etiquetas-ciclo.test.mjs`
- `tests/generador-cotizacion.test.mjs`

**Documentos:** `docs/FASE0_ESTABILIZACION_SEP2026.md` (este).

---

## J. Qué tienes que correr y verificar antes de commit o deploy

### 1. Checks (en tu PC, dentro de `respondo-portal`)

```bash
npm ci            # si hace falta
npm run check     # = lint + typecheck + test + build
npm run typecheck:scripts
```

**Por qué no se corrieron aquí.** Este entorno no tenía salida a registry.npmjs.org (403), ni a mirrors ni CDNs, ni a Supabase. El puente a tu PC no montó la carpeta (update de Windows del 8-sep). Lo que sí se hizo:
- **Tests:** los 595 corren con un cargador que reemplaza `@supabase/supabase-js`, `react` y `web-push` por stubs. En tu PC corren con los paquetes reales.
- **Typecheck diferencial:** `tsc` con tipos stub sobre el código original y el nuevo. Resultado: **0 errores nuevos**. Los 18 que aparecen en ambos son artefactos de los stubs. Se probó inyectando un error real y lo detectó.
- **Lint y build:** no ejecutados. Riesgo principal: una regla de ESLint o un tipo real de supabase-js que los stubs no ven. Si `npm run check` falla, pégame la salida.

**Clasificación de fallas conocidas:** ninguna bloqueante observada en lo que se pudo correr.

### 2. SQL de solo lectura (Supabase → SQL editor), ANTES de desplegar

```sql
-- (a) ⚠️ BLOQUEANTE PARA EL DEPLOY: usuarios del portal con correo SIN confirmar.
--     Tras el deploy NO podrán entrar (G6). Debe devolver 0 filas.
select pu.email, pu.cliente_id, pu.rol
from portal_usuarios pu
join auth.users u on lower(u.email) = lower(pu.email)
where pu.activo and u.email_confirmed_at is null;

-- (b) Informe semanal: quién tiene el de la semana 31-ago → 6-sep y cuándo se creó.
select c.nombre, i.periodo_desde, i.creado_en
from ed_clientes c
left join ed_insights i on i.cliente_id = c.id and i.periodo_desde = '2026-08-31'
where c.activo order by c.id;

-- (c) Negocios activos con poca o nula actividad (los que tapaban la cola del informe).
select c.id, c.nombre, count(m.id) as mensajes_semana
from ed_clientes c
left join ed_empleados e on e.cliente_id = c.id
left join ed_mensajes m on m.empleado_id = e.id
  and m.creado_en >= '2026-08-31T04:00:00Z' and m.creado_en < '2026-09-07T03:00:00Z'
where c.activo group by c.id, c.nombre order by c.id;

-- (d) Beto: confirmar que nadie lo tiene encendido y si la 297 está aplicada.
select to_regclass('public.ed_propuestas_seguimiento') as tabla_297;
select id, nombre, cotizacion_seguimiento, cotizacion_tope_diario from ed_clientes
where cotizacion_seguimiento;

-- (e) Chats con más de una derivación abierta (explica 53 vs 52).
select e.chat_id, count(*) from ed_escalaciones e
where e.atendida_en is null group by e.chat_id having count(*) > 1;

-- (f) Mapeos servicio → profesional de OTRO negocio (G1). Idealmente 0.
select sp.servicio_id, sp.profesional_id, s.cliente_id as negocio_servicio, p.cliente_id as negocio_profesional
from ed_servicio_profesional sp
join ed_servicios s on s.id = sp.servicio_id
join ed_profesionales p on p.id = sp.profesional_id
where s.cliente_id <> p.cliente_id;

-- (g) Mismo calendario de Google en más de un negocio (G7).
select lower(gcal_id), count(distinct cliente_id) from ed_profesionales
where gcal_id is not null group by 1 having count(distinct cliente_id) > 1;

-- (h) Suscripciones push de personas que ya no están activas (G5).
select s.cliente_id, s.email from ed_push_suscripciones s
left join portal_usuarios pu on lower(pu.email) = lower(s.email) and pu.cliente_id = s.cliente_id and pu.activo
where pu.email is null;

-- (i) Seguimientos descartados vs enviados reales este mes.
select count(*) filter (where variables ? 'descartado') as descartados,
       count(*) filter (where not (variables ? 'descartado')) as enviados_reales
from ed_seguimientos where enviado_en >= date_trunc('month', now());

-- (j) Estado de los procesos (después del deploy).
select clave, ultimo_en, detalle->>'ultimo_estado' as estado, detalle->>'fallos_seguidos' as fallos,
       detalle->>'ultimo_error' as error
from ed_latidos where clave like 'proceso:%' order by clave;
```

### 3. Migraciones y variables

- **`sql/304_propuestas_memoria.sql`.** Aplicar solo si la 297 ya está aplicada (consulta d). No envía ni enciende nada. Si la 297 no está, déjalas las dos para cuando se decida encender Beto.
- **`RESPONDO_ADMIN_EMAILS`** en Vercel (opcional): correos del equipo Respondo, separados por coma, que ven `/estado` completo.
- **Monitor externo.** Confirmar que llama a `/api/salud?k=…`. Los chequeos nuevos solo corren con el secreto.

### 4. Verificaciones manuales después del deploy (5 minutos)

1. Inicio de Impresora:
   - "N conversaciones este mes" plausible (menor que el "en 30 días" de Isabel);
   - "Te están esperando" igual al número del menú;
   - Beto y Vera sin tarjetas en cero estructural.
2. `/agenda/configuracion`: si hay Google conectado, el estado dice lo real.
3. Conectar Google/Instagram en un negocio de prueba: debe funcionar (valida la cookie OAuth en tu dominio).
4. Una hora después: `select … from ed_latidos where clave like 'proceso:%'` con estados `ok`.
5. El lunes 14-sep: el informe de la semana del 7-sep aparece para Impresora sin apretar nada.

---

## K. Próxima fase recomendada (Fase 1)

**En orden**

1. **Vista canónica del estado comercial.** Fuentes autoritativas:
   - etapa → embudo (cron);
   - pago → `ed_pagos`;
   - "pago informado" → detector;
   - cita → `ed_citas`;
   - seguimiento → `ed_seguimientos` real.

   Una vista derivada, no una mega tabla. La UI mostraría "Pago informado por cliente · pendiente de confirmar" vs "Pago confirmado" (las etiquetas ya existen).
2. **Webhook de Flow.** Pago confirmado por proveedor → `cambiarEstadoPago` (que ya refleja en la conversación). El diseño cabe sin cambiar tablas: referencia del cobro ↔ orden de Flow.
3. **Columna `estado` en `ed_seguimientos`** (programado / enviado / descartado / fallido). Reemplaza la marca en `variables`, que es frágil.
4. **Sacar escrituras de la lectura pública de disponibilidad.** El estado de Google se registra solo en sincronizaciones reales o en un chequeo del cron.
5. **Métricas pesadas a RPC o vista materializada.** Tarjetas por empleado sin paginar mensajes.
6. **Verificación de propiedad de calendarios** con la cuenta de servicio.
7. **Archivado de medios WAHA** y dejar de guardar la URL temporal.
8. **Rediseño** (identidad azul/cian, Inicio accionable, Equipo IA) sobre números que ya cuadran.
9. **Visión y audio de Tino,** después de definir la privacidad con revisión legal.
10. **Permiso opcional de Cobros para staff.**

---

## Decisiones tomadas después de la entrega

1. **Aprobar mensajes pagados de Beto: solo el dueño.** Permiso nuevo `aprobar_mensajes_pagados` (fuera de staff). El staff ve la lista y puede descartar, pero no aprobar. Es una decisión de gasto, no de operación. Archivos: `lib/permisos.ts`, `app/(portal)/seguimientos/acciones.ts`, `app/(portal)/seguimientos/page.tsx`, `tests/permisos.test.mjs`.
2. **Perdido por silencio sigue siendo retomable por Beto.** Se queda como está (B7). El juez lee el hilo antes de proponer, y en modo aprobación una persona lo ve antes de que salga algo.
3. **`ed_metricas`.** No se toca en Fase 0: Inicio ya la ignora si no es del mes en curso. En Fase 1 se revisa si el motor 2.0 la escribe; si no, se quita el bloque.
4. **Dominio del portal.** Se verifica en el despliegue: `NEXT_PUBLIC_SITE_URL` tiene que ser exactamente la dirección con la que se entra al portal (paso de verificación en `docs/FASE0_PENDIENTES_MARCELO.md`).
5. **Avisos push al cerrar sesión.** Sí deben apagarse. Queda para Fase 1 (requiere que el botón de salir corra en el navegador).

---

## Después del despliegue (11-sep-2026)

Commit `2c7e455` en producción, migración 304 aplicada, variables de Vercel corregidas (`NEXT_PUBLIC_SITE_URL` recreada como Config; `RESPONDO_ADMIN_EMAILS` solo con la cuenta de Respondo).

**Primer hallazgo del chequeo de procesos.** `/api/salud` respondió `degradado` (503): `vigilante_abandonadas` con 6 errores en 6 h, «Vapid subject is not a valid URL».

- **Causa.** `VAPID_SUBJECT` en Vercel es un correo sin `mailto:`. `web-push` rechaza la configuración, así que **ningún aviso push salió nunca** en producción (preexistente, invisible hasta ahora).
- **Efecto extra.** En el vigilante, el aviso «el cliente le respondió a Tino» no estaba dentro de un `try`: el error cortaba el barrido completo cada 5 minutos. No se enviaron mensajes repetidos a clientes (la marca de revisado se escribe antes de mandar).
- **Arreglo.** `lib/push.ts`: `sujetoVapid()` agrega `mailto:` a un correo pelado y usa el sujeto por defecto ante cualquier valor inválido; `setVapidDetails` queda dentro de `try`, así que un aviso ya no puede lanzar. Test en `tests/push-vigentes.test.mjs`.
- **Reingreso de Tino.** Encendido en Impresora a propósito (confirmado por Marcelo). Con este arreglo, los avisos al equipo cuando Tino retoma o calla empiezan a llegar por primera vez.
- **Informes semanales.** Chequeo en verde: la semana del 31-ago tiene informe en todos los negocios con actividad.

