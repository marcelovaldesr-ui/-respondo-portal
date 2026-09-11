import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { HERRAMIENTAS } from "@/lib/marketing/copilotoCore";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import { NEGOCIO_DEMO } from "@/lib/marketing/demo";
import Cabecera from "@/components/marketing/Cabecera";
import ChatCopiloto from "@/components/marketing/ChatCopiloto";

export const dynamic = "force-dynamic";

/**
 * COPILOTO. El panorama se carga acá —no dentro del chat— para poder mostrar
 * QUÉ se está analizando antes de la primera pregunta. Es la diferencia entre
 * un chat genérico y un copiloto que ya leyó tu período.
 */
export default async function Copiloto({ searchParams }: { searchParams: Promise<{ p?: string; q?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const rango = resolverRango(sp.p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });

  const reales = p.campanas.filter((c) => c.origen !== "borrador");
  const gasto = p.metaConectada ? reales.reduce((a, c) => a + (c.gasto ?? 0), 0) : null;
  const cobrado = reales.reduce((a, c) => a + c.cobrado, 0);
  const contexto = [
    { etiqueta: "Período", valor: rango.etiqueta },
    { etiqueta: "Campañas", valor: formatearNumero(reales.length) },
    { etiqueta: "Invertido", valor: gasto === null ? "—" : formatearMonto({ valor: gasto, moneda: p.monedaNegocio }) },
    { etiqueta: "Conversaciones", valor: formatearNumero(p.leads.length) },
    { etiqueta: "Ventas", valor: formatearNumero(p.leads.filter((l) => l.compro).length) },
    { etiqueta: "Ingresos", valor: cobrado > 0 ? formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) : "—" },
    { etiqueta: "Creatividades", valor: formatearNumero(p.creatividades.length) },
  ];

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Copiloto"
        bajada="Un asesor que lee tus cifras antes de opinar."
        cuenta={demo ? `${NEGOCIO_DEMO.nombre} · CLP` : null}
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
        contexto={contexto}
      />
    </main>
  );
}
