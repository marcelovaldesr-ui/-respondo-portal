# Puesta en producción del portal

Todo lo que falta para entregarle el portal a un cliente real, en orden.
Cada paso dice cuánto demora y qué se rompe si se salta.

---

## 1. SMTP propio (bloqueante)

**Por qué:** el correo integrado de Supabase permite muy pocos envíos por hora
y no está pensado para producción. Ya te topaste con el error
`email rate limit exceeded`. Sin esto, tus clientes no pueden entrar.

**Qué hacer** (~10 minutos):

1. Crear cuenta en [resend.com](https://resend.com) — el plan gratis cubre
   3.000 correos al mes, de sobra.
2. Verificar el dominio `respon-do.com` en Resend (te pide agregar unos
   registros DNS donde tengas el dominio). Sin dominio verificado solo puedes
   enviar a tu propio correo.
3. Crear una API key en Resend.
4. En Supabase → **Authentication → Emails → SMTP Settings**, activar
   "Enable Custom SMTP" y completar:
   - Host: `smtp.resend.com`
   - Puerto: `465`
   - Usuario: `resend`
   - Contraseña: la API key de Resend
   - Sender email: `portal@respon-do.com`
   - Sender name: `Respondo`
5. En **Authentication → Rate Limits**, subir el límite de correos por hora
   (con SMTP propio ya no aplica el límite bajo de Supabase).

**Verificación:** pedir un enlace de acceso desde `/login` con un correo real y
que llegue en menos de un minuto, sin caer en spam.

---

## 2. Migración de RLS (recomendado, 2 minutos)

Correr `sql/202_rls.sql` en el SQL Editor de Supabase.

Enciende Row Level Security en todas las tablas. **No rompe nada**: el portal y
el motor usan la llave secreta, que salta RLS por diseño. Es una segunda barrera
por si alguna vez cambian los permisos de las tablas.

**Verificación:** la consulta al final del archivo debe devolver `rowsecurity =
true` en las 14 tablas. Después, entrar al portal y confirmar que todo carga
igual.

---

## 3. Registro de resultados en el motor (bloqueante para las métricas)

Hoy la tabla `ed_resultados` la llena el seed de demostración. En producción,
**las tarjetas de Beto y Vera mostrarían 0** hasta que el motor escriba ahí.

Ver `docs/MOTOR_REGISTRO_RESULTADOS.md` — trae el nodo de n8n listo para pegar.

---

## 4. Despliegue en Vercel (~15 minutos)

**Cuidado:** tu CLI de Vercel está enlazada al proyecto de `respon-do.com`. Si
corres `vercel` desde la carpeta equivocada, puedes pisar tu web viva. El portal
va como **proyecto nuevo y separado**.

1. Desde `respondo-portal/`, correr `vercel` (sin `--prod` la primera vez).
   Cuando pregunte, elegir **"Set up and deploy"** y **crear un proyecto nuevo**
   — NO enlazar a uno existente. Nombre sugerido: `respondo-portal`.
2. En el panel de Vercel, en ese proyecto nuevo, cargar las variables de entorno
   (Settings → Environment Variables). Son las mismas de `.env.local`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL`
   - `NEXT_PUBLIC_SITE_URL` → la URL final del portal
3. Elegir un dominio. Sugerencia: `portal.respon-do.com` (subdominio, no toca la
   web principal).
4. **Actualizar Supabase** → Authentication → URL Configuration:
   - Site URL: la URL del portal en producción
   - Redirect URLs: agregar `https://portal.respon-do.com/auth/callback` y
     `https://portal.respon-do.com/auth/verificar`

   Si te saltas esto, el enlace del correo manda al cliente a localhost.
5. Recién ahí, `vercel --prod`.

**Verificación:** entrar desde el teléfono con un correo habilitado, y revisar
las cuatro pantallas.

---

## 5. Antes de dar el primer acceso a un cliente real

- [ ] Borrar o desactivar los clientes demo si no los quieres en la misma base
      (`delete from ed_clientes where id in ('1111...','2222...')`).
- [ ] Crear su fila en `ed_clientes`, sus `ed_empleados` y su `ed_conocimiento`.
- [ ] Mapear su correo en `portal_usuarios`.
- [ ] Cargar su información real desde la pantalla **Información**.
- [ ] Probar en **Probar ahora** que responde con SUS precios, y que niega algo
      que no le cargaste.

---

## Pendientes conocidos (no bloquean, pero conviene saberlos)

- **Sin paginación:** la lista de conversaciones lee hasta 2.000 mensajes. Con
  un cliente de alto volumen habría que paginar.
- **Sin actualización automática:** hay que recargar para ver mensajes nuevos.
- **Supabase plan gratis:** 500 MB de base. Con varios clientes conversando,
  `ed_mensajes` crece rápido — vigilarlo.
- **Cambio de tarifas de WhatsApp:** hay un cambio de precios de Meta previsto
  que afecta el costo por mensaje. Verificar en la fuente oficial antes de
  cerrar precios anuales con clientes.
- **Instagram:** requiere App Review de Meta y una columna de canal en
  `ed_mensajes`. Es un proyecto aparte, no un incremento.
