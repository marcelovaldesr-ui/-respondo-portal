import { db } from "@/lib/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { empleadosDeCliente } from "@/lib/empleadosCache";
import { EMPLEADOS } from "@/lib/empleados";
import { COL_DESCARTADO } from "@/lib/seguimientosCore";
import { inicioDeMesChile, LOCALE, ZONA } from "@/lib/fechas";
import { resumenAhorro, SUPUESTOS } from "@/lib/analitica";
import type { ContextoNegocio } from "@/lib/estadoComercialCore";

/**
 * INICIO — EQUIPO DIGITAL Y RESULTADOS (Fase 1).
 *
 * Cada empleado dice QUÉ ESTÁ HACIENDO y QUÉ LOGRÓ, solo con datos que la base
 * registra. Si una capacidad está apagada, la tarjeta lo dice: una fila de
 * ceros de Beto se leía como «Beto no logra nada» cuando en realidad Beto
 * nunca estuvo encendido.
 *
 * Todo son conteos (`head: true`): ni una fila viaja, ni aplica el tope de
 * 1.000 filas de PostgREST. La versión anterior leía TODOS los mensajes del mes
 * paginando solo para contar chats distintos por empleado.
 */

type Supa = SupabaseClient | ReturnType<typeof db>;
const DIA = 86_400_000;

export type TarjetaEquipo = {
  clave: "tino" | "rita" | "vera" | "isabel";
  nombre: string;
  funcion: string;
  avatar: string;
  color: string;
  /** apagado = capacidad desactivada; en_espera = activa pero sin trabajo que mostrar. */
  estado: "activo" | "apagado" | "en_espera";
  haciendo: string;
  resultado: string | null;
  enlace: { href: string; label: string } | null;
};

async function contar(p: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  try {
    const r = await p;
    return r.error ? null : r.count ?? 0;
  } catch {
    return null;
  }
}

const n = (x: number | null) => (x ?? 0).toLocaleString("es-CL");
const plural = (x: number | null, uno: string, varios: string) => ((x ?? 0) === 1 ? uno : varios);

export async function resumenEquipo(
  clienteId: string,
  ctx: ContextoNegocio,
  datos: { derivadas: number; propuestasVivas: number; coberturaIA: number | null },
  supa: Supa = db(),
): Promise<TarjetaEquipo[]> {
  const empleados = await empleadosDeCliente(clienteId);
  const ids = (rol: string) => empleados.filter((e) => e.rol === rol).map((e) => e.id);
  const tino = ids("tino");
  const beto = ids("rita");
  const vera = ids("vera");
  const todos = empleados.map((e) => e.id);
  const mes = inicioDeMesChile();
  const hace24h = new Date(ctx.ahora - DIA).toISOString();

  const cuenta = (tabla: string) => supa.from(tabla).select("id", { count: "exact", head: true });
  const nada = Promise.resolve(null);

  const [
    conversacionesHoy,
    agendadasMes,
    betoEnviados,
    betoRespondieron,
    betoProgramados,
    veraEnviadas,
    veraRespondidas,
    veraMolestos,
    citasMes,
    informe,
  ] = await Promise.all([
    tino.length
      ? contar(supa.from("ed_contactos").select("chat_id", { count: "exact", head: true }).eq("cliente_id", clienteId).gte("ultimo_mensaje_en", hace24h))
      : nada,
    tino.length
      ? contar(cuenta("ed_resultados").in("empleado_id", todos).eq("tipo", "agendamiento").gte("creado_en", mes))
      : nada,
    beto.length
      ? contar(cuenta("ed_seguimientos").in("empleado_id", beto).not("enviado_en", "is", null).is(COL_DESCARTADO, null).gte("enviado_en", mes))
      : nada,
    beto.length
      ? contar(
          cuenta("ed_seguimientos")
            .in("empleado_id", beto)
            .not("enviado_en", "is", null)
            .is(COL_DESCARTADO, null)
            .eq("respuesta_recibida", true)
            .gte("enviado_en", mes),
        )
      : nada,
    beto.length ? contar(cuenta("ed_seguimientos").in("empleado_id", beto).is("enviado_en", null)) : nada,
    vera.length
      ? contar(
          cuenta("ed_seguimientos")
            .in("empleado_id", vera)
            .eq("tipo", "encuesta_postventa")
            .not("enviado_en", "is", null)
            .is(COL_DESCARTADO, null)
            .gte("enviado_en", mes),
        )
      : nada,
    vera.length ? contar(cuenta("ed_resultados").in("empleado_id", todos).eq("tipo", "encuesta_respondida").gte("creado_en", mes)) : nada,
    vera.length ? contar(cuenta("ed_resultados").in("empleado_id", todos).eq("tipo", "cliente_molesto").gte("creado_en", mes)) : nada,
    vera.length ? contar(cuenta("ed_citas").eq("cliente_id", clienteId).gte("inicio", mes)) : nada,
    (async () => {
      try {
        const { data, error } = await supa
          .from("ed_insights")
          .select("periodo_desde, contenido, creado_en")
          .eq("cliente_id", clienteId)
          .order("periodo_desde", { ascending: false })
          .limit(1)
          .maybeSingle();
        return error ? null : (data as Record<string, unknown> | null);
      } catch {
        return null;
      }
    })(),
  ]);

  const tarjetas: TarjetaEquipo[] = [];
  const meta = (rol: "tino" | "rita" | "vera") => {
    const m = EMPLEADOS[rol];
    const propio = empleados.find((e) => e.rol === rol)?.nombrePublico;
    return { nombre: propio || m.nombrePorDefecto, funcion: m.funcion, avatar: m.avatar, color: m.color };
  };

  if (tino.length) {
    const partes: string[] = [];
    if (datos.coberturaIA !== null) partes.push(`Escribió el ${datos.coberturaIA}% de las respuestas en 30 días`);
    if (agendadasMes) partes.push(`${n(agendadasMes)} ${plural(agendadasMes, "hora agendada", "horas agendadas")} este mes`);
    tarjetas.push({
      clave: "tino",
      ...meta("tino"),
      estado: "activo",
      haciendo:
        datos.derivadas > 0
          ? `${n(conversacionesHoy)} conversaciones en 24 h · ${n(datos.derivadas)} derivadas a tu equipo`
          : `${n(conversacionesHoy)} conversaciones en 24 h`,
      resultado: partes.join(" · ") || null,
      enlace: datos.derivadas > 0 ? { href: "/conversaciones?estado=espera", label: "Ver derivadas" } : null,
    });
  }

  if (beto.length) {
    const m = meta("rita");
    const enviados = betoEnviados ?? 0;
    const resultado = enviados
      ? `${n(enviados)} ${plural(enviados, "mensaje enviado", "mensajes enviados")} este mes · ${n(betoRespondieron)} ${plural(betoRespondieron, "respondió", "respondieron")}`
      : null;
    if (!ctx.betoCotizaciones) {
      tarjetas.push({
        clave: "rita",
        ...m,
        estado: "apagado",
        haciendo: "El seguimiento automático de cotizaciones está apagado",
        // Apagado no genera sugerencias nuevas; si quedaron de antes, se dice
        // así y no como si estuviera trabajando.
        resultado: datos.propuestasVivas > 0
          ? `${plural(datos.propuestasVivas, "Queda", "Quedan")} ${n(datos.propuestasVivas)} ${plural(datos.propuestasVivas, "sugerencia anterior", "sugerencias anteriores")} sin decidir`
          : resultado ?? "No escribe a nadie por su cuenta",
        enlace: datos.propuestasVivas > 0 ? { href: "/seguimientos", label: "Revisar pendientes" } : null,
      });
    } else {
      tarjetas.push({
        clave: "rita",
        ...m,
        estado: datos.propuestasVivas || betoProgramados ? "activo" : "en_espera",
        haciendo: datos.propuestasVivas
          ? `${n(datos.propuestasVivas)} ${plural(datos.propuestasVivas, "sugerencia espera", "sugerencias esperan")} aprobación`
          : betoProgramados
            ? `${n(betoProgramados)} ${plural(betoProgramados, "seguimiento programado", "seguimientos programados")}`
            : "Revisa las cotizaciones sin respuesta",
        resultado: resultado ?? "Sin envíos este mes",
        enlace: datos.propuestasVivas > 0 ? { href: "/seguimientos", label: ctx.puedeAprobarPagados ? "Revisar y aprobar" : "Ver sugerencias" } : null,
      });
    }
  }

  if (vera.length) {
    const m = meta("vera");
    const enviadas = veraEnviadas ?? 0;
    if (!enviadas && !citasMes) {
      tarjetas.push({
        clave: "vera",
        ...m,
        estado: "en_espera",
        haciendo: "Trabaja después de cada cita",
        resultado: "Este mes no hubo citas que seguir",
        enlace: null,
      });
    } else {
      tarjetas.push({
        clave: "vera",
        ...m,
        estado: "activo",
        haciendo: `${n(enviadas)} ${plural(enviadas, "encuesta enviada", "encuestas enviadas")} este mes`,
        resultado: `${n(veraRespondidas)} ${plural(veraRespondidas, "respondida", "respondidas")} · ${n(veraMolestos)} con mala nota`,
        enlace: veraMolestos ? { href: "/conversaciones?estado=espera", label: "Ver casos" } : null,
      });
    }
  }

  const contenido = (informe?.contenido ?? null) as { problemas?: string[]; oportunidades?: string[]; resumen?: string[] } | null;
  const hallazgo = contenido?.problemas?.[0] ?? contenido?.oportunidades?.[0] ?? contenido?.resumen?.[0] ?? null;
  tarjetas.push({
    clave: "isabel",
    nombre: "Isabel",
    funcion: "Análisis",
    avatar: "/brand/isabel.webp",
    color: "#7C3AED",
    estado: informe ? "activo" : "en_espera",
    haciendo: informe
      ? `Informe de la semana del ${diaYMes(String(informe.periodo_desde))}`
      : "Prepara un informe cada lunes",
    resultado: hallazgo ? recortar(hallazgo, 150) : informe ? null : "Todavía no hay informe",
    enlace: informe ? { href: "/insights", label: "Leer informe" } : null,
  });

  return tarjetas;
}

/** "2026-09-07" → "7 de septiembre" (día calendario, sin corrimiento de zona). */
function diaYMes(periodo: string): string {
  const d = new Date(`${periodo.slice(0, 10)}T12:00:00Z`);
  return new Intl.DateTimeFormat(LOCALE, { timeZone: ZONA, day: "numeric", month: "long" }).format(d);
}

function recortar(t: string, max: number): string {
  const limpio = t.replace(/\s+/g, " ").trim();
  return limpio.length <= max ? limpio : limpio.slice(0, max - 1).trimEnd() + "…";
}

export type ResultadosInicio = {
  conversacionesMes: number | null;
  coberturaIA: number | null;
  coberturaReciente: number | null;
  respuestasIA: number;
  minutosAhorrados: number | null;
  minutosPorMensaje: number;
};

export async function resultadosInicio(
  clienteId: string,
  conversacionesMes: number | null,
  supa?: SupabaseClient,
): Promise<ResultadosInicio> {
  const ahorro = await resumenAhorro(clienteId, 30, supa).catch(() => null);
  const hayDatos = ahorro && (ahorro.enviadosIA > 0 || ahorro.enviadosHumano > 0);
  return {
    conversacionesMes,
    coberturaIA: hayDatos ? ahorro.coberturaIA : null,
    coberturaReciente: hayDatos ? ahorro.coberturaReciente : null,
    respuestasIA: ahorro?.enviadosIA ?? 0,
    minutosAhorrados: hayDatos ? ahorro.minutosAhorrados : null,
    minutosPorMensaje: SUPUESTOS.minutosPorMensaje,
  };
}
