import { headers } from "next/headers";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatearSlot, ZONA_AGENDA } from "@/lib/agendaCore";
import { claveDiaChile } from "@/lib/agendaSeguimientos";
import { googleCalendarConfigurado } from "@/lib/googleCalendar";
import CampoCopiar from "@/components/CampoCopiar";
import FormularioAgregar from "@/components/FormularioAgregar";
import {
  crearServicio,
  alternarServicio,
  crearProfesional,
  alternarProfesional,
  agregarHorario,
  eliminarHorario,
  crearBloqueo,
  eliminarBloqueo,
  configurarReservas,
  crearCitaManual,
  cambiarEstadoCita,
  configurarGoogleProfesional,
  eliminarServicio,
  eliminarProfesional,
  reabrirCita,
} from "./acciones";

export const dynamic = "force-dynamic";

/**
 * AGENDA (F4): las citas del negocio + la configuración del módulo.
 * Si la migración 220 no está aplicada, la página lo dice y no rompe nada.
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
type CitaFila = {
  id: string; nombre_contacto: string; telefono: string | null; chat_id: string | null;
  inicio: string; fin: string; estado: string; origen: string;
  ed_servicios: { nombre: string } | null; ed_profesionales: { nombre: string } | null;
};

const ESTILO_ESTADO: Record<string, { texto: string; bg: string; color: string }> = {
  agendada: { texto: "Agendada", bg: "#EEF0FE", color: "#4f46e5" },
  confirmada: { texto: "Confirmada ✓", bg: "#E6F2EE", color: "#0E7C66" },
  reagendada: { texto: "Reagendada", bg: "#EEF0FE", color: "#4f46e5" },
  cancelada: { texto: "Cancelada", bg: "#F1F2F7", color: "#6b7280" },
  no_show: { texto: "No llegó", bg: "#FDE9EA", color: "#B33A3A" },
  completada: { texto: "Completada", bg: "#E6F2EE", color: "#0E7C66" },
};

/**
 * Solo la hora ("15:00") de un instante, en hora de Chile.
 * OJO: no se puede sacar partiendo formatearSlot() por comas — devuelve
 * "lun, 3 ago, 15:00" y la coma del día engaña. Se extrae del final.
 */
function soloHora(iso: string): string {
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function nombreDia(clave: string): string {
  const [a, m, d] = clave.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d, 16, 0)); // 12:00 Chile aprox
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(fecha);
}

export default async function Agenda() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  // Detección amable de "migración 220 pendiente": una consulta chica primero.
  const sonda = await supa.from("ed_servicios").select("id").limit(1);
  const migracionLista = !sonda.error;

  if (!migracionLista) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <div className="eyebrow">Agenda</div>
        <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">Agenda y reservas</h1>
        <div className="tarjeta mt-6 p-6">
          <p className="text-[15px] font-bold">Falta un paso técnico para activar la agenda.</p>
          <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
            Hay que aplicar la migración <code>sql/220_agenda.sql</code> en Supabase (SQL editor).
            Mientras tanto, el resto del portal y los empleados siguen funcionando normal.
          </p>
        </div>
      </main>
    );
  }

  const hastaIso = new Date(Date.now() + 14 * 86_400_000).toISOString();
  const desdeIso = new Date(Date.now() - 6 * 3600_000).toISOString();

  const [{ data: servicios }, { data: profesionales }, { data: citas }, { data: cliente }] =
    await Promise.all([
      supa
        .from("ed_servicios")
        .select("id, nombre, duracion_min, precio_clp, activo")
        .eq("cliente_id", usuario.clienteId)
        .order("orden", { ascending: true })
        .order("creado_en", { ascending: true }),
      // Se piden las columnas de Google por separado (migración 221): si no
      // están, se reintenta con el set básico y la página funciona igual.
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
        .from("ed_citas")
        .select(
          "id, nombre_contacto, telefono, chat_id, inicio, fin, estado, origen, ed_servicios(nombre), ed_profesionales(nombre)",
        )
        .eq("cliente_id", usuario.clienteId)
        .gte("inicio", desdeIso)
        .lte("inicio", hastaIso)
        .order("inicio", { ascending: true }),
      supa
        .from("ed_clientes")
        .select(
          "slug, reservas_online, confirmacion_automatica, anticipacion_min_horas, horizonte_dias, ical_token",
        )
        .eq("id", usuario.clienteId)
        .maybeSingle()
        .then((r) =>
          r.error
            ? supa
                .from("ed_clientes")
                .select(
                  "slug, reservas_online, confirmacion_automatica, anticipacion_min_horas, horizonte_dias",
                )
                .eq("id", usuario.clienteId)
                .maybeSingle()
            : r,
        ),
    ]);

  const listaServicios = (servicios ?? []) as Servicio[];
  const listaProfesionales = (profesionales ?? []) as Profesional[];
  const listaCitas = (citas ?? []) as unknown as CitaFila[];

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

  // Agrupar citas por día chileno.
  const porDia = new Map<string, CitaFila[]>();
  for (const c of listaCitas) {
    const clave = claveDiaChile(c.inicio);
    porDia.set(clave, [...(porDia.get(clave) ?? []), c]);
  }

  // Base pública del portal, para armar el enlace del calendario.
  const cabeceras = headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "";
  const protocolo = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const base = host ? `${protocolo}://${host}` : "";
  const icalToken = (cliente as { ical_token?: string } | null)?.ical_token ?? null;
  const urlIcal = icalToken && base ? `${base}/api/agenda/ical/${icalToken}` : null;
  const gcalListo = googleCalendarConfigurado();

  const serviciosActivos = listaServicios.filter((s) => s.activo);
  const profesionalesActivos = listaProfesionales.filter((p) => p.activo).length;
  const configurada = serviciosActivos.length > 0 && listaProfesionales.some((p) => p.activo) && listaHorarios.length > 0;
  // Enlace público COMPLETO: el dueño lo pega en Instagram, en Google o en un QR,
  // así que tiene que ser copiable tal cual, no una ruta relativa.
  const urlPublica = cliente?.slug && base ? `${base}/reservar/${cliente.slug}` : null;

  return (
    <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Agenda</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">Agenda y reservas</h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
        Las horas que agendan tus empleados por WhatsApp, las reservas online y las que
        creas tú, todas en un solo lugar.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="pildora-indigo">
          {serviciosActivos.length} {serviciosActivos.length === 1 ? "servicio" : "servicios"}
        </span>
        <span className="pildora-indigo">
          {profesionalesActivos} {profesionalesActivos === 1 ? "profesional" : "profesionales"}
        </span>
        {cliente?.reservas_online && urlPublica ? (
          <span className="pildora-ok">Reservas online activas</span>
        ) : (
          <span className="pildora" style={{ background: "#F1F2F7", color: "var(--muted)" }}>
            Reservas online apagadas
          </span>
        )}
      </div>

      {/* Un bloqueo de "todo el negocio" que cubre AHORA deja la agenda sin
          cupos. Sin este aviso, el dueño ve "no hay horas" y no entiende por qué. */}
      {(() => {
        const ahoraMs = Date.now();
        const tapando = listaBloqueos.filter(
          (b) => !b.profesional_id && Date.parse(b.desde) <= ahoraMs && Date.parse(b.hasta) > ahoraMs,
        );
        if (tapando.length === 0) return null;
        return (
          <div className="tarjeta mt-6 p-5" style={{ background: "#FDE9EA", borderColor: "#F5C9CB" }}>
            <p className="text-[14.5px] font-bold" style={{ color: "#B33A3A" }}>
              Atención: hay un bloqueo activo sobre todo el negocio.
            </p>
            <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
              Mientras esté vigente <b>no se ofrecerá ninguna hora</b>, ni en la página de
              reservas ni por WhatsApp. Va desde {formatearSlot(tapando[0].desde)} hasta{" "}
              {formatearSlot(tapando[0].hasta)}
              {tapando[0].motivo ? ` (${tapando[0].motivo})` : ""}. Si no era la idea,
              quítalo más abajo en “Bloqueos y feriados”.
            </p>
          </div>
        );
      })()}

      {!configurada && (
        <div className="tarjeta mt-6 p-5" style={{ borderColor: "#F5C9CB" }}>
          <p className="text-[14.5px] font-bold">Para que tus empleados agenden, faltan 3 cosas:</p>
          <ol className="mt-2 list-inside list-decimal text-[14px]" style={{ color: "var(--muted)" }}>
            {serviciosActivos.length === 0 && <li>Crear al menos un servicio (más abajo).</li>}
            {!listaProfesionales.some((p) => p.activo) && <li>Crear al menos un profesional.</li>}
            {listaHorarios.length === 0 && <li>Darle horario semanal a ese profesional.</li>}
          </ol>
        </div>
      )}

      {/* ────────────── Próximas citas ────────────── */}
      <h2 className="titular mt-8 text-[19px] font-bold">Próximas citas (14 días)</h2>
      {porDia.size === 0 ? (
        <div className="tarjeta mt-3 p-5 text-[14px]" style={{ color: "var(--muted)" }}>
          Aún no hay citas en el horizonte. Cuando un cliente agende por WhatsApp o por tu
          página de reservas, aparecerá aquí.
        </div>
      ) : (
        [...porDia.entries()].map(([clave, citasDia]) => (
          <section key={clave} className="mt-4">
            <div className="text-[13px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.06em" }}>
              {nombreDia(clave)}
            </div>
            <div className="mt-2 grid gap-2">
              {citasDia.map((c) => {
                const est = ESTILO_ESTADO[c.estado] ?? ESTILO_ESTADO.agendada;
                const activa = ["agendada", "confirmada", "reagendada"].includes(c.estado);
                return (
                  <div key={c.id} className="tarjeta flex flex-wrap items-center gap-3 p-4">
                    <div className="min-w-[64px] text-[15px] font-extrabold">
                      {soloHora(c.inicio)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[14.5px] font-bold">
                        {c.nombre_contacto}
                        <span className="font-normal" style={{ color: "var(--muted)" }}>
                          {" "}· {c.ed_servicios?.nombre ?? "servicio"} · {c.ed_profesionales?.nombre ?? ""}
                        </span>
                      </div>
                      <div className="text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                        {c.telefono ?? c.chat_id ?? "sin teléfono"} · vía {c.origen}
                      </div>
                    </div>
                    <span className="pildora shrink-0" style={{ background: est.bg, color: est.color }}>
                      {est.texto}
                    </span>
                    {activa ? (
                      <div className="flex shrink-0 gap-1.5">
                        {c.estado !== "confirmada" && (
                          <form action={cambiarEstadoCita}>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="estado" value="confirmada" />
                            <button className="btn-suave px-2.5 py-1.5 text-[12px]">Confirmar</button>
                          </form>
                        )}
                        <form action={cambiarEstadoCita}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="estado" value="completada" />
                          <button className="btn-suave px-2.5 py-1.5 text-[12px]">Completada</button>
                        </form>
                        <form action={cambiarEstadoCita}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="estado" value="no_show" />
                          <button className="btn-suave px-2.5 py-1.5 text-[12px]">No llegó</button>
                        </form>
                        <form action={cambiarEstadoCita}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="estado" value="cancelada" />
                          <button className="btn-suave px-2.5 py-1.5 text-[12px]">Cancelar</button>
                        </form>
                      </div>
                    ) : (
                      // Cerrada (completada / cancelada / no llegó): siempre hay
                      // vuelta atrás, para que un clic equivocado no sea final.
                      <form action={reabrirCita} className="shrink-0">
                        <input type="hidden" name="id" value={c.id} />
                        <button className="btn-suave px-2.5 py-1.5 text-[12px]" title="Volver a dejarla como agendada">
                          Reabrir
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Cita manual */}
      <details className="tarjeta mt-5 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">+ Agendar una hora manualmente</summary>
        <form action={crearCitaManual} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-bold">Servicio</label>
            <select name="servicio" required className="campo mt-1.5">
              {serviciosActivos.map((s) => (
                <option key={s.id} value={s.id}>{s.nombre} ({s.duracion_min} min)</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold">Profesional</label>
            <select name="profesional" required className="campo mt-1.5">
              {listaProfesionales.filter((p) => p.activo).map((p) => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[13px] font-bold">Fecha y hora (Chile)</label>
            <input type="datetime-local" name="inicio" required className="campo mt-1.5" />
          </div>
          <div>
            <label className="text-[13px] font-bold">Nombre del cliente</label>
            <input name="nombre" required className="campo mt-1.5" placeholder="Camila Rojas" />
          </div>
          <div>
            <label className="text-[13px] font-bold">WhatsApp (opcional, para recordatorios)</label>
            <input name="telefono" className="campo mt-1.5" placeholder="9 1234 5678" />
          </div>
          <div className="flex items-end">
            <button type="submit" className="btn-primario px-4 py-2 text-[14px]">Agendar</button>
          </div>
        </form>
      </details>

      {/* ────────────── Configuración ────────────── */}
      <h2 className="titular mt-10 text-[19px] font-bold">Configuración</h2>

      {/* Servicios */}
      <details className="tarjeta mt-3 p-5" open={serviciosActivos.length === 0}>
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Servicios ({listaServicios.length})
        </summary>
        <div className="mt-3 grid gap-2">
          {listaServicios.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--borde)", opacity: s.activo ? 1 : 0.55 }}>
              <div className="text-[14px] font-bold">
                {s.nombre}
                <span className="font-normal" style={{ color: "var(--muted)" }}>
                  {" "}· {s.duracion_min} min · {s.precio_clp != null ? `$${s.precio_clp.toLocaleString("es-CL")}` : "según evaluación"}
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
                    <button
                      className="btn-suave px-3 py-1.5 text-[12px]"
                      style={{ color: "#B33A3A" }}
                      title="Eliminar definitivamente (no tiene citas)"
                    >
                      Eliminar
                    </button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
        <FormularioAgregar action={crearServicio} className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px_150px_auto]">
          <input name="nombre" required className="campo" placeholder="Ej: Limpieza facial" />
          <input name="duracion" type="number" min={5} max={480} defaultValue={30} className="campo" title="Duración (min)" />
          <input name="precio" className="campo" placeholder="Precio CLP (opcional)" />
          <button type="submit" className="btn-primario px-4 py-2 text-[14px]">Agregar</button>
        </FormularioAgregar>
      </details>

      {/* Profesionales + horarios */}
      <details className="tarjeta mt-3 p-5" open={listaProfesionales.length === 0}>
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Profesionales y horarios ({listaProfesionales.length})
        </summary>
        {listaProfesionales.map((p) => (
          <div key={p.id} className="mt-3 rounded-xl border p-4" style={{ borderColor: "var(--borde)", opacity: p.activo ? 1 : 0.55 }}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-[15px] font-bold">{p.nombre}</div>
              <div className="flex shrink-0 gap-1.5">
                <form action={alternarProfesional}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="activo" value={String(p.activo)} />
                  <button className="btn-suave px-3 py-1.5 text-[12px]">{p.activo ? "Apagar" : "Encender"}</button>
                </form>
                {!profesionalesConCitas.has(p.id) && (
                  <form action={eliminarProfesional}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      className="btn-suave px-3 py-1.5 text-[12px]"
                      style={{ color: "#B33A3A" }}
                      title="Eliminar definitivamente (no tiene citas)"
                    >
                      Eliminar
                    </button>
                  </form>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {listaHorarios.filter((h) => h.profesional_id === p.id).map((h) => (
                <form key={h.id} action={eliminarHorario} className="inline">
                  <input type="hidden" name="id" value={h.id} />
                  <button
                    className="pildora"
                    style={{ background: "#EEF0FE", color: "#4f46e5" }}
                    title="Clic para eliminar este tramo"
                  >
                    {DIAS[h.dia_semana]} {String(h.desde).slice(0, 5)}–{String(h.hasta).slice(0, 5)} ✕
                  </button>
                </form>
              ))}
              {listaHorarios.filter((h) => h.profesional_id === p.id).length === 0 && (
                <span className="text-[13px]" style={{ color: "var(--muted-2)" }}>Sin horario todavía — sin horario no hay cupos.</span>
              )}
            </div>
            <form action={agregarHorario} className="mt-3 flex flex-wrap items-center gap-2">
              <input type="hidden" name="profesional" value={p.id} />
              {DIAS.map((d, i) => (
                <label key={i} className="flex items-center gap-1 text-[12.5px] font-semibold">
                  <input type="checkbox" name="dias" value={i} defaultChecked={i >= 1 && i <= 5} /> {d.slice(0, 3)}
                </label>
              ))}
              <input type="time" name="desde" defaultValue="10:00" required className="campo !w-auto" />
              <span className="text-[13px]">a</span>
              <input type="time" name="hasta" defaultValue="19:00" required className="campo !w-auto" />
              <button type="submit" className="btn-suave px-3 py-1.5 text-[13px]">Agregar tramo</button>
            </form>
          </div>
        ))}
        <FormularioAgregar action={crearProfesional} className="mt-4 flex gap-3">
          <input name="nombre" required className="campo" placeholder="Nombre (persona, sillón o sala)" />
          <button type="submit" className="btn-primario shrink-0 px-4 py-2 text-[14px]">Agregar</button>
        </FormularioAgregar>
      </details>

      {/* Bloqueos */}
      <details className="tarjeta mt-3 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Bloqueos y feriados ({listaBloqueos.length})
        </summary>
        <div className="mt-3 grid gap-2">
          {listaBloqueos.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: "var(--borde)" }}>
              <div className="text-[13.5px]">
                <b>{formatearSlot(b.desde)}</b> → <b>{formatearSlot(b.hasta)}</b>
                {b.motivo ? ` · ${b.motivo}` : ""}
                {!b.profesional_id && " · todo el negocio"}
              </div>
              <form action={eliminarBloqueo}>
                <input type="hidden" name="id" value={b.id} />
                <button className="btn-suave px-3 py-1.5 text-[12px]">Quitar</button>
              </form>
            </div>
          ))}
        </div>
        <FormularioAgregar action={crearBloqueo} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_160px_1fr_auto]">
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
      </details>

      {/* Reservas online */}
      <details className="tarjeta mt-3 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Página pública de reservas {cliente?.reservas_online ? "· activa ✓" : "· apagada"}
        </summary>
        <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted)" }}>
          Un enlace para que tus clientes reserven solos (Instagram, Google, QR en el local).
          Cada reserva llega a esta agenda y respeta los mismos cupos que ven tus empleados.
        </p>
        {cliente?.reservas_online && urlPublica && (
          <div className="mt-3">
            <div className="text-[13px] font-bold">Tu enlace de reservas</div>
            <CampoCopiar valor={urlPublica} />
            <a
              href={urlPublica}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-block text-[13px] font-semibold underline"
              style={{ color: "var(--indigo)" }}
            >
              Abrir para ver cómo lo ven tus clientes →
            </a>
          </div>
        )}
        <form action={configurarReservas} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[13px] font-bold">Dirección (slug)</label>
            <input name="slug" defaultValue={cliente?.slug ?? ""} className="campo mt-1.5" placeholder="estetica-aurora" />
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
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" name="reservas_online" defaultChecked={!!cliente?.reservas_online} />
            Activar la página pública
          </label>
          <label className="flex items-center gap-2 text-[14px] font-semibold">
            <input type="checkbox" name="confirmacion_automatica" defaultChecked={cliente?.confirmacion_automatica !== false} />
            Confirmación automática (sin revisión manual)
          </label>
          <div>
            <button type="submit" className="btn-primario px-4 py-2 text-[14px]">Guardar configuración</button>
          </div>
        </form>
      </details>

      {/* Calendarios externos */}
      <details className="tarjeta mt-3 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Ver tus horas en Google Calendar
        </summary>

        {/* Opción 1: suscripción por enlace (funciona hoy, sin permisos) */}
        <div className="mt-4">
          <div className="text-[14.5px] font-bold">Opción simple · ver tus horas en el celular</div>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted)" }}>
            Copia este enlace y pégalo en Google Calendar → <i>Otros calendarios</i> →{" "}
            <i>Desde URL</i>. Tus horas de Respondo aparecerán junto al resto de tu
            calendario. Google lo actualiza cada algunas horas.
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

        {/* Opción 2: sincronización real por cuenta de servicio */}
        <div className="mt-6 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
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
            <form key={p.id} action={configurarGoogleProfesional} className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--borde)" }}>
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
                <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#0E7C66" }}>
                  Conectado ✓
                </p>
              )}
            </form>
          ))}
        </div>
      </details>
    </main>
  );
}
