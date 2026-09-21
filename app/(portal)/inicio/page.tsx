import Notificaciones from "@/components/pwa/Notificaciones";
import NecesitaAtencion from "@/components/inicio/NecesitaAtencion";
import PorCerrarse from "@/components/inicio/PorCerrarse";
import EquipoDigital from "@/components/inicio/EquipoDigital";
import Resultados from "@/components/inicio/Resultados";
import OperacionDeHoy from "@/components/inicio/OperacionDeHoy";
import { exigirUsuarioPortal } from "@/lib/auth";
import { tienePermiso } from "@/lib/permisos";
import { formatearCLP } from "@/lib/resumen";
import { db } from "@/lib/db";
import { estadoDeCupo, type EstadoCupo } from "@/lib/cupoConversaciones";
import { resumenPagos } from "@/lib/pagos";
import { contarConversacionesActivas } from "@/lib/metricas";
import { inicioDeMesChile } from "@/lib/fechas";
import { contextoNegocio, panoramaInicio } from "@/lib/estadoComercial";
import { resultadosInicio, resumenEquipo } from "@/lib/inicio";
import { obtenerOperacionHoy } from "@/lib/operationsSummary";

export const dynamic = "force-dynamic";

/**
 * INICIO — «¿Qué está pasando en mi negocio y qué necesita de mí?» (Fase 1).
 *
 * Cuatro bloques, en el orden en que se decide:
 *
 *   A. Necesita tu atención  — lo que exige una decisión, agrupado por urgencia
 *   B. Por cerrarse          — cobros, cotizaciones e interesados con datos reales
 *   C. Tu equipo digital     — qué hace cada empleado y qué logró
 *   D. ¿Está funcionando?    — tres o cuatro cifras defendibles
 *
 * A y B salen del ESTADO COMERCIAL compartido (lib/estadoComercialCore.ts): la
 * ficha de la conversación usa exactamente las mismas reglas, así que la
 * portada y el chat no pueden contradecirse sobre un mismo cliente.
 *
 * Qué salió respecto de la versión anterior y por qué (docs/FASE1_ESTADO_COMERCIAL.md):
 *  · bloque mensual de `ed_metricas`: ningún proceso escribe esa tabla (solo
 *    semillas de demo). Métrica zombie.
 *  · «dinero ahorrado»: supuesto sobre supuesto; vive en Analítica.
 *  · franja permanente de avisos: ahora es una línea en la cabecera.
 *  · cifras de plata (cobrado, plan) para el staff: solo el dueño las ve.
 */

/** "Jueves 11 de septiembre · 09:14" — en hora de Chile, no del servidor. */
function fechaTitulo(ahora: number): string {
  const d = new Date(ahora);
  const dia = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
  const hora = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} · ${hora}`;
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
  const color = pasado ? "var(--peligro)" : cerca ? "var(--alerta)" : "var(--azul)";

  return (
    <div className="tarjeta px-4 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <span style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>
          Conversaciones del ciclo de facturación
        </span>
        {etiquetaPlan && (
          <span className="estado shrink-0" style={{ background: "var(--azul-suave)", color: "var(--azul)" }}>
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

      <div className="mt-2" style={{ fontSize: "var(--t-meta)", color: "var(--muted-2)" }}>
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
  const esDueno = usuario.rol === "dueno";
  const supa = db();
  const ctx = await contextoNegocio(
    usuario.clienteId,
    { puedeAprobarPagados: tienePermiso(usuario, "aprobar_mensajes_pagados") },
    supa,
  );

  /**
   * UNA TANDA EN PARALELO. El panorama (A y B) hace sus dos viajes internos;
   * el equipo espera al panorama solo para dos cifras que ya calculó (chats
   * derivados y sugerencias vivas), así no se consultan dos veces.
   */
  const panoramaP = panoramaInicio(usuario.clienteId, ctx, supa);
  const conversacionesP = contarConversacionesActivas(usuario.clienteId, inicioDeMesChile(), supa).catch(() => null);
  const resultadosP = conversacionesP.then((n) => resultadosInicio(usuario.clienteId, n));

  const [panorama, resultados, cupo, cobros, operacionHoy] = await Promise.all([
    panoramaP,
    resultadosP,
    esDueno ? estadoDeCupo(usuario.clienteId, supa) : Promise.resolve(null),
    esDueno
      ? resumenPagos(usuario.clienteId, supa).catch(() => ({ pendientes: 0, pagadosMes: 0, montoMes: 0 }))
      : Promise.resolve(null),
    obtenerOperacionHoy(usuario.clienteId, supa).catch(() => null),
  ]);
  const equipo = await resumenEquipo(
    usuario.clienteId,
    ctx,
    {
      derivadas: panorama.derivadas,
      propuestasVivas: panorama.atencion.filter((f) => f.atencion.items.some((i) => i.motivo === "propuesta_beto")).length,
      coberturaIA: resultados.coberturaIA,
    },
    supa,
  );

  return (
    <main className="mx-auto max-w-[1320px] px-4 py-6 sm:px-7 lg:px-8">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="h-pagina">Inicio</h1>
          <span className="sub-titulo">{fechaTitulo(ctx.ahora)}</span>
        </div>
        {/* Registra el service worker y ofrece los avisos: el permiso se pide tras un clic. */}
        <Notificaciones variante="cabecera" />
      </header>

      {!panorama.completo && (
        <p className="mt-3 rounded-md px-3 py-2" style={{ fontSize: "var(--t-menor)", background: "var(--alerta-suave)", color: "var(--alerta)" }}>
          No se pudo leer toda la actividad. Las listas pueden estar incompletas; recarga en un momento.
        </p>
      )}

      <div className="mt-5 grid items-start gap-x-8 gap-y-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-8">
          {operacionHoy && <OperacionDeHoy metricas={operacionHoy} />}
          <NecesitaAtencion
            filas={panorama.atencion}
            conteo={panorama.conteoAtencion}
            derivadas={panorama.derivadas}
            ahora={ctx.ahora}
          />
          <PorCerrarse
            filas={panorama.oportunidades}
            conteo={panorama.conteoOportunidades}
            ahora={ctx.ahora}
            verMontos={esDueno}
          />
        </div>

        <aside className="min-w-0 space-y-8">
          <EquipoDigital equipo={equipo} />
          <Resultados r={resultados} cobros={cobros} />
          {cupo && cupo.cupo !== null && (
            <section aria-labelledby="t-plan">
              <h2 id="t-plan" className="mb-2 font-semibold" style={{ fontSize: "var(--t-titulo)" }}>
                Tu plan
              </h2>
              <ConsumoDelPlan estado={cupo} />
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
