import Link from "next/link";
import Notificaciones from "@/components/pwa/Notificaciones";
import { exigirUsuarioPortal } from "@/lib/auth";
import { metaEmpleado } from "@/lib/empleados";
import {
  resumenEmpleados,
  metricasCliente,
  esperandoHumano,
  formatearDuracion,
  formatearCLP,
  nombreMes,
  type ResumenEmpleado,
} from "@/lib/resumen";
import { ETIQUETA_TRIGGER } from "@/lib/conversaciones";
import { contadoresMenu, oportunidadesAbiertas } from "@/lib/contadores";
import { db } from "@/lib/db";
import { estadoDeCupo, type EstadoCupo } from "@/lib/cupoConversaciones";
import { resumenPagos } from "@/lib/pagos";
import { formatearMonto } from "@/lib/pagosCore";
import { metaEtapa } from "@/lib/embudo";
import {
  resumenAhorro,
  formatearDuracion as duracionMin,
  formatearCLP as pesos,
} from "@/lib/analitica";

export const dynamic = "force-dynamic";

/**
 * PORTADA — rediseño del 31-jul.
 *
 * Antes esta pantalla abría con "Bienvenido, <negocio>" y cuatro métricas del
 * mes. El problema no era estético: era que no servía para nada. El dueño entra
 * al portal entre un cliente y otro, mira cinco segundos y necesita saber qué
 * hacer. Un saludo y un número de conversaciones no le dicen qué hacer.
 *
 * Ahora la portada responde tres preguntas, en el orden en que le importan:
 *
 *   1. ¿Alguien me está esperando?   → lo urgente, con la acción al lado
 *   2. ¿Qué está por cerrarse?       → la plata que está en juego hoy
 *   3. ¿Está funcionando lo que pago? → la justificación de la mensualidad
 *
 * Cada bloque termina en un enlace a la pantalla que profundiza. La portada no
 * intenta reemplazar a Conversaciones ni a Analítica: los ordena.
 *
 * Nada de esto usa datos nuevos. Son los mismos que ya existían, puestos en el
 * orden en que se necesitan.
 */

/** "Jueves 31 de julio · 09:14" — en hora de Chile, no del servidor. */
function fechaTitulo(): string {
  const ahora = new Date();
  const dia = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(ahora);
  const hora = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(ahora);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${hora}`;
}

/** Cuánto lleva esperando, en palabras. "18 h", "2 d", "40 min". */
function haceCuanto(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "recién";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Encabezado de bloque con su enlace a la pantalla completa. */
function Bloque({
  titulo,
  nota,
  href,
  hrefLabel,
  children,
}: {
  titulo: string;
  nota?: string;
  href?: string;
  hrefLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <h2 className="h-seccion">
          {titulo}
          {nota && (
            <span className="font-normal" style={{ color: "var(--muted-3)" }}>
              {" · "}
              {nota}
            </span>
          )}
        </h2>
        {href && (
          <Link
            href={href}
            className="shrink-0 font-semibold hover:underline"
            style={{ fontSize: "var(--t-menor)", color: "var(--indigo)" }}
          >
            {hrefLabel} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * Qué números mostrar según el rol. Solo se muestra lo que el motor registra
 * de verdad en ed_resultados: si algo no ocurrió, va en 0, nunca estimado.
 */
function statsDeEmpleado(r: ResumenEmpleado): { label: string; valor: string }[] {
  const n = (t: keyof ResumenEmpleado["resultados"]) => String(r.resultados[t] ?? 0);

  if (r.rol === "rita") {
    return [
      { label: "Cotizaciones retomadas", valor: n("cotizacion_retomada") },
      { label: "Clientes reactivados", valor: n("cliente_reactivado") },
      {
        label: "Ventas recuperadas",
        valor: r.montoRecuperado > 0 ? formatearCLP(r.montoRecuperado) : "—",
      },
    ];
  }
  if (r.rol === "vera") {
    return [
      { label: "Encuestas respondidas", valor: n("encuesta_respondida") },
      { label: "Reseñas conseguidas", valor: n("resena_conseguida") },
      { label: "Clientes molestos", valor: n("cliente_molesto") },
    ];
  }
  return [
    { label: "Conversaciones", valor: String(r.conversaciones) },
    { label: "Cotizaciones enviadas", valor: n("cotizacion_enviada") },
    { label: "Agendamientos", valor: n("agendamiento") },
  ];
}

/** Variación vs el período de comparación, con el signo que corresponde. */
function Variacion({
  actual,
  previo,
  mejorSiBaja = false,
  etiqueta,
}: {
  actual: number | null;
  previo: number | null;
  mejorSiBaja?: boolean;
  etiqueta: string;
}) {
  if (actual == null || previo == null || previo === 0) return null;
  const cambio = ((actual - previo) / previo) * 100;
  const mejora = mejorSiBaja ? cambio < 0 : cambio > 0;
  const signo = cambio > 0 ? "+" : "";
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[12px]">
      <span
        className="font-bold"
        style={{ color: mejora ? "var(--ok)" : "var(--muted)" }}
      >
        {signo}
        {Math.round(cambio)}%
      </span>
      <span style={{ color: "var(--muted-2)" }}>{etiqueta}</span>
    </div>
  );
}

function Metrica({
  label,
  valor,
  children,
  destacada = false,
}: {
  label: string;
  valor: string;
  children?: React.ReactNode;
  destacada?: boolean;
}) {
  return (
    <div className="tarjeta px-5 py-4">
      <div style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>{label}</div>
      <div
        className="h-cifra cifra mt-1.5"
        style={{ color: destacada ? "var(--indigo)" : "var(--tinta)" }}
      >
        {valor}
      </div>
      {children}
    </div>
  );
}

/**
 * CUÁNTO LLEVA USADO DE SU PLAN.
 *
 * Respondo vende por conversaciones incluidas, así que el dueño tiene derecho a
 * ver el contador sin pedírselo a nadie — igual que el saldo de datos del
 * celular. Vender un cupo que el cliente no puede mirar es la receta para una
 * discusión en el mes 3.
 *
 * El tono es deliberadamente tranquilo, incluso pasado el 100%: NUNCA cortamos
 * el servicio. La tarjeta informa y ofrece ampliar; no amenaza.
 *
 * Si el cliente no tiene plan asignado (o la migración 278 no está aplicada),
 * esto no se muestra: estadoDeCupo() devuelve null y aquí retornamos null.
 */
function ConsumoDelPlan({ estado }: { estado: EstadoCupo }) {
  const { consumo, cupo, porcentaje, proyeccion, excedente, ciclo, etiquetaPlan } = estado;
  if (cupo === null || porcentaje === null) return null;

  const pasado = porcentaje >= 100;
  const cerca = porcentaje >= 80;
  const color = pasado ? "var(--peligro)" : cerca ? "var(--coral)" : "var(--indigo)";

  return (
    <div className="tarjeta mb-3 px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          Conversaciones del mes
        </span>
        {etiquetaPlan && (
          <span className="pildora-indigo shrink-0" style={{ fontSize: "var(--t-micro)" }}>
            {etiquetaPlan}
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className="h-cifra cifra" style={{ color }}>
          {consumo.toLocaleString("es-CL")}
        </span>
        <span className="cifra" style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
          de {cupo.toLocaleString("es-CL")}
        </span>
      </div>

      <div
        className="mt-3 h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--borde)" }}
        role="progressbar"
        aria-valuenow={Math.min(100, porcentaje)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, porcentaje)}%`, background: color }}
        />
      </div>

      <div className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        {pasado ? (
          <>
            Pasaste el cupo incluido. <strong>Tu asistente sigue atendiendo igual</strong>
            {excedente && excedente.costo > 0 && (
              <>
                {" · "}
                {excedente.conversaciones.toLocaleString("es-CL")} adicionales ={" "}
                {formatearCLP(excedente.costo)}
              </>
            )}
          </>
        ) : (
          <>
            {ciclo.diasRestantes > 0
              ? `Quedan ${ciclo.diasRestantes} días de ciclo`
              : "El ciclo termina hoy"}
            {/* La proyección solo se muestra si dice algo que el número de
                arriba no dice ya: avisar que se va a pasar cuando todavía se
                puede hacer algo. */}
            {proyeccion > cupo && ciclo.diasRestantes > 2 && (
              <> · al ritmo actual llegarías a ~{proyeccion.toLocaleString("es-CL")}</>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default async function Inicio() {
  const usuario = await exigirUsuarioPortal();
  const [empleados, metricas, esperando, ahorro, oportunidades, abiertas, cupo, pagos] =
    await Promise.all([
      resumenEmpleados(usuario.clienteId),
      metricasCliente(usuario.clienteId),
      esperandoHumano(usuario.clienteId),
      resumenAhorro(usuario.clienteId, 30),
      contadoresMenu(usuario.clienteId),
      oportunidadesAbiertas(usuario.clienteId),
      estadoDeCupo(usuario.clienteId, db()),      // Cobros del mes (migración 289). Si la tabla no existe: ceros, sin romper.
      resumenPagos(usuario.clienteId).catch(() => ({ pendientes: 0, pagadosMes: 0, montoMes: 0 })),
    ]);

  const { actual, comparacion } = metricas;
  const pendientes = esperando.total;
  const antes = comparacion?.esBasal ? "vs antes de Respondo" : "vs mes anterior";

  /**
   * "Por cerrarse" sale del EMBUDO, no de ed_resultados.
   *
   * En la primera versión lo armé sumando cotizacion_enviada / agendamiento /
   * lead_capturado. Con datos reales quedó en cero y el bloque desapareció...
   * mientras el menú, al lado, mostraba "Embudo 9". Dos números del mismo
   * portal diciendo cosas distintas sobre lo mismo. Leyendo de la misma fuente
   * que el contador del menú, ya no pueden contradecirse.
   */
  const porCerrarse = [
    { label: "Interesados", valor: oportunidades.interesados },
    { label: "Cotizados", valor: oportunidades.cotizados },
  ].filter((x) => x.valor > 0);

  // UNA SOLA FUENTE para el total del mes. ed_metricas es el consolidado
  // oficial que escribe el motor; si todavía no existe, se cae al conteo
  // derivado de los mensajes. Nunca mezclar las dos en la misma pantalla.
  const derivadas = empleados.reduce((a, e) => a + e.conversaciones, 0);
  const conversacionesMes = actual?.conversaciones ?? derivadas;

  return (
    <main className="mx-auto max-w-[1400px] px-5 py-6 sm:px-7 lg:px-8">
      {/*
        Registro del service worker y alta de notificaciones. Va en Inicio
        porque es la primera pantalla y porque el permiso hay que pedirlo tras
        un clic — nunca solo, o el navegador se gana un "Bloquear" reflejo que
        es permanente.
      */}
      <div className="mb-4">
        <Notificaciones />
      </div>
      {/* Título y contexto en la MISMA línea. "Inicio" dice dónde estás; la
          fecha es contexto, no un subtítulo que merezca su propio renglón. */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">Inicio</h1>
        <span className="sub-titulo">
          {fechaTitulo()}
          {conversacionesMes > 0 && ` · ${conversacionesMes} conversaciones este mes`}
        </span>
      </div>

      {/*
        DOS COLUMNAS EN ESCRITORIO.

        Apilado en una sola columna angosta, el 40% derecho de la pantalla
        quedaba en blanco — que es exactamente la queja que originó el rediseño
        de esta página. A la izquierda va lo que exige una decisión (quién
        espera, qué está por cerrarse, si esto funciona); a la derecha, el
        estado del equipo, que se consulta pero no se acciona.

        En móvil vuelve a una sola columna y el equipo queda al final: primero
        lo urgente.
      */}
      <div className="mt-1 grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>

      {/* ── 1. ¿Alguien me está esperando? ───────────────────────────────────
          Va primero siempre. Es lo único de la pantalla que se puede estar
          rompiendo mientras el dueño la mira. */}
      <Bloque
        titulo="Te están esperando"
        nota={pendientes > 0 ? String(pendientes) : undefined}
        href={pendientes > 0 ? "/conversaciones" : undefined}
        hrefLabel="Ver bandeja"
      >
        {pendientes === 0 ? (
          <div className="tarjeta px-5 py-6">
            <div className="flex items-center gap-2.5">
              <span className="punto-vivo" aria-hidden="true" />
              <span style={{ fontSize: "var(--t-cuerpo)" }}>
                Nadie está esperando respuesta. Tu asistente va al día.
              </span>
            </div>
          </div>
        ) : (
          <div className="tarjeta divide-y overflow-hidden" style={{ borderColor: "var(--borde)" }}>
            {esperando.items.map((e) => (
              <Link
                key={`${e.empleadoId}-${e.chatId}`}
                /* El parámetro es `emp`, no `empleado`: así lo lee
                   /conversaciones. Con el nombre largo el enlace abría la
                   bandeja sin seleccionar nada y el botón "Responder" no
                   respondía nada. */
                href={`/conversaciones?emp=${e.empleadoId}&chat=${encodeURIComponent(e.chatId)}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--fondo-fila)]"
                style={{ borderColor: "var(--borde)" }}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold" style={{ fontSize: "var(--t-cuerpo)" }}>
                    {e.contacto}
                  </div>
                  <div className="truncate" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                    {ETIQUETA_TRIGGER[e.motivo] ?? e.resumen ?? "Necesita a una persona"}
                  </div>
                </div>
                <span
                  className="cifra shrink-0"
                  style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}
                >
                  {haceCuanto(e.desde)}
                </span>
                <span className="btn-chico shrink-0">Responder</span>
              </Link>
            ))}
            {pendientes > esperando.items.length && (
              <div
                className="px-4 py-2.5"
                style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}
              >
                y {pendientes - esperando.items.length} más en la bandeja
              </div>
            )}
          </div>
        )}
        {esperando.items.length > 0 && (
          <p className="mt-2" style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}>
            La más antigua lleva{" "}
            <strong style={{ color: "var(--muted)" }}>{haceCuanto(esperando.items[0].desde)}</strong>{" "}
            esperando.
          </p>
        )}
      </Bloque>

      {/* ── 2. ¿Qué está por cerrarse? ───────────────────────────────────────
          Los conteos van como píldoras en el encabezado y el cuerpo es la
          LISTA: a quién hay que insistir, qué pidió y hace cuánto. Un panel que
          obliga a ir a otra pantalla para actuar no ahorró nada. */}
      {oportunidades.porCerrar > 0 && (
        <Bloque
          titulo="Por cerrarse"
          nota={porCerrarse.map((x) => `${x.label.toLowerCase()} ${x.valor}`).join(" · ")}
          href="/embudo"
          hrefLabel="Ver embudo"
        >
          <div className="tarjeta divide-y overflow-hidden" style={{ borderColor: "var(--borde)" }}>
            {abiertas.map((o) => {
              const et = metaEtapa(o.etapa);
              return (
                <Link
                  key={o.chatId}
                  href={`/embudo?chat=${encodeURIComponent(o.chatId)}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--fondo-fila)]"
                  style={{ borderColor: "var(--borde)" }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                      {o.contacto}
                    </div>
                    <div
                      className="truncate"
                      style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}
                    >
                      {o.ultimoMensaje || "Sin mensajes recientes"}
                    </div>
                  </div>
                  <span
                    className="pildora shrink-0"
                    style={{ background: et.fondo, color: et.color }}
                  >
                    {et.label}
                  </span>
                  <span
                    className="cifra shrink-0 text-right"
                    style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)", minWidth: 52 }}
                  >
                    {haceCuanto(o.ultimoEn)}
                  </span>
                </Link>
              );
            })}
            {oportunidades.porCerrar > abiertas.length && (
              <div
                className="px-4 py-2"
                style={{ fontSize: "var(--t-menor)", color: "var(--muted-2)" }}
              >
                y {oportunidades.porCerrar - abiertas.length} más en el embudo
              </div>
            )}
          </div>
        </Bloque>
      )}

      {/* ── 3. ¿Está funcionando esto que pago? ─────────────────────────────
          Los mismos tres números de Analítica, calculados con conteos en la
          base (ver resumenAhorro) para no encarecer la página más visitada. */}
      {ahorro && ahorro.enviadosIA > 0 && (
        <Bloque
          titulo="¿Está funcionando?"
          nota="últimos 30 días"
          href="/analitica"
          hrefLabel="Ver analítica"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="tarjeta px-5 py-4">
              <div className="h-cifra cifra">{duracionMin(ahorro.minutosAhorrados)}</div>
              <div className="mt-1.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                que tu equipo no gastó respondiendo
              </div>
            </div>
            <div className="tarjeta px-5 py-4">
              <div className="h-cifra cifra">{pesos(ahorro.dineroAhorradoCLP)}</div>
              <div className="mt-1.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                estimado sobre {ahorro.enviadosIA.toLocaleString("es-CL")} mensajes atendidos
              </div>
            </div>
            {/* Los DOS números de cobertura. Ver el comentario de
                ResumenAhorro.coberturaReciente: mostrar solo el promedio del
                período engaña por omisión cuando el asistente lleva poco. */}
            <div className="tarjeta px-5 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="h-cifra cifra" style={{ color: "var(--indigo)" }}>
                  {ahorro.coberturaIA}%
                </span>
                {ahorro.coberturaReciente !== ahorro.coberturaIA && (
                  <span
                    className="pildora-indigo cifra"
                    title="Los últimos 30 días incluyen conversaciones anteriores a tener el asistente conectado."
                  >
                    últimas 24 h: {ahorro.coberturaReciente}%
                  </span>
                )}
              </div>
              <div className="mt-1.5" style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                de las respuestas las escribió tu asistente
              </div>
            </div>
          </div>
        </Bloque>
      )}

      {/* Métricas del mes: se conservan, pero después de lo accionable. */}
      {actual && (
        <Bloque
          titulo={nombreMes(actual.periodo)}
          nota={comparacion ? antes.replace("vs ", "comparado con ") : undefined}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metrica label="Conversaciones" valor={String(actual.conversaciones ?? "—")}>
              <Variacion
                actual={actual.conversaciones}
                previo={comparacion?.conversaciones ?? null}
                etiqueta={antes}
              />
            </Metrica>

            <Metrica
              label="Clientes potenciales"
              valor={String(actual.leadsCapturados ?? "—")}
            >
              <Variacion
                actual={actual.leadsCapturados}
                previo={comparacion?.leadsCapturados ?? null}
                etiqueta={antes}
              />
            </Metrica>

            <Metrica
              label="Tiempo de respuesta"
              valor={formatearDuracion(actual.tiempoRespuestaSeg)}
              destacada
            >
              {comparacion?.tiempoRespuestaSeg != null && (
                <div className="mt-2" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
                  antes{" "}
                  <strong style={{ color: "var(--muted)" }}>
                    {formatearDuracion(comparacion.tiempoRespuestaSeg)}
                  </strong>
                </div>
              )}
            </Metrica>

            <Metrica
              label="Resuelto sin ti"
              valor={
                actual.resueltasSinHumanoPct != null
                  ? `${Number(actual.resueltasSinHumanoPct)}%`
                  : "—"
              }
            >
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--borde)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Number(actual.resueltasSinHumanoPct ?? 0))}%`,
                    background: "var(--indigo)",
                  }}
                />
              </div>
            </Metrica>
          </div>
        </Bloque>
      )}
        </div>

        {/* ── Columna derecha: estado del equipo ───────────────────────────
            Se consulta, no se acciona. Por eso va al costado y no arriba. */}
        <aside className="mt-8 lg:mt-8">
      {/*
        COBROS DEL MES (27-ago-2026): el número que el dueño quiere ver primero.
        Solo aparece si la función se usa — cero filas = cero tarjeta, para no
        mostrar un $0 permanente a quien no cobra por acá.
      */}
      {(pagos.pagadosMes > 0 || pagos.pendientes > 0) && (
        <>
          <h2 className="h-seccion mb-2.5">Cobros por WhatsApp</h2>
          <div className="tarjeta mb-6 p-4">
            <div className="cifra text-[22px] font-bold">{formatearMonto(pagos.montoMes)}</div>
            <div className="text-[12.5px]" style={{ color: "var(--muted)" }}>
              cobrado este mes · {pagos.pagadosMes} pago{pagos.pagadosMes === 1 ? "" : "s"}
            </div>
            {pagos.pendientes > 0 && (
              <div className="mt-1.5 text-[12.5px]" style={{ color: "#92400E" }}>
                {pagos.pendientes} cobro{pagos.pendientes === 1 ? "" : "s"} esperando pago
              </div>
            )}
          </div>
        </>
      )}

      {cupo && cupo.cupo !== null && (
        <>
          <h2 className="h-seccion mb-2.5">Tu plan</h2>
          <ConsumoDelPlan estado={cupo} />
        </>
      )}

      <h2 className="h-seccion">Tu equipo digital</h2>
      <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {empleados.map((r) => {
          const meta = metaEmpleado(r.rol);
          return (
            <div key={r.empleadoId} className="tarjeta overflow-hidden">
              <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={meta.avatar}
                  alt={r.nombrePublico}
                  width={36}
                  height={36}
                  className="avatar h-9 w-9"
                  style={{ ["--anillo" as string]: meta.color }}
                />
                <div className="min-w-0">
                  <div className="h-seccion truncate">
                    {r.nombrePublico || meta.nombrePorDefecto}
                  </div>
                  <div
                    className="truncate font-semibold"
                    style={{ fontSize: "var(--t-micro)", color: meta.color }}
                  >
                    {meta.funcion}
                  </div>
                </div>
              </div>

              <dl className="space-y-1.5 px-4 pb-4">
                {statsDeEmpleado(r).map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between gap-3">
                    <dt style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
                      {s.label}
                    </dt>
                    <dd className="cifra font-semibold" style={{ fontSize: "var(--t-fila)" }}>
                      {s.valor}
                    </dd>
                  </div>
                ))}
              </dl>

              {r.escalacionesPendientes > 0 && (
                <div
                  className="px-4 py-2 font-semibold"
                  style={{
                    fontSize: "var(--t-micro)",
                    background: "var(--coral-medio)",
                    color: "var(--peligro)",
                  }}
                >
                  {r.escalacionesPendientes} esperando por ti
                </div>
              )}
            </div>
          );
        })}
      </div>

      {empleados.length === 0 && (
        <div
          className="tarjeta-plana vacio mt-3 border-dashed"
          style={{ borderColor: "var(--borde-fuerte)" }}
        >
          <div className="vacio-titulo">Todavía no tienes empleados activos</div>
          <p className="vacio-texto">
            Cuando actives uno, acá vas a ver lo que hizo cada día.
          </p>
        </div>
      )}

      <p className="mt-4" style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>
        Los números vienen de la actividad real de tus empleados y se actualizan solos.
      </p>
        </aside>
      </div>
    </main>
  );
}
