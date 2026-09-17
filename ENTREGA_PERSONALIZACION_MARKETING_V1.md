# DOCUMENTO CONSOLIDADO DE ENTREGA
# PERSONALIZACIÓN PROFUNDA DE MARKETING POR NEGOCIO V1

> **Fecha:** 15 de septiembre de 2026
> **Proyecto:** Respondo Portal (`respondo-portal`)
> **Misión:** Construcción Autónoma — Personalización Profunda de Marketing por Negocio V1
> **Resultado de Validación:** APROBADO — 961 / 961 tests pasando, 0 errores de TypeScript, build de producción Turbopack 100% exitoso.

---

## 1. RESUMEN EJECUTIVO

Se completó de forma autónoma la construcción de la capa canónica de **Personalización Profunda de Marketing por Negocio V1**.

### Logros Principales:
1. **Unificación Definitiva de «Los Dos Cerebros»**: Se eliminó la divergencia arquitectónica entre el contexto comercial 2.0 (`ed_mk_contexto`) y el contexto legacy (`contextoDeMarca()`). Todos los módulos del ecosistema (Estudio Creativo, Campaign Architect, Copiloto de Marketing, Asistente de Campañas y Galería) consumen hoy la **misma y única verdad canónica** a través de `PerfilNegocioMarketing`.
2. **Jerarquía Formal de Procedencia (Provenance)**: Se implementó la regla inquebrantable de autoridad:
   $$\text{DECLARADO (100)} > \text{CATALOGO / EXTRAIDO (80)} > \text{CONOCIMIENTO (60)} > \text{PUBLICIDAD (40)} > \text{CONVERSACIONES (30)} > \text{INFERIDO (10)}$$
   Ningún dato inferido puede validar por sí solo un claim o promesa publicitaria en un anuncio.
3. **Marketing Profile & Temporalidad**: El negocio puede declarar qué desea vender prioritariamente hoy (productos foco, prioridad comercial actual) sin mutilar ni alterar el resto de su catálogo. Las ofertas temporales con fecha de caducidad se evalúan dinámicamente: las ofertas vencidas se desactivan automáticamente y nunca llegan a los anuncios.
4. **Preservación de Overrides Humanos**: Toda corrección manual del dueño (`editado = true`, entidades con `fuente: "declarado"`, directivas de marca) se conserva de forma no destructiva ante cualquier refresco o cambio automático en el conocimiento base.
5. **Cierre de Bugs A y B del Master Context**:
   - **Bug A**: La edición de creatividades en `EditorCreatividad.tsx` ya no pierde `origen`, detecta cambios de copy para fijar `texto_manual = true` y preserva la `estrategia`.
   - **Bug B**: La subida y reutilización de creatividades en `GeneradorAnuncio.tsx` y `imagenes.ts` persiste y valida el puntero canónico `sb:<path>`, erradicando la desreferenciación a `imagen_url = null`.
6. **UX Progresiva (Prellenar $\to$ Confirmar $\to$ Corregir)**: Interfaz intuitiva en `ContextoUsado.tsx` que permite visualizar y editar prioridades de marketing, productos foco, restricciones y promociones sin formularios técnicos abrumadores.
7. **Migración 312 Idempotente y Resiliente**: Se diseñó `sql/312_personalizacion_marketing.sql` como Owner Action, incorporando un fallback transparente que opera con 100% de funcionalidad si la migración aún no ha sido corrida en Supabase.
8. **QA Exhaustivo**: 961 tests unitarios y de propiedades pasando, 0 errores de tipos en TypeScript, build Turbopack limpio y preservación intacta de conectores de Ads y motor conversacional de Tino.

---

## 2. INVENTARIO REAL Y MAPA DE DATOS (27 CAMPOS)

Durante la Fase 1 se generó el documento [`MARKETING_PERSONALIZATION_MAP.md`](./MARKETING_PERSONALIZATION_MAP.md), resolviendo la fragmentación histórica de los 27 campos esenciales:

| Campo | Fuente Original | Diagnóstico Previo | Decisión Arquitectónica V1 |
|---|---|---|---|
| `nombre` | `ed_clientes.nombre` | Estable | Se extrae a `BusinessProfile.nombre`, editable por dueño |
| `rubro` | `ed_clientes.rubro` | Genérico | Se estructura en `BusinessProfile.rubro` |
| `web` | Regex sobre `ed_conocimiento` | Volátil / Regex | `BusinessProfile.sitioWeb` con extracción resiliente |
| `ubicacion` | Regex en `contextoComercialCore` | Frágil | `BusinessProfile.ubicacion` con fallback de conocimiento |
| `cobertura` | No existía estructurado | Inexistente | `BusinessProfile.cobertura` tipado y editable |
| `tipoNegocio` | Inexistente | Inexistente | `BusinessProfile.tipoNegocio` (`"b2b" \| "b2c" \| "ambos"`) |
| `logo` | `ed_clientes.logo_url` | Solo URL | `BrandProfile.logoUrl` |
| `productos` / `servicios` | Dual (`contextoMarca` vs `ed_mk_contexto`) | Dos listas distintas | Unificado bajo `CommercialProfile.vende[]` canónico |
| `precios` | Fichas de precios | No estructurado | `EntidadComercial.precio` con procedencia estricta |
| `cliente ideal` / `segmentos` | `ContextoComercial.audiencia` | Inferencia suelta | `MarketingProfile.segmentosObjetivo[]` + `audiencia` |
| `problema` / `resultado` | `ContextoComercial.propuesta` | Solo en `copy.ts` | Proyectado a Arquitecto, Copiloto y Estudio |
| `diferenciadores` | `ContextoComercial.diferenciadores` | Parcial | Integrado con prioridades dinámicas actuales |
| `ofertas` (permanentes) | `ContextoComercial.ofertas` | Separado de temporales | Unificado en `CommercialProfile.ofertas` |
| `pruebas` | `ContextoComercial.pruebas` | Solo `copy.ts` | Proyectado a todos los consumidores |
| `voz` | `vozMarca.ts` | Determinista | `CommercialProfile.voz` integrado al perfil |
| `noAfirmar` | `ContextoComercial.noAfirmar` | Solo en `copy.ts` | Unificado con prohibiciones de `BrandProfile` para todos |
| `branding visual` | No existía | Inexistente | `BrandProfile` (`paletaColores`, `estiloVisual`, `elementosProhibidos`) |
| `objetivo actual` | No existía | Inexistente | `MarketingProfile.prioridadActual` |
| `productos prioritarios` | No existía | Inexistente | `MarketingProfile.productosFoco[]` |
| `segmentos prioritarios` | No existía | Inexistente | `MarketingProfile.segmentosObjetivo[]` |
| `conversión preferida` | No existía | Inexistente | `MarketingProfile.metaConversion` |
| `canales preferidos` | No existía | Inexistente | `MarketingProfile.canalesPreferidos[]` (`meta`, `google`) |
| `estacionalidad` / `restricciones` | No existía | Inexistente | `BrandProfile.elementosProhibidos` proyectados a `noAfirmar` |
| `restricciones temporales` | No existía | Inexistente | `OfertaTemporal` con expiración evaluada en runtime |

---

## 3. ARQUITECTURA DETALLADA DEL SISTEMA

### 3.1 Diagrama de Flujo Canónico

```
                               ┌────────────────────────────────┐
                               │  FUENTES BASE DEL NEGOCIO      │
                               │  · ed_clientes                 │
                               │  · ed_conocimiento             │
                               │  · ed_isabel_saber             │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │  MOTOR DE ENSAMBLAJE Y JIT     │
                               │  lib/marketing/perfilMarketing │
                               │  · Caché TTL 10 min            │
                               │  · Hash SHA-256 de fichas      │
                               │  · Detección de Staleness      │
                               └───────────────┬────────────────┘
                                               │
                                               ▼
                               ┌────────────────────────────────┐
                               │    PerfilNegocioMarketing      │
                               │    (Modelo Canónico V1)        │
                               │  ├── BusinessProfile           │
                               │  ├── BrandProfile              │
                               │  ├── CommercialProfile         │
                               │  ├── MarketingProfile          │
                               │  └── InvalidationState         │
                               └───────┬───────┬────────┬───────┘
                                       │       │        │
               ┌───────────────────────┘       │        └───────────────────────┐
               ▼                               ▼                                ▼
    ┌────────────────────┐          ┌────────────────────┐           ┌────────────────────┐
    │ proyeccionCreative │          │ proyeccionArchitect│           │ proyeccionCopiloto │
    │ (Estudio Creativo) │          │(Campaign Architect)│           │    (Copiloto)      │
    └──────────┬─────────┘          └────────────────────┘           └────────────────────┘
               │
               ▼
    ┌────────────────────┐
    │proyeccionContexto- │
    │      Marca         │
    │(Adaptador Legacy)  │
    └────────────────────┘
```

### 3.2 Componentes Implementados

#### A. Núcleo Puro (`lib/marketing/perfilMarketingCore.ts`)
- Define los tipos canónicos: `BusinessProfile`, `BrandProfile`, `CommercialProfile`, `MarketingProfile`, `OfertaTemporal`, `InvalidationState` y `PerfilNegocioMarketing`.
- Define y verifica la constante `AUTORIDAD` con los pesos de procedencia.
- Implementa `evaluarOfertasTemporales(ofertas, fechaReferencia)`: apaga ofertas vencidas comparando ISO-8601 contra el reloj del sistema.
- Implementa `conservarCorreccionesPerfil(nuevo, viejo)`: fusiona el perfil generado automáticamente con las modificaciones previas del dueño.
- Implementa las proyecciones especializadas:
  - `proyeccionCreative`: Reordena productos foco al frente, inyecta ofertas temporales activas y agrega elementos prohibidos de marca a `noAfirmar`.
  - `proyeccionArchitect`: Construye el prompt comercial estructurado, canales recomendados, ubicación y sitio web para Google y Meta Ads.
  - `proyeccionCopiloto`: Proporciona contexto del negocio y resumen de prioridades para el chat con el dueño.
  - `proyeccionContextoMarca`: Adaptador que mapea el perfil unificado a la estructura `ContextoMarca` requerida por módulos antiguos.
- Implementa `perfilMarketingDemo()`: Fixture canónico determinista que sustituye a los dos fixtures contradictorios anteriores.

#### B. Ensamblador y Persistencia (`lib/marketing/perfilMarketing.ts`)
- Lee de forma concurrente `ed_clientes`, `ed_conocimiento` e `ed_isabel_saber`.
- Calcula `fichasHash = SHA-256(...)` sobre las fichas del negocio para detectar cambios estáticos sin costo de inferencia LLM.
- Implementa caché en memoria con TTL de 10 minutos por tenant.
- Reconstrucción JIT transparente si el perfil está `stale` o se detectaron ofertas caducadas.
- Persistencia híbrida en `ed_mk_contexto.documento`: guarda el `perfil` canónico bajo `documento.perfil` y aplana las propiedades de `ContextoComercial` en la raíz de `documento`, garantizando compatibilidad 100% con código preexistente.
- Fallback automático si las columnas de la migración 312 (`stale`, `stale_motivo`, `fichas_hash`) aún no existen en Supabase.

#### C. Migración de Base de Datos (`sql/312_personalizacion_marketing.sql`)
- Script aditivo e idempotente:
  ```sql
  alter table public.ed_mk_contexto
    add column if not exists stale boolean not null default false,
    add column if not exists stale_motivo text,
    add column if not exists fichas_hash text;

  create index if not exists ed_mk_contexto_cliente_stale_idx
    on public.ed_mk_contexto (cliente_id, stale);
  ```

#### D. Capa UX Progresiva (`components/marketing/ContextoUsado.tsx` y Server Actions)
- `ContextoUsado.tsx` incluye la pestaña *"Prioridades de Marketing V1"*.
- Permite al usuario revisar lo que Respondo entendió y editar en un clic:
  - Prioridad comercial del mes.
  - Productos y servicios foco.
  - Tipo de negocio (B2B, B2C, Ambos).
  - Restricciones estilísticas de marca.
  - Estado de ofertas temporales (con badges de *Activa* y *Vencida*).
- Server actions en `app/(marketing)/marketing/creatividades/acciones.ts`:
  - `perfilMarketingAccion()`: Carga el perfil canónico del tenant autenticado.
  - `actualizarPerfilMarketingAccion(patch)`: Guarda los cambios del usuario y revalida la vista.

---

## 4. RESOLUCIÓN DEL PROBLEMA DE LOS DOS CEREBROS

### Consumidores Migrados

| Módulo / Consumidor | Archivo | Consumo Previo | Consumo Actual (V1) |
|---|---|---|---|
| **Estudio Creativo (Lote)** | `lib/marketing/creatividades.ts` | `contextoDeMarca()` al vuelo | `obtenerPerfilMarketing` $\to$ `proyeccionCreative` |
| **Campaign Architect** | `lib/marketing/arquitecto.ts` | `contextoDeMarca()` al vuelo | `obtenerPerfilMarketing` $\to$ `proyeccionArchitect` |
| **Copiloto de Marketing** | `lib/marketing/copiloto.ts` | `contextoDeMarca()` al vuelo | `obtenerPerfilMarketing` $\to$ `proyeccionCopiloto` |
| **Asistente de Campañas** | `app/(marketing)/marketing/campanas/nueva/page.tsx` | `contextoDeMarca()` al vuelo | `obtenerPerfilMarketing` $\to$ Catálogo y Focos Canónicos |
| **Galería del Estudio** | `app/(marketing)/marketing/creatividades/page.tsx` | `contextoDeMarca()` al vuelo | `obtenerPerfilMarketing` $\to$ Chips desde `commercial.vende` |
| **Generador de Anuncios** | `app/(marketing)/marketing/creatividades/nueva/page.tsx` | `contextoComercial()` suelto | `obtenerPerfilMarketing` inyectado a `GeneradorAnuncio` y `ContextoUsado` |
| **Adaptador Legacy** | `lib/marketing/contextoMarca.ts` | Generador al vuelo independiente | Delegación interna a `obtenerPerfilMarketing` $\to$ `proyeccionContextoMarca` |

---

## 5. CORRECCIÓN DE BUGS DEL MASTER CONTEXT

### Bug A: Pérdida de Metadatos al Editar Creatividades
- **Diagnóstico**: `EditorCreatividad.tsx` omitía `origen`, no detectaba si el texto había sido modificado manualmente (`texto_manual`) y reseteaba `estrategia` a null al invocar `guardarCreatividadAccion`.
- **Corrección**:
  - `EditorCreatividad.tsx`: Mantiene el `origen` original (`"generada"`, `"subida"`, `"existente"`). Compara el texto editado contra el original; si hubo cambio, establece `textoManual = true`. Envía `estrategia` intacta.
  - `lib/marketing/creatividades.ts`: La función de actualización escribe `origen`, `texto_manual` y `estrategia` condicionalmente sin sobreescribir valores preexistentes con null.
- **Estado**: **CERRADO Y PROBADO**.

### Bug B: Guardado de URL de Visualización en vez del Puntero `sb:`
- **Diagnóstico**: `GeneradorAnuncio.tsx` asignaba la URL del proxy de visualización `/api/marketing/imagen?r=...` en `imagenUrl`. Al guardar, `rutaDeImagen()` en `imagenes.ts` esperaba un prefijo `sb:` y fallaba silenciosamente, guardando `imagen_url = null`.
- **Corrección**:
  - `GeneradorAnuncio.tsx`: Almacena y envía directamente `r.puntero` (`sb:<path>`).
  - `lib/marketing/imagenes.ts`: `rutaDeImagen()` decodifica parámetros URI (`decodeURIComponent`) y valida la expresión regular de rutas de Supabase (`/^[0-9a-f-]{8,}\/[0-9]+\.(jpg|png|webp)$/i`).
- **Estado**: **CERRADO Y PROBADO**.

---

## 6. AISLAMIENTO CUSTOMER ZERO (TENANT SEPARATION)

En `tests/personalizacion-marketing.test.mjs` se implementó una prueba de aislamiento semántico y de seguridad con tres negocios reales de naturalezas radicalmente distintas:

1. **Respondo**: Software SaaS B2B, automatización de WhatsApp, con sede en Santiago. Sus claims giran en torno a horas ahorradas y atención automatizada 24/7.
2. **Impresora Color**: Taller de imprenta gráfica B2B/B2C en Chillán. Sus directivas contienen listas de precios exactas por metro cuadrado y entrega física express.
3. **AyP Abogados**: Firma jurídica en Concepción. Su perfil prohíbe taxativamente garantizar resultados en litigios y no depende de canales informales.

### Verificaciones Demostradas en Pruebas:
- Las prohibiciones deontológicas de AyP Abogados no se aplican ni contaminan a Impresora Color ni a Respondo.
- Las restricciones de despacho local de Impresora Color no afectan a los servicios en la nube de Respondo.
- El vocabulario real de clientes de cada tenant permanece herméticamente aislado dentro de su respectivo `cliente_id`.

---

## 7. SUITE DE TESTS Y RESULTADOS DE QA

### Resumen de Pruebas
Se crearon pruebas de propiedades puras en [`tests/personalizacion-marketing.test.mjs`](./tests/personalizacion-marketing.test.mjs), sumando 9 nuevas aserciones críticas al runner nativo de Node.js.

### Resultados de Ejecución:

```bash
# 1. Tests del repositorio
> npm test
ℹ tests 961
ℹ suites 0
ℹ pass 961
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8176.7132

# 2. Análisis Estático de Tipos
> npx tsc --noEmit
(0 errores, salida limpia)

# 3. Linter
> npm run lint
(0 errores, solo 2 advertencias preexistentes en archivos ajenos)

# 4. Build de Producción Turbopack
> npm run build
▲ Next.js 16.3.0 (Turbopack)
✓ Compiled successfully in 7.3s
✓ Finished TypeScript in 5.3s
✓ Generating static pages (8/8) in 227ms
✓ Finalizing page optimization
(0 errores en todas las rutas /marketing/* y /api/*)
```

---

## 8. ACTUALIZACIONES DE DOCUMENTACIÓN DEL SISTEMA

Se actualizaron de forma quirúrgica los documentos maestros del sistema:
- **`RESPONDO_MASTER_CONTEXT.md`**:
  - Actualizada la Sección 10 (matriz de consumidores) para reflejar la unificación bajo `PerfilNegocioMarketing`.
  - Actualizadas las Secciones 13 y 14 (Campaign Architect y Copiloto) indicando el consumo directo de las proyecciones canónicas.
  - Actualizado el diagrama de flujo E y la resolución del fixture demo duplicado.
- **`RESPONDO_CONTEXT_MARKETING.md`**:
  - Actualizada la Sección 7.9 indicando la reconversión de `contextoDeMarca` en adaptador.
  - Actualizada la lista de preguntas abiertas, marcando como resueltos los ítems 1, 3, 4, 5, 7, 8 y 13.
- **`RESPONDO_CONTEXT_DATA.md`**:
  - Actualizada la Sección 26.6 con las columnas aditivas de la migración 312 (`stale`, `stale_motivo`, `fichas_hash`) en `ed_mk_contexto`.

---

## 9. ACCIONES DEL PROPIETARIO (OWNER ACTIONS)

1. **Migración 312 en Supabase**:
   - Archivo: [`sql/312_personalizacion_marketing.sql`](./sql/312_personalizacion_marketing.sql).
   - Acción: Ejecutar en el SQL Editor de Supabase cuando sea conveniente. No es urgente gracias al fallback integrado.
2. **Control de Versiones (Git)**:
   - Crear el commit con los cambios y realizar `git push origin main`.
3. **Validación Google Ads con Impresora Color**:
   - Ejecutar la prueba planificada para mañana. Los conectores de Google Ads y Meta Ads quedaron completamente intactos y sin riesgo de contaminación.

---

### CONCLUSIÓN FINAL

La Personalización Profunda de Marketing V1 dota a Respondo de una arquitectura comercial coherente, gobernada por reglas de procedencia transparentes y respetuosa de la autonomía del dueño del negocio. Los componentes están listos para operar en producción.
