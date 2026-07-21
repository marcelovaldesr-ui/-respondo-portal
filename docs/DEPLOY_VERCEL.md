# Desplegar el portal en Vercel

El portal va como **proyecto NUEVO y separado** (no tocar el de respon-do.com ni
el de respondo-hq). Recomendado: **GitHub + Vercel**, igual que respondo-hq, así
cada cambio se despliega solo al hacer push.

**Reparto:** la parte de git (crear repo, push) la corres tú en tu terminal —
yo no puedo. La parte de Vercel (importar, variables, deploy) te la guío por
Chrome.

---

## Paso 1 — Subir el portal a un repo nuevo de GitHub (TÚ, terminal)

1. Crear un repo vacío en github.com/new. Nombre sugerido: **respondo-portal**.
   No agregar README ni .gitignore (ya los tenemos). Dejarlo vacío.

2. En tu terminal, parado en la carpeta del portal:
   ```
   cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
   git init
   git add .
   git commit -m "Portal del cliente Respondo - inicial"
   git branch -M main
   git remote add origin https://github.com/marcelovaldesr-ui/respondo-portal.git
   git push -u origin main
   ```
   (Reemplaza la URL por la del repo que creaste.)

   El `.gitignore` ya excluye `node_modules`, `.next`, `.env.local` y `.vercel`,
   así que **tus secretos NO se suben**. Bien.

## Paso 2 — Importar en Vercel (te guío por Chrome)

1. En vercel.com → **Add New… → Project**.
2. Importar el repo **respondo-portal**.
3. Vercel detecta Next.js solo. **Root Directory:** dejar en `./` (el repo ES
   el portal).
4. **NO** desplegar todavía: primero las variables de entorno (Paso 3).

## Paso 3 — Variables de entorno en Vercel

Copiar los valores desde `respondo-portal/.env.local` (no los pego acá por
seguridad). Cargar estas, para los 3 entornos (Production/Preview/Development):

| Variable | De dónde sale |
|---|---|
| `SUPABASE_URL` | .env.local |
| `SUPABASE_SERVICE_ROLE_KEY` | .env.local |
| `NEXT_PUBLIC_SUPABASE_URL` | .env.local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | .env.local |
| `GEMINI_API_KEY` | .env.local |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `NEXT_PUBLIC_SITE_URL` | la URL que te dé Vercel (se completa tras el 1er deploy) |

Las de WhatsApp (`WHATSAPP_*`) pueden quedar **vacías por ahora** — el portal
funciona sin ellas; se llenan cuando conectemos la Cloud API.

## Paso 4 — Desplegar

Botón **Deploy**. Vercel corre el build (unos minutos). Si falla, me pasas el
error y lo arreglo.

## Paso 5 — Configurar Auth de Supabase para el dominio nuevo (CRÍTICO)

Sin esto, el login por enlace mágico NO funciona en producción.

En Supabase → **Authentication → URL Configuration**:
- **Site URL:** la URL de Vercel (ej: `https://respondo-portal.vercel.app`).
- **Redirect URLs:** agregar
  - `https://<tu-dominio-vercel>/auth/callback`
  - `https://<tu-dominio-vercel>/auth/verificar`

Y actualizar en Vercel la variable `NEXT_PUBLIC_SITE_URL` con esa misma URL, y
redeployar (o dejar que el próximo push lo haga).

## Después

- Cada cambio que yo haga al portal: tú haces `git add . && git commit && git
  push`, y Vercel despliega solo.
- Cuando tengas dominio propio (ej: `portal.respon-do.com`), se agrega en
  Vercel → Settings → Domains, y se repite el Paso 5 con ese dominio.

## Alternativa rápida (sin git): Vercel CLI

Si prefieres un deploy de una vez sin repo:
```
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
vercel            # crea proyecto NUEVO; responder "no" a linkear a uno existente
# cargar variables en el dashboard, luego:
vercel --prod
```
Desventaja: cada cambio hay que volver a correr `vercel --prod` a mano. Por eso
recomiendo la ruta de GitHub.
