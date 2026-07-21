# Respondo · Portal del cliente

Portal donde cada pyme cliente entra y ve a **sus empleados IA** trabajando
(Tino, Beto, Vera). Lee del schema `ed_` del **motor 2.0** (misma Supabase).
App separada de `respondo-hq` (panel interno de fundadores) — no lo toca.

**Estado:** MVP completo y verificado en local. Falta ponerlo en producción —
ver `docs/PUESTA_EN_PRODUCCION.md`.

## Rutas

| Ruta | Qué es |
|---|---|
| `/` | Redirige: con sesión a `/inicio`, sin sesión a `/login` |
| `/login` | Pedir enlace de acceso (sin contraseña) |
| `/inicio` | Bienvenida, métricas del mes vs basal, tarjeta por empleado |
| `/conversaciones` | Chats atendidos + pausar / tomar el control |
| `/probar` | Chat en vivo con el asistente, con datos reales del negocio |
| `/informacion` | Ver y editar lo que sabe el asistente + plantillas de rubro |
| `/estado` | Diagnóstico: variables de entorno + conexión a Supabase |
| `/sin-acceso` | Email autenticado pero no habilitado en `portal_usuarios` |
| `/auth/callback` | Enlace de acceso enviado por correo (flujo PKCE) |
| `/auth/verificar` | Enlace de acceso por `token_hash` (generado desde el admin) |

## Arquitectura

- **Next.js 14** (App Router) + **Vercel** (proyecto aparte).
- **Supabase** del motor 2.0. La llave secreta se usa **solo en el servidor**
  (`lib/db.ts`); nunca llega al navegador.
- **Multi-cliente por código:** toda consulta y toda escritura se filtra por el
  `cliente_id` del usuario logueado, resuelto vía `portal_usuarios`. Verificado:
  un cliente no ve ni puede modificar datos de otro.
- **Auth:** enlace de acceso de un solo uso (magic link) de Supabase.
- **RLS:** preparado en `sql/202_rls.sql`, pendiente de aplicar. Es una segunda
  barrera; el aislamiento hoy lo garantiza el código.

### Dos reglas que no hay que romper

1. **`lib/supabaseAuth.ts` (servidor) y `lib/supabaseNavegador.ts` no se juntan.**
   El primero importa `next/headers`; si un componente `"use client"` lo importa,
   Next falla al compilar. Ya pasó una vez.
2. **En las rutas de auth, la cookie de sesión se escribe sobre el objeto de
   respuesta del redirect**, no con `cookies()` de `next/headers`. Si no, la
   sesión se pierde al redirigir y el usuario vuelve al login sin ningún error
   visible. También pasó.

## Migraciones (en orden)

| Archivo | Qué hace |
|---|---|
| `respondo-2.0/motor/sql/100_empleados_digitales.sql` | Tablas del motor |
| `respondo-2.0/motor/sql/101_addendum_n8n.sql` | `ed_mensajes` y extras |
| `sql/200_portal.sql` | `portal_usuarios` |
| `sql/201_resultados_y_seed.sql` | `ed_contactos`, `ed_resultados` + seed demo |
| `sql/202_rls.sql` | Row Level Security ⚠️ **pendiente de aplicar** |

El 201 reemplaza el seed del 200 y es idempotente: se puede correr las veces que
haga falta.

## Puesta en marcha local

```
npm install
npm run dev
```

Necesita `.env.local` con las variables de `.env.example`. Si algo no carga,
`http://localhost:3000/estado` dice si es problema de variables o de conexión.

En Supabase → **Authentication → URL Configuration** deben estar:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/auth/callback` y
  `http://localhost:3000/auth/verificar`

## Datos demo

- **Estética Aurora**: Tino + Beto + Vera, 21 conversaciones, 4 escalaciones,
  33 resultados, métricas junio (basal) vs julio.
- **Barbería Nogal**: solo Tino, 3 conversaciones — sirve para comprobar que un
  cliente no ve los datos del otro.
- Logins: `aurora@demo.respondo.cl`, `nogal@demo.respondo.cl`,
  `hirespondo@gmail.com` y `marcelo.valdes.r@mail.pucv.cl` (→ Aurora).

Los dos clientes demo tienen IDs fijos (`1111…` y `2222…`) y se borran con una
línea de SQL sin tocar nada más.

### Entrar sin correo (cuando el envío está bloqueado)

Se puede generar un enlace desde la API admin de Supabase y abrirlo directo:

```
POST {SUPABASE_URL}/auth/v1/admin/generate_link
{"type":"magiclink","email":"...","options":{"redirect_to":"http://localhost:3000/auth/verificar"}}
```

Devuelve `hashed_token`; el enlace es
`/auth/verificar?token_hash=<token>&type=magiclink`. Es de un solo uso.

## Documentación

- `docs/PUESTA_EN_PRODUCCION.md` — SMTP, RLS, despliegue, checklist previo al
  primer cliente real.
- `docs/MOTOR_REGISTRO_RESULTADOS.md` — nodo de n8n para que el motor escriba en
  `ed_resultados` y `ed_contactos`. **Sin esto, las tarjetas de Beto y Vera
  muestran 0 en producción.**

## Notas para el equipo (2 personas)

- No hacer `git commit`/`build` desde el sandbox de Cowork: los archivos editados
  pueden verse truncados en el mount. Editar aquí, commitear tú.
- El deploy en Vercel es un **proyecto nuevo** — la CLI está enlazada al proyecto
  de respon-do.com y un deploy mal apuntado puede pisar la web viva.
- Los avatares de `public/brand/` son recortes de los robots FLUX de la web.
  El isotipo es una versión circular limpia: el archivo
  `Respondo_Isotipo_IndigoCoral.svg` de la web **no sirve**, es una lámina del
  manual de marca y se ve como cuadritos en tamaño chico.
