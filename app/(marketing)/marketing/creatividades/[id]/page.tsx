import { notFound } from "next/navigation";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { cargarMarketing } from "@/lib/marketing/datos";
import { opcionesDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import EditorCreatividad from "@/components/marketing/EditorCreatividad";

export const dynamic = "force-dynamic";

export default async function DetalleCreatividad({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();
  const { id } = await params;
  const sp = await searchParams;
  // Se carga el panorama para traer el rendimiento cruzado, no solo la fila.
  const p = await cargarMarketing(usuario.clienteId, resolverRango("30d"), { demo, variante });
  const c = p.creatividades.find((x) => x.id === id);
  if (!c) notFound();

  return (
    <main className="mk-pagina">
      <Cabecera
        volver={{ href: "/marketing/creatividades", texto: "Estudio creativo" }}
        titulo={c.nombre}
        bajada={`${c.formato} · ${c.plataforma === "ambas" ? "Facebook e Instagram" : c.plataforma === "instagram" ? "Instagram" : "Facebook"}${c.campanaNombre ? ` · ${c.campanaNombre}` : ""}`}
        demo={p.demo}
      />
      <EditorCreatividad c={c} negocio={p.demo ? "Gráfica Andina" : usuario.clienteNombre} monedaNegocio={p.monedaNegocio} demo={p.demo} recienCreada={sp.nueva === "1"} />
    </main>
  );
}
