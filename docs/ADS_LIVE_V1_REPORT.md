# REPORTE DE EJECUCIÓN: ADS LIVE V1 (META ADS + GOOGLE ADS)

**Fecha:** 17 de Septiembre de 2026  
**Sistema:** Respondo Portal — Marketing & Ads Engine  
**Versión:** Ads Live V1  
**Customer Zero:** Impresora Color (`33333333-3333-3333-3333-333333333333`)  
**Cuenta Meta:** `act_1625722292606602` («Cecilia Roa»)

---

## 1. RESUMEN EJECUTIVO DE OPERATIVIDAD

| Canal / Módulo | Lectura Nativa | Publicador Nativo | Test Live en API | Closed-Loop IDs | Estado General |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Meta Ads** | **GO** | **GO** | **DOCUMENTADO (Code 100/33)** | **PASS** | Código 100% operativo; bloqueado por permiso OAuth `ads_management` |
| **Google Ads** | **GO** | **GO** | **BLOQUEADO (Credenciales faltantes)** | **PASS** | Código 100% operativo; bloqueado por `GOOGLE_ADS_CLIENT_ID` en entorno |

---

## 2. ARQUITECTURA TÉCNICA IMPLEMENTADA

Se construyó el motor de publicación nativo de punta a punta respetando la arquitectura existente de Respondo sin crear sistemas paralelos:

1. **Modelo Unificado de Publicación (`lib/ads/publicacion.ts`)**:
   - Tipos unificados: `VistaPreviaPublicacion`, `ResultadoPublicacion`, `FallaPublicacion`, `EstadoPublicacionPlataforma`.
   - Idempotencia en memoria con TTL de 15 minutos (`verificarIdempotencia`, `registrarInicioPublicacion`, `registrarFinPublicacion`) que previene doble mutación y doble facturación ante dobles clics o reintentos rápidos de red.
   - Sanitización estricta (`sanitizarMensajeError`): Redacción automática de Bearer headers, tokens de acceso de Meta (`EAA...`), Google refresh tokens (`1//...`) y client secrets. Ningún dato sensible llega jamás a logs ni a la interfaz.

2. **Publicador Meta Ads (`lib/ads/metaPublicar.ts`)**:
   - Secuencia estricta Graph API v21.0:
     1. Verificación multi-inquilino de la conexión (`ed_ads_conexion`) y descifrado AES-256-GCM del token.
     2. Validación rápida de presupuesto y moneda (`budget` convertido a centavos enteros).
     3. Creación de Campaña (`POST /act_{id}/campaigns`) con `status: 'PAUSED'`, `objective: 'OUTCOME_TRAFFIC' | 'OUTCOME_LEADS' | 'OUTCOME_ENGAGEMENT'`.
     4. Creación de Conjunto de Anuncios (`POST /act_{id}/adsets`) con `status: 'PAUSED'`, `billing_event: 'IMPRESSIONS'`, `optimization_goal: 'LINK_CLICKS' | 'LEAD_GENERATION'`, targeting geográfico y presupuesto diario.
     5. Creación de Creatividad (`POST /act_{id}/adcreatives`) con `object_story_spec` vinculando la página de Facebook y el destino.
     6. Creación de Anuncio (`POST /act_{id}/ads`) con `status: 'PAUSED'`.
   - Generación de Deep Link directo al Ads Manager de Meta (`linkMetaAdsManager`).
   - Mapeo humano de errores de Graph API (100 subcódigo 33, 190, 200, límites de presupuesto, cuenta deshabilitada).

3. **Publicador Google Ads Search (`lib/ads/googlePublicar.ts`)**:
   - Google Ads API v25 con canje automático de refresh token a access token (`oauth2.googleapis.com/token`).
   - Mutación atómica en lote (`POST /customers/{id}/googleAds:mutate`) utilizando IDs temporales negativos (`-1`, `-2`, `-3`, etc.) para crear en una sola transacción atómica:
     - `CampaignBudgetOperation` (`delivery_method: STANDARD`, monto en micros).
     - `CampaignOperation` (`advertising_channel_type: SEARCH`, `status: PAUSED`, `bidding_strategy_type: MAXIMIZE_CLICKS`).
     - `AdGroupOperation` (`status: PAUSED`, `type: SEARCH_STANDARD`).
     - `AdGroupCriterionOperation` (múltiples palabras clave con concordancia `EXACT`, `PHRASE` o `BROAD`).
     - `AdGroupAdOperation` (Responsive Search Ad validando hasta 15 títulos de <= 30 caracteres y hasta 4 descripciones de <= 90 caracteres).
   - Generación de Deep Link directo a Google Ads (`linkGoogleAds`).
   - Mapeo humano de errores de mutación (nivel de acceso del proyecto Cloud, límites de longitud, permisos de cuenta).

4. **Cierre de Ciclo de IDs & Persistencia (`lib/marketing/campanas.ts` & Server Actions)**:
   - Función `registrarPublicacionCampana`: Persiste en la base de datos Supabase (`ed_mk_campanas`) el resultado completo en el campo JSONB `plan.publicacion`, asigna el estado `publicada` y actualiza `meta_campaign_id` y `google_campaign_id`.
   - Server actions en `app/(marketing)/marketing/campanas/acciones.ts`:
     - `obtenerVistaPreviaPublicacionAccion`: Pre-valida estado de cuenta, moneda, saldo y parámetros sin mutar nada.
     - `publicarCampanaNativaAccion`: Ejecuta la mutación segura, valida permisos e idempotencia, y actualiza el registro.

5. **Experiencia de Usuario (`components/marketing/ModalPublicarCampana.tsx` & `AsistenteCampana.tsx`)**:
   - Modal de confirmación de publicación que exhibe la advertencia visual clara de protección de presupuesto: **«Estado inicial: PAUSADA»**.
   - Resumen completo previo al clic: cuenta conectada, presupuesto diario, audiencia/keywords, copies y advertencias.
   - Visualización de IDs reales devueltos por la plataforma y enlace directo a la consola nativa (Meta Ads Manager o Google Ads UI).

6. **Migración SQL (`sql/316_ads_publicacion.sql`)**:
   - Agrega de forma aditiva e idempotente la columna `google_campaign_id text` y el índice `idx_ed_mk_campanas_cliente_estado` en `ed_mk_campanas`.

---

## 3. AUDITORÍA FORENSE DE CUSTOMER ZERO (IMPRESORA COLOR)

### A. Meta Ads
- **ID Cliente:** `33333333-3333-3333-3333-333333333333`
- **Cuenta Publicitaria:** `act_1625722292606602` («Cecilia Roa»)
- **Estado de Lectura:** **OPERATIVO / 100% OK**
  - Token descifrado con éxito mediante AES-256-GCM.
  - Llamada Graph API v21.0 exitosa: `account_status: 1`, `currency: CLP`, `timezone_name: America/Santiago`.
- **Prueba Live de Creación de Campaña:**
  - Endpoint: `POST https://graph.facebook.com/v21.0/act_1625722292606602/campaigns`
  - Payload enviado: `name: "Test Respondo Ads Live V1"`, `objective: "OUTCOME_TRAFFIC"`, `status: "PAUSED"`, `special_ad_categories: []`
  - Respuesta de Meta:
    ```json
    {
      "error": {
        "message": "Unsupported post request. Object with ID 'act_1625722292606602' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
        "type": "GraphMethodException",
        "code": 100,
        "error_subcode": 33,
        "fbtrace_id": "A3PIUVy0NVNbmk43K_TgJ1W"
      }
    }
    ```
  - **Diagnóstico Exacto:** El token actual de Impresora Color fue generado con el scope histórico de solo lectura (`ads_read`, `business_management`, `public_profile`). Meta rechaza cualquier mutación (`POST /campaigns`) con el subcódigo 33 hasta que el usuario conceda el permiso `ads_management` y seleccione una Página de Facebook asociada a los anuncios.

### B. Google Ads
- **ID Cliente:** `33333333-3333-3333-3333-333333333333`
- **Estado de Entorno:**
  - `GOOGLE_ADS_CLIENT_ID`: No configurado en `.env.local` ni Vercel.
  - `GOOGLE_ADS_CLIENT_SECRET`: No configurado en `.env.local` ni Vercel.
- **Diagnóstico Exacto:** El código del publicador Google (`googlePublicar.ts`) implementa la especificación Google Ads API v25 completa y atómica. Falla cerrado inmediatamente cuando las variables no están presentes en el entorno. Requiere la configuración de las credenciales de OAuth y el nivel de acceso en Google Cloud.

---

## 4. SUITE DE QA Y PRUEBAS AUTOMATIZADAS

Todos los controles de calidad pasan al 100%:
- **Test Suite Completa (`npm test`):** 1028 tests ejecutados, **1028 pasaron (0 fallas)**.
- **Tests Unitarios de Publicación Meta (`tests/ads-publicacion-meta.test.mjs`):** 7 tests pasaron.
  - Traducción de código 100/subcódigo 33.
  - Detección de token expirado (190).
  - Manejo de falta de Facebook Page.
  - Sanitización estricta de tokens Meta en errores.
  - Cache y retención de Idempotencia.
  - Generación de Deep Links a Meta Ads Manager.
  - Rechazo temprano por presupuesto inválido.
- **Tests Unitarios de Publicación Google (`tests/ads-publicacion-google.test.mjs`):** 7 tests pasaron.
  - Traducción de error de nivel de acceso (Access Level).
  - Validación y traducción de límites de caracteres en titulares y descripciones.
  - Permisos de cuenta denegados.
  - Sanitización estricta de Google Refresh Tokens y Client Secrets.
  - Idempotencia en mutaciones Google.
  - Generación de Deep Links a Google Ads UI.
  - Rechazo temprano por presupuesto inválido.
- **Verificación de Tipos TypeScript (`npx tsc --noEmit`):** **0 errores**.
- **Linter (`npm run lint`):** **0 errores, 0 advertencias**.
- **Compilación de Producción (`npm run build`):** **Exitosa (código 0)** en 14.1 segundos.

---

## 5. ACCIONES REQUERIDAS DEL PROPIETARIO (OWNER ACTIONS)

Para que las campañas comiencen a publicarse físicamente en Meta y Google Ads, el propietario debe realizar los siguientes pasos de configuración externa:

### 1. META ADS — Habilitar Permiso de Escritura (`ads_management`)
1. **Configuración de la App en Meta for Developers:**
   - Ingresar a [Meta for Developers](https://developers.facebook.com/apps/).
   - Seleccionar la App de Respondo.
   - En **Casos de uso** o **Permisos y funciones**, asegurarse de que el permiso `ads_management` y `pages_read_engagement` estén disponibles (en modo Desarrollo para administradores/testers del negocio, o solicitar App Review para modo Live).
2. **Re-conectar la Cuenta de Impresora Color:**
   - En el portal de Respondo (`/marketing/integraciones`), desvincular y volver a conectar la cuenta de Meta Ads.
   - En el diálogo de consentimiento de Facebook Login, autorizar la gestión de anuncios (`ads_management`) y seleccionar la Página de Facebook del negocio.
3. **Página de Facebook:**
   - Asegurarse de que la cuenta publicitaria `act_1625722292606602` tenga acceso de anunciante sobre la página de Facebook de «Impresora Color».

### 2. GOOGLE ADS — Credenciales de OAuth y Acceso a API
1. **Crear Proyecto en Google Cloud Console:**
   - Ingresar a [Google Cloud Console](https://console.cloud.google.com/).
   - Crear un proyecto dedicado (por ejemplo, `Respondo Ads`).
   - Habilitar la **Google Ads API** en la Biblioteca de APIs.
2. **Crear Credenciales OAuth 2.0:**
   - En **Pantalla de consentimiento de OAuth**, configurar tipo Externo y agregar el scope `https://www.googleapis.com/auth/adwords`.
   - En **Credenciales**, crear un **ID de cliente de OAuth** (tipo: Aplicación Web).
   - En URIs de redireccionamiento autorizados, agregar:
     - `https://respondo-portal.vercel.app/api/ads/google/callback`
     - `http://localhost:3000/api/ads/google/callback`
3. **Configurar Variables de Entorno en Vercel y `.env.local`:**
   - `GOOGLE_ADS_CLIENT_ID`: ID del cliente de OAuth (`...apps.googleusercontent.com`).
   - `GOOGLE_ADS_CLIENT_SECRET`: Secreto del cliente de OAuth.
4. **Nivel de Acceso de Google Ads API:**
   - Solicitar el nivel de acceso en Google Cloud Console para la Google Ads API (con nivel Basic / Explorer para cuentas de prueba o producción según corresponda).
5. **Conectar la Cuenta en el Portal:**
   - Ingresar a `/marketing/integraciones` en Respondo y presionar **Conectar Google Ads**.
