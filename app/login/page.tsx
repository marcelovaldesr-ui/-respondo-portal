import FormularioLogin from "@/components/FormularioLogin";

export const dynamic = "force-dynamic";

/**
 * Login premium en dos paneles (patrón Stripe/Linear): a la izquierda el
 * momento de marca (gradiente, promesa, 3 pruebas de valor), a la derecha el
 * formulario. En móvil solo se muestra el formulario con la marca arriba.
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
            "radial-gradient(900px 500px at -10% -10%, rgba(249,115,98,0.28), transparent 55%), radial-gradient(900px 600px at 110% 110%, rgba(124,58,237,0.35), transparent 55%), linear-gradient(160deg, #191c46 0%, #0d0f24 100%)",
        }}
      >
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="" width={36} height={36} />
          <span className="titular text-[19px] font-extrabold text-white">Respondo</span>
        </div>

        <div>
          <h2 className="titular max-w-[420px] text-[34px] font-extrabold leading-tight text-white">
            Tus empleados IA, trabajando mientras tú no estás.
          </h2>
          <ul className="mt-7 space-y-3.5">
            {[
              "Mira cada conversación en vivo, tal como la vivió tu cliente",
              "Toma el control cuando quieras — tu empleado se calla al instante",
              "Resultados reales: cotizaciones, leads y ventas, sin humo",
            ].map((t) => (
              <li key={t} className="flex items-start gap-3 text-[15px]" style={{ color: "#c7cbe3" }}>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#34d399"
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
            <img src="/brand/isotipo.svg" alt="Respondo" width={34} height={34} />
            <span className="titular text-[17px] font-extrabold">Respondo</span>
          </div>

          <h1 className="mt-6 text-[30px] font-extrabold leading-tight lg:mt-0">
            Entra a tu portal
          </h1>
          <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
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
