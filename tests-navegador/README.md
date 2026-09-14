# Verificación en navegador real

Estos guiones **no** corren en `npm test`. Necesitan la aplicación construida y
andando, y credenciales de Supabase en `.env.local` — cosas que no pueden ser
requisito de la batería de pruebas unitarias.

```bash
npm run build
npx next start -p 3000 &
set -a && . ./.env.local && set +a
BASE=http://localhost:3000 node tests-navegador/marketing-fase6.mjs
```

## Por qué existen, si ya hay 833 pruebas

Porque un `fetch` no prueba nada acá. En `app/(marketing)` los `redirect()`
ocurren **dentro de un `Suspense`**, así que una petición cruda devuelve **200
con el esqueleto de carga** aunque la persona real termine en otra pantalla.
Un 200 no es evidencia de que alguien pueda usar el producto.

Estos guiones abren un Chromium de verdad, con sesión de verdad (enlace mágico →
`/auth/verificar?token_hash=`), y leen el texto que la persona ve.

## Trampas de este contenedor, para que no las redescubras

- `waitUntil: "networkidle"` **se cuelga**: las fuentes de Google no resuelven.
  Se usa `domcontentloaded` y un interceptor que aborta todo lo que no sea
  `localhost`.
- El guion tiene que correr **desde la raíz del repo**, porque importa
  `@supabase/supabase-js` de `node_modules`.
- Playwright vive en el `node_modules` global de la máquina de desarrollo; la
  importación es por ruta absoluta a propósito, para no agregar una dependencia
  de 300 MB al proyecto.

## `marketing-fase6.mjs`

Los tres Customer Zero de la Fase 6, en el mismo producto y sin modos manuales:

- **AyP Abogados** — sólo Meta, sin conversaciones. Verifica que no aparezcan
  secciones ni KPI vacíos, que el embudo no prometa una venta que no se puede
  medir, y que el Arquitecto explique por qué WhatsApp no es un destino posible.
- **Impresora Color** — Google con palabras clave y términos de búsqueda.
  Verifica, sobre todo, que el término que **chocaría con una palabra clave
  activa** aparezca explicado en «lo que todavía no se puede concluir» y **no**
  como recomendación de excluir.
- **Completo** — el circuito cerrado de siempre. Verifica que nada de lo
  anterior lo haya roto.

Más la tarjeta de Google en Integraciones, que tiene que declarar su **estado
real**, nunca «conectado» sin haber leído.
