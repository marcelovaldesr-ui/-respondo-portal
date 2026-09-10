import { exigirPermisoPortal } from "@/lib/auth";
import { contextoDeMarca } from "@/lib/marketing/contextoMarca";
import { obtenerBorrador } from "@/lib/marketing/campanas";
import { listarCreatividades, obtenerCreatividad } from "@/lib/marketing/creatividades";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import GeneradorAnuncio from "@/components/marketing/GeneradorAnuncio";

export const dynamic = "force-dynamic";

/**
 * NUEVA CREATIVIDAD. `?campana=` la asocia a un borrador de campaña;
 * `?variarDe=` la arma como variación de otra creatividad.
 */
export default async function NuevaCreatividad({ searchParams }: { searchParams: Promise<{ campana?: string; variarDe?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const [marca, campana, base, almacen] = await Promise.all([
    contextoDeMarca(usuario.clienteId, demo),
    sp.campana ? obtenerBorrador(usuario.clienteId, sp.campana, demo) : null,
    sp.variarDe ? obtenerCreatividad(usuario.clienteId, sp.variarDe, demo) : null,
    listarCreatividades(usuario.clienteId, demo),
  ]);

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{ href: base ? `/marketing/creatividades/${encodeURIComponent(base.id)}` : "/marketing/creatividades", texto: base ? base.nombre : "Estudio creativo" }}
        titulo={base ? "Nueva variación" : "Nueva creatividad"}
        bajada={`Escrita con lo que Respondo sabe de ${marca.nombre}: ${marca.saber.length ? `${marca.saber.length} cosas aprendidas de las conversaciones` : "tu ficha del negocio"}${marca.ofertas.length ? ` y ${marca.ofertas.length} productos o servicios` : ""}.`}
        demo={demo}
      />
      {!almacen.disponible && <AvisoMigracion />}
      <GeneradorAnuncio
        negocio={marca.nombre}
        ofertas={marca.ofertas}
        demo={demo}
        campanaId={campana?.id ?? null}
        campanaNombre={campana?.nombre ?? null}
        base={base ? { ...base } : null}
      />
    </main>
  );
}
