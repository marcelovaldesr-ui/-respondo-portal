import { exigirPermisoPortal } from "@/lib/auth";
import { obtenerPerfilMarketing } from "@/lib/marketing/perfilMarketing";
import { proyeccionCreative } from "@/lib/marketing/perfilMarketingCore";
import { completitud } from "@/lib/marketing/contextoComercialCore";
import { obtenerBorrador } from "@/lib/marketing/campanas";
import { listarCreatividades, obtenerCreatividad } from "@/lib/marketing/creatividades";
import { plantillaPorClave, type PlantillaCreativa } from "@/lib/marketing/plantillasCreativas";
import { modoDemo } from "@/lib/marketing/modo";
import { briefDesdeAngulo } from "@/lib/marketing/arquitecto";
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
  searchParams: Promise<{ campana?: string; variarDe?: string; plantilla?: string; angulo?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const sp = await searchParams;
  const [perfil, campana, base, almacen] = await Promise.all([
    obtenerPerfilMarketing(usuario.clienteId, { demo }),
    sp.campana ? obtenerBorrador(usuario.clienteId, sp.campana, demo) : null,
    sp.variarDe ? obtenerCreatividad(usuario.clienteId, sp.variarDe, demo) : null,
    listarCreatividades(usuario.clienteId, demo),
  ]);
  const creativeCtx = proyeccionCreative(perfil);
  /**
   * ⭐ LA INTEGRACIÓN REAL CON EL ARQUITECTO (Fase 6).
   *
   * `?campana=<id>&angulo=<n>` abre el estudio con el brief del ángulo YA
   * cargado. No es copiar y pegar: el plan vive en el borrador de campaña y
   * acá se lee de ahí, así que el estudio no necesita saber que el Arquitecto
   * existe y el Arquitecto no necesita saber cómo se generan las imágenes. El
   * estado compartido es el borrador, que es el objeto que los dos editan.
   *
   * Si el plan no está guardado (migración 309 sin aplicar), simplemente no hay
   * ángulo que precargar y el estudio abre en blanco: se pierde comodidad, no
   * trabajo.
   */
  const indice = Number(sp.angulo);
  const anguloPlan =
    campana?.plan && Number.isInteger(indice) && indice >= 0 ? campana.plan.angulos[indice] : undefined;

  const plantilla: PlantillaCreativa | null = anguloPlan
    ? (() => {
        const brief = briefDesdeAngulo(campana!.plan!, anguloPlan);
        return {
          clave: `angulo-${indice}`,
          titulo: `Ángulo: ${anguloPlan.nombre}`,
          texto: anguloPlan.gancho,
          icono: "historia",
          objetivo: brief.objetivo,
          formato: brief.formato as PlantillaCreativa["formato"],
          plataforma: brief.plataforma as PlantillaCreativa["plataforma"],
          indicaciones: brief.indicaciones,
        };
      })()
    : plantillaPorClave(sp.plantilla);

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
        negocio={perfil.business.nombre}
        contexto={creativeCtx}
        completitud={completitud(creativeCtx)}
        contextoEditado={perfil.editado}
        demo={demo}
        campanaId={campana?.id ?? null}
        campanaNombre={campana?.nombre ?? null}
        base={base ? { ...base } : null}
        plantilla={plantilla}
        perfil={perfil}
      />
    </main>
  );
}
