# MAPA DE PERSONALIZACIÓN DE MARKETING: INVENTARIO REAL Y FUENTES
# RESPONDO PORTAL · FASE 1

**Fecha:** 15 de Septiembre de 2026
**Objetivo:** Mapeo exhaustivo del estado actual de los datos empresariales, comerciales y publicitarios en `respondo-portal`, identificando duplicaciones, vacíos, mecanismos de edición y decisiones de unificación para la V1 de Personalización Profunda.

---

## 1. TABLA MAESTRA DE INVENTARIO (27 CAMPOS AUDITADOS)

| DATO | FUENTE ACTUAL | TIPO DE FUENTE | EDITABLE HOY | QUIÉN LO CONSUME | DUPLICACIONES DETECTADAS | CALIDAD ACTUAL | DECISIÓN V1 |
|---|---|---|---|---|---|---|---|
| **nombre** | `ed_clientes.nombre` | DB (columna base de cliente) | **No** (solo por SQL en puesta en marcha) | Auth, Layouts, Tino (`promptEmpleado.ts`), Isabel, `contextoComercialCore.ts`, `contextoMarca.ts`. | Ninguna en BD; duplicado en fixtures demo. | **Alta** (nombre legal o de fantasía registrado). | Mantener en `ed_clientes`; proyectar canónicamente en `BusinessProfile.nombre`. |
| **rubro** | `ed_clientes.rubro` | DB (columna base de cliente) | **No** (solo por SQL) | Auth, Tino, `inferirVoz` (`vozMarca.ts`), `contextoComercialCore.ts`, `contextoMarca.ts`. | Duplicado en clasificador operativo (`clasificadorProducto.ts`). | **Media** (un string libre como `"imprenta"` o `"abogado"`). | Mantener en `ed_clientes`; proyectar en `BusinessProfile.rubro` con inferencias de voz asociadas. |
| **web / sitio** | `sitioDe()` en `contextoComercial.ts:86` | Regex sobre texto de fichas `ed_conocimiento` | **Indirecta** (escribiendo una ficha que contenga `http://...`) | `ContextoComercial.negocio.sitio`, prompt de Arquitecto. | Se extraía también al vuelo en `contextoMarca.ts`. | **Baja / Frágil** (si el cliente no escribe su URL con `https://` en una ficha, queda `null`). | **Campo estructurado declarado** en `BusinessProfile.sitio` con fallback a regex sobre fichas. |
| **ubicación / ciudad** | `zonaDe()` en `contextoComercial.ts:75` y `zonaDesde()` en `contextoMarca.ts` | Regex contra lista fija de 20 ciudades de Chile sobre fichas | **Indirecta** (escribiendo el nombre de una de las 20 ciudades en una ficha) | `ContextoComercial.negocio.zona`, Audiencia en Arquitecto, Copiloto. | Duplicado en `contextoComercial.ts` y `contextoMarca.ts` con regex ligeramente distintas. | **Baja** (ignora comunas o ciudades fuera del top 20; no estructurado). | **Campo estructurado declarado** en `BusinessProfile.ubicacion` (`ciudad`, `direccion`, `comuna`) con fallback a regex. |
| **cobertura** | No existe | Inexistente (se asumía la ciudad o Chile entero) | **No** | Nadie estructuradamente | — | **Nula** | **Nuevo campo estructurado** en `BusinessProfile.cobertura` (`"local" \| "regional" \| "nacional" \| "internacional"` + detalle). |
| **B2B / B2C** | No existe | Inexistente (se deducía implícitamente por rubro) | **No** | Nadie estructuradamente | — | **Nula** | **Nuevo campo estructurado** en `BusinessProfile.tipoCliente` (`"b2b" \| "b2c" \| "ambos"`). |
| **logo** | `ed_clientes.logo_url` + storage bucket `logos` | DB + Supabase Storage | **Sí**, en `/informacion` (`accionesLogo.ts`) | Layout del portal (`Sidebar`), `/informacion`. | No consumido por Creative Studio para composiciones. | **Alta** (soporta PNG/JPG/WEBP/SVG máx 2MB). | Integrar como parte del `BrandProfile.logoUrl` y proyectarlo a creatividades. |
| **productos** | `ed_mk_contexto.documento->vende` (tipo `"producto"`) vs `ofertasDesde()` en `contextoMarca.ts` | Extractor LLM / Clasificador 40/40 vs Regex legacy | **Sí**, en `/marketing/creatividades` («contexto usado») | Estudio Creativo 2.0, copies, filtros de creatividades. | **DUPLICACIÓN CRÍTICA**: `contextoDeMarca` filtra con regex sobre títulos (`ofertasDesde`), mientras Estudio 2.0 usa `ContextoComercial.vende`. | **Media** (Estudio 2.0 es alta; `contextoMarca` es baja/ruidosa). | **Canónico único en `CommercialProfile.vende[]`**. Eliminar `ofertasDesde` legacy. |
| **servicios** | `ed_mk_contexto.documento->vende` (tipo `"servicio"`) | Extractor LLM / Clasificador 40/40 | **Sí**, en «contexto usado» | `ContextoComercial.vende` (apenas como etiqueta; inerte antes) | Duplicado con `ed_servicios` de Agenda (solo si el negocio usa reservas). | **Media** | Canónico en `CommercialProfile.vende[]` con `tipo: "servicio"`, integrando servicios activos de Agenda si existen. |
| **precios** | `EntidadComercial.precio` | Extractor de conocimiento / texto literal | **Sí**, en «contexto usado» | Copies de Estudio 2.0, validador de hechos | No se cruzaba con los montos de `ed_servicios` de Agenda. | **Media** (depende de que el cliente escriba `$XX` en una ficha). | Canónico en `vende[].precio` TAL CUAL aparece, respetando provenance ("declarado" vs "extraido"). |
| **cliente ideal** | `ContextoComercial.audiencia.descripcion` | Extractor LLM sobre fichas de rol `audiencia` | **Sí**, en «contexto usado» | Prompt de copy en Estudio 2.0 | Duplicado conceptual con `AudienciaCampana` en Arquitecto (targeting de pauta). | **Media** | Canónico en `CommercialProfile.audiencia.descripcion`. Permite override explícito del dueño. |
| **segmentos** | `ContextoComercial.audiencia.rubros[]` | Extractor LLM / Clasificador 40/40 | **Sí**, en «contexto usado» | Prompt de copy | Inerte en Arquitecto | **Media** | Canónico en `CommercialProfile.audiencia.rubros[]`, utilizado para segmentación en copies y campañas. |
| **problema** | `ContextoComercial.propuesta.problema` | Extractor LLM sobre fichas de rol `problema` | **Sí**, en «contexto usado» | Ángulo `problema` en Estudio 2.0 | No conectado a Arquitecto | **Media** | Canónico en `CommercialProfile.propuesta.problema`. Proyectado a Arquitecto y Copiloto. |
| **resultado** | `ContextoComercial.propuesta.resultado` | Extractor LLM | **Sí**, en «contexto usado» | Ángulo `resultado` en Estudio 2.0 | No conectado a Arquitecto | **Media** | Canónico en `CommercialProfile.propuesta.resultado`. |
| **diferenciadores** | `ContextoComercial.diferenciadores[]` | Extractor LLM (máx 4 del modelo, cortados a 6) | **No** (omitido en `corregirContextoAccion`) | Alimenta `terminosPropios()` | No editable en UI | **Media** | **Hacer editable en UI** dentro de `CommercialProfile.diferenciadores[]`. |
| **ofertas** | `ContextoComercial.ofertas[]` con `fuente` y `reserva` | Fichas de rol `oferta` / `esOfertaDeVerdad()` | **Sí**, en «contexto usado» | Ángulo `urgencia`, copies | En `contextoMarca` legacy se llamaba `ofertas` a cualquier producto. | **Alta** en Estudio 2.0 | Canónico en `CommercialProfile.ofertas[]`, agregando soporte de **vigencia temporal**. |
| **pruebas** | `ContextoComercial.pruebas[]` con `reserva` | Fichas de rol `prueba` / `casos` | **No** (omitido en `corregirContextoAccion`) | Ángulo `prueba`, validador de claims | No se exponía para edición manual | **Alta** | **Hacer editable en UI** dentro de `CommercialProfile.pruebas[]`. |
| **voz** | `ContextoComercial.voz` (`VozMarca`, 9 ejes) | `inferirVoz()` determinista en `vozMarca.ts` | **Indirecta** (escribiendo una ficha de rol `voz`) | `revisarPieza()`, prompt de copy | No se usaba en Copiloto ni en Arquitecto | **Alta** (muy buen subsistema determinista) | Proyectar `CommercialProfile.voz` a todos los prompts generativos con adaptación según canal. |
| **noAfirmar** | `ContextoComercial.noAfirmar[]` | Derivado determinista de mecánica y pruebas faltantes | **No** (bloqueado por seguridad) | Prompt de copy bajo «PROHIBIDO AFIRMAR» | No conectado a Copiloto ni a Arquitecto | **Alta** | Canónico en `CommercialProfile.noAfirmar[]`, permitiendo agregar prohibiciones explícitas declaradas por el dueño. |
| **branding visual** | No existe (solo `logo_url`) | Inexistente | **No** | Nadie estructuradamente | — | **Nula** | **Nuevo `BrandProfile` mínimo V1**: colores principales, estilo visual, elementos prohibidos en imágenes. |
| **objetivo actual** | `pedido.objetivo` en Arquitecto o brief por anuncio | Input efímero en formulario | **Efímero** (se pierde tras generar) | Arquitecto de Campañas | Cada pantalla pedía escribir el objetivo desde cero | **Baja** (sin persistencia ni coherencia) | **Nuevo `MarketingProfile.objetivoActual`** persistente, editable y pre-cargable en todas las pantallas. |
| **productos prioritarios** | No existe | Inexistente | **No** | Nadie | — | **Nula** | **Nuevo `MarketingProfile.productosPrioritarios[]`**. Orienta Estudio, Arquitecto y Home sin borrar el resto. |
| **segmentos prioritarios** | No existe | Inexistente | **No** | Nadie | — | **Nula** | **Nuevo `MarketingProfile.segmentosPrioritarios[]`**. |
| **conversión preferida** | No existe como preferencia declarada | Derivado de integraciones conectadas (WhatsApp/web) | **No** | `capacidades.ts`, `destino` en Arquitecto | `acciones.ts` forzaba `destino: "whatsapp"` (corregido en remediación) | **Media** | **Nuevo `MarketingProfile.conversionDeseada`** (`"whatsapp" \| "formulario" \| "sitio_web" \| "llamada" \| "compra"`). |
| **canales preferidos** | No existe como preferencia | Derivado de canales conectados en `capacidades.ts` | **No** | `arquitectoCore.ts` (reparto) | — | **Media** | **Nuevo `MarketingProfile.canalesPreferidos`** (`("meta" \| "google")[]`). |
| **estacionalidad** | No existe | Inexistente | **No** | Nadie | — | **Nula** | **Nuevo `MarketingProfile.estacionalidad`** (texto descriptor para influir ángulos y ganchos). |
| **restricciones temporales** | No existe | Inexistente | **No** | Nadie | — | **Nula** | **Nuevo `MarketingProfile.restriccionesTemporales[]`** ({ texto, hasta }). Desactiva ofertas vencidas automáticamente. |

---

## 2. DIAGNÓSTICO DE DUPLICACIONES Y FRAGMENTACIÓN ("DOS CEREBROS")

### La Fractura `ContextoMarca` (Legacy) vs `ContextoComercial` (Estudio 2.0)
1. **`ContextoMarca` (`lib/marketing/contextoMarca.ts`):**
   - Extrae productos usando regex elemental (`ofertasDesde`) buscando `"servicio|producto|precio|catalogo"` o signos `$` en títulos de `ed_conocimiento`.
   - Consulta `ed_isabel_saber` al vuelo y aplana con `contextoEnTexto()`.
   - Hardcodea en modo demo un fixture de "Gráfica Andina" que tiene textos, precios y hechos sabidos diferentes a los de Estudio 2.0.
   - **Consumidores Activos:**
     - `app/(marketing)/marketing/creatividades/page.tsx:34` (chips "Puedes anunciar").
     - `app/(marketing)/marketing/campanas/nueva/page.tsx:29` (asistente de campaña).
     - `lib/marketing/arquitecto.ts:280` (Arquitecto de campañas).
     - `lib/marketing/copiloto.ts:32` (Copiloto de marketing).
     - `lib/marketing/creatividades.ts:118` (`generarPaquete` legacy).
2. **`ContextoComercial` (`lib/marketing/contextoComercial.ts` + `ed_mk_contexto`):**
   - Utiliza el clasificador semántico 40/40 (`rolesConocimiento.ts`) separando `vende`, `capacidades`, `propuesta`, `audiencia`, `ofertas`, `pruebas`, `voz`, `noAfirmar`.
   - Persiste en `ed_mk_contexto` (migración 310) y soporta correcciones manuales humanas con fuente `declarado`.
   - **Consumidor Único:**
     - `app/(marketing)/marketing/creatividades/nueva/page.tsx` (Estudio Creativo 2.0).

**Impacto:** El dueño corregía un producto en «contexto usado» del Estudio Creativo 2.0, pero al entrar al Arquitecto de Campañas o al Copiloto, estos módulos leían el viejo `contextoDeMarca`, ignorando sus correcciones y mostrando un catálogo desfasado o inventado.

---

## 3. ARQUITECTURA UNIFICADA V1: EL MODELO DE PERSONALIZACIÓN INTEGRAL

Se define una única entidad canónica: **`PerfilNegocioMarketing`**, que integra armónicamente las 5 dimensiones conceptuales:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                     PERFIL DE MARKETING DEL NEGOCIO                       │
│                     (ed_mk_contexto.documento jsonb)                      │
├───────────────────────────────────────────────────────────────────────────┤
│ 1. BUSINESS PROFILE (Identidad estable)                                   │
│    nombre · rubro · sitio · ubicacion · cobertura · tipoCliente           │
├───────────────────────────────────────────────────────────────────────────┤
│ 2. BRAND PROFILE (Identidad visual y de marca)                            │
│    logoUrl · colores (primario, secundario) · estiloVisual · noVisual     │
├───────────────────────────────────────────────────────────────────────────┤
│ 3. COMMERCIAL PROFILE (Qué vende y cómo lo demuestra)                    │
│    vende[] · capacidades[] · audiencia · propuesta · diferenciadores[]    │
│    ofertas[] (con vigencia) · pruebas[] · voz · noAfirmar[]               │
├───────────────────────────────────────────────────────────────────────────┤
│ 4. MARKETING PROFILE (Qué quiere conseguir ahora - prioridades)           │
│    objetivoActual · productosPrioritarios[] · segmentosPrioritarios[]     │
│    zonaPrioritaria · conversionDeseada · canalesPreferidos · estacionalidad│
├───────────────────────────────────────────────────────────────────────────┤
│ 5. PROVENANCE & HUMAN OVERRIDES                                           │
│    declarado (100) > catalogo/extraido (80) > inferido (10)               │
│    conservarCorrecciones() campo por campo en reconstrucción              │
└───────────────────────────────────────────────────────────────────────────┘
                                     │
           ┌─────────────────────────┼─────────────────────────┐
           ▼                         ▼                         ▼
   PROYECCIÓN CREATIVE       PROYECCIÓN ARCHITECT      PROYECCIÓN COPILOTO
   (Estudio 2.0 / Copies)    (Planes de campaña)       (Análisis & Asesoría)
```

---

## 4. PLAN DE RETIRO DE COMPONENTES LEGACY

1. **Eliminar `contextoDeMarca` y `contextoEnTexto`:**
   - Reemplazar en `arquitecto.ts`, `copiloto.ts`, `creatividades/page.tsx`, `campanas/nueva/page.tsx` por la lectura canónica del perfil unificado (`obtenerPerfilMarketing`).
   - Deprecar `lib/marketing/contextoMarca.ts`.
2. **Eliminar `generarPaquete` y `promptCreativo` legacy:**
   - Redirigir el generador simple de `creatividades.ts` para usar `generarCopy` de Estudio 2.0 o retirar su ruta muerta.
3. **Unificar Fixtures de Demostración:**
   - Consolidar en `demo.ts` un único perfil de "Gráfica Andina" que alimente por igual a Estudio, Arquitecto y Copiloto.
