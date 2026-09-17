# RESPONDO — Informe de Remediación Onboarding P0 (Versión 2)
## Aprovisionamiento Atómico + Hardening de Canales

> **Misión:** Misión B — Remediación Onboarding P0
> **Fecha:** 16 de Septiembre de 2026
> **Repositorio:** `respondo-portal`
> **Aislamiento:** Cumplido estrictamente (cero modificaciones en `lib/marketing/**`, `app/(marketing)/**`, `components/marketing/**`, `ed_mk_contexto`, `sql/312_personalizacion_marketing.sql`). Cero commits, cero pushes, cero SQL aplicado en producción.

---

## 1. Resumen Ejecutivo y Veredictos Finales

Esta misión técnica resolvió de raíz la fragilidad en el aprovisionamiento de nuevos clientes y endureció las defensas de seguridad en el proxy de medios multicanal, basándose estrictamente en el **esquema real de la base de datos** y eliminando abstracciones o tablas ficticias.

### Veredictos Técnicos

| Componente | Veredicto | Justificación Técnica |
| :--- | :---: | :--- |
| **ONBOARDING CODE (`lib/onboarding.ts`, CLI, Readiness)** | **GO** | Implementa validaciones puras en runtime, soporte de planes y cuotas canónicas, fail-closed sin fallback pseudo-transaccional, y encapsulamiento de Beto $\to$ `rita`. |
| **MIGRACIÓN 313 (`sql/313_transporte_cloud_default.sql`)** | **GO** | Altera únicamente el `DEFAULT` de la columna `transporte` a `'cloud'` para nuevos registros. No ejecuta `UPDATE` sobre clientes WAHA legacy existentes. 100% aditiva e inocua. |
| **MIGRACIÓN 314 (`sql/314_fn_onboarding_cliente.sql`)** | **GO** | Función PL/pgSQL transaccional atómica, `SECURITY INVOKER`, con `search_path` estricto, permisos revocados de `PUBLIC/anon/authenticated`, ejecución exclusiva concedida a `service_role`, sin dependencias a tablas inexistentes, con contrato de idempotencia real. |
| **COMMIT / PUSH / DEPLOY** | **NO-GO** | Cumplimiento de directiva estricta de aislamiento: ningún commit, push ni despliegue fue ejecutado en esta sesión. |

---

## 2. Auditoría del Esquema Real vs Hallazgos Originales

### Eliminación de la Tabla Ficticia `ed_citas_config`
- **Diagnóstico:** Reportes y playbooks anteriores sugerían la existencia de una tabla `ed_citas_config` para parametrizar la agenda (`dias_visibles`, `anticipacion_minima_horas`, etc.).
- **Realidad del Código:** La migración fundacional de agenda (`sql/220_agenda.sql:135-140`) agregó la configuración directamente en la tabla `ed_clientes`:
  - `slug text unique`
  - `reservas_online boolean not null default false`
  - `confirmacion_automatica boolean not null default true`
  - `anticipacion_min_horas int not null default 2`
  - `horizonte_dias int not null default 30`
- **Acción Ejecutada:** Se eliminó toda mención, inserción y dependencia hacia `ed_citas_config` tanto en la migración `sql/314_fn_onboarding_cliente.sql` como en `lib/onboarding.ts`. El módulo agenda ahora activa limpiamente `reservas_online = true` en `ed_clientes`.

### Restitución de Planes Comerciales Reales
- **Diagnóstico:** El código previo aceptaba `starter` y `pro`, valores inexistentes que provocaban fallos inmediatos contra la base de datos.
- **Realidad del Código:** La migración `sql/278_cupo_conversaciones.sql:41-44` impone el check constraint `ed_clientes_plan_valido`:
  ```sql
  check (plan is null or plan in ('tino_solo', 'inicial', 'crecimiento', 'empresa', 'a_medida'))
  ```
- **Acción Ejecutada:**
  - El sistema ahora valida estrictamente contra la terna real de planes (`tino_solo`, `inicial`, `crecimiento`, `empresa`, `a_medida`).
  - Por defecto se asigna el plan canónico de entrada `'inicial'`.
  - Se sincroniza automáticamente el cupo mensual canónico desde `lib/cupoConversaciones.ts`:
    - `tino_solo` $\to$ 800 conversaciones
    - `inicial` $\to$ 1.200 conversaciones
    - `crecimiento` $\to$ 3.000 conversaciones
    - `empresa` $\to$ 6.000 conversaciones
    - `a_medida` $\to$ cupo configurable o nulo

---

## 3. Hechos Confirmados por la Auditoría Independiente

1. **Preservación de Estados de Contacto en Instagram:** `lib/inboundInstagram.ts:198-215` consulta primero si el contacto ya existe. Si existe, preserva su `etiqueta` y `etapa` actuales (`ignoreDuplicates: false`), evitando que los mensajes entrantes degraden clientes calificados a `"lead"`.
2. **Canal Multicanal en Tino:** `lib/promptEmpleado.ts` expone `resolverCanalPrompt(canal)`. Si el canal es `"instagram"`, el prompt se contextualiza con `"Instagram"` e `"Instagram Direct (máx. 1.000 caracteres)"`, suprimiendo cualquier mención a `"WhatsApp"`.
3. **Transporte WhatsApp Inmutable:** Los clientes existentes con `transporte = 'waha'` (ej. Impresora Color) no sufren alteración alguna.
4. **Decisión de Reservas Web vs CRM:** No forzar la creación de registros sintéticos en `ed_contactos` para reservas web es la decisión arquitectónicamente correcta. La tabla `ed_contactos` es chat-céntrica (`(cliente_id, chat_id)` donde `chat_id NOT NULL`), mientras que `ed_citas` almacena la cita con nombre y teléfono.

---

## 4. Nueva Arquitectura de Aprovisionamiento Atómico

### 4.1 Migración 314: Función PostgreSQL (`sql/314_fn_onboarding_cliente.sql`)
Se reescribió por completo la función `public.ed_aprovisionar_cliente(p_datos jsonb)` con las siguientes especificaciones:

```
┌─────────────────────────────────────────────────────────────┐
│              ed_aprovisionar_cliente(p_datos jsonb)         │
│  SECURITY INVOKER (search_path = public, pg_temp)           │
├─────────────────────────────────────────────────────────────┤
│  1. Extracción y validación de tipos e insumos              │
│  2. Mapeo de planes reales y cupos canónicos                │
│  3. Validación de formato de email, slug y moneda ISO       │
│  4. Evaluación de Idempotencia y detección de conflictos    │
│  5. Inserción atómica (BEGIN ... COMMIT automático en RPC): │
│     ├─ ed_clientes (transporte='cloud', reservas_online)    │
│     ├─ portal_usuarios (dueño + colaboradores staff)        │
│     └─ ed_empleados (Tino, Beto [rol 'rita'], Vera)         │
│  6. Si ocurre cualquier error -> ROLLBACK TOTAL             │
└─────────────────────────────────────────────────────────────┘
```

#### Modelo de Seguridad y Privilegios
- **`SECURITY INVOKER`:** La función se ejecuta con los privilegios del rol que la invoca, evitando elevaciones innecesarias de privilegios.
- **Search Path Seguro:** `SET search_path = public, pg_temp` previene ataques de suplantación de esquemas (search path hijacking).
- **Restricción de Acceso:**
  ```sql
  REVOKE ALL ON FUNCTION public.ed_aprovisionar_cliente(jsonb) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.ed_aprovisionar_cliente(jsonb) FROM anon;
  REVOKE ALL ON FUNCTION public.ed_aprovisionar_cliente(jsonb) FROM authenticated;
  GRANT EXECUTE ON FUNCTION public.ed_aprovisionar_cliente(jsonb) TO service_role;
  ```
  La RPC está completamente bloqueada para usuarios anónimos o clientes autenticados en el frontend; únicamente el backend autorizado con credenciales `service_role` puede invocarla.

### 4.2 Contrato de Idempotencia Real
Se diseñó un mecanismo riguroso que distingue reintentos legítimos de conflictos de datos:
1. **Reintento Idéntico (Doble Click / Network Retry):**
   - Si el `slug` ya existe, la función consulta si el `nombre` comercial y el `email_dueno` en `portal_usuarios` coinciden exactamente con la solicitud.
   - Si coinciden: Retorna el cliente existente con `idempotente: true`, `status: "EXISTENTE_NO_MODIFICADO"`, sin insertar filas duplicadas ni alterar el tenant.
2. **Conflicto de Slug:**
   - Si el `slug` ya existe pero para otro nombre comercial o dueño distinto: Lanza excepción `CONFLICTO_IDEMPOTENCIA` / `SLUG_EN_USO`.
3. **Conflicto de Email de Dueño:**
   - Si el `slug` es nuevo pero el `email_dueno` ya está registrado en `portal_usuarios` (clave única global): Lanza excepción `EMAIL_EN_USO`.
4. **Colisión de Staff:**
   - Si algún email de staff ya pertenece a otra empresa o está duplicado con el dueño: Lanza excepción `EMAIL_STAFF_EN_USO` o `STAFF_DUPLICADO`.

### 4.3 Eliminación del Fallback Pseudo-Transaccional en TypeScript
Se eliminó en su totalidad el antiguo mecanismo de fallback en `lib/onboarding.ts` (que ejecutaba múltiples queries cliente a cliente e intentaba limpiezas con `DELETE` manuales ante fallos).
- **Semántica Fail-Closed:** Si la migración 314 no está instalada en la base de datos (error PostgreSQL `42883`), el sistema falla inmediatamente retornando:
  ```json
  {
    "ok": false,
    "codigo": "MIGRACION_NO_APLICADA",
    "error": "Falta aplicar la migración de aprovisionamiento (sql/314_fn_onboarding_cliente.sql) en la base de datos."
  }
  ```
- **Garantía:** Cero riesgo de dejar un tenant a medio crear (ej. empresa creada sin usuarios o sin empleados de IA).

---

## 5. Hardening de Media Proxy e Instagram (SSRF y Size Limit)

Se implementó el módulo [`lib/mediaSegura.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/mediaSegura.ts) e integró en [`app/api/whatsapp/media/route.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/app/api/whatsapp/media/route.ts) con dos defensas críticas:

### 5.1 Revalidación Estricta de Redirecciones (Anti-SSRF)
- **Problema Previo:** `fetch` seguía redirecciones de forma automática. Un atacante o servidor comprometido podía devolver un código HTTP 302 hacia `http://169.254.169.254/latest/meta-data` o servicios internos.
- **Solución Implementada:**
  - Se utiliza `redirect: "manual"`.
  - Cada encabezado `Location` se resuelve y se revalida obligatoriamente con `hostDeMediaPermitido(proxUrl)`.
  - Solo se permiten esquemas `https:` hacia dominios oficiales de Meta (`lookaside.fbsbx.com`, `graph.facebook.com`, `*.fbcdn.net`, `*.cdninstagram.com`).
  - Se impone un límite estricto de máximo 3 redirecciones (`MAX_REDIRECTS_MEDIA = 3`) para prevenir bucles.
  - Al cambiar de host entre saltos, se elimina automáticamente el encabezado `Authorization` para no fugar tokens del tenant.

### 5.2 Límite Real de 25 MB en Streaming
- **Problema Previo:** El control dependía exclusivamente de `Content-Length`. Si un servidor entregaba respuestas chunked (`Transfer-Encoding: chunked`) o sin encabezado de longitud, el stream se entregaba sin límite.
- **Solución Implementada:**
  - Se implementó `crearStreamConLimiteBytes(stream, maxBytes)` utilizando la API nativa de `TransformStream`.
  - Cada chunk emitido incrementa un contador de bytes.
  - Si el acumulado supera los 25 MB (`25 * 1024 * 1024` bytes), el transformador invoca `controller.error(new Error("EXCESO_LIMITE_BYTES"))`, abortando la conexión de inmediato sin almacenar el contenido en memoria RAM.

---

## 6. Auditoría y Readiness del Tenant (`scripts/readiness_tenant.ts`)

Se rediseñó el inspector de salud [`scripts/readiness_tenant.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/scripts/readiness_tenant.ts) para consultar el esquema real y categorizar las comprobaciones:

1. **CORE (Vital para operar):**
   - Tenant activo en `ed_clientes`.
   - Dueño registrado en `portal_usuarios` con email en minúsculas.
   - Empleados de IA activos en `ed_empleados`: Tino, Beto (rol `rita`), Vera.
2. **CANALES:**
   - WhatsApp: Transporte (`CLOUD` recomendado), estado de conexión WABA, soporte de Coexistencia.
   - Instagram: Identificador de usuario y token activo.
3. **MÓDULOS OPCIONALES (No contractuales $\neq$ Error crítico):**
   - Agenda: Estado de `reservas_online`, conteo de servicios y profesionales activos.
   - Marketing CAPI: Presencia de `ads_dataset_id`.
   - Cobros Asistidos: Configuración de `pago_link_base` y etiqueta de referencia.

---

## 7. Análisis Arquitectónico: Reservas Web vs Contactos CRM

### El Desacople Estructural de Identidad
En la arquitectura actual de Respondo coexisten dos conceptos distintos de identidad:
- **Identidad de Conversación (`ed_contactos`):** Diseñada estrictamente alrededor del chat (`(cliente_id, chat_id)` donde `chat_id NOT NULL`). Representa un hilo de mensajería (WhatsApp o Instagram).
- **Identidad de Cita (`ed_citas`):** Diseñada alrededor de una reserva de servicio (`(cliente_id, servicio_id, inicio, fin)`), donde el paciente ingresa su nombre y teléfono en un formulario web.

### Por qué NO crear contactos sintéticos en esta fase
Forzar la creación de un contacto en `ed_contactos` inventando un `chat_id` artificial (ej. `"web:+56912345678"`) produce graves efectos secundarios:
1. Crea un chat "fantasma" en el inbox del portal.
2. Si el cliente posteriormente escribe a la línea de WhatsApp del negocio, Meta entrega el identificador telefónico real del usuario, duplicando al contacto en el CRM.
3. Si el paciente reservó con un número fijo, los intentos de WhatsApp Cloud API fallan con error `131026`.

**Recomendación Arquitectónica (Fase P2):**
Introducir una tabla unificadora `ed_personas (id, cliente_id, nombre, telefono_e164, email)` a la que apunten tanto `ed_citas.persona_id` como `ed_contactos.persona_id`.

---

## 8. Verificación y Batería de Pruebas Ejecutadas

### 8.1 Resultados de la Suite Automatizada P0 (`tests/onboarding-p0.test.mjs`)
Se ejecutaron 17 pruebas unitarias rigurosas, cubriendo cada una de las fases exigidas:

```text
✔ 1. Migración 313: solo altera default a 'cloud' sin migrar clientes WAHA existentes (2.05ms)
✔ 2. Migración 314: función PostgreSQL atómica en una sola transacción (0.92ms)
✔ 3. Migración 314: modelo de seguridad INVOKER, revoke público y grant exclusivo a service_role (0.28ms)
✔ 4. Planes reales: admite tino_solo, inicial, crecimiento, empresa, a_medida y rechaza starter/pro (2.19ms)
✔ 5. Agenda real: ed_citas_config NO existe en código ni en migración 314 (0.97ms)
✔ 6. Idempotencia: retry idéntico retorna cliente existente sin duplicar (0.58ms)
✔ 7. Conflicto de idempotencia: slug o email en uso para otro titular devuelve error claro (0.40ms)
✔ 8. Encapsulamiento Beto -> rita: el rol en DB es 'rita', el nombre público es 'Beto' (0.20ms)
✔ 9. Staff: valida emails, previene duplicados y rechaza colisión con el dueño (2.36ms)
✔ 10. Teléfonos: normaliza texto y arrays, exigiendo al menos 8 dígitos (0.46ms)
✔ 11. Moneda: valida formato ISO-4217 de 3 letras mayúsculas (0.28ms)
✔ 12. Fallo cerrado: si falta la migración 314, rechaza con MIGRACION_NO_APLICADA sin escrituras parciales (0.26ms)
✔ 13. Readiness: distingue CORE completo y no marca módulos opcionales no contratados como error crítico (0.28ms)
✔ 14. Canal Prompt: Tino adapta su saludo y contexto a Instagram sin mencionar WhatsApp (0.12ms)
✔ 15. Media Proxy SSRF: rechaza dominios no autorizados y redirecciones a hosts prohibidos (49.46ms)
✔ 16. Media Size: límite de 25 MB real (Content-Length y streaming chunked) (5.07ms)
✔ 17. GenerarSlug: remueve diacríticos, caracteres raros y recorta longitud (0.13ms)

Total: 17 tests passed, 0 failed.
```

### 8.2 QA Global y Compilación
- **`tests/canal-prompt.test.mjs` y `tests/media-segura.test.mjs`:** 5/5 pruebas aprobadas.
- **Suite Global del Repositorio:** 984 pruebas aprobadas (las 3 fallas preexistentes corresponden a pruebas de reproducción en archivos de Marketing de la misión paralela).
- **Typecheck (`npx tsc --noEmit`):** **0 errores** en todo el proyecto.
- **Linter (`npm run lint`):** **0 errores** (8 advertencias en componentes intactos de React).
- **Build (`npm run build`):** La compilación Next.js generó los artefactos de producción exitosamente (`Compiled successfully in 13.3s`).

---

## 9. Inventario Exhaustivo de Archivos Modificados y Creados

### Archivos Creados / Reescribir:
1. [`sql/313_transporte_cloud_default.sql`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/sql/313_transporte_cloud_default.sql): Migración aditiva para default de transporte a `'cloud'`.
2. [`sql/314_fn_onboarding_cliente.sql`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/sql/314_fn_onboarding_cliente.sql): Función PostgreSQL transaccional con esquema real, security invoker e idempotencia.
3. [`lib/mediaSegura.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/mediaSegura.ts): Utilidad de streaming seguro, anti-SSRF para redirecciones y límite de 25 MB.
4. [`lib/onboarding.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/onboarding.ts): Módulo central de validaciones, provisioning atómico fail-closed y readiness.
5. [`scripts/nuevo_cliente.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/scripts/nuevo_cliente.ts): Herramienta CLI para aprovisionamiento con soporte para staff múltiple y dry-run.
6. [`scripts/readiness_tenant.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/scripts/readiness_tenant.ts): Inspector de salud por capas (Core vs Canales vs Opcionales).
7. [`tests/onboarding-p0.test.mjs`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/tests/onboarding-p0.test.mjs): Suite de pruebas automatizadas con 17 casos de prueba.

### Archivos Modificados:
1. [`app/api/whatsapp/media/route.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/app/api/whatsapp/media/route.ts): Integración de `descargarMediaSegura` y streaming con control de tamaño.
2. [`lib/promptEmpleado.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/promptEmpleado.ts): Exportación y uso de `resolverCanalPrompt` para aislar contexto de canal.
3. [`lib/inboundInstagram.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/inboundInstagram.ts): Preservación de etiquetas y etapas preexistentes en contactos.
4. [`lib/responderBot.ts`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/lib/responderBot.ts): Paso de argumento `canal` en el ciclo de Tino.

---

## 10. Acciones Requeridas por el Owner (Paso a Producción)

Una vez finalizada la revisión de código, el administrador de producción debe ejecutar manualmente en Supabase:

1. **Aplicar Migración 313:**
   ```sql
   -- En Supabase SQL Editor:
   ALTER TABLE ed_clientes ALTER COLUMN transporte SET DEFAULT 'cloud';
   ```
2. **Aplicar Migración 314:**
   Ejecutar el script completo de `sql/314_fn_onboarding_cliente.sql` en Supabase SQL Editor para registrar la función `public.ed_aprovisionar_cliente(jsonb)`.
3. **Uso en Producción:**
   Aprovisionar nuevos clientes mediante el comando CLI:
   ```bash
   npx tsx scripts/nuevo_cliente.ts \
     --nombre "Clínica Dental San Lucas" \
     --rubro "odontologia" \
     --email-dueno "admin@sanlucas.cl" \
     --telefono "+56912345678" \
     --plan "inicial"
   ```
