# Plan de migración: WAHA → WhatsApp Cloud API oficial (Impresora Color)

**Fecha:** 18 de agosto de 2026
**Número a migrar:** +56 9 9844 1157 (`56998441157@c.us`, sesión WAHA `default`, instancia `impresora-color`)
**Estado actual:** `ed_clientes.transporte = "waha"`, `waba_phone_id = null`, `waba_token = null`

---

## 1. Resumen ejecutivo

La buena noticia: **la mitad del trabajo ya está hecha.** El portal ya tiene el
transporte Cloud API construido y funcionando en código (`lib/inboundMeta.ts`,
`lib/whatsapp.ts`, `app/api/whatsapp/webhook/route.ts`), con verificación de
firma HMAC, idempotencia, tracking de entregas y detección de toma de control
humana vía `message_echoes`. Además existe ya un interruptor por cliente
(`ed_clientes.transporte`) que decide el transporte de salida del inbox.

La mala noticia: **el camino de Meta está entre 6 y 12 meses más atrasado que el
de WAHA en calidad de conversación.** Los arreglos que se hicieron durante las
auditorías de agosto — debounce adaptativo, guardia anti-mensaje-fantasma,
simulación de "escribiendo…", visor de adjuntos — se aplicaron sobre el camino
de WAHA y **no existen** en el de Meta. Migrar hoy tal cual sería cambiar un
transporte maduro por uno que reintroduce bugs que ya costó encontrar y
arreglar.

**Recomendación:** migrar en 4 fases, con la Fase 1 (emparejar el camino de
Meta con el de WAHA) hecha **antes** de tocar nada en producción. La migración
en sí es de bajo riesgo si se usa **Coexistencia**, que permite tener el mismo
número en la app y en la API a la vez y volver atrás sin drama.

**Costo esperado: prácticamente cero.** Meta cobra por mensaje desde mediados
de 2025, pero los mensajes de *servicio* (respuestas dentro de las 24 h a un
cliente que escribió primero) **son gratis**. Tino solo responde a clientes que
escriben primero: ese es exactamente el caso gratuito.

---

## 2. Por qué migrar (y por qué no correr)

> ⚠️ **PÉRDIDA DE CAPACIDAD QUE NO ESTABA ANOTADA ACÁ (agregado 24-ago-2026).**
>
> En **WAHA no existe la ventana de 24 h**: es una sesión real de la app, así que
> el negocio le puede escribir a quien quiera cuando quiera, como desde el
> teléfono. En **Cloud API sí existe**, y aplica al asistente Y a la persona por
> igual: pasadas 24 h desde el último mensaje del cliente, solo salen plantillas
> aprobadas.
>
> Para Impresora Color eso significa que Cecilia **deja de poder retomar a mano
> una conversación vieja** escribiendo nomás. Es un cambio en cómo trabaja, no un
> detalle técnico, y hay que decírselo ANTES de migrar — no descubrirlo el lunes
> siguiente.
>
> Mitigación: el portal ya ofrece mandar una plantilla aprobada desde la bandeja
> cuando la conversación está fuera de plazo. No es lo mismo que escribir libre,
> pero es una salida y cuesta ≈$18 por mensaje (utilidad).

### A favor
- **Estabilidad.** WAHA es no oficial: depende de mantener una sesión vinculada
  por QR. Si WhatsApp cambia algo, o el teléfono se desvincula, Tino se cae. Con
  Cloud API el vínculo es una credencial, no una sesión de navegador.
- **Riesgo de bloqueo.** Un número en un transporte no oficial siempre corre
  riesgo de ser marcado. Con la API oficial ese riesgo desaparece.
- **Infraestructura propia.** Hoy el envío depende de un servidor WAHA propio
  (`WAHA_API_URL`). Con Cloud API lo hospeda Meta.
- **Multi-cliente.** La *entrada* ya resuelve el cliente por la columna
  `ed_clientes.waha_instancia` (migración 275), pero la *salida* sigue atada a
  `WAHA_SESSION` / `WAHA_INSTANCIA`, que son variables de entorno **globales**
  (`lib/waha.ts:30-31`): en la práctica solo se puede enviar desde un negocio.
  Cloud API resuelve el cliente por `phone_number_id` desde la base en ambos
  sentidos — multi-tenant de verdad. Esto ya estaba anotado como decisión
  pendiente en la auditoría de agosto.

### En contra de apurarse
- El camino de Meta **no tiene** los arreglos de calidad de conversación (ver §3).
- Migrar toca el canal de ventas real de un negocio en operación.
- Requiere verificación de negocio en Meta, que puede tardar días.

---

## 3. Brechas de código detectadas (auditadas hoy, 18-ago-2026)

Estas son las diferencias reales entre `lib/inboundWaha.ts` y `lib/inboundMeta.ts`
que harían que Tino **empeore** si se migra sin arreglarlas primero.

| # | Brecha | Dónde | Impacto si se migra hoy | Severidad |
|---|--------|-------|--------------------------|-----------|
| **G1** | Debounce **fijo de 6 s** en vez del adaptativo `ventanaDeEspera()` (6 s / 20 s) | `lib/inboundMeta.ts:189` | Vuelve el bug de mensajes fragmentados: Tino pregunta lo mismo 2-4 veces seguidas. Es exactamente el bug encontrado en producción el 1-ago | **Alta** |
| **G2** | `enviarTexto()` de Meta no acepta la guardia `vigente` | `lib/whatsapp.ts:96` | La corrección anti-"mensaje fantasma" del 3-ago **no se activa**: `responderBot` la busca por el error `obsoleto:llego_mensaje_nuevo`, que Meta nunca devuelve. Vuelven respuestas fantasma al historial | **Alta** |
| **G3** | Sin simulación de "escribiendo…" ni retardo humano | `lib/whatsapp.ts:96` | Tino responde instantáneo → se nota que es un bot. Choca de frente con el requisito de que nadie sepa que habla con un bot | **Alta** |
| **G4** | Los adjuntos no se guardan con metadatos de media | `lib/inboundMeta.ts` (nunca pasa `media` a `guardarMensaje`) | El visor de adjuntos del inbox queda vacío: Cecilia no puede ver las imágenes que manda el cliente. Los arreglos B5/N2 son solo de WAHA | **Media** |
| **G5** | `/api/whatsapp/media` resuelve solo vía WAHA (`mediaDeMensajeWaha`) | `app/api/whatsapp/media/route.ts` | Los adjuntos recibidos por Meta no se pueden descargar (Meta usa `GET /<media-id>` + URL firmada temporal, flujo distinto) | **Media** |
| **G6** | Sin freno de ritmo (≥8 envíos/min) | `lib/inboundMeta.ts` | Menor: la API oficial no penaliza como WAHA, pero conviene mantener el comportamiento humano | **Baja** |

> **Verificado contra el código actual.** Estas seis brechas se re-comprobaron
> el 18-ago-2026 contra el HEAD del repositorio (`a85faa5`, ya con "Hardening
> seguridad" y "Auditoría de escala" aplicados): **las seis siguen abiertas**.
> No están cubiertas por el trabajo de endurecimiento reciente.

> **Nota importante:** G1, G2 y G3 son los tres arreglos que más costó encontrar
> en las auditorías de agosto (uno requirió un servidor WAHA falso para
> reproducir la carrera). Migrar sin portarlos sería perder ese trabajo.

---

## 4. Decisión clave: Coexistencia vs. migración completa

| | **Coexistencia** (recomendada) | Migración completa |
|---|---|---|
| App de WhatsApp Business en el teléfono | **Sigue funcionando** | Deja de funcionar |
| Cecilia puede seguir respondiendo desde su teléfono | **Sí** | No, solo desde el portal |
| Historial de chats anterior | Se queda en la app (no se sincroniza a la API, pero **no se pierde**) | Se pierde en la API |
| Contactos guardados | Se sincronizan | No |
| Vuelta atrás | Sencilla | Compleja |
| Throughput | ~5-20 mensajes/s (de sobra) | Cientos/s |

**Recomendación: Coexistencia.** El caso de uso de Impresora Color —Cecilia
tomando el control desde su propio teléfono cuando hace falta— *depende* de que
la app siga funcionando. Una migración completa la obligaría a atender solo
desde el portal, lo que es un cambio de hábito grande y un riesgo innecesario.

Coexistencia además ya está contemplada en el código: `lib/inboundMeta.ts` maneja
`message_echoes`, que es justamente el evento que Meta emite cuando **una persona
escribe desde la app** — el equivalente al `fromMe` de WAHA para detectar la toma
de control humana.

### Requisitos de Coexistencia a verificar antes de empezar
- App WhatsApp Business **2.24.17 o superior** en el teléfono de Cecilia.
- El número debe llevar **al menos 7 días** de uso activo en la app (cumple de sobra).
- El número **no puede estar activo en otra configuración de Cloud API**.
- Portafolio de Meta Business + acceso de administrador de Facebook.
- **Disponibilidad en Chile:** según fuentes de terceros, Coexistencia pasó a
  disponibilidad global durante 2026, pero **Chile no aparece nombrado
  explícitamente** en las listas publicadas. *Esto hay que confirmarlo en la
  interfaz de Meta antes de planificar fechas* — es el único punto que puede
  bloquear todo el plan.
- Si la app no se abre en el teléfono por **más de 14 días**, la Coexistencia
  puede desconectarse. Vale la pena avisarle esto a Cecilia.

---

## 5. Plan por fases

### Fase 0 — Verificación previa (bloqueante, ~1 día)
1. Confirmar en Meta Business Manager que **Coexistencia está disponible para Chile (+56)**.
2. Confirmar versión de la app WhatsApp Business en el teléfono de Cecilia.
3. Confirmar que el número no está enganchado a ninguna otra plataforma de API.
4. Tener el negocio verificado en Meta (o iniciar la verificación: puede tardar días).

> Si Coexistencia no está disponible para Chile, **detener el plan** y reevaluar:
> la alternativa sería migración completa, que cambia el flujo de trabajo de
> Cecilia y merece una decisión comercial explícita, no técnica.

### Fase 1 — Emparejar el camino de Meta con el de WAHA (~1-2 días de desarrollo)
Todo esto se hace **sin tocar producción**: son cambios de código que no se
activan hasta que el cliente cambie de transporte.

1. **G1** — Usar `ventanaDeEspera()` en `inboundMeta.ts` en vez del 6 s fijo.
   Extraer la función a un módulo común para que no se dupliquen.
2. **G2 + G3** — Agregar a `enviarTexto()` de `lib/whatsapp.ts`:
   - parámetro `vigente?: () => Promise<boolean>` con el mismo contrato y el
     mismo string de error `obsoleto:llego_mensaje_nuevo` que usa WAHA (así el
     arreglo anti-fantasma de `responderBot.ts` funciona sin tocarlo);
   - indicador de "escribiendo…" oficial de Meta + el mismo `delayHumano(texto)`
     que usa `enviarTextoWaha`.

   El indicador de tipeo de Meta se manda al mismo endpoint `POST /<PHONE_NUMBER_ID>/messages`,
   combinado con el marcado de leído. Dura **hasta 25 segundos o hasta que se
   envía el mensaje** — más que suficiente para el retardo humano actual:
   ```json
   {
     "messaging_product": "whatsapp",
     "status": "read",
     "message_id": "<WAMID_DEL_MENSAJE_DEL_CLIENTE>",
     "typing_indicator": { "type": "text" }
   }
   ```
   *(Confirmar el formato exacto contra la documentación de Meta al implementar:
   circulan dos variantes y la documentación oficial está tras login.)*
   Bonus: marcar como leído hace que al cliente le aparezca el doble check azul,
   que es otra señal de "hay alguien ahí".
3. **G4** — Pasar los metadatos de media a `guardarMensaje()` en `inboundMeta.ts`,
   igual que hace `inboundWaha.ts`.
4. **G5** — Extender `/api/whatsapp/media` para resolver también por Meta
   (`GET /<media-id>` → URL firmada → descarga con el token), manteniendo el
   re-anclado anti-SSRF que ya existe.
5. **G6** — Portar el freno de ritmo.
6. **Pruebas**: portar `_test_fantasma_obsoleto.ts` y `_test_carrera_humano.ts`
   al camino de Meta con un servidor Graph falso, y correr toda la batería.

**Criterio de salida de la Fase 1:** los mismos tests que hoy protegen el camino
de WAHA pasan también contra el camino de Meta.

### Fase 2 — Alta en Meta y pruebas en paralelo (~1 día + espera de verificación)
1. Crear/usar la app de Meta, agregar el producto WhatsApp.
2. Onboarding de Coexistencia con el número de Impresora Color.
3. Guardar en `ed_clientes` (Impresora Color): `waba_phone_id`, `waba_token`,
   `waba_id`, `waba_coexistencia = true`. **Dejar `transporte = "waha"`.**
4. Configurar el webhook de Meta apuntando a
   `https://respondo-portal.vercel.app/api/whatsapp/webhook` con `WHATSAPP_VERIFY_TOKEN`
   y `WHATSAPP_APP_SECRET` en Vercel (la verificación de firma HMAC ya está implementada).
5. Suscribirse a los campos `messages` **y `message_echoes`** (este último es
   imprescindible para detectar cuando Cecilia responde desde su teléfono).

En este punto **los dos transportes reciben eventos**. Como `transporte` sigue en
`"waha"`, WAHA sigue mandando las respuestas y el camino de Meta solo observa:
es el momento de comparar en la base que ambos ven los mismos mensajes.

> ⚠️ **Riesgo de doble respuesta.** Con ambos webhooks activos, los dos caminos
> podrían intentar responder. Antes de la Fase 2 hay que agregar una guardia en
> `manejarEntranteMeta` que **solo responda si `ed_clientes.transporte === "cloud"`**
> (observar y guardar sí, responder no). Sin esa guardia el cliente recibiría
> cada respuesta dos veces. **Este es el punto más peligroso de todo el plan.**

### Fase 3 — Corte (minutos, reversible)
1. Elegir una ventana de baja actividad (ideal: después del cierre, o domingo).
2. `UPDATE ed_clientes SET transporte = 'cloud' WHERE id = '3333...'`.
3. Probar desde un teléfono propio: saludo, cotización con precio fijo, envío de
   una imagen, y toma de control desde el teléfono de Cecilia.
4. Vigilar `/api/salud` y la bandeja durante las primeras horas.

**Vuelta atrás:** volver `transporte` a `'waha'`. Un solo UPDATE. WAHA nunca se
desconectó, así que la vuelta es inmediata.

### Fase 4 — Consolidación (1-2 semanas después)
1. Verificar que no hay mensajes perdidos ni duplicados comparando volúmenes.
2. Recién ahí, desconectar WAHA y dar de baja el servidor.
3. Quitar del código las variables globales `WAHA_SESSION` / `WAHA_INSTANCIA`
   (o dejarlas solo para clientes que sigan en WAHA).

---

## 6. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Doble respuesta con ambos webhooks activos | **Alta si no se mitiga** | Muy alto (cliente ve todo dos veces) | Guardia por `transporte` en `manejarEntranteMeta` **antes** de la Fase 2 |
| Coexistencia no disponible en Chile | Media | Bloqueante | Verificar en Fase 0 antes de comprometer fechas |
| Tino "se nota" más robótico tras migrar | Alta si se salta la Fase 1 | Alto (choca con el requisito central del negocio) | Fase 1 completa antes del corte |
| Verificación de negocio en Meta se demora | Media | Retrasa el plan | Iniciarla en Fase 0, en paralelo |
| Coexistencia se desconecta por 14 días sin abrir la app | Baja | Alto | Avisar a Cecilia; monitorear con `/api/salud` |
| Se pierde el historial de chats | Baja (con Coexistencia) | Medio | Coexistencia lo conserva en la app |

---

## 7. Costo

Con el modelo por mensaje vigente desde mediados de 2025:

- **Mensajes de servicio** (respuesta dentro de 24 h a un cliente que escribió
  primero): **gratis**. Es el 100% del uso actual de Tino.
- **Marketing / Utilidad / Autenticación**: se cobran por mensaje y por país del
  destinatario. **No aplican hoy**, pero sí aplicarían si en el futuro se activa
  el rol de seguimiento (Beto/rita), que envía mensajes proactivos con plantilla.

**Conclusión:** para el uso actual, migrar no debería generar costo de mensajería.
Sí hay que tenerlo en cuenta antes de activar seguimientos proactivos.

---

## 8. Esfuerzo estimado

| Fase | Trabajo | Tiempo |
|---|---|---|
| 0 | Verificaciones y trámites en Meta | 1 día + espera |
| 1 | Desarrollo (G1-G6) + tests | 1-2 días |
| 2 | Alta, webhook, guardia anti-doble-respuesta, observación | 1 día |
| 3 | Corte y vigilancia | 1 hora + monitoreo |
| 4 | Consolidación y limpieza | 1 día, semanas después |

---

## 9. Decisiones que necesito de Marcelo

1. **¿Coexistencia o migración completa?** (recomendación: Coexistencia — Cecilia
   conserva su teléfono como herramienta de trabajo).
2. **¿Cuándo?** No conviene hacerlo en la misma semana que un cambio de precios
   recién aplicado. Sugerencia: dejar pasar unos días de operación normal.
3. **¿Se activarán seguimientos proactivos (Beto) después de migrar?** Cambia el
   análisis de costos: dejaría de ser gratis.

