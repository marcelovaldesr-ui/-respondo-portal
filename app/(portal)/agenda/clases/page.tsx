import Link from "next/link";
import { redirect } from "next/navigation";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { commerceActivoParaCliente } from "@/lib/commerce/featureFlag";
import { listarClasesOperacionales } from "@/lib/classes/classesOperations";
import AgendaSubnav from "@/components/agenda/AgendaSubnav";
import ClasesOperaciones from "@/components/agenda/ClasesOperaciones";
import {
  crearClaseAccion,
  generarSerieAccion,
  cancelarClaseAccion,
  obtenerDetalleClaseAccion,
  inscribirAlumnoManualAccion,
  cancelarInscripcionAlumnoAccion,
  marcarAsistenciaAlumnoAccion,
  marcarNoShowAlumnoAccion,
} from "./acciones";

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

export default async function ClasesPage() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const commerceActivo = await commerceActivoParaCliente(usuario.clienteId, supa);
  if (!commerceActivo) redirect("/agenda");

  const [gruposClases, { data: servicios }, { data: profesionales }] =
    await Promise.all([
      listarClasesOperacionales(usuario.clienteId, supa),
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

  const servs = servicios ?? [];
  const profs = profesionales ?? [];
  const listos = servs.length > 0 && profs.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      {/* ── Subnavegación unificada de Agenda ───────────────────────────── */}
      <AgendaSubnav activo="clases" commerceActivo={commerceActivo} />

      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Agenda · Clases</div>
          <h1 className="h-pagina">Clases y Cupos</h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Administra tus sesiones grupales, cupos libres y asistencia de alumnos en tiempo real.
          </p>
        </div>
      </div>

      {!listos ? (
        <div className="tarjeta mt-6 p-6">
          <p className="text-[15px] font-bold">Antes de programar clases necesitas dos cosas:</p>
          <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
            Tener al menos un servicio grupal y un profesional creados en tu configuración.
          </p>
          <Link href="/agenda/configuracion" className="btn-primario mt-4 inline-block">
            Ir a configuración
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* ── Panel Operacional de Clases ─────────────────────────────── */}
          <div>
            <ClasesOperaciones
              grupos={gruposClases}
              onObtenerDetalle={obtenerDetalleClaseAccion}
              onInscribir={inscribirAlumnoManualAccion}
              onCancelarInscripcion={cancelarInscripcionAlumnoAccion}
              onMarcarAsistencia={marcarAsistenciaAlumnoAccion}
              onMarcarNoShow={marcarNoShowAlumnoAccion}
              onCancelarClase={cancelarClaseAccion}
            />
          </div>

          {/* ── Formularios para programar ──────────────────────────────── */}
          <aside className="space-y-5">
            {/* Programar la semana */}
            <div className="tarjeta p-4">
              <h2 className="text-[15px] font-bold text-slate-900">Programar serie semanal</h2>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Genera sesiones recurrentes por varias semanas automáticamente.
              </p>
              <form action={generarSerieAccion} className="mt-3 space-y-2.5">
                <select name="servicioId" className="campo text-[13px]" required>
                  <option value="">Selecciona clase / servicio…</option>
                  {servs.map((s) => (
                    <option key={s.id as string} value={s.id as string}>
                      {s.nombre as string}
                    </option>
                  ))}
                </select>
                <select name="profesionalId" className="campo text-[13px]" required>
                  <option value="">Selecciona instructor…</option>
                  {profs.map((p) => (
                    <option key={p.id as string} value={p.id as string}>
                      {p.nombre as string}
                    </option>
                  ))}
                </select>

                <div>
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Días de la semana
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {DIAS.map((d) => (
                      <label key={d.n} className="btn-chico cursor-pointer text-[12px]">
                        <input type="checkbox" name="dias" value={d.n} className="mr-1" />
                        {d.l}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="text-[11px] text-slate-500">Hora inicio</span>
                    <input type="time" name="hora" defaultValue="19:00" className="campo text-[13px]" required />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Duración (min)</span>
                    <input type="number" name="duracion" defaultValue={60} min={15} step={5} className="campo text-[13px]" />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Cupo máx.</span>
                    <input type="number" name="cupo" defaultValue={10} min={1} max={500} className="campo text-[13px]" />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Semanas</span>
                    <input type="number" name="semanas" defaultValue={4} min={1} max={12} className="campo text-[13px]" />
                  </label>
                </div>

                <button type="submit" className="btn-primario w-full justify-center text-[13px]">
                  Generar serie
                </button>
              </form>
            </div>

            {/* Clase suelta */}
            <div className="tarjeta p-4">
              <h2 className="text-[15px] font-bold text-slate-900">Clase suelta / horario extra</h2>
              <p className="mt-1 text-[12.5px] text-slate-500">
                Crea una única sesión sin repetición.
              </p>
              <form action={crearClaseAccion} className="mt-3 space-y-2.5">
                <select name="servicioId" className="campo text-[13px]" required>
                  <option value="">Selecciona clase / servicio…</option>
                  {servs.map((s) => (
                    <option key={s.id as string} value={s.id as string}>
                      {s.nombre as string}
                    </option>
                  ))}
                </select>
                <select name="profesionalId" className="campo text-[13px]" required>
                  <option value="">Selecciona instructor…</option>
                  {profs.map((p) => (
                    <option key={p.id as string} value={p.id as string}>
                      {p.nombre as string}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="text-[11px] text-slate-500">Fecha</span>
                    <input type="date" name="fecha" className="campo text-[13px]" required />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Hora</span>
                    <input type="time" name="hora" defaultValue="19:00" className="campo text-[13px]" required />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Duración (min)</span>
                    <input type="number" name="duracion" defaultValue={60} min={15} step={5} className="campo text-[13px]" />
                  </label>
                  <label>
                    <span className="text-[11px] text-slate-500">Cupo máx.</span>
                    <input type="number" name="cupo" defaultValue={10} min={1} max={500} className="campo text-[13px]" />
                  </label>
                </div>
                <button type="submit" className="btn-suave w-full justify-center text-[13px]">
                  Crear clase suelta
                </button>
              </form>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
