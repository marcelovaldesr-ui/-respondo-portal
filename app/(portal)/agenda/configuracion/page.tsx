import Link from "next/link";
import { headers } from "next/headers";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatearSlot } from "@/lib/agendaCore";
import { googleCalendarConfigurado } from "@/lib/googleCalendar";
import CampoCopiar from "@/components/CampoCopiar";
import FormularioAgregar from "@/components/FormularioAgregar";
import HorarioSemanal from "@/components/HorarioSemanal";
import {
  crearServicio,
  alternarServicio,
  eliminarServicio,
  crearProfesional,
  alternarProfesional,
  eliminarProfesional,
  agregarHorario,
  eliminarHorario,
  crearBloqueo,
  eliminarBloqueo,
  configurarReservas,
  configurarGoogleProfesional,
} from "../acciones";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN DE LA AGENDA.
 *
 * Vive aparte del calendario a propósito: esto se toca al montar el negocio y
 * después casi nunca, mientras que el calendario se mira todos los días. Antes
 * estaban mezclados y la pantalla parecía un formulario, no una agenda.
 */

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type Servicio = { id: string; nombre: string; duracion_min: number; precio_clp: number | null; activo: boolean };
type Profesional = {
  id: string;
  nombre: string;
  activo: boolean;
  gcal_id?: string | null;
  gcal_sync?: boolean | null;
  gcal_ultimo_error?: string | null;
};
type Horario = { id: string; profesional_id: string; dia_semana: number; desde: string; hasta: string };
type Bloqueo = { id: string; profesional_id: string | null; desde: string; hasta: string; motivo: string | null };

export default async function ConfiguracionAgenda() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  const sonda = await supa.from("ed_servicios").select("id").limit(1);
  if (sonda.error) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <div className="eyebrow">Agenda</div>
        <h1 className="h-pagina">Configuración</h1>
        <div className="tarjeta mt-6 p-6 text-[14px]" style={{ color: "var(--muted)" }}>
          Falta aplicar la migración <code>sql/220_agenda.sql</code> en Supabase.
        </div>
      </main>
    );
  }

  const [{ data: servicios }, { data: profesionales }, { data: cliente }] = await Promise.all([
    supa
      .from("ed_servicios")
      .select("id, nombre, duracion_min, precio_clp, activo")
      .eq("cliente_id", usuario.clienteId)
      .order("orden", { ascending: true })
      .order("creado_en", { ascending: true }),
    // Las columnas de Google son de la migración 221: si no están, se reintenta
    // con el set básico y la pantalla funciona igual.
    supa
      .from("ed_profesionales")
      .select("id, nombre, activo, gcal_id, gcal_sync, gcal_ultimo_error")
      .eq("cliente_id", usuario.clienteId)
      .order("creado_en", { ascending: true })
      .then((r) =>
        r.error
          ? supa
              .from("ed_profesionales")
              .select("id, nombre, activo")
              .eq("cliente_id", usuario.clienteId)
              .order("creado_en", { ascending: true })
          : r,
      ),
    supa
      .from("ed_clientes")
      .select("slug, reservas_online, confirmacion_automatica, anticipacion_min_horas, horizonte_dias, ical_token")
      .eq("id", usuario.clienteId)
      .maybeSingle()
      .then((r) =>
        r.error
          ? supa
              .from("ed_clientes")
              .select("slug, reservas_online, confirmacion_automatica, anticipacion_min_horas, horizonte_dias")
              .eq("id", usuario.clienteId)
              .maybeSingle()
          : r,
      ),
  ]);

  const listaServicios = (servicios ?? []) as Servicio[];
  const listaProfesionales = (profesionales ?? []) as Profesional[];

  const profIds = listaProfesionales.map((p) => p.id);
  const [{ data: horarios }, { data: bloqueos }] = await Promise.all([
    profIds.length
      ? supa.from("ed_horarios").select("id, profesional_id, dia_semana, desde, hasta").in("profesional_id", profIds).order("dia_semana")
      : Promise.resolve({ data: [] as Horario[] }),
    supa
      .from("ed_bloqueos")
      .select("id, profesional_id, desde, hasta, motivo")
      .eq("cliente_id", usuario.clienteId)
      .gte("hasta", new Date().toISOString())
      .order("desde"),
  ]);
  const listaHorarios = (horarios ?? []) as Horario[];
  const listaBloqueos = (bloqueos ?? []) as Bloqueo[];

  // Qué servicios y profesionales tienen historial de citas: los que NO tienen
  // se pueden borrar de verdad; los que sí, solo apagar (para no perder el
  // historial ni chocar con la llave foránea).
  const { data: usados } = await supa
    .from("ed_citas")
    .select("servicio_id, profesional_id")
    .eq("cliente_id", usuario.clienteId);
  const serviciosConCitas = new Set((usados ?? []).map((u) => u.servicio_id as string));
  const profesionalesConCitas = new Set((usados ?? []).map((u) => u.profesional_id as string));

  const cabeceras = headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "";
  const protocolo = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const base = host ? `${protocolo}://${host}` : "";
  const icalToken = (cliente as { ical_token?: string } | null)?.ical_token ?? null;
  const urlIcal = icalToken && base ? `${base}/api/agenda/ical/${icalToken}` : null;
  const urlPublica = cliente?.slug && base ? `${base}/reservar/${cliente.slug}` : null;
  const gcalListo = googleCalendarConfigurado();

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      <Link
        href="/agenda"
        className="text-[13px] font-bold"
        style={{ color: "var(--indigo)" }}
      >
        ‹ Volver al calendario
      </Link>
      <h1 className="h-pagina">
        Configuración de la agenda
      </h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
        Qué vendes, quién lo hace, a qué horas y quién puede reservar solo. Esto define
        los cupos que ofrecen tus empleados por WhatsApp y tu página pública.
      </p>

      {/* ── Servicios ───────────────────────────────────────────────── */}
      <Seccion
        titulo="Servicios"
        cuenta={listaServicios.length}
        ayuda="Lo que ofreces y cuánto dura cada cosa. La duración define el largo del bloque en el calendario."
      >
        <div className="grid gap-2">
          {listaServicios.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[7px] border p-3"
              style={{ borderColor: "var(--borde)", opacity: s.activo ? 1 : 0.55 }}
            >
              <div className="min-w-0 text-[14px] font-bold">
                {s.nombre}
                <span className="font-normal" style={{ color: "var(--muted)" }}>
                  {" "}· {s.duracion_min} min ·{" "}
                  {s.precio_clp != null ? `$${s.precio_clp.toLocaleString("es-CL")}` : "según evaluación"}
                </span>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <form action={alternarServicio}>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="activo" value={String(s.activo)} />
                  <button className="btn-suave px-3 py-1.5 text-[12px]">{s.activo ? "Apagar" : "Encender"}</button>
                </form>
                {!serviciosConCitas.has(s.id) && (
                  <form action={eliminarServicio}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn-suave px-3 py-1.5 text-[12px]" style={{ color: "#B33A3A" }} title="Eliminar definitivamente (no tiene citas)">
                      Eliminar
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
          {listaServicios.length === 0 && (
            <p className="text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              Todavía no hay servicios. Sin al menos uno, no se puede agendar nada.
            </p>
          )}
        </div>
        <FormularioAgregar action={crearServicio} className="mt-4 grid gap-3 sm:grid-cols-[1fr_120px_150px_auto]">
          <input name="nombre" required className="campo" placeholder="Ej: Corte de pelo" />
          <input name="duracion" type="number" min={5} max={480} defaultValue={30} className="campo" title="Duración en minutos" />
          <input name="precio" className="campo" placeholder="Precio CLP (opcional)" />
          <button type="submit" className="btn-primario px-4 py-2 text-[14px]">Agregar</button>
        </FormularioAgregar>
      </Seccion>

      {/* ── Profesionales y horarios ────────────────────────────────── */}
      <Seccion
        titulo="Profesionales y horarios"
        cuenta={listaProfesionales.length}
        ayuda="Cada profesional es una columna del calendario y una agenda independiente. Puede ser una persona, un sillón, una sala o una cancha."
      >
        <div className="grid gap-3">
          {listaProfesionales.map((p) => {
            const suyos = listaHorarios.filter((h) => h.profesional_id === p.id);
            return (
              <div key={p.id} className="rounded-[7px] border p-4" style={{ borderColor: "var(--borde)", opacity: p.activo ? 1 : 0.6 }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-[15px] font-bold">
                    {p.nombre}
                    {!p.activo && (
                      <span className="pildora ml-2" style={{ background: "#F1F2F7", color: "var(--muted)" }}>
                        apagado
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <form action={alternarProfesional}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="activo" value={String(p.activo)} />
                      <button className="btn-suave px-3 py-1.5 text-[12px]">{p.activo ? "Apagar" : "Encender"}</button>
                    </form>
                    {!profesionalesConCitas.has(p.id) && (
                      <form action={eliminarProfesional}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn-suave px-3 py-1.5 text-[12px]" style={{ color: "#B33A3A" }} title="Eliminar definitivamente (no tiene citas)">
                          Eliminar
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                <HorarioSemanal
                  profesionalId={p.id}
                  tramos={suyos.map((h) => ({
                    id: h.id,
                    diaSemana: h.dia_semana,
                    desde: String(h.desde).slice(0, 5),
                    hasta: String(h.hasta).slice(0, 5),
                  }))}
                  accionAgregar={agregarHorario}
                  accionEliminar={eliminarHorario}
                />
              </div>
            );
          })}
        </div>
        <FormularioAgregar action={crearProfesional} className="mt-4 flex gap-3">
          <input name="nombre" required className="campo" placeholder="Nombre (persona, sillón o sala)" />
          <button type="submit" className="btn-primario shrink-0 px-4 py-2 text-[14px]">Agregar</button>
        </FormularioAgregar>
      </Seccion>

      {/* ── Bloqueos ────────────────────────────────────────────────── */}
      <Seccion
        titulo="Bloqueos y feriados"
        cuenta={listaBloqueos.length}
        ayuda="Días u horas en que no se atiende. Mientras un bloqueo esté vigente, esas horas no se ofrecen en ningún lado."
      >
        <div className="grid gap-2">
          {listaBloqueos.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[7px] border p-3" style={{ borderColor: "var(--borde)" }}>
              <div className="text-[13.5px]">
                <b>{formatearSlot(b.desde)}</b> → <b>{formatearSlot(b.hasta)}</b>
                {b.motivo ? ` · ${b.motivo}` : ""}
                {!b.profesional_id && (
                  <span className="pildora ml-2" style={{ background: "#FDE9EA", color: "#B33A3A" }}>
                    todo el negocio
                  </span>
                )}
              </div>
              <form action={eliminarBloqueo}>
                <input type="hidden" name="id" value={b.id} />
                <button className="btn-suave px-3 py-1.5 text-[12px]">Quitar</button>
              </form>
            </div>
          ))}
          {listaBloqueos.length === 0 && (
            <p className="text-[13.5px]" style={{ color: "var(--muted-2)" }}>Sin bloqueos vigentes.</p>
          )}
        </div>
        <FormularioAgregar action={crearBloqueo} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_160px_1fr_auto]">
          <div>
            <label className="text-[12.5px] font-bold">Desde</label>
            <input type="datetime-local" name="desde" required className="campo mt-1" />
          </div>
          <div>
            <label className="text-[12.5px] font-bold">Hasta</label>
            <input type="datetime-local" name="hasta" required className="campo mt-1" />
          </div>
          <div>
            <label className="text-[12.5px] font-bold">Quién</label>
            <select name="profesional" className="campo mt-1">
              <option value="">Todo el negocio</option>
              {listaProfesionales.map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[12.5px] font-bold">Motivo (opcional)</label>
            <input name="motivo" className="campo mt-1" placeholder="Feriado, vacaciones…" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primario px-4 py-2 text-[14px]">Bloquear</button>
          </div>
        </FormularioAgregar>
      </Seccion>

      {/* ── Página pública ──────────────────────────────────────────── */}
      <Seccion
        titulo="Página pública de reservas"
        insignia={cliente?.reservas_online ? "activa" : "apagada"}
        ayuda="Un enlace para que tus clientes reserven solos (Instagram, Google, QR en el local). Cada reserva llega a esta agenda y respeta los mismos cupos que ven tus empleados."
      >
        {cliente?.reservas_online && urlPublica && (
          <div className="rounded-[7px] border p-4" style={{ borderColor: "var(--borde)", background: "var(--indigo-suave)" }}>
            <div className="text-[13px] font-bold">Tu enlace de reservas</div>
            <CampoCopiar valor={urlPublica} />
            <a href={urlPublica} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-[13px] font-bold underline" style={{ color: "var(--indigo)" }}>
              Abrir para ver cómo lo ven tus clientes →
            </a>
          </div>
        )}
        <form action={configurarReservas} className="mt-4 grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-bold">Dirección (slug)</label>
            <input name="slug" defaultValue={cliente?.slug ?? ""} className="campo mt-1.5" placeholder="barberia-nogal" />
            <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
              Es la parte final del enlace. Solo letras, números y guiones.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[13px] font-bold">Anticipación mín. (horas)</label>
              <input type="number" name="anticipacion" min={0} max={72} defaultValue={cliente?.anticipacion_min_horas ?? 2} className="campo mt-1.5" />
            </div>
            <div>
              <label className="text-[13px] font-bold">Horizonte (días)</label>
              <input type="number" name="horizonte" min={1} max={90} defaultValue={cliente?.horizonte_dias ?? 30} className="campo mt-1.5" />
            </div>
          </div>
          <label className="flex items-start gap-2.5 rounded-[7px] border p-3 text-[14px] font-semibold" style={{ borderColor: "var(--borde)" }}>
            <input type="checkbox" name="reservas_online" defaultChecked={!!cliente?.reservas_online} className="mt-0.5" />
            <span>
              Activar la página pública
              <span className="block text-[12.5px] font-normal" style={{ color: "var(--muted)" }}>
                Si está apagada, el enlace muestra un aviso y no se puede reservar.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-[7px] border p-3 text-[14px] font-semibold" style={{ borderColor: "var(--borde)" }}>
            <input type="checkbox" name="confirmacion_automatica" defaultChecked={cliente?.confirmacion_automatica !== false} className="mt-0.5" />
            <span>
              Confirmación automática
              <span className="block text-[12.5px] font-normal" style={{ color: "var(--muted)" }}>
                La hora queda tomada al instante, sin que tengas que aprobarla.
              </span>
            </span>
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primario px-5 py-2 text-[14px]">Guardar configuración</button>
          </div>
        </form>
      </Seccion>

      {/* ── Google Calendar ─────────────────────────────────────────── */}
      <Seccion
        titulo="Ver tus horas en Google Calendar"
        ayuda="Para tener las horas de Respondo junto al resto de tu calendario, en el celular."
      >
        <div className="rounded-[7px] border p-4" style={{ borderColor: "var(--borde)" }}>
          <div className="text-[14.5px] font-bold">Opción simple · solo ver</div>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted)" }}>
            Copia este enlace y pégalo en Google Calendar → <i>Otros calendarios</i> → <i>Desde URL</i>.
            Tus horas aparecerán junto al resto de tu calendario. Google lo actualiza cada algunas horas.
          </p>
          {urlIcal ? (
            <CampoCopiar valor={urlIcal} />
          ) : (
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              Disponible al aplicar la migración <code>sql/221_agenda_calendarios.sql</code>.
            </p>
          )}
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted-2)" }}>
            Es un enlace privado: no lo compartas con quien no deba ver tus horas.
          </p>
        </div>

        <div className="mt-4 rounded-[7px] border p-4" style={{ borderColor: "var(--borde)" }}>
          <div className="text-[14.5px] font-bold">
            Sincronización en dos vías {gcalListo ? "· disponible" : "· no configurada aún"}
          </div>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted)" }}>
            Además de escribir tus citas en Google, lee tus compromisos personales para no
            ofrecer horas cuando ya estás ocupado. Para activarla, comparte tu calendario de
            Google (permiso <i>Hacer cambios en los eventos</i>) con el correo de Respondo y
            pega abajo el ID de tu calendario.
          </p>
          {!gcalListo && (
            <p className="mt-2 text-[13px] font-semibold" style={{ color: "#B0842A" }}>
              Falta que el equipo de Respondo configure la cuenta de servicio en el servidor.
            </p>
          )}
          {listaProfesionales.map((p) => (
            <form key={p.id} action={configurarGoogleProfesional} className="mt-3 rounded-[7px] border p-3" style={{ borderColor: "var(--borde)" }}>
              <input type="hidden" name="profesional" value={p.id} />
              <div className="text-[14px] font-bold">{p.nombre}</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                <input
                  name="gcal_id"
                  defaultValue={p.gcal_id ?? ""}
                  className="campo font-mono text-[12.5px]"
                  placeholder="correo@gmail.com o id@group.calendar.google.com"
                />
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  <input type="checkbox" name="gcal_sync" defaultChecked={!!p.gcal_sync} /> Activar
                </label>
                <button type="submit" className="btn-suave px-3 py-1.5 text-[13px]">Guardar</button>
              </div>
              {p.gcal_ultimo_error && (
                <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#B33A3A" }}>
                  Google respondió: {p.gcal_ultimo_error}
                </p>
              )}
              {p.gcal_sync && !p.gcal_ultimo_error && (
                <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#0E7C66" }}>Conectado ✓</p>
              )}
            </form>
          ))}
          {listaProfesionales.length === 0 && (
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              Primero crea un profesional.
            </p>
          )}
        </div>
      </Seccion>

      <p className="mt-8 text-center text-[13px]">
        <Link href="/agenda" className="font-bold" style={{ color: "var(--indigo)" }}>
          ‹ Volver al calendario
        </Link>
      </p>
    </main>
  );
}

/** Bloque de configuración: título, ayuda de una línea y contenido. */
function Seccion({
  titulo,
  cuenta,
  insignia,
  ayuda,
  children,
}: {
  titulo: string;
  cuenta?: number;
  insignia?: string;
  ayuda: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tarjeta mt-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="h-seccion">{titulo}</h2>
        {cuenta !== undefined && <span className="pildora-indigo">{cuenta}</span>}
        {insignia && (
          <span
            className="pildora"
            style={
              insignia === "activa"
                ? { background: "var(--ok-suave)", color: "var(--ok)" }
                : { background: "#F1F2F7", color: "var(--muted)" }
            }
          >
            {insignia}
          </span>
        )}
      </div>
      <p className="mt-1 max-w-2xl text-[13.5px]" style={{ color: "var(--muted)" }}>
        {ayuda}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
