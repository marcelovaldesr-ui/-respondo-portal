import { exigirPermisoPortal } from "@/lib/auth";
import { opcionesDemo } from "@/lib/marketing/modo";
import { capacidadesDe, capacidadesDemo } from "@/lib/marketing/capacidades";
import { senalesDeNegocio } from "@/lib/marketing/senalesNegocio";
import { senalesVacias } from "@/lib/ads/senales";
import { destinosPosibles } from "@/lib/marketing/arquitectoCore";
import Cabecera from "@/components/marketing/Cabecera";
import Arquitecto from "@/components/marketing/Arquitecto";

export const dynamic = "force-dynamic";

/**
 * DISEÑAR CAMPAÑA — el paso anterior al asistente.
 *
 * El asistente de ocho pasos sirve cuando la persona ya decidió qué hacer.
 * Esta pantalla resuelve lo que en la práctica frena a todos: decidir. De una
 * frase salen la estrategia de canal, la estructura, las palabras, los ángulos
 * y la hipótesis, y de ahí se pasa al asistente o al estudio creativo.
 *
 * PERMISO: `generar_insights` (dueño), igual que el resto de Marketing.
 */
export default async function PaginaArquitecto() {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();

  const capacidades = demo ? capacidadesDemo(variante) : await capacidadesDe(usuario.clienteId);
  const senales = demo
    ? {
        ...senalesVacias(),
        ads: true,
        conversiones: true,
        conversaciones: variante === "completo",
        ingresos: variante === "completo",
      }
    : await senalesDeNegocio(usuario.clienteId);

  return (
    <main className="mk-pagina">
      <Cabecera
        titulo="Diseñar campaña"
        bajada="Contame qué quieres conseguir y con cuánto. El resto lo pienso yo."
        demo={demo}
      />
      <Arquitecto
        destinos={destinosPosibles(senales, capacidades.whatsappConectado)}
        monedaNegocio={capacidades.monedaPublicidad ?? "CLP"}
        hayCanales={capacidades.hayCanalConectado}
        demo={demo}
      />
    </main>
  );
}
