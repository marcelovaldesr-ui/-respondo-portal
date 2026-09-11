import { notFound } from "next/navigation";
import { exigirPermisoPortal } from "@/lib/auth";
import { contextoDeMarca } from "@/lib/marketing/contextoMarca";
import { obtenerBorrador } from "@/lib/marketing/campanas";
import { listarCreatividades } from "@/lib/marketing/creatividades";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import AvisoMigracion from "@/components/marketing/AvisoMigracion";
import AsistenteCampana from "@/components/marketing/AsistenteCampana";
import { capacidadesDe, capacidadesDemo } from "@/lib/marketing/capacidades";

export const dynamic = "force-dynamic";

/**
 * CREAR / EDITAR CAMPAÑA. `?id=` abre un borrador existente;
 * `?creatividad=` preselecciona una creatividad (viene del estudio).
 */
export default async function NuevaCampana({ searchParams }: { searchParams: Promise<{ id?: string; creatividad?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  /**
   * Las capacidades salen de UN solo lugar. Antes esta página calculaba
   * `metaConectada` con su propia expresión y `campanas/acciones.ts` repetía la
   * misma línea copiada: dos definiciones que podían separarse y dejar la
   * píldora que ve el dueño diciendo una cosa y el estado guardado otra.
   */
  const [marca, creatividades, borrador, capacidades] = await Promise.all([
    contextoDeMarca(usuario.clienteId, demo),
    listarCreatividades(usuario.clienteId, demo),
    sp.id ? obtenerBorrador(usuario.clienteId, sp.id, demo) : null,
    demo ? Promise.resolve(capacidadesDemo()) : capacidadesDe(usuario.clienteId),
  ]);
  /**
   * Un `?id=` que no existe abría el asistente EN BLANCO, con el id todavía en
   * la URL: la persona rehacía los ocho pasos y recién al guardar se enteraba
   * de que ese borrador ya no estaba. Mejor decirlo antes de que trabaje.
   */
  if (sp.id && !borrador) notFound();

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
        metaConectada={capacidades.metaConectada}
        puedeConectarMeta={capacidades.puedeConectarMeta}
        puedePublicar={capacidades.puedePublicarEnMeta}
        puedeGenerarConIa={capacidades.puedeGenerarConIa}
        demo={demo}
        creatividadInicial={sp.creatividad ?? null}
      />
    </main>
  );
}
