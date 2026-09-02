# Lo que te toca a ti — estado al 31-ago-2026 (noche)

> Todo lo automatizable ya está hecho, testeado (264 tests) y commiteado.
> Esta lista es SOLO lo que requiere tus manos: cuentas, tarjetas, teléfono, pruebas
> reales. Ordenada por urgencia. Al final está el resumen de qué se construyó y dónde
> leer el detalle.

---

## 🔴 Esta semana

### 1 · Supabase Pro — HOY lunes (tenías recordatorio a las 10:00)

Toda la operación vive en una base **sin respaldos**. Un borrado accidental hoy es
irrecuperable. Supabase → Settings → Billing → plan Pro. Es el pendiente más barato
de resolver comparado con lo que protege.

### 2 · Plantillas de Impresora: mirar si pasaron de PENDING a APPROVED

Ya no necesitas correr scripts: entra al portal → **/whatsapp → «Puesta en marcha»**
y mira los chips de cada plantilla. Cuando estén APPROVED:

- **La prueba que cierra todo:** desde tu otro número, deja pasar 24 h sin escribir
  y manda un seguimiento (o pídele a Beto que programe uno). Si la plantilla LLEGA,
  queda confirmado que el método de pago del WABA quedó bien — era el último
  bloqueante real.
- Con eso, **Cecilia recupera** el poder retomar conversaciones viejas (hoy no puede
  de ninguna forma: perdió la ventana al migrar y sin plantillas no hay alternativa).

### 3 · Probar el cobro en conversación (5 minutos)

El enlace de pago ya lo pegaste. Falta el circuito completo:

1. Abre una conversación tuya de prueba → botón **💲 Cobrar** → $1.000, «prueba».
2. Debe llegarte el WhatsApp con el enlace y una referencia P-XXXXXX.
3. Panel derecho → «Marcar pagado» → la etiqueta cambia.
4. Mira **Inicio** (tarjeta de cobros del mes) y el menú **Vender → Cobros**.

### 4 · Probar el aviso de pedido (2 minutos)

En un chat de Impresora, tarjeta **«Pedido listo»** → escribe «500 tarjetas» →
avisar. Con la ventana abierta sale como texto gratis en ≤5 min (dentro de horario
hábil). Tócalo dos veces para comprobar que NO duplica (debe decir que ya hay uno).

### 5 · Instagram aprobado: verificar la cuenta conectada

Meta aprobó la app (ya lo guardé en memoria). Un solo chequeo: en el portal, canal
Instagram de Impresora, confirma que la cuenta siga siendo
**@impresoracolorchillan** — si el revisor conectó la suya durante la revisión, la
reemplazó y hay que reconectar la de la imprenta (botón de conectar, 1 minuto).

---

## 🟡 Cuando confirmes que Cloud API está estable (unos días)

- **Apagar el servidor WAHA.** Ya no queda nadie usándolo. Es plata y superficie de
  ataque gratis. No borres el servidor, solo apágalo, por si hay que mirar algo.
- **Instalar la PWA en tu iPhone** (la saltamos): Safari → portal → Compartir →
  «Agregar a pantalla de inicio». Sin eso, los avisos de derivación no llegan al
  teléfono.

## 🟢 Con José / sin apuro

- **Formulario de onboarding:** agregar dos pasos que hoy no están escritos en
  ninguna parte y ya nos mordieron: (a) el cliente crea SU portafolio de Meta,
  (b) asocia una tarjeta al WABA. Sin (b) las plantillas no salen aunque estén
  aprobadas.
- **web-respondo:** hay ~30 archivos sin desplegar. No tiene remoto git: se sube con
  `npm run build` + `vercel --prod` desde esa carpeta.
- **Vercel Pro:** obligatorio cuando firme el primer cliente pagado (Hobby prohíbe
  uso comercial).
- **Ley 21.719 (rige 1-dic):** razón social + términos + política de privacidad
  publicados en la web.

---

## Qué se construyó estas sesiones (resumen + dónde está el detalle)

**Ola 1 completa — cobros y pedidos** (`docs/COBROS_Y_PEDIDOS.md`):

- **Cobrar dentro de la conversación** — la función de Vita. Enlace de pago del
  negocio + referencia + estados. Botón en el chat, panel lateral, tarjeta en
  Inicio, página global **/cobros** (menú Vender). No somos pasarela: cero
  regulación.
- **Avisos de pedido por dos caminos:** tarjeta «Pedido listo» en el chat (sin
  sistema externo) y webhook genérico `/api/integraciones/pedidos` para que el
  sistema de cualquier cliente avise solo.
- **«Puesta en marcha» en /whatsapp:** checklist de onboarding calculado contra el
  estado real, con las plantillas consultadas en vivo contra Meta.

**Dos auditorías adversariales** (`docs/AUDITORIA_OLA1_AGO2026.md`) — 4 bugs graves
cazados ANTES de producción, entre ellos:

- La protección «si el cliente habló último, Beto no insiste» estaba rota de raíz
  (leía un hilo vacío) — arreglada con doble barrera.
- Avisos de pedido duplicados en reintentos de webhook — idempotencia en ambos
  caminos.
- El caché del navegador sobrevivía al deploy con datos de forma vieja y habría
  roto la pantalla de conversaciones justo después de desplegar — clave versionada.

Todo commiteado. Estado final: **264 tests · typecheck · lint, en verde.**
