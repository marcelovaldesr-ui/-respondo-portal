import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatearSlot, ZONA_AGENDA, fechaChileDe, horaChileAUtc } from "@/lib/agendaCore";
import CalendarioAgenda, { type CitaCal, type FranjaSemanal, type ProfCal } from "@/components/CalendarioAgenda";
import NuevaCita from "@/components/NuevaCita";
import { crearCitaManual, cambiarEstadoCita, reabrirCita } from "./acciones";

export const dynamic = "force-dynamic";

/**
 * AGENDA — pantalla principal del dueño.
 *
 * Es una AGENDA, no un listado: lo primero y más grande es el calendario. La
 * configuración (servicios, profesionales, horarios, bloqueos, enlaces) vive en
 * /agenda/configuracion, porque se toca una vez al mes y estorbaba todos los días.
 *
 * El servidor manda una ventana amplia de citas (30 días atrás, 90 adelante) y
 * el calendario navega en el cliente: moverse de semana es instantáneo.
 */

type CitaFila = {
  id: string;
  nombre_contacto: string;
  telefono: string | null;
  chat_id: string | null;
  inicio: string;
  fin: string;
  estado: string;
  origen: string;
  profesional_id: string;
  ed_servicios: { nombre: string } | null;
  ed_profesionales: { nombre: string } | null;
  /** Ficha del servicio respondida al reservar (migración 277). */
  datos_extra?: Record<string, string> | null;
};

const ACTIVOS = ["agendada", "confirmada", "reagendada"];

/** "10:30:00" → 630. Tolera "10:30" y valores ya numéricos. */
function minutosDeHora(v: string): number {
  const [h, m] = String(v).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function claveDe(f: { anio: number; mes: number; dia: number }): string {
  return `${f.anio}-${String(f.mes).padStart(2, "0")}-${String(f.dia).padStart(2, "0")}`;
}

function claveDiaDe(iso: string): string {
  return claveDe(fechaChileDe(new Date(iso)));
}

/**
 * "Hoy 16:30" o "lun 3, 11:00".
 *
 * Mostrar solo la hora engañaba: si la próxima reserva era la semana que viene,
 * la tarjeta decía "11:00" y parecía que era hoy.
 */
function etiquetaProxima(iso: string, claveHoy: string): string {
  const d = new Date(iso);
  const hora = new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
  if (claveDiaDe(iso) === claveHoy) return `Hoy ${hora}`;
  const dia = new Intl.DateTimeFormat("es-CL", {
    timeZone: ZONA_AGENDA, weekday: "short", day: "numeric",
  }).format(d);
  return `${dia}, ${hora}`;
}

export default async function Agenda() {
  const usuario = await exigirUsuarioPortal();
  const supa = db();

  // Detección amable de "migración 220 pendiente": una consulta chica primero.
  const sonda = await supa.from("ed_servicios").select("id").limit(1);
  if (sonda.error) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <div className="eyebrow">Agenda</div>
        <h1 className="h-pagina">Agenda y reservas</h1>
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

  const desdeIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const hastaIso = new Date(Date.now() + 90 * 86_400_000).toISOString();

  const [{ data: servicios }, { data: profesionales }, { data: citas }, { data: cliente }] =
    await Promise.all([
      supa
        .from("ed_servicios")
        .select("id, nombre, duracion_min, precio_clp, activo")
        .eq("cliente_id", usuario.clienteId)
        .order("orden", { ascending: true })
        .order("creado_en", { ascending: true }),
      supa
        .from("ed_profesionales")
        .select("id, nombre, activo")
        .eq("cliente_id", usuario.clienteId)
        .order("creado_en", { ascending: true }),
      // `datos_extra` llega con la migración 277. Si todavía no está aplicada,
      // PostgREST devuelve error por columna desconocida y la agenda quedaría
      // VACÍA — la pantalla que el negocio mira todos los días. Por eso se
      // intenta con la columna y se reintenta sin ella: el orden del deploy
      // deja de poder romper nada.
      (async () => {
        const conFicha = await supa
          .from("ed_citas")
          .select(
            "id, nombre_contacto, telefono, chat_id, inicio, fin, estado, origen, profesional_id, datos_extra, ed_servicios(nombre), ed_profesionales(nombre)",
          )
          .eq("cliente_id", usuario.clienteId)
          .gte("inicio", desdeIso)
          .lte("inicio", hastaIso)
          .order("inicio", { ascending: true });
        if (!conFicha.error) return conFicha;
        return supa
          .from("ed_citas")
          .select(
            "id, nombre_contacto, telefono, chat_id, inicio, fin, estado, origen, profesional_id, ed_servicios(nombre), ed_profesionales(nombre)",
          )
          .eq("cliente_id", usuario.clienteId)
          .gte("inicio", desdeIso)
          .lte("inicio", hastaIso)
          .order("inicio", { ascending: true });
      })(),
      supa
        .from("ed_clientes")
        .select("slug, reservas_online")
        .eq("id", usuario.clienteId)
        .maybeSingle(),
    ]);

  const listaServicios = (servicios ?? []) as { id: string; nombre: string; duracion_min: number; activo: boolean }[];
  const listaProfesionales = (profesionales ?? []) as { id: string; nombre: string; activo: boolean }[];
  const listaCitas = (citas ?? []) as unknown as CitaFila[];

  const profIds = listaProfesionales.map((p) => p.id);
  const [{ data: horarios }, { data: bloqueos }] = await Promise.all([
    profIds.length
      ? supa
          .from("ed_horarios")
          .select("id, profesional_id, dia_semana, desde, hasta")
          .in("profesional_id", profIds)
          .order("dia_semana")
      : Promise.resolve({ data: [] as { id: string; profesional_id: string; dia_semana: number; desde: string; hasta: string }[] }),
    supa
      .from("ed_bloqueos")
      .select("id, profesional_id, desde, hasta, motivo")
      .eq("cliente_id", usuario.clienteId)
      .gte("hasta", new Date().toISOString())
      .order("desde"),
  ]);
  const listaHorarios = (horarios ?? []) as { id: string; profesional_id: string; dia_semana: number; desde: string; hasta: string }[];
  const listaBloqueos = (bloqueos ?? []) as { id: string; profesional_id: string | null; desde: string; hasta: string; motivo: string | null }[];

  const serviciosActivos = listaServicios.filter((s) => s.activo);
  const profActivos = listaProfesionales.filter((p) => p.activo);
  const configurada = serviciosActivos.length > 0 && profActivos.length > 0 && listaHorarios.length > 0;

  // ── Datos para el calendario ──────────────────────────────────────────
  const citasCal: CitaCal[] = listaCitas.map((c) => ({
    id: c.id,
    inicio: c.inicio,
    fin: c.fin,
    estado: c.estado,
    origen: c.origen,
    nombre: c.nombre_contacto,
    telefono: c.telefono ?? c.chat_id ?? null,
    servicio: c.ed_servicios?.nombre ?? "Servicio",
    profesionalId: c.profesional_id,
    profesional: c.ed_profesionales?.nombre ?? "—",
    datosExtra: c.datos_extra ?? null,
  }));

  const profCal: ProfCal[] = profActivos.map((p) => ({ id: p.id, nombre: p.nombre }));

  // Horario de atención del negocio = unión de los tramos de sus profesionales.
  const franjas: FranjaSemanal[] = listaHorarios.map((h) => ({
    diaSemana: h.dia_semana,
    desdeMin: minutosDeHora(h.desde),
    hastaMin: minutosDeHora(h.hasta),
  }));

  // ── Cifras de cabecera ────────────────────────────────────────────────
  const hoy = fechaChileDe(new Date());
  const claveHoy = claveDe(hoy);
  const ahoraMs = Date.now();

  const activas = listaCitas.filter((c) => ACTIVOS.includes(c.estado));
  const citasHoy = activas.filter((c) => claveDiaDe(c.inicio) === claveHoy);
  const proxima = activas.find((c) => Date.parse(c.inicio) >= ahoraMs) ?? null;

  // Semana en curso (lunes a domingo, hora de Chile).
  const aLunes = hoy.diaSemana === 0 ? -6 : 1 - hoy.diaSemana;
  const lunesMs = horaChileAUtc(hoy.anio, hoy.mes, hoy.dia, 12, 0).getTime() + aLunes * 86_400_000;
  const clavesSemana = new Set(
    Array.from({ length: 7 }, (_, i) => claveDe(fechaChileDe(new Date(lunesMs + i * 86_400_000)))),
  );
  const citasSemana = activas.filter((c) => clavesSemana.has(claveDiaDe(c.inicio)));

  // Minutos vendidos esta semana vs. minutos de atención disponibles.
  const minutosAgendados = citasSemana.reduce(
    (t, c) => t + Math.max(0, (Date.parse(c.fin) - Date.parse(c.inicio)) / 60_000),
    0,
  );
  const minutosCapacidad = franjas.reduce((t, f) => t + Math.max(0, f.hastaMin - f.desdeMin), 0);
  const ocupacion = minutosCapacidad > 0 ? Math.round((minutosAgendados / minutosCapacidad) * 100) : null;

  const porRevisar = activas.filter((c) => c.estado === "agendada" && Date.parse(c.inicio) >= ahoraMs).length;

  const bloqueoTapando = listaBloqueos.find(
    (b) => !b.profesional_id && Date.parse(b.desde) <= ahoraMs && Date.parse(b.hasta) > ahoraMs,
  );

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">
      {/* ── Cabecera ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Agenda</div>
          <h1 className="h-pagina">
            Tu agenda
          </h1>
          <p className="mt-1 text-[14.5px]" style={{ color: "var(--muted)" }}>
            Las horas que agendan tus empleados por WhatsApp, las reservas online y las que creas tú.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {cliente?.reservas_online && cliente?.slug && (
            <Link
              href={`/reservar/${cliente.slug}`}
              target="_blank"
              className="btn-suave px-3.5 py-2 text-[13.5px]"
            >
              Ver página de reservas
            </Link>
          )}
          {/* Clases va ANTES de configuración: se usa todas las semanas, mientras
              que configuración se toca una vez al mes. */}
          <Link href="/agenda/clases" className="btn-suave px-3.5 py-2 text-[13.5px]">
            Clases
          </Link>
          <Link href="/agenda/configuracion" className="btn-suave px-3.5 py-2 text-[13.5px]">
            Configuración
          </Link>
          <NuevaCita
            accion={crearCitaManual}
            servicios={serviciosActivos.map((s) => ({ id: s.id, nombre: s.nombre, duracionMin: s.duracion_min }))}
            profesionales={profCal}
          />
        </div>
      </div>

      {/* ── Cifras ───────────────────────────────────────────────────── */}
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cifra
          rotulo="Hoy"
          valor={String(citasHoy.length)}
          detalle={citasHoy.length === 1 ? "hora agendada" : "horas agendadas"}
          acento
        />
        <Cifra
          rotulo="Esta semana"
          valor={String(citasSemana.length)}
          detalle={`${Math.round(minutosAgendados / 60)} h de trabajo`}
        />
        <Cifra
          rotulo="Ocupación esta semana"
          valor={ocupacion === null ? "—" : `${ocupacion}%`}
          detalle={ocupacion === null ? "falta definir horarios" : "de tu horario de atención"}
        />
        <Cifra
          rotulo="Próxima reserva"
          valor={proxima ? etiquetaProxima(proxima.inicio, claveHoy) : "—"}
          detalle={proxima ? `${proxima.nombre_contacto} · ${proxima.ed_servicios?.nombre ?? ""}` : "sin horas por delante"}
        />
      </div>

      {porRevisar > 0 && (
        <p className="mt-3 text-[13.5px] font-semibold" style={{ color: "var(--muted)" }}>
          <span className="pildora-indigo mr-1.5">{porRevisar}</span>
          {porRevisar === 1 ? "hora sin confirmar" : "horas sin confirmar"} — ábrelas en el calendario y confírmalas.
        </p>
      )}

      {/* Un bloqueo de "todo el negocio" que cubre AHORA deja la agenda sin
          cupos. Sin este aviso, el dueño ve "no hay horas" y no entiende por qué. */}
      {bloqueoTapando && (
        <div className="tarjeta mt-5 p-5" style={{ background: "#FDE9EA", borderColor: "#F5C9CB" }}>
          <p className="text-[14.5px] font-bold" style={{ color: "#B33A3A" }}>
            Atención: hay un bloqueo activo sobre todo el negocio.
          </p>
          <p className="mt-1.5 text-[14px]" style={{ color: "var(--muted)" }}>
            Mientras esté vigente <b>no se ofrecerá ninguna hora</b>, ni en la página de
            reservas ni por WhatsApp. Va desde {formatearSlot(bloqueoTapando.desde)} hasta{" "}
            {formatearSlot(bloqueoTapando.hasta)}
            {bloqueoTapando.motivo ? ` (${bloqueoTapando.motivo})` : ""}.{" "}
            <Link href="/agenda/configuracion" className="font-bold underline" style={{ color: "#B33A3A" }}>
              Quitarlo
            </Link>
            .
          </p>
        </div>
      )}

      {!configurada && (
        <div className="tarjeta mt-5 p-5" style={{ borderColor: "#F5C9CB" }}>
          <p className="text-[14.5px] font-bold">Para que tus empleados agenden, faltan algunas cosas:</p>
          <ol className="mt-2 list-inside list-decimal text-[14px]" style={{ color: "var(--muted)" }}>
            {serviciosActivos.length === 0 && <li>Crear al menos un servicio.</li>}
            {profActivos.length === 0 && <li>Crear al menos un profesional.</li>}
            {listaHorarios.length === 0 && <li>Darle horario semanal a ese profesional.</li>}
          </ol>
          <Link href="/agenda/configuracion" className="btn-primario mt-3 inline-block px-4 py-2 text-[13.5px]">
            Ir a configuración
          </Link>
        </div>
      )}

      {/* ── Calendario ───────────────────────────────────────────────── */}
      <div className="mt-6">
        <CalendarioAgenda
          citas={citasCal}
          profesionales={profCal}
          franjas={franjas}
          accionEstado={cambiarEstadoCita}
          accionReabrir={reabrirCita}
        />
      </div>
    </main>
  );
}

function Cifra({
  rotulo,
  valor,
  detalle,
  acento,
}: {
  rotulo: string;
  valor: string;
  detalle: string;
  acento?: boolean;
}) {
  return (
    <div className="tarjeta p-4">
      <div className="text-[11.5px] font-bold uppercase" style={{ color: "var(--muted-2)", letterSpacing: "0.07em" }}>
        {rotulo}
      </div>
      <div
        className="mt-1 truncate h-pagina"
        style={{ color: acento ? "var(--indigo)" : "var(--tinta)" }}
        title={valor}
      >
        {valor}
      </div>
      <div className="mt-1.5 truncate text-[12.5px]" style={{ color: "var(--muted)" }} title={detalle}>
        {detalle}
      </div>
    </div>
  );
}
