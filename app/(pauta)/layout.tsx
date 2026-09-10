import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * SECCIÓN APARTE, A PROPÓSITO.
 *
 * Pauta no entra al menú del portal. El portal está organizado por lo que la
 * persona viene a hacer todos los días —atender, vender, entender, configurar—
 * y son ya doce entradas: meter una más, que además se mira una vez a la
 * semana y solo si el negocio pone plata en anuncios, le sube el costo a las
 * tres que sí se usan a diario.
 *
 * Así que vive en su propio grupo de rutas, con su propio encabezado y sin
 * barra lateral: se entra por un botón, se mira, y se vuelve. Es la misma
 * decisión que toma Vambe al separar su módulo de anuncios del resto, y por la
 * misma razón: son dos cabezas distintas mirando dos cosas distintas.
 *
 * Lo único que este layout comparte con el portal es la puerta: el mismo
 * `exigirUsuarioPortal`, así que el aislamiento por cliente es idéntico y no
 * hay una segunda forma de entrar que auditar.
 */
export default async function PautaLayout({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuarioPortal();

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20"
        style={{
          background: "var(--nav-bg)",
          borderBottom: "1px solid var(--nav-borde)",
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-7">
          <Link
            href="/inicio"
            className="flex shrink-0 items-center gap-1.5 font-semibold"
            style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Volver al portal
          </Link>

          <div
            className="hidden h-4 w-px shrink-0 sm:block"
            style={{ background: "var(--nav-borde)" }}
          />

          <div className="min-w-0 leading-tight">
            <div className="font-semibold tracking-tight" style={{ fontSize: "var(--t-titulo)" }}>
              Pauta
            </div>
            <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
              {usuario.clienteNombre}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl">{children}</div>
    </div>
  );
}
