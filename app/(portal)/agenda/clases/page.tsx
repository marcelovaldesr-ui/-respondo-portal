import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { proximasClases, inscritosDeClase, type Clase } from "@/lib/clases";
import { crearClaseAccion, generarSerieAccion, cancelarClaseAccion } from "./acciones";

export const dynamic = "force-dynamic";

const DIAS = [
  { n: 1, l: "Lun" },
  { n: 2, l: "Mar" },
  { n: 3, l: "Mié" },
  { n: 4, l: "Jue" },
  { n: 5, l: "Vie" },
  { n: 6, l: "Sáb" },
  { n: 0, l: "Dom" },
];

function cuando(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Barra de ocupación de una clase.
 *
 * El número solo ("8/12") obliga a hacer la resta mentalmente cada vez. La
 * barra se entiende sin leer, que es lo que se necesita cuando el dueño revisa
 * veinte clases de un vistazo antes de abrir el local.
 */
function Ocupacion({ c }: { c: Clase }) {
  const pct = c.cupoMaximo ? Math.round((c.cupoOcupado / c.cupoMaximo) * 100) : 0;
  const lleno = c.lugaresLibres === 0;
  return (
    <div style={{ minWidth: 108 }}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="cifra font-semibold" style={{ fontSize: "var(--t-menor)" }}>
          {c.cupoOcupado}/{c.cupoMaximo}
        </span>
        <span
          style={{
            fontSize: "var(--t-micro)",
            color: lleno ? "var(--peligro)" : "var(--muted-2)",
          }}
        >
          {lleno ? "sin cupos" : `quedan ${c.lugaresLibres}`}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden"
        style={{ background: "var(--borde)", borderRadius: "var(--r-pill)" }}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.min(100, pct)}%`,
            borderRadius: "var(--r-pill)",
            background: lleno ? "var(--coral)" : "var(--indigo)",
          }}
        />
      </div>
    </div>
  );
}

export default async function Clases() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const [clases, servicios, profesionales] = await Promise.all([
    proximasClases(usuario.clienteId, { dias: 30, incluirLlenas: true }),
    supa
      .from("ed_servicios")
      .select("id, nombre, duracion_min")
      .eq("cliente_id", usuario.clienteId)
      .order("nombre"),
    supa
      .from("ed_profesionales")
      .select("id, nombre")
      .eq("cliente_id", usuario.clienteId)
      .order("nombre"),
  ]);

  const servs = servicios.data ?? [];
  const profs = profesionales.data ?? [];
  const listos = servs.length > 0 && profs.length > 0;

  // Los inscritos se traen solo de las próximas seis: es lo que el dueño mira
  // antes de abrir, y pedir la lista de treinta clases sería gastar por nada.
  const inscritos = await Promise.all(
    clases.slice(0, 6).map((c) => inscritosDeClase(usuario.clienteId, c.id)),
  );

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Clases</h1>
        <span className="sub-titulo">
          {clases.length ? `${clases.length} programadas` : "Ninguna programada aún"}
        </span>
        <Link
          href="/agenda"
          className="ml-auto font-semibold"
          style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }}
        >
          ← Volver a la agenda
        </Link>
      </div>

      {!listos ? (
        <div className="tarjeta vacio mt-4">
          <div className="vacio-titulo">Antes de crear clases faltan dos cosas</div>
          <p className="vacio-texto">
            Necesitas al menos un servicio y un profesional cargados. Se configuran en
            Agenda → Configuración, y son los mismos que usa la agenda de horas.
          </p>
          <Link href="/agenda/configuracion" className="btn-primario mt-4">
            Ir a configuración
          </Link>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
          {/* ── Lista de sesiones ─────────────────────────────────────────── */}
          <div>
            {clases.length === 0 ? (
              <div className="tarjeta vacio">
                <div className="vacio-titulo">Todavía no hay clases programadas</div>
                <p className="vacio-texto">
                  Crea la parrilla de la semana con el formulario de la derecha. Apenas
                  exista una clase, tu asistente puede empezar a inscribir gente.
                </p>
              </div>
            ) : (
              <div className="tarjeta divide-y overflow-hidden" style={{ borderColor: "var(--borde)" }}>
                {clases.map((c, i) => (
                  <div key={c.id} className="px-4 py-3" style={{ borderColor: "var(--borde)" }}>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                          {c.servicioNombre}
                        </div>
                        <div style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                          <span className="cifra">{cuando(c.inicio)}</span>
                          {c.profesionalNombre && ` · ${c.profesionalNombre}`}
                        </div>
                      </div>
                      <Ocupacion c={c} />
                      <form action={cancelarClaseAccion}>
                        <input type="hidden" name="claseId" value={c.id} />
                        <button type="submit" className="btn-peligro">
                          Cancelar
                        </button>
                      </form>
                    </div>

                    {/* Quiénes vienen. Solo en las próximas, que es cuando importa. */}
                    {i < 6 && inscritos[i]?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {inscritos[i]
                          .filter((p) => p.estado !== "cancelada")
                          .map((p, j) => (
                            <span key={j} className="pildora-neutra">
                              {p.nombre}
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Crear ─────────────────────────────────────────────────────── */}
          <aside className="flex flex-col gap-4">
            <div className="tarjeta p-4">
              <h2 className="h-seccion">Programar la semana</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                Crea todas las sesiones de una vez. Las que choquen con otra clase del
                mismo profesional se saltan solas.
              </p>
              <form action={generarSerieAccion} className="mt-3 space-y-2.5">
                <select name="servicioId" className="campo" required>
                  {servs.map((s) => (
                    <option key={s.id as string} value={s.id as string}>
                      {s.nombre as string}
                    </option>
                  ))}
                </select>
                <select name="profesionalId" className="campo" required>
                  {profs.map((p) => (
                    <option key={p.id as string} value={p.id as string}>
                      {p.nombre as string}
                    </option>
                  ))}
                </select>

                <div>
                  <div
                    className="mb-1.5 font-semibold uppercase"
                    style={{ fontSize: "var(--t-columna)", letterSpacing: "0.07em", color: "var(--muted-3)" }}
                  >
                    Días
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DIAS.map((d) => (
                      <label key={d.n} className="btn-chico cursor-pointer">
                        <input type="checkbox" name="dias" value={d.n} className="mr-1.5" />
                        {d.l}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Hora</span>
                    <input type="time" name="hora" defaultValue="19:00" className="campo" required />
                  </label>
                  <label>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Duración (min)</span>
                    <input type="number" name="duracion" defaultValue={60} min={15} step={5} className="campo" />
                  </label>
                  <label>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Cupos</span>
                    <input type="number" name="cupo" defaultValue={12} min={1} max={500} className="campo" />
                  </label>
                  <label>
                    <span style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}>Semanas</span>
                    <input type="number" name="semanas" defaultValue={4} min={1} max={12} className="campo" />
                  </label>
                </div>

                <button type="submit" className="btn-primario w-full justify-center">
                  Generar
                </button>
              </form>
            </div>

            <div className="tarjeta p-4">
              <h2 className="h-seccion">Una clase suelta</h2>
              <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                Para un horario extra que no se repite.
              </p>
              <form action={crearClaseAccion} className="mt-3 space-y-2.5">
                <select name="servicioId" className="campo" required>
                  {servs.map((s) => (
                    <option key={s.id as string} value={s.id as string}>
                      {s.nombre as string}
                    </option>
                  ))}
                </select>
                <select name="profesionalId" className="campo" required>
                  {profs.map((p) => (
                    <option key={p.id as string} value={p.id as string}>
                      {p.nombre as string}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" name="fecha" className="campo" required />
                  <input type="time" name="hora" defaultValue="19:00" className="campo" required />
                  <input type="number" name="duracion" defaultValue={60} min={15} step={5} className="campo" />
                  <input type="number" name="cupo" defaultValue={12} min={1} max={500} className="campo" />
                </div>
                <button type="submit" className="btn-suave w-full justify-center">
                  Crear
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
