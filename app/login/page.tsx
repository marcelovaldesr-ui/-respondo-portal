import FormularioLogin from "@/components/FormularioLogin";

export const dynamic = "force-dynamic";

// Server Component: lee el error de la URL (enlaces fallidos) y se lo pasa al
// formulario. Antes el error llegaba en la URL y nadie lo mostraba, así que un
// enlace vencido se veía como "no pasó nada".
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="w-full max-w-[420px]">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/isotipo.svg" alt="Respondo" width={34} height={34} />
          <span className="titular text-[17px] font-extrabold">Respondo</span>
        </div>

        <h1 className="mt-6 text-[30px] font-extrabold leading-tight">
          Entra a tu portal
        </h1>
        <p className="mt-2 text-[15px]" style={{ color: "var(--muted)" }}>
          Mira a tus empleados IA trabajando: conversaciones, resultados y tus métricas.
        </p>

        <div className="tarjeta mt-7 p-6">
          <FormularioLogin error={searchParams.error} />
        </div>
      </div>
    </main>
  );
}
