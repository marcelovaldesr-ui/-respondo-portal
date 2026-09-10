import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import TablaCampanas from "@/components/marketing/TablaCampanas";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * CAMPAÑAS — la lista completa, con lo que cada una costó y lo que trajo.
 *
 * Arriba, tres cifras del período para tener el marco; abajo la tabla con
 * buscador, filtros y orden. Los borradores del asistente conviven con las
 * campañas de Meta en la misma lista, porque para el dueño son «mis
 * campañas»: unas ya corren y otras están por salir.
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

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${p.demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo="Campañas"
        bajada="Cada campaña con su costo, sus conversaciones y lo que terminó en venta."
        demo={p.demo}
        rango={rango}
        base="/marketing/campanas"
        acciones={
          <Link href="/marketing/campanas/nueva" className="btn-primario">
            {Ico.nueva()} Crear campaña
          </Link>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Resumen etiqueta="Campañas activas" valor={formatearNumero(activas)} nota={`${formatearNumero(reales.length)} en total · ${formatearNumero(p.borradores.length)} borradores`} />
        <Resumen
          etiqueta="Inversión del período"
          valor={gasto === null ? "—" : formatearMonto({ valor: gasto, moneda: p.monedaNegocio })}
          nota={gasto === null ? "Requiere la cuenta de Meta conectada" : "Según Meta"}
        />
        <Resumen etiqueta="Conversaciones" valor={formatearNumero(conversaciones)} nota="Desde anuncios de Facebook e Instagram" />
        <Resumen
          etiqueta="Ventas · cobrado"
          valor={`${formatearNumero(ventas)} · ${cobrado > 0 ? formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) : "—"}`}
          nota="Cobrado por enlace de pago (piso)"
          fuerte
        />
      </div>

      {!p.almacenListo && <AvisoMigracion />}
      <TablaCampanas filas={p.campanas} monedaNegocio={p.monedaNegocio} periodo={rango.clave} metaConectada={p.metaConectada} />

      <p className="mt-6 max-w-3xl leading-relaxed" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        Las conversaciones y ventas se atribuyen al primer anuncio pagado que trajo a cada persona. El gasto, las impresiones y los
        clics vienen de Meta y solo aparecen con la cuenta conectada.
      </p>
    </main>
  );
}

function Resumen({ etiqueta, valor, nota, fuerte }: { etiqueta: string; valor: string; nota: string; fuerte?: boolean }) {
  return (
    <div className="tarjeta px-4 py-3">
      <div className="mk-metrica-etiqueta">{etiqueta}</div>
      <div className="cifra mt-1 truncate" style={{ fontSize: "var(--t-ficha)", fontWeight: 600, letterSpacing: "-0.02em", color: fuerte ? "var(--indigo)" : "var(--tinta)" }}>
        {valor}
      </div>
      <div className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{nota}</div>
    </div>
  );
}
