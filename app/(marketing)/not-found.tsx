import Link from "next/link";

export default function NoEncontradoMarketing() {
  return (
    <main className="mk-pagina">
      <div className="tarjeta mx-auto mt-10 max-w-md">
        <div className="vacio">
          <div className="vacio-titulo">Eso no está o ya no existe</div>
          <p className="vacio-texto">
            El enlace apunta a algo que ya no está: puede ser de otro período, algo que se eliminó, o un enlace de la demostración abierto
            con la demostración apagada.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/marketing" className="btn-primario">Ir al inicio de Marketing</Link>
            <Link href="/marketing/campanas" className="btn-suave">Campañas</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
