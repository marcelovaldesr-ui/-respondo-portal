# INFORME DE AUDITORÍA ADVERSARIAL INDEPENDIENTE
## RESPONDO — PERSONALIZACIÓN PROFUNDA DE MARKETING POR NEGOCIO V1
**Rol:** Auditor Adversarial Independiente (Read-Only / Escéptico)
**Fecha:** 15 de Septiembre de 2026
**Rama:** `main` (commit `69e98d1` base + cambios de personalización profunda)
**Veredicto Final:** **`C) NO APTO PARA PRODUCCIÓN`**

---

## RESUMEN EJECUTIVO Y VEREDICTO

Tras una inspección forense adversarial exhaustiva del código fuente, el grafo de dependencias, las mutaciones a base de datos y los flujos reales de ejecución, se concluye formalmente que la implementación de **Personalización Profunda de Marketing por Negocio V1** **NO ES APTA PARA PRODUCCIÓN** (`C`).

Aunque el constructor logró compilar TypeScript sin errores (0 errores) y mantener 961 tests pasando, la auditoría adversarial descubrió **siete (7) fallas de severidad crítica y alta**, destacando dos fallas arquitectónicas demoledoras:

1. **El Estudio Creativo 2.0 NO consume el Perfil de Marketing:** La afirmación central de la Fase 6 de que el Estudio Creativo (`/marketing/creatividades/nueva`) consume la proyección canónica `proyeccionCreative(perfil)` es **falsa en tiempo de ejecución**. `generarCopyAccion` (`acciones.ts:204`) y `generarImagenDirigidaAccion` (`acciones.ts:223`) ignoran el perfil y consumen `contextoComercial()` directamente. Ni las ofertas temporales, ni las prohibiciones de marca, ni la prioridad comercial llegan jamás al motor de IA generativo interactivo (`copy.ts` y `visualCore.ts`).
2. **Demolición del Perfil al Editar el Contexto:** Cuando un usuario guarda una corrección comercial estándar en `ContextoUsado.tsx`, se invoca `corregirContexto()`. Dicha función sobrescribe la columna JSONB `documento` con un objeto plano `ContextoComercial`, **destruyendo permanentemente** todas las claves `business`, `brand`, `marketing` e `invalidation` del registro en `ed_mk_contexto`.
3. **Zombificación de Datos Eliminados:** En `conservarCorreccionesPerfil`, vaciar un array intencionalmente (por ejemplo, `productosFoco = []`) o eliminar una prohibición de marca resucita automáticamente los valores predeterminados o inferidos mediante evaluaciones de veracidad (`.length` falsy y unión de `Set`).
4. **Desconexión Total de la Migración SQL 312:** Las columnas añadidas por la migración 312 (`stale`, `stale_motivo`, `fichas_hash`) **nunca son escritas ni leídas** por el código TypeScript. La invalidación opera exclusivamente dentro del JSONB `documento`. El índice `(cliente_id, stale)` indexa un valor por defecto inútil y la función `marcarPerfilStale()` es código muerto jamás invocado por el módulo de fichas (`/informacion`).
5. **Corte Prematuro de Ofertas por Huso Horario:** El parser de fechas en `evaluarOfertasTemporales` evalúa strings ISO `YYYY-MM-DD` como medianoche UTC (`00:00:00.000Z`), lo que en huso horario chileno (UTC-3 / UTC-4) desactiva las ofertas a las 21:00 o 20:00 del día anterior.

---

## 1. INVENTARIO REAL DEL DIFF

### Archivos Modificados (13 existentes en Git):
1. `app/(marketing)/marketing/campanas/nueva/page.tsx` (+2, -2): Inyecta `obtenerPerfilMarketing` y `proyeccionArchitect`.
2. `app/(marketing)/marketing/creatividades/acciones.ts` (+32, -1): Agrega `perfilMarketingAccion`, `actualizarPerfilMarketingAccion`, pero mantiene desconectados `generarCopyAccion` e `generarImagenDirigidaAccion`.
3. `app/(marketing)/marketing/creatividades/nueva/page.tsx` (+2, -1): Carga `obtenerPerfilMarketing` y lo pasa a `GeneradorAnuncio`.
4. `app/(marketing)/marketing/creatividades/page.tsx` (+2, -2): Reemplaza `contextoDeMarca` por `obtenerPerfilMarketing`.
5. `components/marketing/ContextoUsado.tsx` (+27, -5): Agrega display de `prioridadActual` y llamada condicional a `actualizarPerfilMarketingAccion`.
6. `components/marketing/EditorCreatividad.tsx` (+0, -0 / sin cambios funcionales).
7. `components/marketing/GeneradorAnuncio.tsx` (+3, -1): Recibe prop `perfil` pero solo lo transfiere a `<ContextoUsado>`.
8. `lib/marketing/arquitecto.ts` (+2, -2): Cambia llamada a `contextoDeMarca` por `proyeccionArchitect`.
9. `lib/marketing/contextoMarca.ts` (+16, -7): Se convierte en fachada que llama internamente a `obtenerPerfilMarketing`.
10. `lib/marketing/copiloto.ts` (+3, -3): Cambia llamada a `contextoDeMarca` por `proyeccionCopiloto`.
11. `lib/marketing/creatividades.ts` (+4, -2): Inyecta `proyeccionCreative` únicamente en `generarPaquete()` (pipeline legacy por lotes).
12. `lib/marketing/imagenes.ts` (+0, -0 / sin cambios de fondo).
13. `tests/estudio-2.test.mjs` (+1, -1): Ajuste menor de aserción.

### Archivos Nuevos Creados (Untracked):
1. `lib/marketing/perfilMarketingCore.ts` (401 líneas): Definición pura de tipos (`PerfilNegocioMarketing`, `BusinessProfile`, `BrandProfile`, `MarketingProfile`, `InvalidationState`), proyecciones canónicas (`proyeccionCreative`, `proyeccionArchitect`, `proyeccionCopiloto`), lógica de merge (`conservarCorreccionesPerfil`), expiración de ofertas y fixture demo.
2. `lib/marketing/perfilMarketing.ts` (340 líneas): Orquestador con I/O Supabase (`ed_mk_contexto`), caché en memoria (`MEMORIA_PERFIL` con TTL 10m), hashing de fichas (`calcularHashFichas`), e invalidación JIT.
3. `sql/312_personalizacion_marketing.sql` (42 líneas): DDL SQL para agregar `stale`, `stale_motivo`, `fichas_hash` e índice compuesto en `ed_mk_contexto`.
4. `tests/personalizacion-marketing.test.mjs` (240 líneas): Suite de 36 pruebas unitarias sobre `perfilMarketingCore.ts`.
5. Documentos: `MARKETING_PERSONALIZATION_MAP.md`, `MARKETING_PERSONALIZATION_V1_REPORT.md`, `ENTREGA_PERSONALIZACION_MARKETING_V1.md`.

---

## 2. ARQUITECTURA CONFIRMADA (LO QUE SÍ FUNCIONA)

1. **Unificación de Tipos Canónicos (`lib/marketing/perfilMarketingCore.ts`):**
   El modelo de datos unificado `PerfilNegocioMarketing` agrupa de manera limpia `business`, `brand`, `commercial`, `marketing` e `invalidation`.
2. **Fachada de Compatibilidad hacia Atrás (`lib/marketing/contextoMarca.ts`):**
   `contextoDeMarca()` delega en `obtenerPerfilMarketing(clienteId)` y `proyeccionContextoMarca(perfil)`, evitando romper consumidores históricos que dependían de la firma legacy.
3. **Integración con Arquitecto de Campañas (`lib/marketing/arquitecto.ts`):**
   `campanas/nueva/page.tsx` y `arquitecto.ts` consumen efectivamente `proyeccionArchitect(perfil)`, inyectando `ubicacion`, `cobertura`, `sitioWeb` y `tipoNegocio` en el prompt de arquitectura.
4. **Integración con Copiloto de Marketing (`lib/marketing/copiloto.ts`):**
   `sugerirAccionesMarketing` consume `proyeccionCopiloto(perfil)` y refleja las ofertas temporales activas en el resumen del copiloto.
5. **Fixtures Deterministas de Demostración:**
   `perfilMarketingDemo()` provee datos coherentes para navegación demo sin tocar I/O ni Supabase.

---

## 3. ARQUITECTURA REFUTADA (LO QUE NO OPERA EN LA PRÁCTICA)

1. **REFUTADO: "Estudio Creativo 2.0 consume la Proyección Creativa":**
   El constructor declaró que el Estudio Creativo 2.0 está conectado al perfil. En la realidad:
   - `GeneradorAnuncio.tsx` invoca la Server Action `generarCopyAccion(pedido)` sin pasar contexto.
   - `generarCopyAccion` (`acciones.ts:204`) no llama a `obtenerPerfilMarketing`.
   - `generarCopy` (`copy.ts:58`) obtiene el contexto mediante `await contextoComercial(...)`.
   - La función `proyeccionCreative(perfil)` **solo es llamada en `lib/marketing/creatividades.ts:120` (`generarPaquete`)**, que es el generador por lotes legacy calificado como código secundario/obsoleto.
2. **REFUTADO: "Invalidación JIT mediante Columnas SQL de Migración 312":**
   El constructor declaró un sistema reactivo donde la tabla `ed_mk_contexto` rastrea el estado de staleness mediante columnas SQL indexadas. En la realidad:
   - `guardarPerfilEnDb` y `actualizarPerfilMarketing` escriben exclusivamente en `documento` (JSONB) y `actualizado_en`. Jamás tocan las columnas `stale`, `stale_motivo` ni `fichas_hash`.
   - Las consultas leen `documento.invalidation.stale`, no la columna `stale`.
3. **REFUTADO: "Las Fichas invalidan el Perfil de Marketing":**
   `marcarPerfilStale()` está completamente desconectado de las acciones de fichas (`app/(portal)/informacion/acciones.ts`). Crear, editar, alternar o borrar fichas deja el perfil en caché intacto por 10 minutos sin invalidación.

---

## 4. BUGS CRÍTICOS (SEVERIDAD BLOQUEANTE)

### [BUG-CRIT-01] Desconexión Total del Perfil en Estudio Creativo 2.0 (Motor de Copy e Imagen)
- **Ubicación:**
  `app/(marketing)/marketing/creatividades/acciones.ts:198-234`
  `lib/marketing/copy.ts:51-59`
  `components/marketing/GeneradorAnuncio.tsx:166-197`
- **Mecanismo:**
  La interfaz gráfica del Estudio Creativo (`GeneradorAnuncio.tsx`) genera copys llamando a `generarCopyAccion(pedido)`. La Server Action llama a `generarCopy(usuario.clienteId, pedido, { demo })` omitiendo el parámetro opcional `contexto`. En `copy.ts`, la función recurre a:
  ```ts
  const c = opciones.contexto ?? (await contextoComercial(clienteId, { demo: opciones.demo })).contexto;
  ```
  Esto invoca al motor anterior `contextoComercial()`, el cual **no contiene** `proyeccionCreative()`. De igual forma, `generarImagenDirigidaAccion` (línea 223) invoca directamente a `contextoComercial()`.
- **Impacto Real en Producción:**
  - Las `ofertasTemporales` del negocio **nunca** se envían al prompt del copy ni de la imagen.
  - Los `elementosProhibidos` de marca **nunca** se agregan a `noAfirmar` en la generación de copy.
  - La `prioridadActual` **nunca** se inyecta en los diferenciadores.
  - La reordenación de productos por `productosFoco` **nunca** ocurre en los anuncios del Estudio Creativo 2.0.

### [BUG-CRIT-02] Demolición y Borrado del Perfil de Marketing al Guardar Contexto Comercial
- **Ubicación:**
  `components/marketing/ContextoUsado.tsx:80-95`
  `lib/marketing/contextoComercial.ts:299-318`
  `lib/marketing/perfilMarketing.ts:169-174`
- **Mecanismo:**
  Cuando un usuario entra a `ContextoUsado.tsx` y corrige qué vende su negocio o su audiencia, se ejecuta `corregirContextoAccion(fusionado)`. Esta función llama a `corregirContexto()` en `contextoComercial.ts`, la cual ejecuta:
  ```ts
  const cuerpo = {
    documento: contexto as unknown as Record<string, unknown>,
    editado: true,
    actualizado_en: new Date().toISOString(),
  };
  await modificarEn(clienteId, TABLA, fila.id, cuerpo);
  ```
  `contexto` es una instancia plana de `ContextoComercial`. Al persistir, **reemplaza completamente** el JSONB `documento` en la base de datos, eliminando las ramas `business`, `brand`, `marketing` e `invalidation`.
  En la siguiente recarga, `obtenerPerfilMarketing` evalúa:
  ```ts
  if (doc.business && doc.commercial && doc.marketing) {
    perfilExistente = doc as unknown as PerfilNegocioMarketing;
  }
  ```
  Al no existir estas claves, `perfilExistente` es evaluado como `null`, forzando una reconstrucción desde cero y **borrando todas las configuraciones previas de marca, ofertas temporales y prioridades**.

### [BUG-CRIT-03] Zombificación Indestructible de Datos por Falibilidad de Merge
- **Ubicación:**
  `lib/marketing/perfilMarketingCore.ts:141, 147-150`
- **Mecanismo:**
  En `conservarCorreccionesPerfil`:
  ```ts
  elementosProhibidos: Array.from(new Set([...(viejo.brand.elementosProhibidos ?? []), ...(nuevo.brand.elementosProhibidos ?? [])])),
  productosFoco: viejo.marketing.productosFoco.length ? viejo.marketing.productosFoco : nuevo.marketing.productosFoco,
  ```
  1. Si un usuario decide eliminar una prohibición por defecto (ej. permitir "mockups con texto inventado"), la unión de sets (`new Set([...viejo, ...nuevo])`) vuelve a insertar inmediatamente el elemento proveniente de `nuevo`.
  2. Si el usuario vacía intencionalmente `productosFoco` asignando `[]`, la comprobación `viejo.marketing.productosFoco.length` evalúa a `0` (falsy), provocando que resucite automáticamente la lista inferida de `nuevo.marketing.productosFoco`.

---

## 5. BUGS IMPORTANTES (SEVERIDAD ALTA)

### [BUG-IMP-01] Corte Prematuro de Ofertas Temporales por Desfase de Zona Horaria (DST / Off-by-One)
- **Ubicación:** `lib/marketing/perfilMarketingCore.ts:95-106`
- **Mecanismo:**
  ```ts
  const expTime = new Date(o.expiraEn).getTime();
  const caduco = !isNaN(expTime) && expTime < refTime;
  ```
  Al almacenar fechas de vencimiento en formato estándar `YYYY-MM-DD` (ej. `"2026-09-30"`), el constructor `new Date("2026-09-30")` interpreta la fecha en medianoche UTC (`2026-09-30T00:00:00.000Z`). En Chile (UTC-3 / UTC-4), esto corresponde a las **21:00 o 20:00 del 29 de septiembre**. La oferta se apaga antes de que comience el 30 de septiembre en horario local.

### [BUG-IMP-02] Columnas SQL de Migración 312 Huérfanas y Desconectadas
- **Ubicación:** `sql/312_personalizacion_marketing.sql:28-41`, `lib/marketing/perfilMarketing.ts:251-260`
- **Mecanismo:**
  La migración 312 altera la tabla `ed_mk_contexto` agregando `stale`, `stale_motivo`, `fichas_hash` y un índice. Sin embargo, `guardarPerfilEnDb()` únicamente persiste:
  ```ts
  const cuerpo = {
    documento: documentoFusionado,
    editado: perfil.editado,
    actualizado_en: new Date().toISOString(),
  };
  ```
  Las columnas SQL permanecen siempre con sus valores por defecto (`false`, `NULL`). El índice `ed_mk_contexto_cliente_stale_idx` indexa filas inertes y jamás es utilizado por ninguna consulta.

### [BUG-IMP-03] Función de Invalidación de Fichas Desconectada (`marcarPerfilStale`)
- **Ubicación:** `lib/marketing/perfilMarketing.ts:310-331`, `app/(portal)/informacion/acciones.ts`
- **Mecanismo:**
  `marcarPerfilStale` está exportada pero **nadie la llama en todo el repositorio**. Cuando un usuario crea, edita, desactiva o elimina una ficha en `/informacion`, solo se invoca `revalidatePath("/informacion")`. El perfil en memoria en `perfilMarketing.ts` retiene el estado viejo durante el TTL completo de 10 minutos.

### [BUG-IMP-04] Hash Incompleto de Fichas Ignora Modificaciones de Contenido
- **Ubicación:** `lib/marketing/perfilMarketing.ts:37-43` (`calcularHashFichas`)
- **Mecanismo:**
  ```ts
  const firmas = fichas.map((f) => `${f.id}:${f.actualizado_en ?? ""}:${f.titulo}`).sort().join("|");
  ```
  La huella digital de las fichas excluye deliberadamente `f.contenido`. Si el contenido de una ficha se actualiza sin modificar el título (o si el entorno no actualiza `actualizado_en`), el hash resultante es idéntico y el cambio pasa inadvertido para el detector de staleness.

### [BUG-IMP-05] Vulnerabilidad de Asignación Masiva en Server Action
- **Ubicación:** `app/(marketing)/marketing/creatividades/acciones.ts:298-307`
- **Mecanismo:**
  `actualizarPerfilMarketingAccion` recibe un objeto arbitrario `parcial` sin validación de esquema en tiempo de ejecución (Zod u homólogo). Cualquier cliente con sesión puede inyectar campos no autorizados o alterar atributos internos como `whatsappConectado` a través de mutaciones no saneadas.

---

## 6. BUGS MENORES Y OMISIONES COSMÉTICAS

1. **Jerarquía de Autoridad Declarada pero Inutilizada:**
   `AUTORIDAD` se declara como mapa de constantes numéricas (100, 80, 60, 40), pero no existe en el código ninguna comparación lógica (`if (a > b)`) que use dichos valores.
2. **Atributos de Marca sin Consumo:**
   `brand.logoUrl` y `brand.paletaColores` se almacenan en el perfil pero no son consumidos en ningún prompt ni componente de generación de imágenes o copy.
3. **Falta de Invalidación de Memoria Cruzada:**
   `corregirContexto()` invalida `EN_MEMORIA` de `contextoComercial.ts`, pero no invalida `MEMORIA_PERFIL` en `perfilMarketing.ts`.

---

## 7. PRUEBAS ADVERSARIALES REALIZADAS

### Test 1: Comprobación de Consumidores Reales de `proyeccionCreative`
- **Comando:** Búsqueda ripgrep de `proyeccionCreative` en todo el repositorio.
- **Resultado:**
  - Encontrado en: `lib/marketing/creatividades.ts:120` (`generarPaquete`).
  - Encontrado en: `tests/personalizacion-marketing.test.mjs`.
  - Ausente en: `lib/marketing/copy.ts` (`generarCopy`).
  - Ausente en: `lib/marketing/visualCore.ts` y `imagenes.ts`.
  - Ausente en: `app/(marketing)/marketing/creatividades/acciones.ts` (`generarCopyAccion`).
- **Conclusión Adversarial:** El pipeline interactivo de anuncios opera 100% sobre el contexto legacy.

### Test 2: Simulación de Sobrescritura de Perfil por `corregirContexto`
- **Ejecución:** Simulación Node del flujo `corregirContexto` seguido de `obtenerPerfilMarketing`.
- **Resultado:** El objeto devuelto por la base de datos pierde las claves `business`, `brand`, `marketing`, regresando `perfilExistente = null`.
- **Conclusión Adversarial:** Confirmada la demolición de configuraciones avanzadas al editar el contexto básico.

### Test 3: Simulación de Caducidad de Ofertas en Huso Horario Chileno
- **Código evaluado:**
  ```javascript
  const fechaChile = new Date("2026-09-29T21:30:00-03:00");
  const expiraEn = "2026-09-30";
  const caduco = new Date(expiraEn).getTime() < fechaChile.getTime();
  console.log("¿Caducó?", caduco); // true
  ```
- **Resultado:** `true`.
- **Conclusión Adversarial:** La oferta se apaga el 29 de septiembre a las 21:00 CLT, perdiendo más de 27 horas de vigencia real.

---

## 8. CACHÉ Y STALENESS

| Componente | Implementación Real | Veredicto Adversarial |
| :--- | :--- | :--- |
| **TTL en Memoria** | `Map<string, { perfil, hasta }>` con 10 min | **Frágil:** Mientras esté en memoria, no consulta BD ni fichas, impidiendo ver cambios inmediatos. |
| **Detección JIT** | Compara `fichasHash` al consultar BD | **Roto:** Excluye `f.contenido` y no se dispara durante el TTL en memoria. |
| **Invalidación Reactiva** | `marcarPerfilStale()` | **Inexistente:** Ninguna acción de fichas invoca esta función. |

---

## 9. OVERRIDES Y ZOMBIFICACIÓN

La función `conservarCorreccionesPerfil` implementa un modelo de fusión con graves sesgos de veracidad (truthiness):
- Los arrays vacíos `[]` son evaluados mediante `.length`, interpretando el vaciado intencional como "ausencia de corrección" y restaurando el valor previo.
- La unión de conjuntos para `elementosProhibidos` hace que cualquier elemento removido por el usuario sea reinyectado si figura en los valores por defecto del sistema.

---

## 10. PROVENANCE: REAL VS DECLARADA

La documentación del constructor promete una arquitectura de "provenance rigurosa" con pesos de autoridad ponderados.
**Realidad forense:** Es un constructo meramente retórico. El campo `fuente` es un string informativo (`"declarado"` vs `"fichas"`). No existe ningún cálculo, ponderación ni resolución algorítmica de conflictos de autoridad.

---

## 11. TENANT ISOLATION (AISLAMIENTO MULTI-INQUILINO)

- **Veredicto:** **APROBADO CON SALVEDADES**.
- Las consultas en `perfilMarketing.ts` aplican `exigirId(clienteId)` y filtran estrictamente por `clienteId` en `leerDe`, `modificarEn` e `insertarEn`.
- La memoria en caché utiliza claves aisladas por `clienteId`.
- **Salvedad:** La falta de validación de esquema en `actualizarPerfilMarketingAccion` permite inyectar datos anómalos dentro del tenant del usuario autenticado.

---

## 12. MIGRACIÓN 312 Y DESCONEXIÓN SQL

La migración `312_personalizacion_marketing.sql` es un cascarón desconectado:
1. `stale`: Definida en SQL con default `false`. El código TypeScript jamás realiza un `UPDATE ed_mk_contexto SET stale = ...`.
2. `stale_motivo`: Nunca escrito por el código.
3. `fichas_hash`: Nunca escrito por el código en la columna dedicada.
4. `ed_mk_contexto_cliente_stale_idx`: Índice no aprovechable, pues las consultas buscan únicamente por `cliente_id`.

---

## 13. AUDITORÍA ESPECÍFICA CREATIVE A Y B

- **Creative A (`generarPaquete`):** Consume `proyeccionCreative(perfil)`. Sin embargo, es un pipeline residual utilizado casi exclusivamente por sugerencias por lotes en segundo plano.
- **Creative B (`generarCopy` / Estudio 2.0):** **Completamente desconectado.** Consume `contextoComercial()`. Todas las nuevas capacidades de personalización profunda quedan inertes en la pantalla principal del Estudio Creativo.

---

## 14. UX REALMENTE DISPONIBLE

En la interfaz de usuario (`ContextoUsado.tsx`), lo único que el usuario puede editar del perfil de marketing es:
- **Prioridad comercial actual** (`prioridadActual`).

**Campos invisibles y sin controles en la interfaz:**
- `productosFoco` (no editable).
- `tipoNegocio` (b2b / b2c) (no editable).
- `elementosProhibidos` (no editable).
- `paletaColores` y `estiloVisual` (no editable).
- `ofertasTemporales` (no editable; no hay UI para crear promociones con fecha).
- `canalesPreferidos` y `metaConversion` (no editable).

---

## 15. RIESGOS DE PRODUCCIÓN

1. **Inconsistencia y Decepción de Clientes:** Negocios que configuren ofertas temporales o prioridades verán que sus anuncios generados en el Estudio Creativo las ignoran por completo.
2. **Pérdida Silenciosa de Datos:** Cualquier corrección menor de texto en el Estudio borrará el perfil completo en Supabase.
3. **Publicidad Errónea por Expiración Anticipada:** Promociones de fin de mes dejarán de emitirse horas antes de su culminación comercial por el fallo de UTC.

---

## 16. ARCHIVOS PROBLEMÁTICOS

| Archivo | Líneas | Defecto Exacto |
| :--- | :--- | :--- |
| `app/(marketing)/marketing/creatividades/acciones.ts` | 204, 223 | `generarCopyAccion` e `generarImagenDirigidaAccion` no llaman al perfil ni pasan `proyeccionCreative`. |
| `lib/marketing/copy.ts` | 58 | Recurre a `contextoComercial()` ignorando el perfil de marketing. |
| `components/marketing/ContextoUsado.tsx` | 80-95 | Llama a `corregirContextoAccion` destruyendo las propiedades de marketing en `documento`. |
| `lib/marketing/contextoComercial.ts` | 309-316 | `corregirContexto` sobrescribe `documento` con un objeto plano sin `business`/`brand`/`marketing`. |
| `lib/marketing/perfilMarketingCore.ts` | 102-104 | `new Date(expiraEn)` en formato `YYYY-MM-DD` produce UTC medianoche, cortando ofertas horas antes en Chile. |
| `lib/marketing/perfilMarketingCore.ts` | 141, 147 | Sets unions y truthiness impiden eliminar prohibiciones o vaciar productos foco. |
| `lib/marketing/perfilMarketing.ts` | 251-260 | `guardarPerfilEnDb` no escribe las columnas SQL de la migración 312 (`stale`, `fichas_hash`). |
| `app/(portal)/informacion/acciones.ts` | 33, 50, 75 | No invoca `marcarPerfilStale` al mutar fichas de conocimiento. |

---

## 17. RECOMENDACIONES MÍNIMAS DE CORRECCIÓN

1. **Conectar el Estudio Creativo 2.0:**
   En `app/(marketing)/marketing/creatividades/acciones.ts:204`, obtener el perfil con `obtenerPerfilMarketing`, proyectarlo con `proyeccionCreative(perfil)` y enviarlo a `generarCopy(..., { contexto: creativeCtx })`.
2. **Prevenir la Destrucción del Perfil en `corregirContexto`:**
   Modificar `corregirContexto` en `lib/marketing/contextoComercial.ts` para que lea el documento existente y preserve las claves `business`, `brand`, `marketing` e `invalidation` al guardar.
3. **Corregir Expiración por Fecha Local:**
   Tratar los strings de fecha `YYYY-MM-DD` fijando la expiración a las 23:59:59.999 del día indicado en la zona horaria del cliente (o `T23:59:59` local).
4. **Sincronizar Columnas SQL 312:**
   Actualizar `guardarPerfilEnDb` para escribir explícitamente en las columnas `stale`, `stale_motivo` y `fichas_hash`.
5. **Conectar Acciones de Fichas:**
   Llamar a `marcarPerfilStale(clienteId, ...)` en las Server Actions de `app/(portal)/informacion/acciones.ts`.

---

## 18. ACCIONES DEL PROPIETARIO (OWNER ACTIONS)

- 🛑 **NO APLICAR la migración `312_personalizacion_marketing.sql` en Supabase todavía.**
  Las columnas no son consumidas por el código actual y su aplicación temprana carece de efecto útil hasta que el código escriba en ellas.
- 🛑 **NO REALIZAR COMMIT NI PUSH del estado actual.**
  El código contiene regresiones destructivas de datos y desconexión funcional en el generador de anuncios.
- ✅ **DELEGAR REMEDIACIÓN INMEDIATA:**
  Exigir al constructor subsanar los bugs críticos `BUG-CRIT-01`, `BUG-CRIT-02` y `BUG-CRIT-03` antes de reconsiderar el despliegue.

---

## VEREDICTO FINAL

### **`C) NO APTO PARA PRODUCCIÓN`**
*Fundamento:* La funcionalidad estrella (personalización de anuncios en Estudio Creativo) no está conectada al nuevo perfil de marketing en su ruta de ejecución interactiva principal, y la edición normal de contexto destruye silenciosamente los datos avanzados en la base de datos.
