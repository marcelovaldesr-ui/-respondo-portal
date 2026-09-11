import { exigirPermisoPortal } from "@/lib/auth";
import { conexionDe } from "@/lib/ads/meta";
import { contextoDeMarca } from "@/lib/marketing/contextoMarca";
import { obtenerBorrador } from "@/lib/marketing/campanas";
import { listarCreatividades } from "@/lib/marketing/creatividades";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import AsistenteCampana from "@/components/marketing/AsistenteCampana";

export const dynamic = "force-dynamic";

/**
 * CREAR / EDITAR CAMPAÑA. `?id=` abre un borrador existente;
 * `?creatividad=` preselecciona una creatividad (viene del estudio).
 */
export default async function NuevaCampana({ searchParams }: { searchParams: Promise<{ id?: string; creatividad?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const [marca, creatividades, borrador, conexion] = await Promise.all([
    contextoDeMarca(usuario.clienteId, demo),
    listarCreatividades(usuario.clienteId, demo),
    sp.id ? obtenerBorrador(usuario.clienteId, sp.id, demo) : null,
    demo ? null : conexionDe(usuario.clienteId),
  ]);
  const metaConectada = demo ? true : Boolean(conexion && conexion.cuentaId && conexion.estado === "conectada");
  const utilizables = creatividades.items.filter((c) => c.estado !== "archivada");

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{ href: "/marketing/campanas", texto: "Campañas" }}
        titulo={borrador ? borrador.nombre : "Nueva campaña"}
        bajada="Todo lo que Meta te va a pedir, ya pensado."
        demo={demo}
      />
      {!creatividades.disponible && !demo && <AvisoMigracion />}
      <AsistenteCampana
        key={borrador?.id ?? "nueva"}
        borrador={borrador}
        creatividades={utilizables}
        negocio={marca.nombre}
        ofertas={marca.ofertas}
        zona={marca.zona}
        whatsapp={marca.whatsapp}
        metaConectada={metaConectada}
        demo={demo}
        creatividadInicial={sp.creatividad ?? null}
      />
    </main>
  );
}
