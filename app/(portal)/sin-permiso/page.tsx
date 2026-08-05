import Link from "next/link";

export default function SinPermiso() {
  return (
    <main className="mx-auto max-w-xl px-5 py-16 text-center">
      <h1 className="h-pagina">Esta acción necesita permiso de dueño</h1>
      <p className="mt-3" style={{ color: "var(--muted)" }}>
        Tu sesión sigue activa. Pídele al dueño del negocio que realice este cambio.
      </p>
      <Link href="/inicio" className="btn-primario mt-6 inline-flex">
        Volver al inicio
      </Link>
    </main>
  );
}
