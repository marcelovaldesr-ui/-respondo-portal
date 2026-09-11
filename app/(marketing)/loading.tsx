/**
 * Esqueleto del centro de marketing: cabecera, franja de cifras y gráfico.
 * Responde al clic al instante mientras el servidor arma el panorama, y tiene
 * la forma real de la pantalla para que la espera no reencuadre nada.
 */
export default function CargandoMarketing() {
  return (
    <main className="mk-pagina" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      <div className="mk-cabecera">
        <div>
          <div className="esqueleto h-7 w-44" />
          <div className="esqueleto mt-3 h-4 w-80" />
        </div>
        <div className="esqueleto h-9 w-72" />
      </div>
      <div className="mk-kpis">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="mk-kpi">
            <div className="esqueleto h-3 w-20" />
            <div className="esqueleto mt-3 h-7 w-28" />
            <div className="esqueleto mt-4 h-3 w-16" />
          </div>
        ))}
      </div>
      <div className="mk-panel mt-7">
        <div className="mk-panel-cabecera">
          <div className="esqueleto h-4 w-40" />
        </div>
        <div className="mk-panel-cuerpo">
          <div className="esqueleto h-[280px] w-full" />
        </div>
      </div>
    </main>
  );
}
