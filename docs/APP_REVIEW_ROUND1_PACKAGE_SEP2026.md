# Meta App Review · Ronda 1 · Paquete completo
App **Respondo Ads** (`1771222117337476`) · portafolio dueño: Respondo (`1267084588712153`) · 22-sep-2026
**Estado: PREPARADO — NO ENVIADO.** Se envía solo con la confirmación final de Marcelo.

Permisos de esta ronda: `business_management`, `ads_read`, `pages_show_list`, `pages_read_engagement`.
Fuera de esta ronda: `ads_management` (DIFERIDO, ver el final del documento).

---

## 1. Usuario revisor (mínimo privilegio)
| Punto | Definición |
|---|---|
| Correo | **Gmail nuevo y exclusivo**, sugerido `respondo.metareview@gmail.com`. No el PUCV. |
| Tenant | **Respondo Demo** (`88888888-8888-8888-8888-888888888888`). Vacío: sin WhatsApp, Instagram, conversaciones ni clientes. Única ficha: descripción pública de Respondo y sitio `https://respon-do.com`. |
| Rol | `dueno`. Es el único rol del portal que abre **Marketing** (`generar_insights`) e **Integraciones** (`gestionar_integraciones`); `staff` no alcanza. El privilegio queda acotado por el **tenant vacío**: no hay conversaciones privadas ni datos de otros negocios, y el portal filtra todo por tenant. |
| Otros tenants | Ninguno. El usuario queda amarrado a un solo `cliente_id`. |
| Administración global | No existe en el portal. RespondoHQ es otra app con otro login. |
| Acceso a Meta | Ninguno directo. Por el portal solo ve lo que la conexión lee (cifras en cero y el nombre público de la Página). No recibe rol en el portafolio Cecilia Roa. |
| Pantallas que usa | Marketing → Integraciones; Analizar → Campañas; Armar a mano (`/marketing/campanas/nueva`) hasta el modal de vista previa. |
| Login | El portal entra **solo con enlace mágico**. Meta necesita el correo **y la contraseña del Gmail** para abrir el enlace. |
| Al terminar la revisión | Desactivar el usuario (`portal_usuarios.activo = false`) y desconectar Meta en Respondo Demo. |

**Estado actual:** `revision.respondo@gmail.com` quedó **desactivado** (nadie tiene ese buzón). `marcelo.valdes.r@mail.pucv.cl` está **temporalmente** en Respondo Demo para grabar.

## 2. Datos del tenant de revisión
- Datos: solo 2 fichas de conocimiento con texto público de Respondo. **Cero** conversaciones, clientes, pagos o citas.
- Meta: conectado al portafolio **Cecilia Roa**, porque es el único portafolio que no es dueño de la app y se puede conectar por Business Login. Cuenta publicitaria `act_1625722292606602`, que **nunca ha pautado**; Página pública "Impresora color".
- Guardado por el callback real: `businessId 1787484115580896`, `paginaId 1439127932606268`, cuenta y moneda. Verificado en la base el 22-sep.
- No se usa ningún dato de Impresora Color salvo el **nombre público de su Página** y una cuenta publicitaria vacía.

---

## 3. Paquete permiso por permiso

### 3.1 `business_management`
- **USE CASE:** conectar el portafolio empresarial del negocio y saber a qué portafolio pertenece la cuenta publicitaria que compartió.
- **WHY RESPONDO NEEDS IT:** un mismo dueño suele administrar más de un portafolio. Respondo guarda por negocio qué portafolio es el dueño de la cuenta, para que los informes y campañas de un negocio no se mezclen con los de otro.
- **EXACT PRODUCT SCREEN:** Marketing → **Integraciones** → tarjeta **Meta Ads**.
- **EXACT USER ACTION:** Conectar → elegir portafolio → Confirmar → Finalizar.
- **WHAT META DATA IS READ:** `business{id,name}` de la cuenta publicitaria compartida (`GET /me/adaccounts?fields=...,business{id,name}`).
- **WHAT RESPONDO DOES WITH IT:** guarda `businessId` y `businessNombre` en la conexión de ese negocio y muestra la fila **"Portafolio"** en la tarjeta.
- **WHY IT FAILS WITHOUT IT:** Meta no devuelve el campo `business` de la cuenta. La fila "Portafolio" queda vacía y Respondo no puede separar negocios por portafolio.
- **REVIEWER STEPS:** iniciar sesión → Marketing → Integraciones → Meta Ads → Conectar → elegir portafolio y cuenta → Confirmar → Finalizar.
- **EXPECTED RESULT:** aviso "Cuenta publicitaria conectada" y la tarjeta muestra Cuenta, **Portafolio**, moneda y zona horaria.

### 3.2 `ads_read`
- **USE CASE:** mostrarle al dueño el rendimiento de su propia cuenta publicitaria dentro de Respondo.
- **WHY RESPONDO NEEDS IT:** el centro de marketing pone el costo de los anuncios al lado de los resultados del negocio (conversaciones, ventas).
- **EXACT PRODUCT SCREEN:** Integraciones (fila **"Última lectura"**) y **Analizar → Campañas** (tarjetas **Campañas activas**, **Invertido** y la tabla).
- **EXACT USER ACTION:** abrir esas pantallas. La lectura ocurre al cargar.
- **WHAT META DATA IS READ:** campañas (`/{act}/campaigns`: id, nombre, estado, objetivo, presupuesto) e insights (`/{act}/insights`: gasto, impresiones, clics, resultados) de los últimos 30 días.
- **WHAT RESPONDO DOES WITH IT:** los muestra en pantalla en la moneda de la cuenta. No guarda una copia histórica propia.
- **WHY IT FAILS WITHOUT IT:** Meta rechaza `/insights` y `/campaigns`. La fila "Última lectura" queda en "—" con un aviso de permisos, y Campañas no muestra datos de Meta.
- **REVIEWER STEPS:** con Meta conectado → Integraciones (ver "Última lectura") → Analizar → Campañas.
- **EXPECTED RESULT:** "Última lectura: 0 anuncios · 30 días" y en Campañas, **Invertido $0** y "Todavía no hay campañas". **La cuenta de demostración nunca ha pautado; los ceros son el valor real que devuelve la API**, no un error ni un dato inventado.

### 3.3 `pages_show_list`
- **USE CASE:** encontrar la Página de Facebook del negocio y vincularla a su espacio en Respondo.
- **WHY RESPONDO NEEDS IT:** los anuncios de Meta salen a nombre de una Página. Respondo necesita saber cuál es la del negocio sin pedir que el dueño copie IDs a mano.
- **EXACT PRODUCT SCREEN:** Integraciones → tarjeta Meta Ads → fila **"Página"**.
- **EXACT USER ACTION:** conectar Meta. El descubrimiento ocurre en el callback de la conexión.
- **WHAT META DATA IS READ:** `GET /me/accounts?fields=id,name,instagram_business_account{id,username}`.
- **WHAT RESPONDO DOES WITH IT:** si hay una sola Página, la vincula; si hay varias, guarda la lista para elegir. Muestra el nombre en la tarjeta.
- **WHY IT FAILS WITHOUT IT:** `/me/accounts` no devuelve Páginas. La fila dice "Sin vincular todavía" y Respondo no sabe con qué identidad publicaría el negocio.
- **REVIEWER STEPS:** conectar Meta → mirar la fila "Página".
- **EXPECTED RESULT:** "Página: Impresora color", o el nombre de la Página del revisor.

### 3.4 `pages_read_engagement`
- **USE CASE:** antes de publicar una campaña, mostrarle al dueño con qué Página (nombre y foto) va a salir el anuncio.
- **WHY RESPONDO NEEDS IT:** evitar publicar con la identidad equivocada, sobre todo cuando el dueño administra más de un negocio. La foto de perfil y los metadatos de la Página son lo que cubre este permiso; `pages_show_list` solo entrega la lista.
- **EXACT PRODUCT SCREEN:** Marketing → **Armar a mano** → paso **8 · Revisión** → **Publicar en Meta Ads** → modal de vista previa, bloque **"Se publicará como"**.
- **EXACT USER ACTION:** abrir la vista previa de publicación de un borrador.
- **WHAT META DATA IS READ:** `GET /{page-id}?fields=id,name,link,picture.type(large){url}`.
- **WHAT RESPONDO DOES WITH IT:** muestra la foto de perfil, el nombre y el ID de la Página en la vista previa. No lo guarda.
- **WHY IT FAILS WITHOUT IT:** Meta no devuelve la foto ni los metadatos de la Página. La vista previa no puede mostrar la identidad del anuncio y cae al nombre guardado, sin foto.
- **REVIEWER STEPS:** Armar a mano → llenar el borrador (objetivo, presupuesto, titular y texto) → Revisión → Publicar en Meta Ads → mirar "Se publicará como" → **Cancelar**.
- **EXPECTED RESULT:** foto y nombre de la Página vinculada en el bloque "Se publicará como".
- **Nota honesta:** el modal tiene un botón "Confirmar" que crea la campaña en pausa; eso usa `ads_management`, que **no se pide en esta ronda**. El revisor no necesita apretarlo.

---

## 4. Review copy (pegar en el formulario, inglés)

**App description / general notes for the reviewer**
> Respondo is a SaaS platform for small businesses in Chile. Each business has its own workspace. In the Marketing section, the owner connects their own Meta assets with Facebook Login for Business and sees their ad performance next to their business results. This request covers read access only: which Business Portfolio owns the shared ad account (business_management), the ad account's campaigns and insights (ads_read), the Pages the person manages (pages_show_list), and the linked Page's name and profile picture (pages_read_engagement). Test login: [GMAIL] / [PASSWORD] at https://respondo-portal.vercel.app (the portal sends a one-time sign-in link to that inbox). The demo workspace is already connected to a test ad account that has never run ads, so all values shown are real zeros.

**business_management**
> We use Facebook Login for Business so the business owner selects the Business Portfolio and ad account to share. With business_management we read which Business Portfolio owns that ad account and store it per client, so each client's reports and campaigns stay tied to the correct portfolio. We do not modify business settings, users or assets. Where to see it: Marketing → Integraciones → Meta Ads card, "Portafolio" row.

**ads_read**
> We show each business the performance of its own Meta ads inside Respondo: campaigns, status, budget, spend, impressions, clicks and results for the ad account it connected. Data is read live when the page opens, shown only to that business, and not stored as a separate copy. Where to see it: Marketing → Integraciones ("Última lectura" row) and Analizar → Campañas. The demo ad account has never run ads, so the API returns zeros.

**pages_show_list**
> We list the Pages the person manages to link the business's own Page to its Respondo workspace, so the owner never has to copy Page IDs by hand. Where to see it: Marketing → Integraciones → Meta Ads card, "Página" row.

**pages_read_engagement**
> Before any campaign is published, we read the linked Page's name, link and profile picture to show the owner, in the publishing preview, which Page the ad will run under. This prevents publishing with the wrong identity when a person manages several businesses. Where to see it: Marketing → Armar a mano → step 8 → "Publicar en Meta Ads" → "Se publicará como" block. (Publishing itself is not part of this request.)

---

## 5. Manejo de datos (Data Handling Questions)
| Pregunta de Meta | Respuesta propuesta | Estado |
|---|---|---|
| ¿Hay procesadores o proveedores con acceso a datos de la plataforma? | **Sí**: Supabase (base de datos; guarda la conexión con el token cifrado AES-256-GCM), Vercel (hosting de la app) y **Google Gemini** (recibe métricas y textos de campaña ya derivados para las sugerencias de IA; nunca tokens). Es lo mismo que declara la política de privacidad. | Verificado en el código |
| Entidad responsable y país | Razón social y RUT de Respondo (o persona natural), Chile. | **OWNER INPUT** |
| ¿Entregaron datos personales a autoridades en los últimos 12 meses? | Probablemente "No". | **OWNER INPUT** |
| Políticas ante solicitudes de autoridades | Marcar **solo** lo que exista de verdad. Si no hay un proceso formal, no marcar casillas que no se cumplan. | **OWNER INPUT** |

## 6. Política de privacidad
- **URL:** https://respondo-portal.vercel.app/privacidad (pública, actualizada el 21-sep-2026).
- Cubre: token de Meta cifrado, datos de campañas leídos en vivo, Gemini como único tercero con datos derivados, borrado al desconectar y contacto hirespondo@gmail.com.
- **Revisar en la consola de la app** (no lo pude confirmar hoy porque el navegador se desconectó): en Configuración → Básica, que "URL de la política de privacidad" apunte a esa dirección y que exista una **URL de instrucciones para eliminar datos** (sirve la misma página, sección 6).

## 7. ADS_MANAGEMENT — DIFERIDO (NEXT META GATE)
- El publicador real (`lib/ads/metaPublicar.ts`) queda **intacto**: sin reimplementaciones ni workarounds.
- Bloqueos confirmados el 22-sep:
  - En la cuenta del cliente, la app recibe solo ANALYZE (code 200 / subcode 2490585, fbtrace `AL6Z-fMXB-7nB1gCoFPagTo`).
  - La cuenta propia no se puede usar: Business Login deshabilita el portafolio dueño de la app ("This Meta Business Account owns the app").
- **Volver a probar cuando** el Marketing API Access Tier salga de "Acceso limitado" y/o Meta conceda el acceso correspondiente:
  - Prueba: Campaign → AdSet → Creative → Ad, todo en PAUSED, desde el portal, con una cuenta de cliente autorizada.
  - Recién entonces preparar la ronda 2 (`ads_management`).
