import Link from "next/link";

export default function NoEncontradoMarketing() {
  return (
    <main className="mk-pagina">
      <div className="tarjeta mx-auto mt-10 max-w-md">
        <div className="vacio">
          <div className="vacio-titulo">Eso no está o ya no existe</div>
          <p className="vacio-texto">Puede ser una campaña de otro período, un borrador eliminado o un enlace de la demostración con la demo apagada.</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/marketing" className="btn-primario">Ir al inicio de Marketing</Link>
            <Link href="/marketing/campanas" className="btn-suave">Campañas</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
