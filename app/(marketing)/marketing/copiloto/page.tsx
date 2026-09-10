import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { HERRAMIENTAS } from "@/lib/marketing/copilotoCore";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import ChatCopiloto from "@/components/marketing/ChatCopiloto";

export const dynamic = "force-dynamic";

export default async function Copiloto({ searchParams }: { searchParams: Promise<{ p?: string; q?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const rango = resolverRango(sp.p);

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo="Copiloto"
        bajada="Un asesor que lee tus cifras antes de opinar. Puede armar la próxima campaña."
        demo={demo}
        rango={rango}
        base="/marketing/copiloto"
      />
      <ChatCopiloto
        key={`${rango.clave}-${sp.q ?? ""}`}
        periodo={rango.clave}
        preguntaInicial={sp.q}
        demo={demo}
        herramientas={HERRAMIENTAS.map((h) => ({ nombre: h.nombre, descripcion: h.descripcion }))}
      />
    </main>
  );
}
