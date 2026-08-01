import FormularioLogin from "@/components/FormularioLogin";

export const dynamic = "force-dynamic";

/**
 * Login en dos paneles (patrón Stripe/Linear): a la izquierda el momento de
 * marca, a la derecha el formulario. En móvil solo el formulario con la marca
 * arriba.
 *
 * QUÉ CAMBIÓ EN EL REDISEÑO (31-jul)
 * El panel de marca tenía TRES gradientes radiales superpuestos —coral, violeta
 * y una diagonal de fondo— apilados en una sola propiedad. Es exactamente el
 * primer punto de la lista de "esto no" del brief, y encima el violeta no es un
 * color de la marca: aparecía solo acá.
 *
 * Ahora es la tinta de marca con UN degradado suave y un halo índigo apenas
 * perceptible. Sigue siendo un momento de marca —esta pantalla sí puede
 * permitírselo, es la primera impresión en cada demo— pero deja de verse como
 * una plantilla de dashboard.
 *
 * OJO CON LA ESCALA: acá NO rige el título de 15px del portal. Esto no es una
 * herramienta densa, es una portada; el titular grande está bien puesto.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen">
      {/* Panel de marca (solo escritorio) */}
      <aside
        className="relative hidden w-[46%] flex-col justify-between overflow-hidden p-10 lg:flex"
        style={{
          background:
            "radial-gradient(1100px 700px at 15% 0%, rgba(79,70,229,0.22), transparent 60%), linear-gradient(165deg, #16193a 0%, #0d0f24 100%)",
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="" width={34} height={34} />
          <span className="text-[18px] font-semibold tracking-tight text-white">Respondo</span>
        </div>

        <div>
          <h2
            className="max-w-[440px] font-semibold text-white"
            style={{ fontSize: 32, lineHeight: 1.2, letterSpacing: "-0.03em" }}
          >
            Tus empleados IA, trabajando mientras tú no estás.
          </h2>
          <ul className="mt-7 space-y-3">
            {[
              "Mira cada conversación en vivo, tal como la vivió tu cliente",
              "Toma el control cuando quieras — tu empleado se calla al instante",
              "Resultados reales: cotizaciones, leads y ventas, sin humo",
            ].map((t) => (
              <li
                key={t}
                className="flex items-start gap-3 text-[14.5px] leading-snug"
                style={{ color: "#b9bfda" }}
              >
                {/* El check iba en verde #34d399, que en el sistema significa
                    "resultado confirmado". Acá no confirma nada: es una viñeta.
                    En gris deja de competir con el texto que sí importa. */}
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#6f76a8"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="mt-0.5 shrink-0"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div className="text-[13px]" style={{ color: "#6b7394" }}>
          respon-do.com · hecho en Chile
        </div>
      </aside>

      {/* Panel del formulario */}
      <section className="flex flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-[420px]">
          <div className="flex items-center gap-2.5 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/isotipo.svg" alt="Respondo" width={32} height={32} />
            <span className="text-[17px] font-semibold tracking-tight">Respondo</span>
          </div>

          <h1
            className="mt-6 font-semibold lg:mt-0"
            style={{ fontSize: 26, lineHeight: 1.2, letterSpacing: "-0.03em" }}
          >
            Entra a tu portal
          </h1>
          <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
            Mira a tus empleados IA trabajando: conversaciones, resultados y tus métricas.
          </p>

          <div className="tarjeta mt-7 p-6">
            <FormularioLogin error={searchParams.error} />
          </div>

          <p className="mt-5 text-center text-[12.5px]" style={{ color: "var(--muted-2)" }}>
            ¿Aún no tienes cuenta? Escríbenos y activamos tu negocio.
          </p>
        </div>
      </section>
    </main>
  );
}
