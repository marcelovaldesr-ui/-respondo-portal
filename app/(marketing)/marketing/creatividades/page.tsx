import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearNumero } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import GaleriaCreatividades from "@/components/marketing/GaleriaCreatividades";
import { Ico } from "@/components/marketing/Iconos";

export const dynamic = "force-dynamic";

/**
 * ESTUDIO CREATIVO — la galería.
 *
 * Se carga el panorama completo (y no solo la tabla de creatividades) para
 * poder cruzar cada creatividad con su rendimiento en Meta cuando lo hay.
 */
export default async function Creatividades({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const rango = resolverRango((await searchParams).p ?? "30d");
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });
  const conRendimiento = p.creatividades.filter((c) => c.rendimiento).length;
  const listas = p.creatividades.filter((c) => c.estado === "lista").length;

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${p.demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo="Estudio creativo"
        bajada={
          p.creatividades.length
            ? `${formatearNumero(p.creatividades.length)} creatividades · ${formatearNumero(listas)} listas para usar · ${formatearNumero(conRendimiento)} con rendimiento medido.`
            : "Anuncios escritos con lo que Respondo aprende de tus conversaciones, con imagen generada y vista previa fiel."
        }
        demo={p.demo}
        acciones={
          <Link href="/marketing/creatividades/nueva" className="btn-primario">
            {Ico.nueva()} Nueva creatividad
          </Link>
        }
      />
      {!p.almacenListo && <AvisoMigracion />}
      <GaleriaCreatividades items={p.creatividades} monedaNegocio={p.monedaNegocio} />
    </main>
  );
}
