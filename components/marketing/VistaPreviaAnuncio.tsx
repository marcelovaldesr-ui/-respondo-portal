import { proporcion, textoVisible } from "@/lib/marketing/creatividadesCore";
import type { FormatoCreatividad } from "@/lib/marketing/tipos";

/**
 * CÓMO SE VA A VER EL ANUNCIO — una maqueta fiel del feed.
 *
 * Reproduce la anatomía real de un anuncio de Meta: cabecera con el nombre
 * del negocio y «Publicidad», la imagen en su formato, la barra de botón y el
 * texto con el corte de «Ver más» a los 125 caracteres. Que el titular se
 * corte a los 40 caracteres ACÁ, antes de publicar, es lo que evita que se
 * corte en Meta después de pagar.
 */
export default function VistaPreviaAnuncio({
  negocio,
  titular,
  texto,
  cta,
  imagenUrl,
  formato,
  plataforma = "instagram",
  ancho = 340,
}: {
  negocio: string;
  titular: string;
  texto: string;
  cta: string;
  imagenUrl: string | null;
  formato: FormatoCreatividad;
  plataforma?: "instagram" | "facebook" | "ambas";
  ancho?: number;
}) {
  const { visible, oculto } = textoVisible(texto);
  const inicial = (negocio || "N").trim().charAt(0).toUpperCase();
  const alto = Math.round(ancho / proporcion(formato));

  return (
    <div className="mk-anuncio" style={{ maxWidth: ancho }}>
      <div className="mk-anuncio-cabecera">
        <div className="mk-anuncio-avatar">{inicial}</div>
        <div className="min-w-0 leading-tight">
          <div className="truncate font-semibold">{negocio || "Tu negocio"}</div>
          <div style={{ fontSize: 11, color: "#737373" }}>Publicidad · {plataforma === "facebook" ? "Facebook" : "Instagram"}</div>
        </div>
      </div>
      {plataforma !== "instagram" && (
        <div className="mk-anuncio-texto" style={{ paddingTop: 0 }}>
          {visible}
          {oculto && <span style={{ color: "#737373" }}>… Ver más</span>}
        </div>
      )}
      <div className="mk-anuncio-media" style={{ height: alto }}>
        {imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagenUrl} alt="" />
        ) : (
          <div className="mk-creatividad-sinimagen">
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Sin imagen todavía</span>
            <span style={{ fontSize: 11 }}>Genérala o súbela desde la creatividad</span>
          </div>
        )}
      </div>
      <div className="mk-anuncio-cta">
        <span className="truncate">{titular || "Titular del anuncio"}</span>
        <span className="ml-3 shrink-0 rounded-md border px-2.5 py-1" style={{ borderColor: "#d0d3d8", fontSize: 12 }}>
          {cta || "Enviar mensaje"}
        </span>
      </div>
      {plataforma === "instagram" && (
        <div className="mk-anuncio-texto">
          <span className="font-semibold">{negocio || "tu_negocio"}</span> {visible}
          {oculto && <span style={{ color: "#737373" }}>… más</span>}
        </div>
      )}
    </div>
  );
}
