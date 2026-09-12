# Fase 0 — lo que te toca a ti

**11-sep-2026.** Todo el código ya está en tu carpeta `respondo-portal`. Falta verificarlo, subirlo y activarlo. Son 7 pasos, en este orden. Si algo falla, **para ahí** y pégame lo que salió.

---

## Paso 1 · Correr los chequeos (10 min)

Abre **PowerShell** y pega:

```powershell
cd "C:\Users\marce\Claude\Projects\ChatBot Ventas\respondo-portal"
npm run check
```

- Tiene que terminar sin errores (lint, typecheck, tests y build).
- Si dice que falta un paquete, pega `npm ci`, espera y repite `npm run check`.

Después pega:

```powershell
npm run typecheck:scripts
```

Aquí es normal que salgan **3 errores en `_dbg_vig.ts`** (vienen de antes). Cualquier otro error, me lo pegas.

---

## Paso 2 · Revisar que nadie pierda acceso (2 min) — OBLIGATORIO

En **Supabase → SQL Editor** (pestaña nueva con `+`), pega y corre:

```sql
select pu.email, pu.cliente_id, pu.rol
from portal_usuarios pu
join auth.users u on lower(u.email) = lower(pu.email)
where pu.activo and u.email_confirmed_at is null;
```

- **0 filas →** sigue.
- **Si sale alguien →** no subas nada todavía. Esas personas no podrían entrar después del deploy. Pásame la lista.

Aprovecha de correr esta, que la uso en el paso 5:

```sql
select to_regclass('public.ed_propuestas_seguimiento') as tabla_297;
```

---

## Paso 3 · Variables en Vercel (3 min)

En **Vercel → respondo-portal → Settings → Environment Variables** (Production):

1. **Revisa `NEXT_PUBLIC_SITE_URL`.** Tiene que ser exactamente la dirección con la que entras al portal (por ejemplo `https://respondo-portal.vercel.app`, sin `/` al final). Si entras por otra dirección, conectar Google o Instagram va a fallar.
2. **Agrega `RESPONDO_ADMIN_EMAILS`** con el correo con el que tú entras al portal. Si son varios, sepáralos con coma. Con esto `/estado` te muestra el estado de los procesos; nadie más lo ve.

Hazlo **antes** del paso 4, así el deploy ya las toma.

---

## Paso 4 · Subir solo lo de la Fase 0 (3 min)

En PowerShell, en la misma carpeta:

```powershell
git add --pathspec-from-file=docs/FASE0_ARCHIVOS.txt
git commit -m "Fase 0: estabilizacion del portal (procesos observables, informe semanal, Beto en aprobacion, metricas, cobros, seguridad)"
git push
git log --oneline origin/main -1
```

La última línea tiene que mostrar el commit «Fase 0…». Si muestra otro, el push no subió nada: avísame.

**Si `git add` dice que hay un archivo `.lock`** (y no tienes otra ventana usando git), pega esto y repite el paso 4:

```powershell
Remove-Item .git\index.lock, .git\HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue
```

> Esto sube **solo** los 99 archivos de la Fase 0. Si lo de Marketing todavía no está subido, va en su propio commit, aparte.

Espera a que Vercel marque el deploy como **Ready**.

---

## Paso 5 · Migraciones de Beto (3 min, después del deploy)

**No encienden nada.** Dejan listo el modo aprobación para cuando decidas activarlo.

- **Si en el paso 2 `tabla_297` salió vacío (null):** abre `sql/297_propuestas_seguimiento.sql`, copia todo, pégalo en el SQL Editor y córrelo. Después haz lo mismo con `sql/306_propuestas_memoria.sql`.
- **Si `tabla_297` ya decía `ed_propuestas_seguimiento`:** corre solo `sql/306_propuestas_memoria.sql`.

La 304 termina mostrando una línea que debe incluir `'frenado'`.

---

## Paso 6 · Que el vigilante mire lo nuevo (2 min)

En **cron-job.org**, abre el trabajo **«Respondo · vigilante de salud»** y cambia la URL a:

```
https://respondo-portal.vercel.app/api/salud?k=
```

Después de `k=` pega tú el valor de `CRON_SECRET` (el mismo que usa el cron de seguimientos). Sin la llave, los chequeos nuevos de procesos e informe semanal no corren, y el correo de alerta no saldría.

---

## Paso 7 · Comprobar que quedó andando

**Apenas termine el deploy (5 min):**

1. Entra a **Inicio** de Impresora:
   - «Te están esperando» debe mostrar el mismo número que el menú.
   - «N conversaciones este mes» debe ser un número razonable, menor que el «en 30 días» de Isabel.
   - Beto y Vera ya no muestran ceros fijos.
2. En **Agenda → Configuración**, si hay Google conectado, el estado debe decir lo real.
3. Si puedes, conecta Google Calendar en un negocio de prueba: debe terminar en «conectado».

**Una hora después**, en el SQL Editor:

```sql
select clave, ultimo_en, detalle->>'ultimo_estado' as estado,
       detalle->>'fallos_seguidos' as fallos, detalle->>'ultimo_error' as error
from ed_latidos
where clave like 'proceso:%'
order by clave;
```

Deben aparecer los procesos con estado `ok` o vacío. Si alguno dice `fallo`, pégame la fila.

**El lunes 14-sep:** el informe de la semana del 7-sep tiene que aparecer solo en Impresora, sin apretar nada.

---

## Ya decidido (no tienes que hacer nada)

- **Aprobar mensajes pagados de Beto: solo el dueño.** El staff ve la lista, pero no aprueba. Ya está en el código de este commit.
- **Una cotización cerrada por silencio sigue siendo retomable por Beto.** El juez y tu aprobación la filtran antes de que salga algo.
- **Bloque mensual de Inicio (`ed_metricas`):** se revisa en Fase 1. Hoy no molesta, porque se oculta si no es del mes.
- **Avisos push al cerrar sesión en un equipo compartido:** se apagarán en Fase 1.
