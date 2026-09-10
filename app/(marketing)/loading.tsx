/**
 * Esqueleto del centro de marketing: cabecera, siete métricas y un gráfico.
 * Responde al clic al instante mientras el servidor arma el panorama.
 */
export default function CargandoMarketing() {
  return (
    <main className="mk-pagina" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="mk-cabecera">
        <div>
          <div className="esqueleto h-3 w-24" />
          <div className="esqueleto mt-2 h-6 w-40" />
          <div className="esqueleto mt-2 h-3 w-72" />
        </div>
        <div className="esqueleto h-8 w-64" />
      </div>
      <div className="mk-metricas mb-5">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="tarjeta px-4 py-3">
            <div className="esqueleto h-3 w-16" />
            <div className="esqueleto mt-2 h-6 w-24" />
            <div className="esqueleto mt-2 h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="tarjeta p-5">
        <div className="esqueleto h-4 w-32" />
        <div className="esqueleto mt-4 h-56 w-full" />
      </div>
    </main>
  );
}
