"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * LAS CUATRO PANTALLAS DE PAUTA.
 *
 * Cuatro y no ocho, a propósito. Cada una responde una pregunta distinta que
 * alguien se hace de verdad; ninguna existe porque «un SaaS de anuncios debería
 * tenerla»:
 *
 *   · Resumen    — ¿vamos bien o mal?
 *   · Anuncios   — ¿cuál de todos está trayendo la plata?
 *   · Personas   — ¿quién llegó por un anuncio y en qué quedó?
 *   · Conexión   — ¿qué falta para ver más?
 *
 * Lo que NO está y por qué: **Creatividades** (el generador de ideas ya existe
 * en Growth Studio; un segundo editor sería mantener dos), **Audiencias**
 * (requiere permiso de escritura en Meta, que decidimos no pedir) y **Crear
 * campaña** (el Administrador de Anuncios lo hace gratis y mejor). Una pantalla
 * vacía con un «próximamente» le resta credibilidad a las cuatro que sí
 * funcionan.
 *
 * Es cliente porque necesita saber cuál está activa. Es lo único que necesita.
 *
 * ⚠️ Conexión exige `gestionar_integraciones` y el resto de la sección
 * `generar_insights`. Hoy los dos son de dueño, así que quien ve la pestaña
 * puede entrar. Si algún día la matriz de `permisos.ts` los separa, esta
 * pestaña hay que esconderla o llevaría a `/sin-permiso`.
 */

const PESTANAS = [
  { href: "/pauta", label: "Resumen" },
  { href: "/pauta/anuncios", label: "Anuncios" },
  { href: "/pauta/personas", label: "Personas" },
  { href: "/pauta/conexion", label: "Conexión" },
];

export default function NavPauta() {
  const ruta = usePathname();

  return (
    <nav className="-mx-1 mt-3 flex gap-1 overflow-x-auto px-1" aria-label="Secciones de Pauta">
      {PESTANAS.map((p) => {
        // "/pauta" solo está activa en la ruta exacta; si no, quedaría marcada
        // en todas, que es el error clásico de los menús con prefijos.
        const activa = p.href === "/pauta" ? ruta === "/pauta" : ruta.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={p.href}
            aria-current={activa ? "page" : undefined}
            className="shrink-0 whitespace-nowrap px-3 py-2 font-semibold transition-colors"
            style={{
              fontSize: "var(--t-menor)",
              color: activa ? "var(--tinta)" : "var(--muted)",
              borderBottom: `2px solid ${activa ? "var(--indigo)" : "transparent"}`,
              marginBottom: "-1px",
            }}
          >
            {p.label}
          </Link>
        );
      })}
    </nav>
  );
}
