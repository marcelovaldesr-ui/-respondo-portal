/**
 * Carga de Pauta.
 *
 * Se dibuja la MISMA estructura que va a aparecer —el título, la fila de
 * métricas, la tabla— y no un spinner centrado. La página no «salta» al
 * terminar de cargar, y el ojo ya sabe dónde va a estar cada cosa. Usa la
 * clase `.esqueleto` del portal, la misma de Conversaciones.
 */
export default function CargandoPauta() {
  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8" aria-busy="true" aria-label="Cargando">
      <div className="esqueleto h-5 w-64" />
      <div className="esqueleto mt-2 h-3.5 w-96 max-w-full" />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="tarjeta p-4">
            <div className="esqueleto h-3 w-24" />
            <div className="esqueleto mt-2 h-6 w-20" />
            <div className="esqueleto mt-2 h-3 w-16" />
          </div>
        ))}
      </div>

      <div className="tarjeta mt-6 p-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4 py-2.5">
            <div className="esqueleto h-3.5 flex-1" />
            <div className="esqueleto h-3.5 w-16" />
            <div className="esqueleto h-3.5 w-16" />
          </div>
        ))}
      </div>
    </main>
  );
}
