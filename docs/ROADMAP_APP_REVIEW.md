# Roadmap — Listos para enviar el App Review de Meta (Tech Provider)

App: **Respon.do** · App ID `1754035789373592` · WABA prueba `2272215056649338` · Número prueba +1 555 166-3440 (Phone ID `1292907717228921`)
Permisos que se piden: **whatsapp_business_messaging** + **whatsapp_business_management**
Leyenda de responsable: 👤 = Marcelo (manual) · 🤖 = Claude (técnico) · ⏳ = espera de Meta

⚠️ **Reloj de 30 días:** las llamadas API de ambos permisos se registraron el **24-jul-2026**. Meta exige que el envío ocurra dentro de los 30 días de esas llamadas → **enviar antes de ~23-ago-2026** (si no, hay que repetir las llamadas).

---

## FASE 0 — Ya está listo ✅
- [x] Verificación de empresa (Impresora Color Limitada)
- [x] App creada (Respon.do), caso de uso WhatsApp
- [x] Ajustes básicos: ícono 1024, URLs de privacidad/términos/eliminación, categoría
- [x] Páginas legales online + política reforzada con "Datos de la Plataforma de Meta"
- [x] Webhook del portal configurado y suscrito a la WABA (campo `messages`)
- [x] Token permanente (System User)
- [x] Llamadas API registradas para los 2 permisos (24-jul)
- [x] Webhook oficial endurecido (idempotencia/ACKs/ecos Coexistencia/debounce) — desplegado
- [x] Auditoría de la plataforma + fixes desplegados (overflow, gramática, /estado, mensajes, límites de error)
- [x] Data de prueba sucia limpiada

---

## FASE 1 — Preparación técnica del demo (antes de grabar)

- [ ] 🤖 **Sembrar 2-3 conversaciones demo limpias y realistas** (imprenta: tarjetas, flyers, pendón) para que el video se vea profesional. — *Claude, ~10 min*
- [ ] 🤖 **Configurar un cliente/número en modo `transporte='cloud'`** apuntando al número de prueba +1 555, para que el video muestre la **API oficial** enviando (no WAHA). — *Claude, ~10 min*
- [ ] 👤 **Preparar acceso para el revisor de Meta.** Dos opciones: (a) agregar el correo del revisor a `portal_usuarios` para que entre por magic link, o (b) darle un login de prueba. Se describe en el paso "App Verification" del formulario. — *definir con Claude*
- [ ] 👤🤖 *(Opcional, refuerza el permiso management)* Crear la **config de Embedded Signup** (config_id) + dominios, para poder mostrar el onboarding de un cliente en el video 2. No es obligatorio para enviar. — *ver ROADMAP de Coexistencia*

## FASE 2 — Grabar los 2 videos (screencasts)

Requisitos técnicos de Meta (si se saltan, rechazan): **1080p o más, cursor visible, sin cortes en los momentos clave, UI en inglés O subtítulos/anotaciones en inglés, sin audio.** Antes de grabar, abrir en Meta "Mostrar instrucciones" de cada permiso y seguirlas al pie.

- [ ] 👤 **Video 1 — whatsapp_business_messaging** (~2 min): login completo (desde deslogueado) → Conversaciones → enviar un mensaje a un número → mostrar en WhatsApp Web que llega → (Tino responde automático). — *Marcelo graba, guion en TECH_PROVIDER_RUNBOOK.md*
- [ ] 👤 **Video 2 — whatsapp_business_management** (~2 min): llamada a la Graph API (GET phone_numbers/templates, se ve el JSON) + crear una plantilla de mensaje mostrando el proceso hasta "En revisión". — *Marcelo graba, Claude deja los comandos*
- [ ] 🤖 Claude prepara los comandos curl y el paso a paso exacto de cada video.

## FASE 3 — Completar el formulario de App Review

- [ ] 👤 **Descripciones de uso** (una por permiso, específicas, sin copiar-pegar): qué resuelve, por qué se necesita, cómo se usan los datos. — *Claude redacta el borrador, Marcelo pega*
- [ ] 👤 **App Verification / acceso para pruebas**: marcar que sí se puede iniciar sesión y describir cómo accede el revisor (login de prueba). — *Claude arma el texto*
- [ ] 👤 **Gestión de datos** (cuestionario): dónde se guardan, cifrado, con quién se comparten, no publicidad, eliminación a pedido. — *respuestas sugeridas en TECH_PROVIDER_RUNBOOK.md*
- [ ] 👤 **Uso permitido**: certificar que la app se limita a los usos permitidos de cada permiso.
- [ ] 👤 Revisar `public_profile` en la solicitud: pedir **solo lo necesario**. Si el demo no usa Facebook Login, quitarlo (pedir permisos de más es motivo de rechazo).
- [ ] 👤 Confirmar por última vez ícono / URL de privacidad / categoría.

## FASE 4 — Enviar

- [ ] 👤 **Request advanced access** de los 2 permisos (los botones se habilitan 1-2 días después de las llamadas API del 24-jul).
- [ ] 👤 Adjuntar los 2 videos a sus permisos correspondientes.
- [ ] 👤 **Enviar a revisión** + aceptar los Platform Onboarding Terms.
- [ ] ⏳ Esperar decisión (~2-7 días; si rechazan, +3-5 días por intento — por eso lo dejamos sólido antes).

## FASE 5 — Después de enviar (en paralelo, sin bloquear)

- [ ] 👤 **NO pasar la app a "Live"** hasta que aprueben (si se publica antes, se rompe hasta para ti).
- [ ] 👤🤖 Seguir puliendo el bot en **WAHA con el número de test** (sin tocar el de Cecilia).
- [ ] ⏳ Aprobación → conectar el **número real de Cecilia por Coexistencia** (producción).
- [ ] 🤖 Regenerar el token permanente por higiene (quedó en el chat).

---

## Qué falta, en una línea
**Sembrar demo limpio + modo cloud (Claude) → grabar 2 videos (Marcelo) → rellenar formulario (Claude redacta, Marcelo pega) → enviar.** Todo lo pesado (verificación, webhook, legal, permisos, código) ya está hecho.

## Fuera de alcance de ESTE envío (fases futuras, NO ahora)
- **Instagram DM**: producto y permisos aparte (`instagram_business_manage_messages`), App Review propio. Se hace DESPUÉS de aprobar WhatsApp, como fase 2. La plataforma ya está lista para sumarlo (otro transporte, mismo cerebro).
- **Email/Gmail**: primero por reenvío/webhook (barato), Gmail API restringida solo si un cliente lo paga (CASA anual).
- **Multi-cliente self-serve** (Embedded Signup para clientes externos): requiere este App Review aprobado primero.
