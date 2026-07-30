/**
 * Esqueleto específico de Conversaciones: imita la bandeja de dos columnas
 * (lista + chat) para que la transición sea imperceptible. Es la pantalla que
 * más se abre y la más pesada (consulta mensajes, contactos, estados y
 * escalaciones), así que es donde más se nota tener feedback inmediato.
 */
export default function CargandoConversaciones() {
  return (
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando conversaciones…</span>

      <div className="esqueleto h-3 w-20" />
      <div className="esqueleto mt-3 h-8 w-72" />
      <div className="esqueleto mt-3 h-4 w-96 max-w-full" />

      {/* Buscador + chips de filtro */}
      <div className="mt-5 flex gap-2">
        <div className="esqueleto h-11 w-full max-w-[420px] rounded-xl" />
        <div className="esqueleto h-11 w-24 rounded-xl" />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {[64, 88, 96, 84].map((w, i) => (
          <div key={i} className="esqueleto h-7 rounded-full" style={{ width: w }} />
        ))}
      </div>

      {/* Dos columnas: lista y detalle */}
      <div className="mt-5 grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
        <div className="tarjeta p-0">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex gap-3 border-b px-4 py-3.5 last:border-0"
              style={{ borderColor: "var(--borde)" }}
            >
              <div className="esqueleto h-[38px] w-[38px] shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="esqueleto h-4 w-28" />
                  <div className="esqueleto h-3 w-10" />
                </div>
                <div className="esqueleto mt-2 h-3 w-full" />
                <div className="mt-2 flex gap-1.5">
                  <div className="esqueleto h-5 w-14 rounded-full" />
                  <div className="esqueleto h-5 w-20 rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div
          className="tarjeta-plana hidden min-h-[340px] p-5 lg:block"
          style={{ background: "var(--fondo)" }}
        >
          <div className="flex items-center gap-3">
            <div className="esqueleto h-[42px] w-[42px] rounded-full" />
            <div>
              <div className="esqueleto h-4 w-36" />
              <div className="esqueleto mt-2 h-3 w-48" />
            </div>
          </div>
          <div className="mt-8 space-y-4">
            <div className="esqueleto h-14 w-2/3 rounded-2xl" />
            <div className="ml-auto">
              <div className="esqueleto ml-auto h-16 w-3/4 rounded-2xl" />
            </div>
            <div className="esqueleto h-12 w-1/2 rounded-2xl" />
          </div>
        </div>
      </div>
    </main>
  );
}
