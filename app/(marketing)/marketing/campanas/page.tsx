import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { diaChile, resolverRango, sumarDias } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import { NEGOCIO_DEMO } from "@/lib/marketing/demo";
import Cabecera from "@/components/marketing/Cabecera";
import TablaCampanas from "@/components/marketing/TablaCampanas";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * CAMPAÑAS — la lista completa, con lo que cada una costó y lo que trajo.
 *
 * Arriba, cuatro cifras del período para tener el marco; abajo la tabla con
 * buscador, filtros y orden. Los borradores del asistente conviven con las
 * campañas de Meta porque para el dueño son «mis campañas»: unas ya corren y
 * otras están por salir.
 *
 * La chispa de 7 días se arma acá, desde los leads del período: es la única
 * forma de mostrar dirección por campaña sin pedirle a Meta una llamada por
 * cada fila.
 */
export default async function Campanas({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const rango = resolverRango((await searchParams).p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });

  const reales = p.campanas.filter((c) => c.origen !== "borrador");
  const activas = reales.filter((c) => c.estado === "activa" || c.estado === "publicada").length;
  const gasto = p.metaConectada ? reales.reduce((a, c) => a + (c.gasto ?? 0), 0) : null;
  const conversaciones = reales.reduce((a, c) => a + c.conversaciones, 0);
  const ventas = reales.reduce((a, c) => a + c.ventas, 0);
  const cobrado = reales.reduce((a, c) => a + c.cobrado, 0);

  // Conversaciones por día (últimos 7) de cada campaña, para la columna «7 días».
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(rango.hasta, i - 6));
  const series: Record<string, number[]> = {};
  for (const l of p.leads) {
    if (!l.campanaId) continue;
    const d = new Date(l.llegoEn);
    if (Number.isNaN(d.getTime())) continue;
    const i = dias.indexOf(diaChile(d));
    if (i < 0) continue;
    series[l.campanaId] ??= new Array(7).fill(0);
    series[l.campanaId][i] += 1;
  }

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Campañas"
        cuenta={p.demo ? `${NEGOCIO_DEMO.nombre} · CLP` : null}
        demo={p.demo}
        rango={rango}
        base="/marketing/campanas"
        acciones={
          <Link href="/marketing/campanas/nueva" className="btn-primario mk-btn-lg">
            {Ico.nueva({ className: "h-4 w-4" })} Crear campaña
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Resumen
          etiqueta="Campañas activas"
          valor={formatearNumero(activas)}
          nota={`${formatearNumero(reales.length)} en total · ${formatearNumero(p.borradores.length)} ${p.borradores.length === 1 ? "borrador" : "borradores"}`}
        />
        <Resumen
          etiqueta="Invertido"
          valor={gasto === null ? "—" : formatearMonto({ valor: gasto, moneda: p.monedaNegocio })}
          nota={gasto === null ? "Requiere la cuenta de Meta" : "Según Meta, en el período"}
        />
        <Resumen etiqueta="Conversaciones" valor={formatearNumero(conversaciones)} nota="Desde anuncios de Facebook e Instagram" />
        <Resumen
          etiqueta="Ventas e ingresos"
          valor={`${formatearNumero(ventas)} · ${cobrado > 0 ? formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) : "—"}`}
          nota="Cobrado por enlace de pago (piso)"
          fuerte
        />
      </div>

      {!p.almacenListo && <AvisoMigracion />}

      <TablaCampanas
        filas={p.campanas}
        monedaNegocio={p.monedaNegocio}
        periodo={rango.clave}
        metaConectada={p.metaConectada}
        series={series}
      />
    </main>
  );
}

function Resumen({ etiqueta, valor, nota, fuerte }: { etiqueta: string; valor: string; nota: string; fuerte?: boolean }) {
  return (
    <div className="mk-panel px-5 py-4">
      <div className="mk-kpi-etiqueta">{etiqueta}</div>
      <div
        className="cifra mt-2 truncate"
        style={{ fontSize: "21px", fontWeight: 600, letterSpacing: "-0.025em", color: fuerte ? "var(--indigo)" : valor === "—" ? "var(--muted-3)" : "var(--tinta)" }}
      >
        {valor}
      </div>
      <div className="mt-1.5" style={{ fontSize: "11.5px", color: "var(--muted-2)" }}>
        {nota}
      </div>
    </div>
  );
}
