import { exigirPermisoPortal } from "@/lib/auth";
import { contextoDeMarca } from "@/lib/marketing/contextoMarca";
import { obtenerBorrador } from "@/lib/marketing/campanas";
import { listarCreatividades, obtenerCreatividad } from "@/lib/marketing/creatividades";
import { plantillaPorClave } from "@/lib/marketing/plantillasCreativas";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import GeneradorAnuncio from "@/components/marketing/GeneradorAnuncio";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";

export const dynamic = "force-dynamic";

/**
 * NUEVA CREATIVIDAD.
 *   `?plantilla=` precarga uno de los arranques del estudio.
 *   `?campana=`   la asocia a un borrador de campaña.
 *   `?variarDe=`  la arma como variación de otra creatividad.
 */
export default async function NuevaCreatividad({
  searchParams,
}: {
  searchParams: Promise<{ campana?: string; variarDe?: string; plantilla?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const [marca, campana, base, almacen] = await Promise.all([
    contextoDeMarca(usuario.clienteId, demo),
    sp.campana ? obtenerBorrador(usuario.clienteId, sp.campana, demo) : null,
    sp.variarDe ? obtenerCreatividad(usuario.clienteId, sp.variarDe, demo) : null,
    listarCreatividades(usuario.clienteId, demo),
  ]);
  const plantilla = plantillaPorClave(sp.plantilla);

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{
          href: base ? `/marketing/creatividades/${encodeURIComponent(base.id)}` : "/marketing/creatividades",
          texto: base ? base.nombre : "Estudio creativo",
        }}
        titulo={base ? "Nueva variación" : plantilla ? plantilla.titulo : "Nueva creatividad"}
        demo={demo}
      />
      {!almacen.disponible && <AvisoMigracion />}
      <GeneradorAnuncio
        negocio={marca.nombre}
        ofertas={marca.ofertas}
        saber={marca.saber.length}
        demo={demo}
        campanaId={campana?.id ?? null}
        campanaNombre={campana?.nombre ?? null}
        base={base ? { ...base } : null}
        plantilla={plantilla}
      />
    </main>
  );
}
