import Link from "next/link";

/**
 * 404 de marca.
 *
 * Sin este archivo, cualquier URL equivocada —un enlace viejo en un correo, una
 * reserva pública con el slug mal escrito, un cliente que escribe la dirección a
 * mano— caía en la pantalla por defecto de Next: fondo blanco, tipografía del
 * sistema, "This page could not be found". Funciona, pero parece que el sitio se
 * rompió, y es una de las pocas pantallas que un cliente puede ver ANTES de
 * confiar en nosotros.
 *
 * No usa el layout del portal a propósito: un 404 puede ocurrir sin sesión.
 */
export default function NoEncontrado() {
  return (
    <main
      className="flex min-h-[80vh] items-center justify-center px-6"
      style={{ background: "var(--fondo)" }}
    >
      <div className="tarjeta w-full max-w-[460px] p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/isotipo.svg" alt="Respondo" width={34} height={34} className="mx-auto" />

        <h1 className="titular mt-4 text-[22px] font-bold">Esta página no existe</h1>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          Puede que el enlace esté incompleto o que la página haya cambiado de
          dirección. No se perdió nada de tu información.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/inicio" className="btn-primario px-4 py-2 text-[14px]">
            Ir a mi portal
          </Link>
          <Link href="/" className="btn-suave px-4 py-2 text-[14px]">
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}
