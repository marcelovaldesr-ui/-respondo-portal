export const dynamic = "force-dynamic";

// El usuario se autenticó bien, pero su email no está habilitado en
// portal_usuarios. Autenticado != autorizado.
export default function SinAcceso() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="tarjeta w-full max-w-[420px] p-7 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/isotipo.svg"
          alt="Respondo"
          width={34}
          height={34}
          className="mx-auto"
        />
        <h1 className="titular mt-4 text-[22px] font-bold">
          Tu correo aún no está habilitado
        </h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          Tu sesión se inició correctamente, pero ese correo todavía no está asociado a
          ningún negocio en el portal. Escríbenos y lo activamos.
        </p>
        <form action="/auth/salir" method="post">
          <button type="submit" className="btn-primario mt-5 w-full">
            Volver a entrar con otro correo
          </button>
        </form>
      </div>
    </main>
  );
}
