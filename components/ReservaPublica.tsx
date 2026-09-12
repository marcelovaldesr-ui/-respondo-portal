"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BotonesHora,
  CalendarioMes,
  SelectorProfesional,
  claveDia,
  hora,
  mesDeClave,
  tituloDeClave,
} from "@/components/agenda/piezas";

/**
 * PÁGINA PÚBLICA DE RESERVA — servicio → con quién → día → hora → datos.
 *
 * REESCRITA EN FASE 2 (12-sep-2026). Lo que cambió y por qué:
 *
 *  · UNA HORA, UNA VEZ. Antes el servidor devolvía un cupo POR PROFESIONAL y
 *    la página los pintaba todos: con tres profesionales libres a las 15:00
 *    salían tres botones «15:00» idénticos. Ahora la hora es una sola y quién
 *    atiende lo decide el servidor al confirmar.
 *  · «CUALQUIERA» POR DEFECTO. El selector de profesional solo aparece si de
 *    verdad hay más de uno; elegir persona filtra las horas.
 *  · SE PIDE LO QUE SE MIRA. El calendario pide «qué días de este mes tienen
 *    cupo» y las horas se piden al tocar un día. Antes venían los próximos 120
 *    cupos de una sola vez, lo que con varios profesionales dejaba el
 *    calendario mostrando dos días.
 *  · MÓVIL PRIMERO. El resumen de lo que estás reservando va ARRIBA en el
 *    teléfono (antes caía debajo del botón de confirmar, donde no se veía) y
 *    los botones de hora miden 44 px.
 *  · «ESA HORA ACABA DE OCUPARSE» ES UN CAMINO, NO UN ERROR: se ofrecen las
 *    horas cercanas reales que devuelve el servidor.
 *
 * Sin dependencias externas, a propósito: esta página se abre en 3G.
 */

export type CampoPublico = {
  id: string;
  etiqueta: string;
  tipo: "texto" | "parrafo" | "numero" | "telefono" | "email" | "opciones" | "si_no" | "fecha" | "rut";
  opciones: string[] | null;
  obligatorio: boolean;
  ayuda: string | null;
  orden: number;
};

type Servicio = {
  id: string;
  nombre: string;
  descripcion: string | null;
  duracionMin: number;
  precioClp: number | null;
  campos?: CampoPublico[];
};

type Profesional = { id: string; nombre: string };
type HoraLibre = { inicio: string; profesionales: string[] };

function precio(v: number | null): string {
  return v != null ? `$${v.toLocaleString("es-CL")}` : "según evaluación";
}

function mesDeHoy(): string {
  return claveDia(new Date().toISOString()).slice(0, 7);
}

export default function ReservaPublica({ slug, servicios }: { slug: string; servicios: Servicio[] }) {
  const [servicio, setServicio] = useState<Servicio | null>(servicios.length === 1 ? servicios[0] : null);
  const [profesional, setProfesional] = useState<string | null>(null); // null = cualquiera
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [mes, setMes] = useState<string>(mesDeHoy());
  const [dias, setDias] = useState<string[]>([]);
  const [dia, setDia] = useState<string | null>(null);
  const [horas, setHoras] = useState<HoraLibre[]>([]);
  const [elegida, setElegida] = useState<string | null>(null);
  const [cargandoDias, setCargandoDias] = useState(false);
  const [cargandoHoras, setCargandoHoras] = useState(false);
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alternativas, setAlternativas] = useState<{ inicio: string; texto: string }[]>([]);
  const [ficha, setFicha] = useState<Record<string, string>>({});
  const [erroresFicha, setErroresFicha] = useState<Record<string, string>>({});
  const [listo, setListo] = useState<{
    cuando: string;
    profesional: string | null;
    whatsapp: string | null;
    pendiente: boolean;
    gestion: string | null;
  } | null>(null);

  const campos = useMemo(() => [...(servicio?.campos ?? [])].sort((a, b) => a.orden - b.orden), [servicio]);
  const fichaCompleta = campos.filter((c) => c.obligatorio).every((c) => (ficha[c.id] ?? "").trim().length > 0);
  const puedeRetroceder = mes > mesDeHoy();

  useEffect(() => {
    setFicha({});
    setErroresFicha({});
  }, [servicio?.id]);

  /** Días con cupo del mes visible. Se repite al cambiar servicio o profesional. */
  const cargarDias = useCallback(
    async (silencioso = false) => {
      if (!servicio) return;
      if (!silencioso) setCargandoDias(true);
      try {
        const q = new URLSearchParams({ slug, servicio: servicio.id, modo: "dias", mes });
        if (profesional) q.set("profesional", profesional);
        const d = await fetch(`/api/reservas/disponibilidad?${q}`).then((r) => r.json());
        if (!d.ok) {
          setDias([]);
          setError(d.error === "rate" ? "Demasiadas consultas seguidas. Espera un momento." : null);
          return;
        }
        setDias(d.dias as string[]);
        setProfesionales(d.profesionales as Profesional[]);
        setError(null);
      } catch {
        setError("No pudimos cargar los horarios. Intenta de nuevo.");
      } finally {
        setCargandoDias(false);
      }
    },
    [servicio, slug, mes, profesional],
  );

  useEffect(() => {
    void cargarDias();
  }, [cargarDias]);

  /** Horas del día elegido. */
  const cargarHoras = useCallback(
    async (clave: string) => {
      if (!servicio) return;
      setCargandoHoras(true);
      try {
        const q = new URLSearchParams({ slug, servicio: servicio.id, modo: "horas", fecha: clave });
        if (profesional) q.set("profesional", profesional);
        const d = await fetch(`/api/reservas/disponibilidad?${q}`).then((r) => r.json());
        setHoras(d.ok ? (d.horas as HoraLibre[]) : []);
      } catch {
        setHoras([]);
        setError("No pudimos cargar los horarios. Intenta de nuevo.");
      } finally {
        setCargandoHoras(false);
      }
    },
    [servicio, slug, profesional],
  );

  // Al cambiar de profesional, lo elegido puede dejar de existir.
  useEffect(() => {
    setElegida(null);
    if (dia) void cargarHoras(dia);
  }, [profesional, dia, cargarHoras]);

  // Primer día con cupo del mes: un clic menos para casi todos.
  useEffect(() => {
    if (!dias.length) {
      setDia(null);
      setHoras([]);
      return;
    }
    if (!dia || !dias.includes(dia)) setDia(dias[0]);
  }, [dias, dia]);

  function elegirDia(clave: string) {
    setDia(clave);
    setElegida(null);
    setAlternativas([]);
    void cargarHoras(clave);
  }

  async function reservar() {
    if (!servicio || !elegida) return;
    setEnviando(true);
    setError(null);
    setErroresFicha({});
    setAlternativas([]);
    try {
      const r = await fetch("/api/reservas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          servicioId: servicio.id,
          // Vacío = «cualquiera»: el servidor elige entre los que estén libres.
          profesionalId: profesional ?? "",
          inicio: elegida,
          nombre,
          telefono,
          ficha,
          web: "", // honeypot
        }),
      });
      const d = await r.json();
      if (d.ok) {
        setListo({
          cuando: d.cuando,
          profesional: d.profesional ?? null,
          whatsapp: d.whatsapp ?? null,
          pendiente: !!d.requiereConfirmacion,
          gestion: d.gestion ?? null,
        });
      } else if (d.error === "ficha_invalida") {
        setErroresFicha((d.errores ?? {}) as Record<string, string>);
        setError("Revisa los datos marcados.");
      } else if (d.error === "cupo_tomado" || d.error === "horario_no_disponible") {
        setError(d.mensaje ?? "Ese horario acaba de ocuparse.");
        setElegida(null);
        setAlternativas((d.alternativas ?? []) as { inicio: string; texto: string }[]);
        if (dia) await cargarHoras(dia);
        void cargarDias(true);
      } else {
        setError(d.error ?? "No se pudo reservar. Intenta de nuevo.");
      }
    } catch {
      setError("Problema de conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  // ── Confirmación ────────────────────────────────────────────────────
  if (listo) {
    return (
      <div className="tarjeta mx-auto mt-8 max-w-md overflow-hidden">
        <div className="px-6 pb-2 pt-8 text-center">
          <div
            className="mx-auto flex h-16 w-16 items-center justify-center rounded-full"
            style={{ background: listo.pendiente ? "var(--azul-suave)" : "var(--ok-suave)" }}
          >
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d={listo.pendiente ? "M12 7v5l3 2" : "M4.5 12.5l5 5 10-11"}
                stroke={listo.pendiente ? "var(--azul)" : "var(--ok)"}
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {listo.pendiente && <circle cx="12" cy="12" r="9" stroke="var(--azul)" strokeWidth="2.2" />}
            </svg>
          </div>
          <h2 className="mt-4 font-bold leading-tight" style={{ fontSize: "var(--t-ficha)" }}>
            {listo.pendiente ? "Solicitud recibida" : "Reserva confirmada"}
          </h2>
          <p className="mt-1.5" style={{ fontSize: "var(--t-cuerpo)", color: "var(--muted)" }}>
            {listo.pendiente
              ? "Te confirmamos por WhatsApp a la brevedad."
              : "Te llegará un recordatorio por WhatsApp antes de tu hora."}
          </p>
        </div>

        <div
          className="mx-6 mt-5 rounded-[var(--r-card)] border p-4"
          style={{ borderColor: "var(--borde)", background: "var(--fondo-hundido)" }}
        >
          <Fila etiqueta="Servicio" valor={servicio?.nombre ?? ""} />
          <Fila etiqueta="Cuándo" valor={listo.cuando} destacado />
          {listo.profesional && <Fila etiqueta="Con" valor={listo.profesional} />}
          {servicio && <Fila etiqueta="Duración" valor={`${servicio.duracionMin} minutos`} />}
          {servicio?.precioClp != null && <Fila etiqueta="Valor" valor={precio(servicio.precioClp)} />}
        </div>

        <div className="px-6 pb-7 pt-5 text-center">
          {listo.whatsapp && (
            <a
              href={listo.whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-azul inline-block w-full px-5 py-3"
            >
              Escribirnos por WhatsApp
            </a>
          )}
          {listo.gestion ? (
            <div className="mt-4 rounded-[var(--r-card)] border p-3.5 text-left" style={{ borderColor: "var(--borde)" }}>
              <div className="font-bold" style={{ fontSize: "var(--t-fila)" }}>
                ¿Necesitas moverla o anularla?
              </div>
              <p className="mt-0.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                Guarda este enlace: desde ahí la cambias tú mismo, sin esperar a que te respondan.
              </p>
              <a
                href={listo.gestion}
                className="mt-2 inline-block w-full rounded-[var(--r-input)] px-3 py-2.5 text-center font-bold"
                style={{ background: "var(--azul-suave)", color: "var(--azul)", fontSize: "var(--t-fila)" }}
              >
                Administrar mi hora
              </a>
            </div>
          ) : (
            <p className="mt-3" style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
              ¿Necesitas moverla o anularla? Escríbenos y lo hacemos al tiro.
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Flujo ───────────────────────────────────────────────────────────
  const paso = !servicio ? 1 : !elegida ? 2 : 3;

  return (
    <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
      <div className="grid gap-5">
        {/* En el teléfono, el resumen es UNA LÍNEA pegada arriba: la tarjeta
            completa empujaba el calendario fuera de la pantalla, y antes de
            Fase 2 directamente no se veía (caía debajo del botón de confirmar). */}
        {servicio && elegida && (
          <div
            className="flex items-center justify-between gap-3 rounded-[var(--r-card)] border px-3.5 py-2.5 lg:hidden"
            style={{ borderColor: "var(--azul-borde)", background: "var(--azul-suave)" }}
          >
            <div className="min-w-0">
              <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                {servicio.nombre}
              </div>
              <div className="truncate" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                {tituloDeClave(claveDia(elegida))} · <span className="cifra">{hora(elegida)}</span>
              </div>
            </div>
            <span className="cifra shrink-0 font-bold" style={{ fontSize: "var(--t-fila)", color: "var(--azul)" }}>
              {precio(servicio.precioClp)}
            </span>
          </div>
        )}

        <Pasos paso={paso} />

        {servicios.length > 1 && (
          <section className="tarjeta p-4">
            <h2 className="rotulo mb-2">1 · Qué necesitas</h2>
            <div className="grid gap-2">
              {servicios.map((s) => {
                const activo = servicio?.id === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={activo}
                    onClick={() => {
                      setServicio(s);
                      setProfesional(null);
                      setElegida(null);
                      setDia(null);
                    }}
                    className="rounded-[var(--r-card)] border px-3.5 py-3 text-left transition"
                    style={{
                      borderColor: activo ? "var(--azul)" : "var(--borde)",
                      background: activo ? "var(--azul-suave)" : "#fff",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                        {s.nombre}
                      </span>
                      <span className="cifra" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                        {precio(s.precioClp)}
                      </span>
                    </div>
                    <div className="mt-0.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                      {s.duracionMin} min{s.descripcion ? ` · ${s.descripcion}` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-[var(--r-card)] border px-4 py-3"
            style={{ borderColor: "var(--coral-borde)", background: "var(--coral-medio)" }}
          >
            <div className="font-semibold" style={{ fontSize: "var(--t-fila)", color: "var(--peligro)" }}>
              {error}
            </div>
            {alternativas.length > 0 && (
              <>
                <p className="mt-1" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                  Estas sí están libres:
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {alternativas.map((a) => (
                    <button
                      key={a.inicio}
                      type="button"
                      className="chip-opcion"
                      onClick={() => {
                        const clave = claveDia(a.inicio);
                        setMes(mesDeClave(clave));
                        setDia(clave);
                        setElegida(a.inicio);
                        setError(null);
                        setAlternativas([]);
                        void cargarHoras(clave);
                      }}
                    >
                      {a.texto}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {servicio && (
          <section className="tarjeta p-4">
            <h2 className="rotulo mb-2">{servicios.length > 1 ? "2" : "1"} · Cuándo te acomoda</h2>

            <div className="grid gap-4">
              <SelectorProfesional
                profesionales={profesionales}
                valor={profesional}
                onCambio={(id) => {
                  setProfesional(id);
                  setAlternativas([]);
                }}
              />

              {/* Calendario ARRIBA y horas ABAJO, siempre. Con el resumen al
                  lado, la columna principal mide ~590 px: partirla en dos dejaba
                  los botones de hora en 46 px, encimados e imposibles de tocar.
                  Una cosa debajo de la otra se lee igual en el teléfono y en el
                  escritorio. */}
              <div className="grid gap-5">
                <CalendarioMes
                  mes={mes}
                  dias={dias}
                  elegido={dia}
                  cargando={cargandoDias}
                  puedeRetroceder={puedeRetroceder}
                  onMes={(m) => {
                    setMes(m);
                    setElegida(null);
                  }}
                  onDia={elegirDia}
                />

                <div>
                  {dia ? (
                    <>
                      <div className="mb-2 font-semibold first-letter:capitalize" style={{ fontSize: "var(--t-fila)" }}>
                        {tituloDeClave(dia)}
                      </div>
                      <BotonesHora
                        horas={horas}
                        elegida={elegida}
                        cargando={cargandoHoras}
                        onElegir={(i) => {
                          setElegida(i);
                          setAlternativas([]);
                        }}
                      />
                    </>
                  ) : (
                    <div className="vacio">
                      <div className="vacio-titulo">
                        {cargandoDias ? "Buscando horas…" : "No hay horas este mes"}
                      </div>
                      <div className="vacio-texto">
                        {cargandoDias ? "Un segundo." : "Prueba el mes siguiente o escríbenos por WhatsApp."}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {servicio && elegida && (
          <section className="tarjeta p-4">
            <h2 className="rotulo mb-2">{servicios.length > 1 ? "3" : "2"} · Tus datos</h2>
            <div className="grid gap-3.5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="font-bold" style={{ fontSize: "var(--t-cuerpo)" }} htmlFor="r-nombre">
                    Tu nombre
                  </label>
                  <input
                    id="r-nombre"
                    className="campo mt-1.5"
                    value={nombre}
                    onChange={(e) => setNombre(e.target.value)}
                    autoComplete="name"
                    placeholder="Nombre y apellido"
                  />
                </div>
                <div>
                  <label className="font-bold" style={{ fontSize: "var(--t-cuerpo)" }} htmlFor="r-fono">
                    WhatsApp
                  </label>
                  <input
                    id="r-fono"
                    className="campo mt-1.5"
                    value={telefono}
                    onChange={(e) => setTelefono(e.target.value)}
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="9 1234 5678"
                  />
                </div>
              </div>

              {campos.map((c) => (
                <CampoFormulario
                  key={c.id}
                  campo={c}
                  valor={ficha[c.id] ?? ""}
                  error={erroresFicha[c.id]}
                  onChange={(v) => setFicha((f) => ({ ...f, [c.id]: v }))}
                />
              ))}

              <button
                type="button"
                className="btn-azul w-full justify-center px-5 py-3"
                disabled={enviando || nombre.trim().length < 2 || telefono.replace(/\D/g, "").length < 8 || !fichaCompleta}
                onClick={() => void reservar()}
              >
                {enviando ? "Reservando…" : "Confirmar mi hora"}
              </button>
              <p className="text-center" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
                Usamos tu WhatsApp solo para confirmarte y recordarte esta hora.
              </p>
            </div>
          </section>
        )}
      </div>

      <aside className="hidden lg:sticky lg:top-6 lg:block">
        <Resumen
          servicio={servicio}
          inicio={elegida}
          dia={dia}
          profesional={profesionales.find((p) => p.id === profesional)?.nombre ?? null}
        />
        <p className="mt-3 px-1 leading-relaxed" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
          Tu hora queda tomada al instante y nadie más puede reservarla.
        </p>
      </aside>
    </div>
  );
}

function Pasos({ paso }: { paso: number }) {
  const items = ["Servicio", "Día y hora", "Tus datos"];
  return (
    <ol className="flex items-center gap-2" aria-label="Pasos de la reserva">
      {items.map((t, i) => {
        const n = i + 1;
        const hecho = paso > n;
        const actual = paso === n;
        return (
          <li key={t} className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full font-bold"
              style={{
                fontSize: "var(--t-meta)",
                background: hecho || actual ? "var(--azul)" : "var(--fondo-hundido)",
                color: hecho || actual ? "#fff" : "var(--muted-2)",
              }}
              aria-current={actual ? "step" : undefined}
            >
              {hecho ? "✓" : n}
            </span>
            <span
              style={{
                fontSize: "var(--t-menor)",
                fontWeight: actual ? 700 : 500,
                color: actual ? "var(--tinta)" : "var(--muted-2)",
              }}
            >
              {t}
            </span>
            {n < items.length && <span style={{ color: "var(--borde-fuerte)" }}>·</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Resumen({
  servicio,
  inicio,
  dia = null,
  profesional,
  className = "",
}: {
  servicio: { nombre: string; duracionMin: number; precioClp: number | null } | null;
  inicio: string | null;
  /** Día ya elegido, para no pedir dos cosas cuando falta una. */
  dia?: string | null;
  profesional: string | null;
  className?: string;
}) {
  if (!servicio && !inicio) return null;
  return (
    <div className={`tarjeta p-4 ${className}`}>
      <div className="eyebrow">Tu reserva</div>
      <div className="mt-2">
        {servicio && (
          <>
            <Fila etiqueta="Servicio" valor={servicio.nombre} destacado />
            <Fila etiqueta="Duración" valor={`${servicio.duracionMin} min`} />
            <Fila etiqueta="Valor" valor={precio(servicio.precioClp)} />
          </>
        )}
        {inicio ? (
          <>
            <div className="my-2 border-t" style={{ borderColor: "var(--borde)" }} />
            <Fila etiqueta="Día" valor={tituloDeClave(claveDia(inicio))} />
            <Fila etiqueta="Hora" valor={hora(inicio)} destacado />
            <Fila etiqueta="Con" valor={profesional ?? "Quien esté disponible"} />
          </>
        ) : (
          <p className="mt-2" style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
            {dia ? "Falta elegir la hora." : "Falta elegir el día y la hora."}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Un campo de la ficha. Se elige el control por TIPO, no un input de texto para
 * todo: en el celular la diferencia es enorme —un teclado numérico, un
 * desplegable en vez de escribir "Fonasa" a mano, dos botones para sí/no—.
 */
function CampoFormulario({
  campo,
  valor,
  error,
  onChange,
}: {
  campo: CampoPublico;
  valor: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  const borde = error ? { borderColor: "var(--peligro)" } : undefined;
  const idCampo = `f-${campo.id}`;
  const idError = `${idCampo}-error`;

  return (
    <div>
      <label className="font-bold" style={{ fontSize: "var(--t-cuerpo)" }} htmlFor={idCampo}>
        {campo.etiqueta}
        {!campo.obligatorio && (
          <span className="ml-1.5 font-semibold" style={{ color: "var(--muted-2)" }}>
            (opcional)
          </span>
        )}
      </label>

      {campo.tipo === "opciones" ? (
        <select
          id={idCampo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="campo mt-1.5"
          style={borde}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? idError : undefined}
        >
          <option value="">Elige una opción…</option>
          {(campo.opciones ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : campo.tipo === "si_no" ? (
        <div className="mt-1.5 grid grid-cols-2 gap-2" role="group" aria-label={campo.etiqueta}>
          {["Sí", "No"].map((o) => (
            <button key={o} type="button" onClick={() => onChange(o)} className="btn-hora" aria-pressed={valor === o}>
              {o}
            </button>
          ))}
        </div>
      ) : campo.tipo === "parrafo" ? (
        <textarea
          id={idCampo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className="campo mt-1.5"
          style={borde}
          placeholder={campo.ayuda ?? ""}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? idError : undefined}
        />
      ) : (
        <input
          id={idCampo}
          value={valor}
          onChange={(e) => onChange(e.target.value)}
          className="campo mt-1.5"
          style={borde}
          type={campo.tipo === "fecha" ? "date" : "text"}
          inputMode={
            campo.tipo === "numero" || campo.tipo === "telefono" ? "numeric" : campo.tipo === "email" ? "email" : undefined
          }
          placeholder={
            campo.tipo === "rut" ? "12.345.678-9" : campo.tipo === "email" ? "tucorreo@ejemplo.cl" : (campo.ayuda ?? "")
          }
          autoComplete={campo.tipo === "email" ? "email" : campo.tipo === "telefono" ? "tel" : "off"}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? idError : undefined}
        />
      )}

      {error ? (
        <p id={idError} className="mt-1 font-semibold" style={{ fontSize: "var(--t-meta)", color: "var(--peligro)" }}>
          {error}
        </p>
      ) : campo.ayuda && campo.tipo !== "parrafo" ? (
        <p className="mt-1" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
          {campo.ayuda}
        </p>
      ) : null}
    </div>
  );
}

function Fila({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="shrink-0" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
        {etiqueta}
      </span>
      <span
        className={`text-right first-letter:capitalize ${destacado ? "font-bold" : "font-semibold"}`}
        style={{ fontSize: "var(--t-fila)", color: destacado ? "var(--tinta)" : "var(--muted)" }}
      >
        {valor}
      </span>
    </div>
  );
}
