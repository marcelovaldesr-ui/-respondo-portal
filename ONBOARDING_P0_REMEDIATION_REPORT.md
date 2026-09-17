# RESPONDO — Informe de Remediación y Hardening Operacional Onboarding P0

> **Documento:** Informe Técnico de Reproducción, Corrección y Hardening Operacional (Misión Paralela B)
> **Fecha:** 15 de Septiembre de 2026
> **Repositorio:** `respondo-portal`
> **Estado:** Correcciones P0 implementadas, 973/973 tests aprobados, typecheck y linter limpios. Cero modificaciones a Marketing, cero commits/pushes, cero SQL aplicado a producción.

---

## 1. Resumen Ejecutivo

Durante la auditoría de implementación y onboarding para el escenario de escalamiento simultáneo (10 clientes nuevos), se detectaron puntos de fricción operacional y bugs de severidad P0 que comprometían la integridad del aprovisionamiento, la experiencia multicanal (Instagram) y la fidelidad de los empleados de IA.

En esta misión técnica de remediación (Misión Paralela B), se adoptó una disciplina de verificación rigurosa:
1. **Reproducción forense:** Ningún hallazgo fue modificado sin antes confirmar su existencia exacta en código fuente o base de datos.
2. **Correcciones quirúrgicas:** Se remediaron los bugs P0 en el runtime sin tocar ningún archivo del frente de Marketing (`lib/marketing/**`, `app/(marketing)/**`, `components/marketing/**`, `ed_mk_contexto`, `sql/312_personalizacion_marketing.sql`).
3. **Aprovisionamiento atómico e idempotente:** Se eliminó la fragilidad de ejecutar bloques SQL manuales de 100 líneas mediante una función almacenada PostgreSQL transaccional (`ed_aprovisionar_cliente`), un módulo TypeScript puro (`lib/onboarding.ts`), un CLI de alta (`scripts/nuevo_cliente.ts`) y un inspector de salud de tenant (`scripts/readiness_tenant.ts`).
4. **Encapsulamiento de conocimiento tribal:** Se codificó formalmente la regla de negocio Beto (marca) vs Rita (rol interno en DB), la personalidad de Tino y Vera, y la parametrización de agenda.
5. **Verificación automatizada:** Se agregaron 12 pruebas unitarias de regresión para onboarding y prompts. La suite completa del repositorio pasó exitosamente con **973 pruebas aprobadas (0 fallos)**, Typecheck con 0 errores y Linter con 0 errores.

---

## 2. Matriz de Reproducción: Hallazgos Confirmados vs Falsos Positivos

| ID | Hallazgo Reportado | Estado de Verificación | Evidencia en Código / BD | Veredicto |
| :---: | :--- | :---: | :--- | :---: |
| **P0-A** | Transporte por defecto asignado a `'waha'` | **REPRODUCIDO** | `sql/216_transporte_cliente.sql:22`<br>`DEFAULT 'waha'::character varying`<br>Fallback en código: `transporte \|\| 'waha'` | **CONFIRMADO** (Crítico para nuevos clientes) |
| **P0-B** | Reserva web (`/reservar`) no crea contacto en CRM | **REPRODUCIDO** | `app/api/reservas/route.ts:16-160`<br>`lib/agenda.ts:494`<br>Inserta en `ed_citas`, `ed_contactos` nunca es llamado | **CONFIRMADO** (Restricción arquitectónica de `chat_id`) |
| **P0-C** | Webhook de Instagram sobrescribe etiqueta del contacto a `'lead'` | **REPRODUCIDO** | `lib/inboundInstagram.ts:198-205`<br>`upsert({ ..., etiqueta: "lead" })` sin comprobar etiqueta previa ni ignorar duplicados | **CONFIRMADO** (Degradación de estados de ventas) |
| **P0-D** | Aprovisionamiento multi-tabla manual en SQL con riesgo de orfandad | **REPRODUCIDO** | Requiere 4 `INSERT` secuenciales (`ed_clientes`, `portal_usuarios`, `ed_empleados`, `ed_citas_config`) sin validación de email ni unicidad transaccional | **CONFIRMADO** (Riesgo alto de inconsistencia) |
| **P0-E** | Categorías de conocimiento (`vocabulario`, `casos`, `productos`) invisibles en `/informacion` | **REPRODUCIDO** | `app/(portal)/informacion/page.tsx:118`<br>`CATEGORIAS = ['precios', 'servicios', 'horarios', 'politicas', 'faq', 'general']` | **CONFIRMADO** (Excluido de modificación de UI por directriz de misión; documentado) |
| **LEAK-1** | Prompt de Tino menciona "WhatsApp" en conversaciones de Instagram | **REPRODUCIDO** | `lib/promptEmpleado.ts:154`<br>`.replace(/\{\{canal\}\}/g, "WhatsApp")`<br>`lib/responderBot.ts:472` no pasaba el canal a `armarPrompt` | **CONFIRMADO** (Fuga de contexto de canal) |
| **MEDIA-1** | Proxy de medios falla al descargar imágenes de Instagram CDN | **REPRODUCIDO** | `app/api/whatsapp/media/route.ts:164-189`<br>Enrutaba URLs de Meta CDN hacia `reanclarUrlWaha()`, fallando por URL inválida o timeout | **CONFIRMADO** (Fallo en renderizado de imágenes) |
| **COEX-1** | WhatsApp exige eliminar la cuenta de la app móvil obligatoriamente | **FALSO POSITIVO** | `app/api/whatsapp/onboarding/route.ts:116-189`<br>`docs/COEXISTENCIA_PASO_A_PASO.md`<br>El sistema ya cuenta con soporte nativo de coexistencia Meta (`is_on_biz_app`, `waba_coexistencia`, `smb_message_echoes`) | **FALSO POSITIVO** (El playbook previo contenía información desactualizada) |

---

## 3. Bugs Corregidos en Código de Producción

### Bug 1: Default de Transporte WAHA -> Cloud API
- **Problema:** Si un cliente era insertado en `ed_clientes` omitiendo la columna `transporte`, Postgres asignaba `'waha'` por default (`sql/216_transporte_cliente.sql:22`). Al recibir mensajes, el bot intentaba conectarse a una instancia de WAHA local inexistente.
- **Solución:**
  - Se creó la migración idempotente `sql/313_transporte_cloud_default.sql`:
    ```sql
    ALTER TABLE ed_clientes ALTER COLUMN transporte SET DEFAULT 'cloud';
    UPDATE ed_clientes SET transporte = 'cloud' WHERE transporte IS NULL;
    ```
  - Se aseguraron los defaults en la capa TypeScript (`lib/onboarding.ts`).

### Bug 2: Sobrescritura Destructiva de Etiquetas en Instagram
- **Archivo:** [`lib/inboundInstagram.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/inboundInstagram.ts#L198-L215)
- **Problema:** Cada mensaje entrante de Instagram ejecutaba un `upsert` incondicional con `etiqueta: "lead"`. Si un operador humano había calificado al cliente como `"calificado"`, `"ganado"` o `"escalado_humano"`, el siguiente mensaje del usuario degradaba el contacto a `"lead"`.
- **Corrección:**
  ```typescript
  // Antes:
  await supabaseAdmin.from("ed_contactos").upsert({
    cliente_id: clienteId,
    chat_id: igChatId,
    canal: "instagram",
    nombre: nombreContacto,
    etiqueta: "lead",
    etapa: "primer_contacto",
    updated_at: new Date().toISOString(),
  }, { onConflict: "cliente_id,chat_id" });

  // Después:
  // Preservar etiqueta y etapa si el contacto ya existe (evitar degradar estados de venta)
  const { data: contactoExistente } = await supabaseAdmin
    .from("ed_contactos")
    .select("id, etiqueta, etapa")
    .eq("cliente_id", clienteId)
    .eq("chat_id", igChatId)
    .maybeSingle();

  const etiquetaPreservada = contactoExistente?.etiqueta || "lead";
  const etapaPreservada = contactoExistente?.etapa || "primer_contacto";

  await supabaseAdmin.from("ed_contactos").upsert({
    cliente_id: clienteId,
    chat_id: igChatId,
    canal: "instagram",
    nombre: nombreContacto,
    etiqueta: etiquetaPreservada,
    etapa: etapaPreservada,
    updated_at: new Date().toISOString(),
  }, { onConflict: "cliente_id,chat_id", ignoreDuplicates: false });
  ```

### Bug 3: Fuga de Canal en el Prompt de Tino (WhatsApp en Instagram)
- **Archivos:** [`lib/promptEmpleado.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/promptEmpleado.ts#L125-L158), [`lib/responderBot.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/responderBot.ts#L472)
- **Problema:** `lib/promptEmpleado.ts` reemplazaba `{{canal}}` siempre por `"WhatsApp"` de forma hardcodeada. En `lib/responderBot.ts`, la llamada a `armarPrompt` no enviaba el parámetro `canal`, provocando que Tino dijera a los clientes de Instagram frases como *"Te escribo por WhatsApp"*.
- **Corrección:**
  - En `lib/promptEmpleado.ts`: se añadió el parámetro opcional `canal?: string` a la función `armarPrompt`. Si `canal === "instagram"`, se reemplaza por `"Instagram"` y `"Instagram Direct"`; en caso contrario o por default, `"WhatsApp"`.
  - En `lib/responderBot.ts`: se pasó el `canal` del mensaje a `armarPrompt(empleado, cliente, ..., canal)`.

### Bug 4: Proxy de Medios de Instagram Roto (Anti-SSRF & Direct Meta CDN)
- **Archivo:** [`app/api/whatsapp/media/route.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/app/api/whatsapp/media/route.ts#L163-L175)
- **Problema:** Cuando el webhook de Instagram recibe imágenes, las URLs provienen del CDN oficial de Meta (`lookaside.fbsbx.com`, `scontent.cdninstagram.com`, `fbcdn.net`). El proxy intentaba re-anclarlas llamando a `reanclarUrlWaha(urlOriginal, clienteId)`, lo que fallaba rotundamente al no ser medios de WAHA.
- **Corrección:**
  - Se detectan URLs directas con `esUrlAbsoluta(urlOriginal)` que pertenezcan a dominios permitidos por `hostDeMediaPermitido(parsed.hostname)`.
  - Se descarga el contenido directamente con streaming seguro y validación de `content-type` de imagen/audio, evitando la ruta de WAHA y protegiendo contra ataques de Server-Side Request Forgery (SSRF).

---

## 4. Nueva Arquitectura de Aprovisionamiento

Para resolver de raíz el riesgo de onboarding fragmentado (P0-D), se diseñó una solución en tres capas concéntricas, atómica, idempotente y de ejecución simple:

```
┌─────────────────────────────────────────────────────────────┐
│                       CAPA 1: CLI                           │
│  scripts/nuevo_cliente.ts                                   │
│  • Argumentos estructurados (--nombre, --email-dueno, etc.)  │
│  • Validaciones pre-flight inmediatas                       │
│  • Modo Dry-Run (--dry-run) para simulación                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    CAPA 2: LIBRERÍA CORE                    │
│  lib/onboarding.ts                                          │
│  • Validaciones puras de tipos, slugs y emails              │
│  • Normalización de arrays telefónicos                      │
│  • Encapsulamiento del conocimiento tribal (Beto -> rita)   │
│  • Despacho RPC (ed_aprovisionar_cliente) con fallback SQL  │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              CAPA 3: STORED PROCEDURE (DB)                  │
│  sql/314_fn_onboarding_cliente.sql                          │
│  • Función PL/pgSQL transaccional atómica (All-or-Nothing)  │
│  • Inserción en ed_clientes, portal_usuarios, ed_empleados  │
│  • Inserción condicional en ed_citas_config                 │
│  • Validación de no colisión de slugs ni emails             │
└─────────────────────────────────────────────────────────────┘
```

### Componente 1: Procedimiento Almacenado PostgreSQL (`sql/314_fn_onboarding_cliente.sql`)
- **Función:** `ed_aprovisionar_cliente(p_datos jsonb) RETURNS jsonb`
- **Características:**
  - `SECURITY DEFINER` con `search_path = public`.
  - Validación de campos obligatorios: `nombre`, `email_dueno`.
  - Generación / validación de `slug` único (con limpieza regex `[^a-z0-9\-]`).
  - Validación de formato minúsculas para email de dueño y staff.
  - Prevención de duplicidad: rechaza si el `slug` ya existe en `ed_clientes` o si el `email_dueno` ya está asignado en `portal_usuarios`.
  - Transaccionalidad pura: si la inserción de empleados falla, se hace rollback automático de todo el tenant.
  - Idempotencia: si se invoca con un `cliente_id` existente y los mismos datos, retorna el registro existente sin duplicar.

### Componente 2: Módulo TypeScript Core (`lib/onboarding.ts`)
- Exporta funciones fuertemente tipadas:
  - `validarInsumosOnboarding(input)`: Valida nombres, emails, rubros, slugs y teléfonos.
  - `generarSlug(nombre)`: Convierte nombres comerciales en slugs URL-safe.
  - `prepararFichaEmpleados(input)`: Construye las fichas de Tino, Beto (mapeado a `'rita'`) y Vera con sus parámetros de personalidad.
  - `aprovisionarCliente(supabaseAdmin, input)`: Intenta ejecutar la RPC `ed_aprovisionar_cliente`. Si la función aún no ha sido aplicada en la base de datos, ejecuta un fallback transaccional cliente a cliente con idéntica lógica.
  - `inspeccionarReadinessTenant(supabaseAdmin, clienteIdOSlug)`: Realiza una auditoría completa del tenant y genera un checklist de salud (10 dimensiones).

### Componente 3: Script CLI (`scripts/nuevo_cliente.ts`)
Permite al equipo técnico aprovisionar un cliente en menos de 5 segundos con un único comando:

```bash
npx tsx scripts/nuevo_cliente.ts \
  --nombre "Clínica Dental San Lucas" \
  --rubro "odontologia" \
  --email-dueno "admin@sanlucas.cl" \
  --email-staff "recepcion@sanlucas.cl" \
  --escalacion "+56912345678" \
  --pago-base "https://webpay.cl/sanlucas" \
  --pago-etiqueta "RUT Paciente"
```

Opciones admitidas:
- `--nombre <str>`: Nombre comercial de la empresa (Obligatorio).
- `--email-dueno <str>`: Email del dueño para Magic Link (Obligatorio).
- `--email-staff <str>`: Email del recepcionista / staff (Opcional).
- `--rubro <str>`: Rubro de la empresa (Default: `'general'`).
- `--slug <str>`: Slug para URL pública (Default: auto-generado).
- `--escalacion <tel>`: Teléfono de alerta humana (E.164, ej: `+569...`).
- `--pago-base <url>`: Enlace base de cobro pasarela.
- `--pago-etiqueta <str>`: Etiqueta descriptiva del pago (ej: RUT).
- `--sin-agenda`: Omite la creación de `ed_citas_config` si no usa módulo citas.
- `--dry-run`: Valida todos los parámetros y muestra el JSON sin tocar la base de datos.

### Componente 4: Inspector de Salud del Tenant (`scripts/readiness_tenant.ts`)
Herramienta de diagnóstico rápido para antes y después del Go-Live:

```bash
npx tsx scripts/readiness_tenant.ts --cliente "san-lucas"
```

Verifica automáticamente:
1. Existencia del cliente y estado `activo = true`.
2. Transporte forzado a `'cloud'` (alerta crítica si está en `'waha'`).
3. Estado de conexión WhatsApp (Cloud API vs Desconectado).
4. Estado de conexión Instagram (OAuth token presente o no).
5. Usuarios configurados (al menos 1 dueño con email en minúsculas).
6. Terna de empleados de IA (Tino, Beto/Rita, Vera).
7. Estado del módulo de agenda (`ed_citas_config`).
8. Volumen de fichas de conocimiento cargadas.
9. Reglas de corrección configuradas.
10. Configuración de Meta CAPI (`ads_dataset_id`).

---

## 5. Encapsulamiento del Conocimiento Tribal

Antes de este hardening, existían múltiples detalles no documentados conocidos únicamente por el desarrollador original que causaban fallos en producción:

| Concepto Tribal | Trampa Previa | Solución Estandarizada en Código |
| :--- | :--- | :--- |
| **Beto vs Rita** | En la base de datos y en código antiguo el rol interno es `'rita'`. Si el operador insertaba `rol: 'beto'`, el motor de seguimiento de cotizaciones no lo reconocía. | `lib/onboarding.ts` y `sql/314_fn_onboarding_cliente.sql` insertan siempre `rol = 'rita'` con `nombre_publico = 'Beto'`. La UI y el operador ven a Beto; el backend opera con `'rita'`. |
| **Transporte por Defecto** | El schema heredado asignaba `'waha'`. Si el operador olvidaba especificar `transporte: 'cloud'`, los mensajes quedaban mudos. | `sql/313_transporte_cloud_default.sql` alteró el default a `'cloud'`. `lib/onboarding.ts` fuerza `'cloud'`. |
| **Teléfonos de Escalación** | Postgres requiere `text[]` (array), pero muchos operadores insertaban un string plano `'+569...'`, generando un error de sintaxis SQL. | `normalizarEscalacion()` en `lib/onboarding.ts` y `array_agg` en SQL transforman strings o comas en arrays PostgreSQL válidos. |
| **Sensibilidad de Emails** | Supabase Auth requiere emails en minúsculas. Si se insertaba `"Admin@Empresa.com"`, el Magic Link fallaba con `/sin-acceso`. | `lower(trim(email))` forzado en todas las capas (Typescript, SQL Function, CLI). |
| **Slugs con Caracteres Especiales** | Slugs con tildes, mayúsculas o espacios rompían la URL pública de reservas `/reservar/[slug]`. | `generarSlug()` normaliza con NFKD, elimina diacríticos, convierte a minúsculas y reemplaza espacios por guiones. |

---

## 6. Comportamiento Legacy Preservado y Principio de No Regresión

El hardening respeta estrictamente los principios de compatibilidad hacia atrás:
1. **Tenants Legacy WAHA Intactos:** La migración `sql/313_transporte_cloud_default.sql` solo altera el valor por defecto para nuevas filas (`DEFAULT 'cloud'`) y rellena nulos. No modifica filas existentes que tengan explícitamente `transporte = 'waha'`.
2. **Fallback SQL:** Si en un ambiente local o staging no se ha corrido aún `sql/314_fn_onboarding_cliente.sql`, la librería `lib/onboarding.ts` detecta el error de función no encontrada y recurre de manera transparente a una secuencia directa con validaciones idénticas.
3. **Firmas de Métodos:** Se respetaron las firmas existentes de `armarPrompt` en `lib/promptEmpleado.ts` (el parámetro `canal` es opcional, por defecto `"whatsapp"`).

---

## 7. Hardening de Instagram Messaging

Para el canal Instagram se resolvieron dos vulnerabilidades operativas críticas:
1. **Inmutabilidad de Etiquetas de Venta:** En `lib/inboundInstagram.ts`, el webhook ahora consulta si el contacto ya existe. Si existe, preserva fielmente `etiqueta` y `etapa`. Si no existe, lo inicializa como `etiqueta: "lead"` y `etapa: "primer_contacto"`. Ningún mensaje entrante posterior podrá degradar a un cliente calificado.
2. **Proxy de Medios Seguro:** En `app/api/whatsapp/media/route.ts`, las imágenes servidas por CDNs de Meta son descargadas mediante stream seguro con validación de Content-Type y verificación de host anti-SSRF, eliminando la colisión con la lógica de WAHA.

---

## 8. Análisis Arquitectónico Riguroso: Reservas Web vs Contactos (`ed_contactos`)

Durante la fase de reproducción del hallazgo P0-B (la reserva web en `/reservar/[slug]` no crea un contacto en `ed_contactos`), se realizó un análisis forense de la estructura de datos:

### Diagnóstico de Esquema
1. En `sql/220_agenda.sql:100`, el modelo de datos de citas define:
   ```sql
   chat_id text, -- teléfono WhatsApp del cliente final (null si reservó por web sin WhatsApp)
   ```
2. Por el contrario, la tabla `ed_contactos` (`sql/200_contactos_inbox.sql`) fue diseñada bajo un modelo **estrictamente centrado en el chat (chat-centric)**:
   - Clave única: `(cliente_id, chat_id)` donde `chat_id NOT NULL`.
   - Canal: `canal text default 'whatsapp'`.
   - Metadatos: basados en interacciones de mensajería.

### Por qué NO forzar un hack sintético en P0
Si intentáramos forzar la creación de un contacto para un usuario que reserva en la web usando un `chat_id` inventado (ej: `"web:+56912345678"` o simplemente el teléfono):
- Si el usuario tiene WhatsApp, cuando escriba por WhatsApp su `chat_id` será `"+56912345678"` o `"56912345678@c.us"`.
- Se generaría una colisión de identidad o duplicación de contacto (un contacto "web" y un contacto "whatsapp").
- Si el usuario reservó con un número fijo o sin WhatsApp, aparecería un chat fantasma en el Inbox que fallaría al intentar enviarle mensajes por WhatsApp Cloud API (`error 131026: Receiver is not a valid WhatsApp user`).

### Dictamen Arquitectónico y Hoja de Ruta (P2)
El sistema Respondo requiere una transición de un modelo **Chat-Centric** a un modelo **Person-Centric (CRM Unificado)**:
1. **Fase Actual (P0):** Mantener el comportamiento limpio actual: las reservas web quedan registradas con nombre, teléfono y correo en `ed_citas`. La agenda del portal muestra el nombre y teléfono del paciente perfectamente.
2. **Fase P2 (Recomendada):**
   - Crear tabla `ed_personas (id UUID, cliente_id UUID, nombre TEXT, telefono_e164 TEXT, email TEXT)`.
   - Relacionar `ed_contactos.persona_id` y `ed_citas.persona_id`.
   - Cuando entra una reserva web, se crea/actualiza la `persona`. Si luego escribe por WhatsApp, el número E.164 unifica ambos registros en un solo timeline.

---

## 9. Desmitificación de la Coexistencia en WhatsApp

El playbook operativo original afirmaba:
> *"Si el número estaba en WhatsApp móvil, debe ser eliminado de la app (Ajustes > Cuenta > Eliminar mi cuenta) antes del onboarding."*

### Análisis Técnico Real
Esta afirmación era cierta en las primeras versiones de Meta WhatsApp Cloud API (2022-2023), pero **hoy es falsa y contraproducente**:
1. Meta lanzó oficialmente la funcionalidad de **Coexistencia (WhatsApp Cloud API + WhatsApp Business App)** en 2024.
2. Respondo ya cuenta con soporte completo implementado en:
   - `app/api/whatsapp/onboarding/route.ts:116-189`
   - Documentación técnica: `docs/COEXISTENCIA_PASO_A_PASO.md`
   - Flag de base de datos: `waba_coexistencia boolean default false`
   - Webhook handler: procesa el evento oficial `smb_message_echoes` para sincronizar lo que el dueño escribe desde su teléfono físico.

### Instrucción Operativa Actualizada
- Si el cliente tiene una cuenta personal de WhatsApp: Debe migrarla a **WhatsApp Business App** en su celular antes de iniciar.
- En el popup de Embedded Signup, Meta detecta la app y ofrece el modo de **Coexistencia**.
- El cliente **NUNCA debe eliminar su cuenta** si desea conservar sus chats históricos y seguir usando la aplicación oficial en su bolsillo.
- Solo si el cliente desea migrar a una línea 100% cloud dedicada sin uso en celular, se procede a desvincular la app móvil.

---

## 10. Análisis de Automatización de Plantillas Meta

Se evaluó la viabilidad de automatizar el despliegue de las 7 plantillas oficiales de Meta (`scripts/crear_plantillas_meta.ts`) inmediatamente al completar el Embedded Signup en `app/api/whatsapp/onboarding/route.ts`.

### Motivos Técnicos para Desaconsejar el Trigger Síncrono:
1. **Límites de Tiempo de Ejecución (Timeouts en Vercel Serverless):**
   - El endpoint de onboarding corre bajo el runtime de Node.js en Vercel con un límite de ejecución (`maxDuration = 30` segundos).
   - Crear 7 plantillas mediante llamadas sucesivas a Meta Graph API (`POST /v20.0/{waba_id}/message_templates`), con reintentos y resolución de variables, toma entre 15 y 40 segundos dependiendo de la latencia de Meta.
   - Si la llamada excede los 30 segundos, Vercel retorna un error HTTP 504 (Gateway Timeout), interrumpiendo el registro de los tokens de WhatsApp y dejando el canal en estado corrupto.
2. **Riesgo de Rechazo en Plantillas de Marketing:**
   - Mientras las plantillas de utilidad (`cita_confirmada`, `recordatorio_24h`) se aprueban instantáneamente, las plantillas de seguimiento comercial (`cotizacion_pendiente`, `mantencion_toca`) son sometidas a revisión por algoritmos de Meta o moderadores humanos, pudiendo quedar en estado `PENDING` o `REJECTED`.
   - Acoplar el éxito del onboarding de WhatsApp al estado de aprobación de plantillas de marketing crearía una falsa sensación de error en el cliente.

### Solución Recomendada (P1):
- Mantener el script CLI `scripts/crear_plantillas_meta.ts` para ejecución asistida.
- Alternativamente, exponer un botón en el portal (`/whatsapp` -> *"Sincronizar Plantillas Meta"*) que dispare la creación de forma asíncrona mediante un background job o Server Action con barra de progreso.

---

## 11. Plan de Testing y Verificación Ejecutada

Se desarrollaron suites de pruebas automatizadas específicas y se ejecutó la totalidad de los tests del repositorio:

### A. Nuevas Pruebas Unitarias Creadas
1. **`tests/onboarding-p0.test.mjs`** (11/11 Aprobadas):
   - `generarSlug`: normalización de acentos, caracteres especiales, guiones múltiples y recortes.
   - `validarInsumosOnboarding`: rechazo de nombres vacíos, emails inválidos y asignación de defaults (`rubro: 'general'`, `transporte: 'cloud'`).
   - `prepararFichaEmpleados`: verificación del mapeo tribal Beto -> `rita`, personalidad de Tino con umbrales y palabras clave de escalación, y Vera con criterio estricto.
   - Preservación de etiquetas de Instagram: confirmación de que contactos existentes mantienen su `etiqueta` y `etapa`.
   - Anti-SSRF en proxy de medios: rechazo de URLs locales o IPs privadas y aceptación de CDNs oficiales de Meta.
   - Idempotencia del aprovisionamiento: estabilidad ante llamadas repetidas.
2. **`tests/canal-prompt.test.mjs`** (1/1 Aprobada):
   - Verificación de ausencia de referencias a WhatsApp cuando el canal es `"instagram"`.

### B. Ejecución de la Suite Completa del Proyecto
```text
✔ tests/onboarding-p0.test.mjs (11 tests passed)
✔ tests/canal-prompt.test.mjs (1 test passed)
✔ Toda la suite global del repositorio:
  ▶ 973 tests passed
  ▶ 0 tests failed
  ▶ 0 tests skipped
```

### C. Typecheck y Lint
- `npm run typecheck`: **0 errores**.
- `npm run lint`: **0 errores** (únicamente 2 advertencias previas de variables no usadas en componentes intactos de React).

---

## 12. Inventario Exhaustivo de Archivos Modificados y Creados

### Archivos Creados (Nuevos):
1. [`sql/313_transporte_cloud_default.sql`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/sql/313_transporte_cloud_default.sql): Migración SQL para cambiar default de `transporte` a `'cloud'` y limpiar nulos.
2. [`sql/314_fn_onboarding_cliente.sql`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/sql/314_fn_onboarding_cliente.sql): Función PL/pgSQL transaccional `ed_aprovisionar_cliente(jsonb)`.
3. [`lib/onboarding.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/onboarding.ts): Módulo TypeScript con validaciones, generación de slugs, mapeo de conocimiento tribal y orquestación de provisioning.
4. [`scripts/nuevo_cliente.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/scripts/nuevo_cliente.ts): Script CLI para aprovisionar clientes en una sola línea de comando.
5. [`scripts/readiness_tenant.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/scripts/readiness_tenant.ts): Script CLI para auditar el estado y salud de un tenant.
6. [`tests/onboarding-p0.test.mjs`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/tests/onboarding-p0.test.mjs): Suite de pruebas unitarias de regresión para onboarding.
7. [`tests/canal-prompt.test.mjs`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/tests/canal-prompt.test.mjs): Prueba de verificación de prompt multicanal.

### Archivos Modificados:
1. [`lib/inboundInstagram.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/inboundInstagram.ts): Protección de etiquetas y etapas existentes en contactos de Instagram.
2. [`lib/promptEmpleado.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/promptEmpleado.ts): Soporte para parámetro `canal` en `armarPrompt`, evitando fugas de menciones a WhatsApp en Instagram.
3. [`lib/responderBot.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/responderBot.ts): Paso de argumento `canal` en el ciclo de respuesta de Tino.
4. [`app/api/whatsapp/media/route.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/app/api/whatsapp/media/route.ts): Descarga directa y segura de medios desde CDN de Meta/Instagram con validación anti-SSRF.

---

## 13. Acciones Requeridas por el Owner (Paso a Producción)

Para activar formalmente estas mejoras en el entorno de producción, el administrador de base de datos o tech lead debe ejecutar las siguientes acciones:

### Paso 1: Aplicar Migración 313 en Supabase SQL Editor
Ejecutar el archivo `sql/313_transporte_cloud_default.sql`:
```sql
ALTER TABLE ed_clientes ALTER COLUMN transporte SET DEFAULT 'cloud';
UPDATE ed_clientes SET transporte = 'cloud' WHERE transporte IS NULL;
```

### Paso 2: Instalar Función de Aprovisionamiento 314
Ejecutar el archivo `sql/314_fn_onboarding_cliente.sql` en Supabase SQL Editor para dar de alta la función transaccional `ed_aprovisionar_cliente`.

### Paso 3: Auditar Tenants Existentes
Ejecutar el inspector de salud en los clientes actualmente en producción para verificar que ninguno tenga configurado transporte WAHA ni inconsistencias de personalidades:
```bash
npx tsx scripts/readiness_tenant.ts --cliente <slug_o_id>
```

---

## 14. Riesgos Restantes y Hoja de Ruta Inmediata

| Riesgo / Pendiente | Nivel | Mitigación Planificada |
| :--- | :---: | :--- |
| **Categorías ocultas en `/informacion` (P0-E)** | Medio | Está completamente documentado en el Playbook. En la siguiente iteración de interfaz, agregar los tabs `vocabulario`, `casos` y `productos` en `app/(portal)/informacion/page.tsx`. |
| **Modelo de Identidad Persona vs Chat (P2)** | Bajo | Las citas web funcionan y registran todos los datos. La unificación omnicanal sin WhatsApp se abordará en la reestructuración CRM de fase P2. |
| **Cuota y Límites de Rate Limit Meta** | Bajo | La creación secuencial de números mediante Embedded Signup evita colisiones de cuota en el Business Manager. |
