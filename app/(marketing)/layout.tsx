import "./marketing.css";
import { exigirPermisoPortal } from "@/lib/auth";
import { opcionesDemo } from "@/lib/marketing/modo";
import { estadoParaNavegacion } from "@/lib/marketing/senalesNegocio";
import { senalesVacias } from "@/lib/ads/senales";
import RielMarketing, { FranjaMarketing } from "@/components/marketing/RielMarketing";

export const dynamic = "force-dynamic";

/**
 * EL CENTRO DE MARKETING — una plataforma dentro del portal.
 *
 * Grupo de rutas propio, con su propio riel: quien entra acá viene a hacer un
 * trabajo distinto del de atender conversaciones, y el riel se lo ordena en
 * tres verbos (analizar, crear, optimizar). Se vuelve al portal por el enlace
 * de arriba; la puerta de entrada es el botón «Marketing» del portal.
 *
 * Comparte con el portal la ÚNICA cosa que no puede duplicarse: la puerta de
 * seguridad. `exigirPermisoPortal` resuelve quién es y qué negocio puede ver,
 * y toda consulta de abajo se filtra por ese `clienteId`.
 *
 * PERMISO: `generar_insights` (dueño). Marketing muestra gasto y ventas.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const { demo, variante } = await opcionesDemo();

  /**
   * ⭐ LA NAVEGACIÓN SE ARMA CON LO QUE EL NEGOCIO TIENE (Fase 6).
   *
   * «Personas» sin conversaciones no es una lista que se va a llenar sola: es
   * una pantalla que nunca va a tener nada, y dejarla en el riel le enseña al
   * dueño que el producto tiene partes muertas. En demostración manda la
   * variante elegida, que es justamente lo que se quiere mostrar.
   */
  const navegacion = demo
    ? {
        senales: {
          ...senalesVacias(),
          ads: true,
          conversiones: true,
          conversaciones: variante === "completo",
          ingresos: variante === "completo",
        },
        canales: (variante === "meta" ? ["meta"] : variante === "google" ? ["google"] : ["meta", "google"]) as (
          | "meta"
          | "google"
        )[],
      }
    : await estadoParaNavegacion(usuario.clienteId);
  const { senales, canales } = navegacion;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row" style={{ background: "var(--fondo)" }}>
      <div className="hidden lg:block">
        <RielMarketing
          clienteNombre={demo ? "Gráfica Andina (demo)" : usuario.clienteNombre}
          demo={demo}
          variante={variante}
          senales={senales}
          canales={canales}
        />
      </div>
      <FranjaMarketing demo={demo} senales={senales} canales={canales} />
      <div className="mk-contenido">{children}</div>
    </div>
  );
}
