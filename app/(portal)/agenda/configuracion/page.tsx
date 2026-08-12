import Link from "next/link";
import { headers } from "next/headers";
import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatearSlot } from "@/lib/agendaCore";
import { googleCalendarConfigurado } from "@/lib/googleCalendar";
import { oauthConfigurado } from "@/lib/googleOAuth";
import CampoCopiar from "@/components/CampoCopiar";
import FormularioAgregar from "@/components/FormularioAgregar";
import HorarioSemanal from "@/components/HorarioSemanal";
import FichaServicioConfig, { type CampoConfig } from "@/components/FichaServicioConfig";
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
  rotarTokenIcal,
  configurarGoogleProfesional,
  desconectarGoogleOauth,
  crearCampoFicha,
  eliminarCampoFicha,
  configurarBufferServicio,
  configurarAutogestion,
} from "../acciones";

export const dynamic = "force-dynamic";

/**
 * CONFIGURACIÓN DE LA AGENDA.
 *
 * Vive aparte del calendario a propósito: esto se toca al montar el negocio y
 * después casi nunca, mientras que el calendario se mira todos los días. Antes
 * estaban mezclados y la pantalla parecía un formulario, no una agenda.
 */

type Servicio = { id: string; nombre: string; duracion_min: number; precio_clp: number | null; activo: boolean; buffer_min?: number | null };
type Profesional = {
  id: string;
  nombre: string;
  activo: boolean;
  gcal_id?: string | null;
  gcal_sync?: boolean | null;
  gcal_ultimo_error?: string | null;
  gcal_modo?: string | null;
  gcal_oauth_email?: string | null;
};
type Horario = { id: string; profesional_id: string; dia_semana: number; desde: string; hasta: string };
type Bloqueo = { id: string; profesional_id: string | null; desde: string; hasta: string; motivo: string | null };

export default async function ConfiguracionAgenda({
  searchParams,
}: {
  searchParams?: Promise<{ gcal_oauth?: string }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const usuario = await exigirPermisoPortal("configurar_agenda");
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
      // buffer_min llega con la migración 277: si no está aplicada, pedirlo
      // dejaría la pantalla SIN servicios. Se reintenta sin la columna.
      .from("ed_servicios")
      .select("id, nombre, duracion_min, precio_clp, activo, buffer_min")
      .eq("cliente_id", usuario.clienteId)
      .order("orden", { ascending: true })
      .order("creado_en", { ascending: true })
      .then((r) =>
        r.error
          ? supa
              .from("ed_servicios")
              .select("id, nombre, duracion_min, precio_clp, activo")
              .eq("cliente_id", usuario.clienteId)
              .order("orden", { ascending: true })
              .order("creado_en", { ascending: true })
          : r,
      ),
    // Las columnas de Google son de las migraciones 221 y 222: si faltan, se
    // reintenta con juegos de columnas más chicos y la pantalla sigue andando.
    supa
      .from("ed_profesionales")
      .select("id, nombre, activo, gcal_id, gcal_sync, gcal_ultimo_error, gcal_modo, gcal_oauth_email")
      .eq("cliente_id", usuario.clienteId)
      .order("creado_en", { ascending: true })
      .then((r) =>
        r.error
          ? supa
              .from("ed_profesionales")
              .select("id, nombre, activo, gcal_id, gcal_sync, gcal_ultimo_error")
              .eq("cliente_id", usuario.clienteId)
              .order("creado_en", { ascending: true })
              .then((r2) =>
                r2.error
                  ? supa
                      .from("ed_profesionales")
                      .select("id, nombre, activo")
                      .eq("cliente_id", usuario.clienteId)
                      .order("creado_en", { ascending: true })
                  : r2,
              )
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

  /**
   * Ficha personalizable por servicio (migración 277). Tolerante a que no esté
   * aplicada: sin la tabla, `campos` queda vacío y la sección se ve como antes.
   */
  const { data: camposCrudos } = await supa
    .from("ed_servicio_campos")
    .select("id, servicio_id, etiqueta, tipo, opciones, obligatorio, ayuda, orden")
    .in("servicio_id", listaServicios.map((s) => s.id))
    .order("orden", { ascending: true });
  const camposPorServicio = new Map<string, CampoConfig[]>();
  for (const c of camposCrudos ?? []) {
    const sid = c.servicio_id as string;
    camposPorServicio.set(sid, [...(camposPorServicio.get(sid) ?? []), c as unknown as CampoConfig]);
  }

  /**
   * Reglas de autogestión. En consulta aparte y tolerante a error: las columnas
   * llegan con la migración 277 y pedirlas en el select principal tumbaría toda
   * la pantalla de configuración en la ventana previa a aplicarla.
   */
  const { data: cfgAuto } = await supa
    .from("ed_clientes")
    .select("permite_cancelar_online, permite_reagendar_online, cancelacion_min_horas")
    .eq("id", usuario.clienteId)
    .maybeSingle();
  const autogestion = {
    permiteCancelar: (cfgAuto?.permite_cancelar_online as boolean | undefined) ?? true,
    permiteReagendar: (cfgAuto?.permite_reagendar_online as boolean | undefined) ?? true,
    cancelacionMinHoras: (cfgAuto?.cancelacion_min_horas as number | undefined) ?? 4,
  };

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

  const cabeceras = await headers();
  const host = cabeceras.get("x-forwarded-host") ?? cabeceras.get("host") ?? "";
  const protocolo = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
  const base = host ? `${protocolo}://${host}` : "";
  const icalToken = (cliente as { ical_token?: string } | null)?.ical_token ?? null;
  const urlIcal = icalToken && base ? `${base}/api/agenda/ical/${icalToken}` : null;
  const urlPublica = cliente?.slug && base ? `${base}/reservar/${cliente.slug}` : null;
  const gcalListo = googleCalendarConfigurado();
  const gcalOauthListo = oauthConfigurado();
  const avisoOauth = params?.gcal_oauth;

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
              className="rounded-[7px] border p-3"
              style={{ borderColor: "var(--borde)", opacity: s.activo ? 1 : 0.55 }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
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

              {/* Ficha del servicio + preparación (migración 277). Es lo que
                  hace que la misma agenda sirva para una clínica y un taller. */}
              <FichaServicioConfig
                servicioId={s.id}
                servicioNombre={s.nombre}
                campos={camposPorServicio.get(s.id) ?? []}
                bufferMin={s.buffer_min ?? 0}
                crearCampo={crearCampoFicha}
                eliminarCampo={eliminarCampoFicha}
                guardarBuffer={configurarBufferServicio}
              />
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

      {/* ── Autogestión del cliente final (migración 277) ────────────── */}
      <Seccion
        titulo="Que tus clientes se muevan solos"
        ayuda="En la confirmación y el recordatorio va un enlace propio de cada hora. Desde ahí el cliente la cambia o la anula sin escribirte."
      >
        <div className="rounded-[7px] p-3.5 text-[13.5px]" style={{ background: "var(--indigo-suave)", color: "var(--indigo)" }}>
          Cuando alguien anula por su cuenta, el cupo se libera <b>al instante</b> y
          otra persona puede tomarlo. Si tiene que escribirte, la hora se pierde
          igual pero el cupo queda ocupado hasta que alcances a moverlo.
        </div>

        <form action={configurarAutogestion} className="mt-4 grid gap-3.5 sm:grid-cols-2">
          <label className="flex items-start gap-2.5 rounded-[7px] border p-3 text-[14px] font-semibold" style={{ borderColor: "var(--borde)" }}>
            <input
              type="checkbox"
              name="reagendar"
              defaultChecked={autogestion.permiteReagendar}
              className="mt-0.5"
            />
            <span>
              Puede cambiar día u hora
              <span className="block text-[12.5px] font-normal" style={{ color: "var(--muted)" }}>
                Elige entre los cupos que tengas libres. Nunca fuera de tu horario.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-[7px] border p-3 text-[14px] font-semibold" style={{ borderColor: "var(--borde)" }}>
            <input
              type="checkbox"
              name="cancelar"
              defaultChecked={autogestion.permiteCancelar}
              className="mt-0.5"
            />
            <span>
              Puede anular su hora
              <span className="block text-[12.5px] font-normal" style={{ color: "var(--muted)" }}>
                Se le pide confirmación antes. El cupo queda libre al tiro.
              </span>
            </span>
          </label>

          <div>
            <label className="text-[13px] font-bold">Se cierra cuántas horas antes</label>
            <input
              type="number"
              name="cancelacion_horas"
              min={0}
              max={168}
              defaultValue={autogestion.cancelacionMinHoras}
              className="campo mt-1.5"
            />
            <p className="mt-1 text-[12px]" style={{ color: "var(--muted-2)" }}>
              Pasado ese punto ya no puede por internet y se le pide que te escriba.
              Con 0, puede hasta la hora misma.
            </p>
          </div>

          <div className="sm:col-span-2">
            <button type="submit" className="btn-primario px-5 py-2 text-[14px]">Guardar</button>
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
            <>
              <CampoCopiar valor={urlIcal} />
              <form action={rotarTokenIcal} className="mt-2">
                <button type="submit" className="btn-chico">
                  Renovar enlace privado
                </button>
              </form>
            </>
          ) : (
            <p className="mt-2 text-[13.5px]" style={{ color: "var(--muted-2)" }}>
              Disponible al aplicar la migración <code>sql/221_agenda_calendarios.sql</code>.
            </p>
          )}
          <p className="mt-1.5 text-[12px]" style={{ color: "var(--muted-2)" }}>
            Es un enlace privado: no lo compartas con quien no deba ver tus horas. Al
            renovarlo, el enlace anterior deja de funcionar de inmediato.
          </p>
        </div>

        <div className="mt-4 rounded-[7px] border p-4" style={{ borderColor: "var(--borde)" }}>
          <div className="text-[14.5px] font-bold">
            Sincronización en dos vías {gcalListo || gcalOauthListo ? "· disponible" : "· no configurada aún"}
          </div>
          <p className="mt-1 text-[13.5px]" style={{ color: "var(--muted)" }}>
            Además de escribir tus citas en Google, lee tus compromisos personales para no
            ofrecer horas cuando ya estás ocupado.
          </p>
          {!gcalListo && !gcalOauthListo && (
            <p className="mt-2 text-[13px] font-semibold" style={{ color: "#B0842A" }}>
              Falta que el equipo de Respondo configure la conexión con Google en el servidor.
            </p>
          )}
          {avisoOauth === "ok" && (
            <p className="mt-2 rounded-[7px] px-3 py-2 text-[13px] font-semibold" style={{ color: "#0E7C66", background: "#E9F7F3" }}>
              Google Calendar conectado ✓
            </p>
          )}
          {avisoOauth === "cancelado" && (
            <p className="mt-2 rounded-[7px] px-3 py-2 text-[13px] font-semibold" style={{ color: "#B0842A", background: "#FBF3E4" }}>
              Cancelaste la conexión en Google — no se cambió nada.
            </p>
          )}
          {avisoOauth === "error" && (
            <p className="mt-2 rounded-[7px] px-3 py-2 text-[13px] font-semibold" style={{ color: "#B33A3A", background: "#FBECEC" }}>
              Algo falló al conectar con Google. Probá de nuevo, o usá la opción manual más abajo.
            </p>
          )}
          {listaProfesionales.map((p) => {
            const conectadoOauth = p.gcal_modo === "oauth" && !!p.gcal_sync;
            return (
              <div key={p.id} className="mt-3 rounded-[7px] border p-3" style={{ borderColor: "var(--borde)" }}>
                <div className="text-[14px] font-bold">{p.nombre}</div>

                {conectadoOauth ? (
                  <>
                    <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#0E7C66" }}>
                      Conectado ✓ {p.gcal_oauth_email ? `· como ${p.gcal_oauth_email}` : ""}
                    </p>
                    {p.gcal_ultimo_error && (
                      <p className="mt-1 text-[12.5px] font-semibold" style={{ color: "#B33A3A" }}>
                        Google respondió: {p.gcal_ultimo_error}
                      </p>
                    )}
                    <form action={desconectarGoogleOauth} className="mt-2">
                      <input type="hidden" name="profesional" value={p.id} />
                      <button type="submit" className="btn-suave px-3 py-1.5 text-[13px]">Desconectar</button>
                    </form>
                  </>
                ) : (
                  <>
                    {gcalOauthListo && (
                      <a
                        href={`/api/google/conectar?profesional=${p.id}`}
                        className="btn-primario mt-2 inline-block px-4 py-2 text-[13.5px]"
                      >
                        Conectar Google Calendar
                      </a>
                    )}
                    <details className="mt-2">
                      <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: "var(--muted)" }}>
                        {gcalOauthListo ? "O conectar a mano" : "Conectar a mano"}
                      </summary>
                      <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--muted)" }}>
                        Comparte tu calendario de Google (permiso <i>Hacer cambios en los eventos</i>) con
                        el correo de Respondo y pega acá el ID de tu calendario.
                      </p>
                      <form action={configurarGoogleProfesional} className="mt-2">
                        <input type="hidden" name="profesional" value={p.id} />
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
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
                      </form>
                    </details>
                    {p.gcal_ultimo_error && (
                      <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#B33A3A" }}>
                        Google respondió: {p.gcal_ultimo_error}
                      </p>
                    )}
                    {p.gcal_sync && !p.gcal_ultimo_error && (
                      <p className="mt-2 text-[12.5px] font-semibold" style={{ color: "#0E7C66" }}>Conectado ✓</p>
                    )}
                  </>
                )}
              </div>
            );
          })}
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
