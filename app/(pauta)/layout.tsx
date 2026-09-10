import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import NavPauta from "@/components/pauta/NavPauta";

export const dynamic = "force-dynamic";

/**
 * PAUTA — sección aparte, con su propia cabecera.
 *
 * POR QUÉ NO ES UNA PANTALLA MÁS DEL MENÚ
 * El portal está organizado por lo que la persona viene a hacer todos los días
 * (atender, vender, entender, configurar) y ya son doce entradas. Pauta se mira
 * una vez por semana y solo si el negocio pone plata en anuncios: meterla ahí
 * le sube el costo de lectura a las tres pantallas que sí se usan a diario.
 *
 * Así que vive en su propio grupo de rutas, se entra por un botón y se vuelve.
 * Lo único que comparte con el portal es la puerta —el mismo
 * `exigirPermisoPortal`— para que el aislamiento por cliente sea idéntico y no
 * haya una segunda forma de entrar que auditar.
 *
 * ⚠️ PERMISO: `generar_insights`, que es de DUEÑO. Pauta muestra cuánto se
 * gasta y cuánto se vende; eso no es del mesón. (Mismo criterio que Isabel.)
 */
export default async function PautaLayout({ children }: { children: React.ReactNode }) {
  const usuario = await exigirPermisoPortal("generar_insights");

  return (
    <div className="min-h-screen">
      <header
        className="sticky top-0 z-20"
        style={{ background: "var(--nav-bg)", borderBottom: "1px solid var(--nav-borde)" }}
      >
        <div className="mx-auto max-w-6xl px-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-3">
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
              <div className="h-pagina">Pauta</div>
              <div
                className="truncate"
                style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
              >
                {usuario.clienteNombre}
              </div>
            </div>
          </div>

          <NavPauta />
        </div>
      </header>

      <div className="mx-auto max-w-6xl">{children}</div>
    </div>
  );
}
