import type { FilaPauta, ResumenPauta } from "@/lib/ads/atribucionCore";
import type { DatosPropios } from "@/lib/ads/metricas";

/**
 * HALLAZGOS AUTOMÁTICOS — lo que Pauta te dice sin que preguntes.
 *
 * LA REGLA QUE MANDA ACÁ: **cada hallazgo tiene que poder defenderse con una
 * cifra concreta.** Un panel que afirma «tu campaña está rindiendo mal» sin
 * decir contra qué, con cuántos casos y en qué período, es peor que uno que no
 * dice nada: la primera vez que alguien lo revisa y no cuadra, deja de creerle
 * a la pantalla entera, incluidas las cifras que sí estaban bien.
 *
 * De ahí los umbrales mínimos. No son cautela: son la diferencia entre un dato
 * y una casualidad. Con 3 conversaciones y 0 ventas no hay nada que concluir —
 * es un martes. Con 12, sí.
 *
 * Puro y sin dependencias de ejecución (los imports son de tipos, que
 * TypeScript borra), así se prueba con Node pelado.
 */

export type Hallazgo = {
  clave: string;
  /** Una línea, en el idioma del dueño. */
  titulo: string;
  /** El detalle con las cifras exactas que lo sostienen. */
  evidencia: string;
  /** `alerta` = está costando plata. `oportunidad` = hay algo que aprovechar. */
  tono: "alerta" | "oportunidad" | "neutro";
  /** Para ordenar: primero lo que cuesta plata. */
  prioridad: number;
  /** A dónde ir a ver el dato. */
  href?: string;
};

/** Mínimos para poder afirmar algo. Bajarlos es empezar a inventar. */
const MINIMOS = {
  /** Conversaciones de un anuncio antes de decir que no cierra. */
  sinCerrar: 8,
  /** Ventas para hablar de concentración. */
  concentracion: 3,
  /** Conversaciones en el período anterior para comparar. */
  comparar: 10,
  /** Ventas en cada período para hablar de costo por venta. */
  costoVenta: 5,
};

function pesos(n: number): string {
  return `$${new Intl.NumberFormat("es-CL").format(Math.round(n))}`;
}

export function hallazgos(entrada: {
  filas: FilaPauta[];
  resumen: ResumenPauta;
  propios: DatosPropios;
  propiosAntes: DatosPropios | null;
  /** Etiqueta del período, para escribirla en la evidencia. */
  periodo: string;
}): Hallazgo[] {
  const { filas, resumen, propios, propiosAntes, periodo } = entrada;
  const fuera: Hallazgo[] = [];

  /* ── 1. Un anuncio que trae gente y no cierra ─────────────────────────────
     El más accionable de todos: es plata que ya se gastó en traer a alguien
     que se fue. */
  const noCierra = filas
    .filter((f) => f.conversaciones >= MINIMOS.sinCerrar && f.ventas === 0)
    .sort((a, b) => b.conversaciones - a.conversaciones)[0];
  if (noCierra) {
    fuera.push({
      clave: `no_cierra_${noCierra.clave}`,
      titulo: `«${noCierra.titular}» trae conversaciones pero no cierra ninguna`,
      evidencia: `${noCierra.conversaciones} conversaciones en ${periodo} y ninguna terminó en venta. ${
        noCierra.cotizaciones > 0
          ? `${noCierra.cotizaciones} llegaron a cotizarse, así que el problema está después del precio.`
          : "Ninguna llegó siquiera a cotizarse: puede que el anuncio prometa algo distinto de lo que se vende."
      }`,
      tono: "alerta",
      prioridad: 100,
      href: "/pauta/anuncios",
    });
  }

  /* ── 2. De dónde viene la plata ──────────────────────────────────────────── */
  const conPlata = filas.filter((f) => f.pagado > 0).sort((a, b) => b.pagado - a.pagado);
  if (resumen.pagado > 0 && conPlata.length) {
    const primero = conPlata[0];
    const parte = Math.round((primero.pagado / resumen.pagado) * 100);
    if (parte >= 50 && resumen.ventas >= MINIMOS.concentracion) {
      fuera.push({
        clave: `concentracion_${primero.clave}`,
        titulo:
          conPlata.length === 1
            ? `Toda la plata atribuida viene de «${primero.titular}»`
            : `El ${parte}% de la plata atribuida viene de «${primero.titular}»`,
        evidencia: `${pesos(primero.pagado)} de ${pesos(resumen.pagado)} cobrados en ${periodo}, con ${primero.ventas} ${primero.ventas === 1 ? "venta" : "ventas"}. ${
          conPlata.length === 1
            ? "Depender de un solo aviso es frágil: si Meta lo baja, se corta la entrada."
            : "Vale la pena mirar qué tiene ese aviso que no tienen los otros."
        }`,
        tono: "oportunidad",
        prioridad: 80,
        href: "/pauta/anuncios",
      });
    }
  }

  /* ── 3. ¿Entra más o menos gente que antes? ──────────────────────────────── */
  if (propiosAntes && propiosAntes.conversaciones >= MINIMOS.comparar) {
    const antes = propiosAntes.conversaciones;
    const ahora = propios.conversaciones;
    const pct = Math.round(((ahora - antes) / antes) * 100);
    if (Math.abs(pct) >= 25) {
      fuera.push({
        clave: "variacion_conversaciones",
        titulo:
          pct < 0
            ? `Están llegando ${Math.abs(pct)}% menos conversaciones desde anuncios`
            : `Están llegando ${pct}% más conversaciones desde anuncios`,
        evidencia: `${ahora} en ${periodo}, contra ${antes} en el período anterior de la misma cantidad de días.`,
        tono: pct < 0 ? "alerta" : "oportunidad",
        prioridad: pct < 0 ? 90 : 60,
      });
    }
  }

  /* ── 4. ¿Se está cerrando mejor o peor? ─────────────────────────────────── */
  if (
    propiosAntes &&
    propios.ventas >= MINIMOS.costoVenta &&
    propiosAntes.ventas >= MINIMOS.costoVenta &&
    propios.conversaciones > 0 &&
    propiosAntes.conversaciones > 0
  ) {
    const ahora = (propios.ventas / propios.conversaciones) * 100;
    const antes = (propiosAntes.ventas / propiosAntes.conversaciones) * 100;
    const dif = Math.round((ahora - antes) * 10) / 10;
    if (Math.abs(dif) >= 5) {
      fuera.push({
        clave: "variacion_cierre",
        titulo:
          dif < 0
            ? "Se está cerrando peor que el período anterior"
            : "Se está cerrando mejor que el período anterior",
        evidencia: `De cada 100 conversaciones que llegan por anuncios, ahora compran ${ahora.toFixed(
          1,
        )}; antes compraban ${antes.toFixed(1)}. Es la atención, no el anuncio: la misma gente está llegando.`,
        tono: dif < 0 ? "alerta" : "oportunidad",
        prioridad: 85,
      });
    }
  }

  /* ── 5. Conversaciones que no se le pueden devolver a Meta ───────────────── */
  const sinClid = resumen.conversaciones - resumen.conClid;
  if (resumen.conversaciones >= MINIMOS.comparar && sinClid > resumen.conversaciones / 2) {
    fuera.push({
      clave: "sin_clid",
      titulo: "La mayoría de estas conversaciones no se le puede devolver a Meta",
      evidencia: `${sinClid} de ${resumen.conversaciones} no traen el identificador del clic. Meta lo manda solo en el primer mensaje: las conversaciones nuevas sí lo van a traer, las viejas no se recuperan.`,
      tono: "neutro",
      prioridad: 40,
      href: "/pauta/conexion",
    });
  }

  /* ── 6. Se agenda pero no se cobra ───────────────────────────────────────── */
  if (propios.agendadas >= MINIMOS.costoVenta && propios.ventas === 0) {
    fuera.push({
      clave: "agenda_sin_venta",
      titulo: "La gente agenda pero no aparece ninguna venta cerrada",
      evidencia: `${propios.agendadas} horas tomadas en ${periodo} y ninguna venta registrada. Puede ser real, o puede que las ventas se estén cobrando por fuera del enlace de pago y no las veamos.`,
      tono: "neutro",
      prioridad: 50,
      href: "/pauta/personas",
    });
  }

  return fuera.sort((a, b) => b.prioridad - a.prioridad).slice(0, 4);
}
