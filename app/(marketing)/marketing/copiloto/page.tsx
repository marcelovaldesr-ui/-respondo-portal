import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import { herramientasDisponibles, preguntasPara } from "@/lib/marketing/copilotoCore";
import { cargarMarketing } from "@/lib/marketing/datos";
import { opcionesDemo } from "@/lib/marketing/modo";
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
  const { demo, variante } = await opcionesDemo();
  const sp = await searchParams;
  const rango = resolverRango(sp.p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo, variante });

  const reales = p.campanas.filter((c) => c.origen !== "borrador");
  const gasto = p.senales.ads ? reales.reduce((a, c) => a + (c.gasto ?? 0), 0) : null;
  const cobrado = reales.reduce((a, c) => a + c.cobrado, 0);
  /**
   * ⭐ EL CONTEXTO MUESTRA LO QUE ESTE NEGOCIO TIENE, no una lista fija.
   *
   * «Conversaciones: 0» y «Ventas: 0» arriba del chat, en un negocio que no
   * trae sus conversaciones a Respondo, no informan: acusan. Y lo que acusan es
   * falso —esas conversaciones existen, pasan por otro lado—, así que la fila
   * simplemente no va.
   */
  const contexto = [
    { etiqueta: "Período", valor: rango.etiqueta },
    { etiqueta: "Campañas", valor: formatearNumero(reales.length) },
    ...(p.senales.ads
      ? [{ etiqueta: "Invertido", valor: gasto === null ? "—" : formatearMonto({ valor: gasto, moneda: p.monedaNegocio }) }]
      : []),
    ...(p.senales.conversaciones
      ? [
          { etiqueta: "Conversaciones", valor: formatearNumero(p.leads.length) },
          { etiqueta: "Ventas", valor: formatearNumero(p.leads.filter((l) => l.compro).length) },
        ]
      : []),
    ...(p.senales.ingresos && cobrado > 0
      ? [{ etiqueta: "Ingresos", valor: formatearMonto({ valor: cobrado, moneda: p.monedaNegocio }) }]
      : []),
    { etiqueta: "Creatividades", valor: formatearNumero(p.creatividades.length) },
  ];

  /**
   * Solo se muestran las herramientas que de verdad tienen algo que decir para
   * este negocio: la lista del pie es una promesa de lo que el copiloto puede
   * mirar, y prometer una que va a volver vacía es empezar mintiendo.
   */
  const { usables } = herramientasDisponibles(p);

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Copiloto"
        bajada="Un asesor que lee tus cifras antes de opinar."
        demo={demo}
        rango={rango}
        base="/marketing/copiloto"
      />
      <ChatCopiloto
        key={`${rango.clave}-${sp.q ?? ""}`}
        periodo={rango.clave}
        preguntaInicial={sp.q}
        demo={demo}
        herramientas={usables.map((h) => ({ nombre: h.nombre, etiqueta: h.etiqueta, descripcion: h.descripcion }))}
        contexto={contexto}
        sugerencias={preguntasPara(p)}
      />
    </main>
  );
}
