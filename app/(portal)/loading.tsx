/**
 * Estado de carga de TODAS las páginas del portal.
 *
 * POR QUÉ EXISTE: cada página del portal es un Server Component que consulta la
 * base antes de renderizar. Sin este archivo, Next deja la pantalla ANTERIOR
 * congelada mientras carga: el usuario hace clic y "no pasa nada" durante
 * cientos de milisegundos (peor en móvil o con señal lenta), y la app se siente
 * rota o lenta aunque sea rápida.
 *
 * Con el esqueleto, la respuesta al clic es INMEDIATA y la espera se percibe
 * como carga, no como cuelgue. Es el mismo recurso que usan Linear, Stripe o
 * Notion — la diferencia entre "va lento" y "va volando".
 */
export default function CargandoPortal() {
  return (
    <main className="px-5 py-7 sm:px-8 lg:px-10 lg:py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>

      {/* Encabezado */}
      <div className="esqueleto h-3 w-20" />
      <div className="esqueleto mt-3 h-8 w-64" />
      <div className="esqueleto mt-3 h-4 w-full max-w-md" />

      {/* Bloque de tarjetas (sirve para inicio, conversaciones e información) */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="tarjeta p-5">
            <div className="flex items-center gap-3">
              <div className="esqueleto h-12 w-12 rounded-full" />
              <div className="min-w-0 flex-1">
                <div className="esqueleto h-4 w-24" />
                <div className="esqueleto mt-2 h-3 w-32" />
              </div>
            </div>
            <div className="mt-5 space-y-3">
              <div className="esqueleto h-3 w-full" />
              <div className="esqueleto h-3 w-4/5" />
              <div className="esqueleto h-3 w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
