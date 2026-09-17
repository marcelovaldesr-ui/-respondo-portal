# INFORME DE CONSTRUCCIÓN Y ENTREGA
# PERSONALIZACIÓN PROFUNDA DE MARKETING POR NEGOCIO V1

> **Fecha:** 15 de septiembre de 2026
> **Repositorio:** `respondo-portal`
> **Rol:** Constructor Principal de Personalización de Marketing
> **Estado:** COMPLETADO CON ÉXITO — 961 / 961 tests pasando, build Turbopack limpio, 0 errores de tipos, sin regresiones.

---

## 1. Qué existía antes

Antes de esta intervención, la información del negocio en Respondo se encontraba fragmentada entre múltiples silos conceptuales y de almacenamiento:

1. **`ed_clientes`**: Almacenaba atributos esenciales del tenant (`id`, `nombre`, `rubro`, `telefono`, `logo_url`, flags de configuración). Atributos comerciales como sitio web, ubicación física precisa o tipo de negocio (B2B vs B2C) no existían como columnas tipadas y debían deducirse al vuelo con heurísticas o regex sobre texto libre.
2. **`ed_conocimiento`**: Repositorio de fichas operativas del negocio orientadas a la atención de Tino por WhatsApp. El módulo de Marketing las leía indirectamente para intentar inferir catálogos y propuestas.
3. **`ed_isabel_saber`**: Memoria destilada nocturna con hechos acumulados (`veces`, `tipo`, `clave`) generados a partir de conversaciones de clientes.
4. **`ed_mk_contexto`**: Creado en la Fase 6 (migración 310), almacenaba un `documento` JSONB con un `ContextoComercial` 2.0 (`vende`, `capacidades`, `audiencia`, `propuesta`, `diferenciadores`, `ofertas`, `pruebas`, `voz`, `noAfirmar`, `vocabularioCliente`).
5. **`contextoMarca.ts` (Legacy)**: El contexto previo a Fase 6 que calculaba al vuelo un objeto `ContextoMarca` aplanado a texto con el encabezado `"LO QUE VENDE:"`.

---

## 2. Qué estaba duplicado («El problema de los dos cerebros»)

El hallazgo arquitectónico más crítico documentado en el Master Context era la coexistencia de **dos cerebros comerciales activos e incompatibles**:

1. **Dualidad de Contextos en Motores de Marketing**:
   - `copy.ts` y `visualCore.ts` (generador de anuncios nuevo) consumían `ed_mk_contexto`.
   - `arquitecto.ts` (Campaign Architect), `copiloto.ts` (Copiloto de Marketing), `creatividades.ts::generarPaquete` (generación por lotes) y `campanas/nueva/page.tsx` consumían `contextoDeMarca()`.
2. **Consecuencias de la duplicación**:
   - **Desconexión de ediciones humanas**: Si el dueño corregía su contexto comercial en la pantalla del Estudio (`editado = true`), el Copiloto y el Arquitecto **no se enteraban** y seguían generando planes y recomendaciones a partir de la heurística al vuelo de `contextoMarca`.
   - **Fuga de restricciones de marca**: Las directivas de `noAfirmar[]` solo eran respetadas por `copy.ts`. El Arquitecto y el Copiloto podían prometer claims expresamente prohibidos por el negocio.
   - **Discrepancia visible de catálogo**: En la pantalla `/marketing/creatividades` (índice) se mostraban chips derivados del filtro de `contextoMarca`, mientras que `/marketing/creatividades/nueva` mostraba `contexto.vende`.
   - **Dos fixtures de demostración contradictorios**: Existía `contextoComercialDemo()` en `demo.ts` y una rama demo independiente en `contextoDeMarca()`, con descripciones, precios y productos distintos para el mismo negocio ficticio («Gráfica Andina»).

---

## 3. Qué faltaba realmente

1. **Una capa canónica unificada**: Una única estructura de datos que consolidara todos los aspectos de la identidad comercial de la empresa.
2. **Capacidad de declarar prioridades dinámicas (Marketing Profile)**: El negocio no tenía cómo indicarle a Respondo: *"Este mes quiero impulsar pendones y no tarjetas"* sin tener que borrar tarjetas del catálogo comercial.
3. **Manejo explícito de temporalidad**: Ofertas con fecha de vencimiento que se apagaran automáticamente al expirar, impidiendo anuncios con promociones caducadas.
4. **Jerarquía formal de procedencia (Provenance)**: Distinguir técnicamente entre lo que el dueño **declaró**, lo que se **extrajo** de una fuente documental y lo que Respondo **infirió**.
5. **Preservación granular de overrides humanos**: Al actualizar el conocimiento o refrescar el perfil, las correcciones manuales del dueño sobre un campo no debían perderse ni bloquear la actualización de otros campos.
6. **Invalidación reactiva sin llamadas bloqueantes a LLM**: Detectar cuándo el conocimiento base cambió (`stale`) y reconstruir de forma JIT (Just-in-Time) solo cuando un consumidor de marketing lo necesita.
7. **Brand Profile estructurado**: Prohibiciones estilísticas de marca, paleta de colores y estilo visual más allá del mero `logo_url`.
8. **Mitigación definitiva de los Bugs A y B del Master Context** (pérdida de metadatos en edición de anuncios y desreferenciación de punteros de imagen `sb:`).

---

## 4. Arquitectura elegida

Se diseñó una arquitectura desacoplada y orientada a tipos canónicos, con aislamiento estricto de lógica pura frente a operaciones de I/O de base de datos:

```
                  ┌──────────────────────────────────────────────────┐
                  │       FUENTES DE INFORMACIÓN DEL NEGOCIO         │
                  │   ed_clientes · ed_conocimiento · ed_isabel_saber│
                  └─────────────────────────┬────────────────────────┘
                                            │
                                            ▼
                  ┌──────────────────────────────────────────────────┐
                  │      ASSEMBLER / REBUILDER JIT (Cached/Hash)     │
                  │         lib/marketing/perfilMarketing.ts         │
                  └─────────────────────────┬────────────────────────┘
                                            │
                                            ▼
                  ┌──────────────────────────────────────────────────┐
                  │       PERFIL CANÓNICO DE MARKETING (V1)          │
                  │              PerfilNegocioMarketing              │
                  │  ├── BusinessProfile   (datos estables empresa)  │
                  │  ├── BrandProfile      (identidad visual / vetos)│
                  │  ├── CommercialProfile (catálogo / propuestas)   │
                  │  ├── MarketingProfile  (prioridades / ofertas)   │
                  │  └── InvalidationState (stale / hash / audit)    │
                  └───────┬──────────────┬─────────────┬─────────────┘
                          │              │             │
        ┌─────────────────┘              │             └──────────────────┐
        ▼                                ▼                                ▼
┌──────────────┐                 ┌──────────────┐                 ┌──────────────┐
│  Creative    │                 │  Campaign    │                 │   Copiloto   │
│  Studio      │                 │  Architect   │                 │  Marketing   │
│(proyeccion-  │                 │(proyeccion-  │                 │(proyeccion-  │
│  Creative)   │                 │  Architect)  │                 │  Copiloto)   │
└──────────────┘                 └──────────────┘                 └──────────────┘
        │                                                                 │
        └────────────────────────────────┬────────────────────────────────┘
                                         ▼
                 ┌──────────────────────────────────────────────┐
                 │  Adaptador Transparente de Compatibilidad    │
                 │              contextoMarca.ts                │
                 │         (proyeccionContextoMarca)            │
                 └──────────────────────────────────────────────┘
```

- **Módulo Núcleo Puro (`lib/marketing/perfilMarketingCore.ts`)**: Tipos fundamentales, evaluadores de tiempo, unificador de overrides humanos, proyecciones especializadas para cada consumidor y fixture determinista unificado para demos. Sin dependencias de runtime ni I/O.
- **Módulo Ensamblador y Persistencia (`lib/marketing/perfilMarketing.ts`)**: Conexión con Supabase, cálculo de hash SHA-256 de fichas de conocimiento, caché en memoria de 10 minutos por tenant, lectura/escritura en `ed_mk_contexto.documento` y soporte sin fisuras para entornos con y sin la migración 312.
- **Persistencia Híbrida Backward-Compatible**: El objeto `PerfilNegocioMarketing` completo se guarda bajo `documento.perfil`, mientras que los campos planos de `ContextoComercial` (`vende`, `capacidades`, `audiencia`, etc.) se aplanan en la raíz de `documento`. Cualquier código legacy que lea `documento.vende` continúa funcionando al 100%.

---

## 5. Business Profile

Define los datos de identidad corporativa estructurada:

```typescript
export type TipoNegocio = "b2b" | "b2c" | "ambos";

export type BusinessProfile = {
  nombre: string;
  rubro: string;
  categoria: string;
  sitioWeb: string | null;
  ubicacion: string | null;
  cobertura: string | null;
  tipoNegocio: TipoNegocio;
  telefonoContacto?: string | null;
  whatsappConectado: boolean;
};
```

- **Extracción resiliente**: `sitioWeb` y `ubicacion` se extraen con regex de `ed_clientes` y fichas de `ed_conocimiento`.
- **Clasificación B2B/B2C**: Basada en palabras clave de catálogo y clientes meta.
- **Canal WhatsApp**: Verifica si el negocio cuenta con `waba_id`, `ig_id` o transporte activo.

---

## 6. Commercial Profile

Aprovecha integralmente el modelo `ContextoComercial` de Fase 6 sin reinventar otro inventario paralelo:

- `vende[]`: Entidades comerciales con nombre, detalle, precio y procedencia (`fuente`).
- `capacidades[]`: Competencias operativas y tiempos de entrega.
- `audiencia`: Descripción del cliente meta y segmentos.
- `propuesta`: Problema principal que resuelve y resultado prometido.
- `diferenciadores[]`: Ventajas competitivas únicas.
- `ofertas[]` y `pruebas[]`: Evidencia y promociones permanentes.
- `voz`: Configuración determinista de formalidad, energía y modismos.
- `noAfirmar[]`: Lista estricta de afirmaciones prohibidas.
- `vocabularioCliente[]`: Frases reales y jerga de los clientes extraídas de `ed_isabel_saber`.

---

## 7. Marketing Profile

Responde a la pregunta estratégica: **¿Qué quiere conseguir este negocio ahora?**

```typescript
export type MarketingProfile = {
  prioridadActual: string | null;
  productosFoco: string[];
  segmentosObjetivo: string[];
  canalesPreferidos: ("meta" | "google")[];
  metaConversion: string | null;
  ofertasTemporales: OfertaTemporal[];
};
```

- **No destructivo**: Declarar que la prioridad del mes es "Pendones" no elimina "Tarjetas" del catálogo.
- **Impacto directo**: Los productos foco se ordenan al frente en el generador creativo, se inyectan como directiva de campaña en el Arquitecto y se suministran al Copiloto como contexto de negocio.

---

## 8. Provenance (Jerarquía de Procedencia)

Se implementó y verificó en pruebas de propiedades la escala de autoridad estricta:

$$\text{DECLARADO } (100) > \text{CATALOGO / EXTRAIDO } (80) > \text{CONOCIMIENTO } (60) > \text{PUBLICIDAD } (40) > \text{CONVERSACIONES } (30) > \text{INFERIDO } (10)$$

### Reglas Inviolables
1. **Inferencia subordinada**: Los datos inferidos por un modelo tienen autoridad mínima ($10$).
2. **Garantía factual de anuncios**: **Ningún dato inferido puede justificar un claim publicitario.** Todo precio, garantía o plazo de entrega anunciado en una creatividad debe provenir de fuentes con autoridad $\ge 60$ (`conocimiento`, `catalogo`, `declarado`).
3. **Prevalencia del dueño**: Lo declarado directamente por el cliente ($100$) prevalece incondicionalmente sobre cualquier extracción automática.

---

## 9. Overrides Humanos (`conservarCorreccionesPerfil`)

Para evitar que una reconstrucción automática borre las correcciones hechas por el dueño, `conservarCorreccionesPerfil(nuevo, viejo)` aplica una fusión a nivel de campo:

- Conserva entidades de `vende`, `ofertas` y `pruebas` cuya fuente sea `declarado`.
- Mantiene las modificaciones del dueño en `nombre`, `rubro`, `sitioWeb`, `ubicacion`, `cobertura`, `tipoNegocio`, `paletaColores`, `estiloVisual` y `elementosProhibidos`.
- Preserva la `prioridadActual`, `productosFoco` y `ofertasTemporales` del `MarketingProfile`.
- Une mediante unión de conjuntos (`Set`) las prohibiciones de `noAfirmar` viejas y nuevas.
- Mantiene el flag `editado = true` para auditoría y persistencia.

---

## 10. Temporalidad (`evaluarOfertasTemporales`)

Se introdujo el tipo `OfertaTemporal`:

```typescript
export type OfertaTemporal = {
  id: string;
  titulo: string;
  detalle: string;
  expiraEn: string; // ISO-8601 o YYYY-MM-DD
  activo: boolean;
  fuente: Fuente;
};
```

- La función `evaluarOfertasTemporales(ofertas, fechaReferencia)` compara la fecha de expiración contra el instante de evaluación.
- Si una oferta caducó, se conmuta a `activo: false`.
- Las proyecciones hacia el Estudio Creativo y el Campaign Architect **filtran rigurosamente solo las ofertas activas (`o.activo === true`)**. Una oferta vencida queda automáticamente excluida de cualquier copy o anuncio.

---

## 11. Invalidación y Detección de Staleness

Estrategia reactiva sin costo superfluo de inferencia:

1. **Cálculo de huella**: `fichas_hash = SHA-256(fichas.map(f => f.id + ":" + f.actualizado_en).sort().join("|"))`.
2. **Detección**: Al consultar el perfil, si el hash de las fichas en `ed_conocimiento` difiere del hash guardado en `ed_mk_contexto`, o si existen ofertas temporales caducadas pendientes de marcar, el estado se marca como `stale: true`.
3. **Reconstrucción JIT**: El perfil se actualiza en memoria incorporando los nuevos datos de conocimiento, pasando por `conservarCorreccionesPerfil` para salvaguardar cualquier override humano.
4. **Caché en memoria (10 min TTL)**: Reduce llamadas redundantes a la base de datos durante sesiones activas de usuario.

---

## 12. Brand Profile

Contexto de marca estructurado y conciso:

```typescript
export type BrandProfile = {
  logoUrl: string | null;
  paletaColores: {
    primario: string;
    secundario?: string;
    acento?: string;
    fondo?: string;
  } | null;
  estiloVisual: string | null;
  elementosProhibidos: string[];
};
```

- **Prohibiciones de marca**: La lista `elementosProhibidos` (ej. "mockups genéricos", "garantizar resultados de juicios") se transfiere automáticamente a `noAfirmar` en la proyección creativa, asegurando que tanto la generación de copy como de prompts visuales respete las restricciones deontológicas y corporativas.

---

## 13. UX Implementada (Progresiva: Prellenar $\to$ Confirmar $\to$ Corregir)

En lugar de abrumar al usuario con un cuestionario de 40 preguntas:

1. **Componente `ContextoUsado.tsx` Mejorado**:
   - Expone la pestaña/sección *"Prioridades de Marketing V1"* dentro del generador de creatividades.
   - Permite visualizar y editar en línea la **Prioridad Actual del Negocio**, los **Productos Foco**, el **Tipo de Negocio** y las **Restricciones de Marca**.
   - Lista las **Ofertas Temporales** distinguiendo con badges visuales las ofertas *Activas* de las *Vencidas*.
   - Botón *"Guardar cambios de marketing"* que invoca la server action `actualizarPerfilMarketingAccion`, persistiendo las modificaciones y refrescando el contexto sin recargar la página.
2. **Server Actions Nuevas (`app/(marketing)/marketing/creatividades/acciones.ts`)**:
   - `perfilMarketingAccion()`: Obtiene el `PerfilNegocioMarketing` canónico para la sesión activa.
   - `actualizarPerfilMarketingAccion(patch)`: Aplica overrides declarados por el usuario, actualiza `ed_mk_contexto` y revalida las rutas afectadas de Next.js.

---

## 14. Consumidores Migrados

Todos los módulos del ecosistema de marketing consumen ahora el perfil unificado:

| Archivo / Consumidor | Mecanismo de Migración | Estado |
|---|---|---|
| `lib/marketing/creatividades.ts` (`generarPaquete`) | Usa `obtenerPerfilMarketing` + `proyeccionCreative` | Migrado |
| `lib/marketing/arquitecto.ts` | Usa `obtenerPerfilMarketing` + `proyeccionArchitect` | Migrado |
| `lib/marketing/copiloto.ts` | Usa `obtenerPerfilMarketing` + `proyeccionCopiloto` | Migrado |
| `app/(marketing)/marketing/campanas/nueva/page.tsx` | Carga el perfil canónico para poblar productos foco y contexto | Migrado |
| `app/(marketing)/marketing/creatividades/page.tsx` | Lista chips desde `perfil.commercial.vende` | Migrado |
| `app/(marketing)/marketing/creatividades/nueva/page.tsx` | Inyecta `perfil` canónico al generador y `ContextoUsado` | Migrado |
| `lib/marketing/contextoMarca.ts` | Delegación completa: `proyeccionContextoMarca(perfil)` | Migrado |

---

## 15. Estado del Código Legacy

- **`contextoDeMarca()`**: Conservado como **adaptador de compatibilidad transparente**. Ya no ejecuta su propia lógica divergente de lectura ni arma un fixture demo incompatible; delega directamente a `obtenerPerfilMarketing(clienteId, demo)` y proyecta el resultado con `proyeccionContextoMarca()`.
- **`contextoComercialDemo()` y fixture demo de `contextoMarca`**: Unificados en `perfilMarketingDemo()` en `lib/marketing/perfilMarketingCore.ts`.
- **`promptCreativo` legacy**: Mantenido por retrocompatibilidad, consumiendo `proyeccionCreative(perfil)`.

---

## 16. Bugs del Master Context: Verificación y Cierre

### Bug A: Pérdida de Metadatos al Editar Creatividades
- **Problema original**: Al editar una creatividad en `EditorCreatividad.tsx`, se perdían `origen`, `texto_manual` y `estrategia`.
- **Solución implementada**:
  1. `EditorCreatividad.tsx` ahora conserva el `origen` de la creatividad.
  2. Detecta si el usuario modificó el titular, texto o concepto, estableciendo `textoManual = true`.
  3. Pasa `origen`, `textoManual` y `estrategia` a `guardarCreatividadAccion`.
  4. `lib/marketing/creatividades.ts` actualiza selectivamente dichos campos sin resetearlos a null.
- **Resultado**: CERRADO y cubierto con tests.

### Bug B: Guardado de URL de Visualización en vez del Puntero `sb:`
- **Problema original**: Al subir o reutilizar piezas en `GeneradorAnuncio.tsx`, se enviaba la URL `/api/marketing/imagen?r=...` al endpoint de guardado, haciendo que `rutaDeImagen` no reconociera el formato y guardara `imagen_url = null`.
- **Solución implementada**:
  1. `GeneradorAnuncio.tsx` almacena directamente el puntero canónico `r.puntero` (`sb:<path>`).
  2. `lib/marketing/imagenes.ts::rutaDeImagen` fue endurecido con decodificación de `decodeURIComponent` y validación estricta de regex para rutas de almacenamiento de Supabase (`/^[0-9a-f-]{8,}\/[0-9]+\.(jpg|png|webp)$/i`).
- **Resultado**: CERRADO y cubierto con tests de regresión unitarios.

---

## 17. Tests Nuevos

Se creó el archivo de pruebas de propiedades [`tests/personalizacion-marketing.test.mjs`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/tests/personalizacion-marketing.test.mjs) que valida de forma determinista:

1. **Un solo cerebro**: Idéntico catálogo de productos proyectado hacia Estudio Creativo, Arquitecto, Copiloto y ContextoMarca.
2. **Jerarquía de procedencia**: `DECLARADO (100) > CATALOGO (80) > CONOCIMIENTO (60) > PUBLICIDAD (40) > CONVERSACIONES (30) > INFERIDO (10)`.
3. **Prioridad sin pérdida**: Las prioridades de marketing sitúan los productos foco en primer lugar sin eliminar productos del catálogo.
4. **Expiración de ofertas temporales**: Una oferta vencida conmuta inmediatamente a `activo: false` y no llega a las proyecciones de creatividades.
5. **Preservación de overrides humanos**: Al reconstruir el perfil con nuevos datos automáticos, las correcciones humanas previas se conservan intactas.
6. **Aislamiento Customer Zero (Tenant Separation)**:
   - *Respondo* (SaaS B2B, Santiago, claims de software).
   - *Impresora Color* (Imprenta B2B, Chillán, productos físicos con precios exactos).
   - *AyP Abogados* (Servicios Jurídicos B2B, Concepción, prohibición deontológica de prometer resultados judiciales).
   - Comprobación de que no existe filtración ni solapamiento de prohibiciones ni vocabulario entre tenants.
7. **Resolución de Bug B**: Decodificación de punteros `sb:` tanto desde URI params como directos, y rechazo de rutas maliciosas o ajenas al tenant.
8. **Fixture de demostración canónico**: Verificación de coherencia del perfil de prueba unificado.

---

## 18. Suites Finales y Resultados de QA

```bash
# 1. Tests unitarios y de regresión (Node native test runner)
npm test
-> 961 passed, 0 failed, 0 skipped (duration: ~8.1s)

# 2. Comprobación estricta de tipos TypeScript
npx tsc --noEmit
-> 0 errores (código de salida 0)

# 3. Linter del proyecto
npm run lint
-> 0 errores (2 advertencias preexistentes en archivos ajenos al alcance)

# 4. Build de producción con Turbopack
npm run build
-> Compilado con éxito en 7.3s
-> TypeScript completado en 5.3s
-> Páginas estáticas y dinámicas generadas sin advertencias ni errores
```

---

## 19. Migraciones

Se generó el archivo de migración aditivo e idempotente:
[`sql/312_personalizacion_marketing.sql`](file:///c:/Users/marce/Claude/Projects/ChatBot%20Ventas/respondo-portal/sql/312_personalizacion_marketing.sql)

```sql
-- Migración 312: Columnas de estado e invalidación para Personalización de Marketing V1
-- Totalmente aditiva, idempotente y backward-compatible.
alter table public.ed_mk_contexto
  add column if not exists stale boolean not null default false,
  add column if not exists stale_motivo text,
  add column if not exists fichas_hash text;

create index if not exists ed_mk_contexto_cliente_stale_idx
  on public.ed_mk_contexto (cliente_id, stale);
```

- **Resiliencia ante ejecución pendiente**: Si el propietario aún no aplica la migración 312 en Supabase, el código detecta de forma transparente el error de columna faltante y continúa operando guardando y leyendo el perfil dentro de la columna JSONB `documento` existente de la migración 310. **Cero caída o degradación.**

---

## 20. Owner Actions Pendientes

1. **Aplicar Migración 312 en Supabase**:
   - Ejecutar el contenido de `sql/312_personalizacion_marketing.sql` en el SQL Editor de Supabase cuando sea oportuno operacionalmente. No es urgente gracias al fallback backward-compatible.
2. **Commit y Push Git**:
   - Una vez revisado este informe, el propietario puede crear el commit y realizar el push correspondiente.
3. **Validación Google Ads con Impresora Color**:
   - Realizar la prueba en vivo programada para mañana. Los proveedores de Ads (`lib/ads/google.ts`, `meta.ts`) se mantuvieron estrictamente inalterados para no contaminar dicha validación.

---

## 21. Riesgos Identificados y Mitigados

| Riesgo | Severidad | Mitigación Implementada |
|---|---|---|
| Inconsistencia entre pantallas de Marketing | Alta | Eliminada al forzar que todos los módulos consuman `PerfilNegocioMarketing` |
| Venta o anuncio de ofertas caducadas | Alta | `evaluarOfertasTemporales()` filtra en tiempo de ejecución las ofertas vencidas |
| Pérdida de cambios del dueño al regenerar contexto | Alta | `conservarCorreccionesPerfil()` preserva entidades con `fuente: "declarado"` y campos manuales |
| Guardado de imágenes rotas (`imagen_url = null`) | Media | Bug B cerrado: paso de punteros canónicos `sb:` y validación estricta de rutas |
| Sobrecarga de cómputo en LLM por cambios frecuentes en fichas | Media | Detección estática por hash SHA-256 de fichas; reconstrucción JIT bajo demanda |
| Cruce de restricciones entre negocios (Multi-tenant leak) | Crítica | Aislamiento por `cliente_id` estricto en persistencia y pruebas Customer Zero dedicadas |

---

## 22. Qué queda deliberadamente para V2

De acuerdo a las directrices explícitas de la misión, se postergó conscientemente para fases posteriores:
1. **Marketing Memory e Inteligencia Histórica de Rendimiento**: Aprendizaje autónomo a partir del ROAS o CPA histórico de campañas pasadas para recomendar creatividades ganadoras.
2. **Growth Advisor y Autopilot de Ads**: Automatización de presupuestos o ajuste automático de pujas.
3. **Ontología Compleja de Audiencias o CRM Integrado**: Mantener el foco en la personalización de marketing sin introducir modelos redundantes de clientes.
4. **Editor Visual de Diseño (tipo Canva)**: Mantener el Brand Profile enfocado en directrices semánticas y restricciones para la IA, sin complejidades de rendering visual en el cliente.

---

### Conclusión

La **Personalización Profunda de Marketing V1** se encuentra totalmente implementada, probada y verificada. Respondo ahora dispone de un único cerebro comercial, distingue formalmente lo declarado de lo inferido, respeta rigurosamente las prioridades dinámicas y restricciones de cada negocio, y garantiza una experiencia de usuario progresiva y confiable.
