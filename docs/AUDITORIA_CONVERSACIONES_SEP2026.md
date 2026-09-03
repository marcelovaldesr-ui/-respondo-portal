# Auditoría completa de la sección Conversaciones — 3 de septiembre de 2026

Encargo: revisar **todo** el funcionamiento de Conversaciones del portal, punto
por punto, corregir lo que estuviera mal y anotar lo que necesita una decisión
del negocio. Motivación directa: las etiquetas que no se actualizaban y el
vigilante que dejó de mandar mensajes (0 de 94 revisiones) pasaron semanas sin
que nadie lo notara. El criterio de esta auditoría fue **verificar contra la
base real de Impresora Color** antes de corregir, no confiar en la lectura del
código.

Se corrigió en cinco lotes (un commit cada uno, todos con `tsc`, `eslint` y los
329 tests en verde) más un commit en Gestión.

| Lote | Commit | Área |
|---|---|---|
| 1 | `3c84410` | Entrada y motor (webhook Meta, parser, bot) |
| 2 | `719a715` | Salida y control (responder, adjuntos, plantillas, cobros, modo) |
| 3 | `93950bd` | Bandeja / interfaz / datos del detalle |
| 4 | `aec674f` | Cron: vigilante, detector de cierres, embudo, seguimientos, archivado |
| 5 | `6eaa238` | Acceso externo (Gestión), seguridad, migraciones |
| Gestión | `6dd0051` | Firma con ts+nonce; bajada de estado por ciclo nuevo |

Migraciones nuevas, **pendientes de aplicar en Supabase**, en este orden:
`sql/292_auditoria_conversaciones.sql` y `sql/293_bandeja_busqueda.sql`.
El código funciona sin ellas (degrada solo), pero varias correcciones
dependen de ellas: el detalle del error de envío, la búsqueda sin acentos, el
chip «Pausados», el conteo «te espera» por chat y el índice del vigilante.

---

## 1. Lo que se verificó contra la base (Impresora Color)

Medido con scripts de solo lectura (`scripts/_dbg_*.ts`, no versionados):

- Tres empleados activos (Tino, Beto, Vera). **Beto y Vera nunca han enviado
  nada** (0 mensajes, 0 filas de estado): todo lo que depende de "varios
  empleados" estaba latente, no roto hoy.
- La clave anónima de Supabase está denegada en todas las tablas `ed_*`: el
  hallazgo de `ed_push_suscripciones` sin RLS **no era explotable**, pero se
  dejó RLS explícito igual (292).
- `ed_chat_estado` **no tiene trigger** sobre `actualizado_en`: la marca que
  usa `restaurarControl` para no pisar a una persona sí funciona.
- Estado de entrega de los mensajes humanos de 7 días: 531 de 701 con
  `estado_envio = NULL`. Son los que Cecilia manda **desde el teléfono**
  (ecos): Meta nunca les manda acuse. Por eso el relojito 🕘 quedaba para
  siempre.
- 0 errores de envío en 30 días; 0 chats en modo bot mudos; 0 pausados; 0
  contactos `no_contactar`.
- 45 escalaciones abiertas en 44 chats (el contador del menú y el chip de la
  bandeja daban números distintos por esto).
- 8.202 mensajes en 30 días (3.405 salientes): cualquier consulta con tope de
  1.000 filas sobre ese rango **ya devuelve datos parciales**.
- 32 mensajes «[el cliente envió un archivo]» sin adjunto: eran eventos
  `edit`/`revoke` de WhatsApp tomados por archivos.
- 0 duplicados por eco: Meta **no** ecoa lo que se manda por API.
- Dos clientes activos en transporte WAHA sin instancia propia (Barbería
  Nogal, Estética Aurora): sin la barrera del lote 2, un adjunto o una
  respuesta humana desde su portal habría salido por el WhatsApp de Impresora.
- Un contacto marcado **ganado sin evidencia** (`56966861584`): 0 ventas, 0
  citas, último mensaje del cliente pidiendo cotizar bolsas. Lo puso la
  etiqueta "agendado" falsa (el modelo decía `accion:"agendar"` sin cita).
  Corregido a mano el 3-sep: etapa `interesado`, motivo
  `correccion_auditoria`, etiqueta `posible_comprador`, Gestión avisado.
  **Esa persona sigue esperando una cotización desde el 31-ago.**

## 2. Qué estaba mal y qué se hizo, por área

### Entrada y motor (lote 1)

- **Cliente mudo tras un corte del modelo.** Si el JSON del modelo llegaba
  malformado, el bot no respondía y no escalaba. Ahora la forma del JSON se
  valida, y cualquier fallo deriva a una persona con aviso push.
- Eventos `edit`/`revoke`/`system`/`order` de WhatsApp se guardaban como
  «archivo»: ahora se ignoran.
- Con dos remitentes en un mismo webhook, el nombre del contacto se pisaba:
  ahora es por remitente.
- Los acuses ✓✓ solo se aplicaban a mensajes guardados bajo Tino: ahora a todos
  los empleados del cliente, y con el **código de error de Meta** guardado
  (`estado_envio_detalle`, 292).
- Se guardaba `etiqueta:'lead'` y se recreaban contactos en cada mensaje: ahora
  `asegurarContacto` solo crea si no existe y solo llena el nombre vacío.
- Debounce + modelo dentro del reproceso de webhooks del cron podía pasar de
  los 60 s: techo de tiempo y sin debounce al reprocesar.
- `agendado` solo cuando la cita existe de verdad.
- Red de seguridad para mensajes duplicados que quedaron sin respuesta.

### Salida y control (lote 2)

- **Ventana de 24 h antes de enviar** (texto y adjuntos). Meta acepta el envío
  y lo rechaza después por webhook: el portal marcaba ✓ y el cliente no
  recibía nada. Ahora se rechaza antes con `codigo: "ventana_cerrada"` y la
  bandeja abre el selector de plantillas.
- Barrera «WAHA es de un solo negocio» en adjuntos y en respuestas humanas.
- Adjuntos por Meta: solo JPEG/PNG ≤ 5 MB como imagen; el resto como documento.
- Escalaciones cerradas **por chat** (todos los empleados) desde responder,
  adjunto, plantilla, cobro, «Tomar el control», «resuelto» y quitar
  «necesita atención».
- Un chat pausado por el dueño sigue pausado después de responderle.
- `lib/erroresMeta.ts`: una sola traducción de errores (190, 131026, 131047,
  130429, 132001…) para todos los caminos. Antes Cecilia veía el JSON crudo.
- `cambiarEtiqueta`: UPDATE en vez de upsert (creaba contactos para cualquier
  `chat_id`), y avisa a Gestión.
- Plantilla manual respeta `no_contactar`. Cobro revisa el guardado y cierra
  la escalación. `restaurarControl` no borra filas. `tocarVentanaEntrante`
  sin carrera. Rate limit de adjuntos por persona.

### Bandeja e interfaz (lote 3)

- **Tormenta de reconexiones del stream**: el EventSource se reabría con cada
  mensaje y, al sexto en un minuto, el servidor devolvía 429 y la bandeja caía
  a sondeo. Era la causa de «se actualiza lento a ratos».
- Panel de contexto (etiquetas, cobros, nota) disponible bajo 1280 px como
  cajón «Detalles»: en notebook chico y teléfono no existía.
- La lista de mensajes ahora desplaza por dentro (cadena flex): «N nuevos» y
  «ver anteriores» funcionan; en el teléfono se detecta quién desplaza.
- Ventana de 24 h **en vivo** (con reloj), no una foto del momento de carga.
- El panel se actualiza con cada refresco y tras cada acción (antes quedaba con
  la versión de la primera carga hasta cambiar de chat).
- Burbuja optimista reemplazada por la real (adjuntos ya no aparecen dos
  veces). Relojito eterno resuelto (mensajes del teléfono sin acuse → ✓).
- Enter no envía en pantallas táctiles. Derivación atendida se oculta a las
  24 h. «Ventana 24 h: Cerrada» ya no aparece en WAHA. 404 distinto de corte
  de red. Atrás/adelante en móvil sin pantalla en blanco.
- **El hilo es por número**: mensajes, estados, derivación y resultados de
  Tino, Beto y Vera juntos (detalle, stream, endpoint de mensajes, Gestión).
- Búsqueda sin acentos y con `%`/`_` escapados; «te espera» por chat; chip
  «Pausados»; el contador del menú usa el mismo cálculo que el chip (293).
- «Tú:» solo para personas, «Tino:» para el asistente; `pago_pendiente` con
  prioridad en la fila.

### Cron y ciclo de vida (lote 4)

- **CRÍTICO latente**: el seguimiento de cotizaciones de Beto calculaba «quién
  habló último» con 1.000 mensajes ordenados ascendente de un rango que ya
  tiene 8.200: el «último» era el de hace tres semanas. Habría mandado
  plantillas pagadas a quien respondió ayer. Ahora usa
  `ed_contactos.ultimo_mensaje_rol`. Sigue apagado (`cotizacion_seguimiento`).
- `pago_pendiente` excluye del seguimiento de cotización (con test).
- Vigilante: avisa cuando el cliente **le responde a Tino y nadie sigue**;
  respeta `no_contactar`; un chat por pasada; revalida antes de mandar; avisa
  si el envío falla; guarda el `waId` (el eco ya no se toma por persona).
- Detector de cierres: la evidencia se valida contra lo **nuevo** (el mismo
  comprobante no confirma dos ventas); una `venta_confirmada` por episodio.
- Fin de la oscilación del ciclo nuevo entre detector, embudo y reconciliar
  (`MOTIVOS_CICLO_NUEVO`): las ventas anteriores a `etapa_en` ya no empujan.
- Seguimientos: un fallo consume el intento; agotados, se descarta con motivo.
  Antes 10 filas atascadas bloqueaban todos los seguimientos para siempre.
- Archivado de adjuntos con timeout, techo y rotación de candidatos.
- Puente a Gestión **esperado con tope** desde el cron y las acciones (el
  fire-and-forget se perdía), con `etapaMotivo`/`etapaEn`.
- Push con timeout. Reconciliar con techo de tiempo. `seguimientoPendiente`
  sin techo de filas.

### Acceso externo y seguridad (lote 5)

- Firma con **marca de tiempo y nonce** (una petición capturada ya no se puede
  repetir). Gestión ya la manda; la firma vieja se acepta en transición
  (`MODO_FIRMA_VIEJA` en `lib/externo.ts`, bajar a `false` cuando no queden
  integraciones viejas).
- Límite por IP **antes** de la firma y por cliente **después**: antes,
  cualquiera con el `clienteId` público podía dejar a Gestión en 429.
- Varias integraciones activas ya no rompen el acceso. 401 uniforme.
- El adjunto firma la huella del archivo. `/cobros` protegido en el proxy.
- Gestión acepta que el estado **baje** cuando el motivo es `nuevo_ciclo`,
  `volvio_a_escribir` o `correccion_auditoria`.

## 3. Lo que queda y necesita una decisión de Marcelo

1. **Clave de cifrado de tokens** (`lib/cifrado.ts`): hoy se deriva de
   `SUPABASE_SERVICE_ROLE_KEY`; rotar esa clave dejaría mudos a todos los
   clientes en Cloud. Propuesta: `RESPONDO_CIFRADO_KEY` propia y versionada,
   con script de recifrado. Requiere ventana de mantenimiento corta.
2. **`/api/integraciones/pedidos`** recibe el secreto en claro en la cabecera
   (sobre HTTPS). Es equivalente a un bearer token; pasarlo a firma HMAC
   implica cambiar también a quien lo llame. Bajo riesgo; decidir si vale.
3. **Beto y Vera en producción**: con este trabajo la bandeja, el vigilante y
   el detector ya tratan el hilo por número, pero conviene probar un
   seguimiento real antes de encender `cotizacion_seguimiento` (tope diario
   10, $85 por plantilla).
4. **Tests de integración** de reconciliar/embudo/vigilante: la lógica pura
   tiene tests; la plomería contra la base se verificó a mano con scripts.
   Un entorno de pruebas con datos sintéticos permitiría automatizarlo.
5. El contacto `56966861584` está esperando una cotización de bolsas con logo
   desde el 31-ago.

## 4. Cómo comprobar que quedó bien

- Abrir la bandeja con la pestaña de red del navegador: `/api/whatsapp/stream`
  debe abrirse **una vez** por conversación y reabrirse solo cada ~50 s.
- Responder un chat con más de 24 h de silencio del cliente: debe aparecer el
  aviso y el selector de plantillas, sin ✓ falso.
- Buscar «sebastian» debe encontrar a «Sebastián» (tras aplicar 293).
- En un notebook de 13" o en el teléfono: botón «Detalles» en la cabecera del
  chat.
- En `ed_reingresos` (bitácora del vigilante), el motivo «el cliente respondió
  al reingreso: avisado al equipo» aparece cuando corresponde, una vez.
- `select count(*) from ed_seguimientos where variables ? 'descartado'` muestra
  lo que el motor dejó de reintentar y por qué.
