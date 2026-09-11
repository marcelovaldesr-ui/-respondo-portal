import { proporcion, textoVisible } from "@/lib/marketing/creatividadesCore";
import type { FormatoCreatividad } from "@/lib/marketing/tipos";

/**
 * CÓMO SE VA A VER EL ANUNCIO — maqueta fiel, no una miniatura.
 *
 * Reproduce la anatomía real del anuncio en Meta: cabecera con el nombre del
 * negocio y «Publicidad», la imagen en su formato exacto, la barra de titular
 * con el botón, y el texto con el corte de «Ver más» a los 125 caracteres.
 *
 * Que el titular se corte a los 40 caracteres ACÁ, antes de publicar, es lo
 * que evita que se corte en Meta después de pagar. Por eso la vista previa no
 * es decorativa: es la validación.
 *
 * Dos superficies: `feed` (Facebook/Instagram) e `historia` (9:16, marco
 * oscuro a pantalla completa con el CTA abajo). La historia solo se ofrece
 * donde el formato la permite; no se simula lo que no podemos representar.
 */
export default function VistaPreviaAnuncio({
  negocio,
  titular,
  texto,
  cta,
  imagenUrl,
  formato,
  plataforma = "instagram",
  superficie = "feed",
  ancho = 380,
}: {
  negocio: string;
  titular: string;
  texto: string;
  cta: string;
  imagenUrl: string | null;
  formato: FormatoCreatividad;
  plataforma?: "instagram" | "facebook" | "ambas";
  superficie?: "feed" | "historia";
  ancho?: number;
}) {
  const { visible, oculto } = textoVisible(texto);
  const inicial = (negocio || "N").trim().charAt(0).toUpperCase();
  const red = plataforma === "facebook" ? "Facebook" : "Instagram";

  if (superficie === "historia") {
    return (
      <div className="mk-historia" style={{ maxWidth: Math.min(ancho, 300) }}>
        {imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagenUrl} alt="" />
        ) : (
          <div className="absolute inset-0 grid place-items-center px-6 text-center" style={{ background: "#1b1f27" }}>
            <span style={{ fontSize: 12.5, color: "rgba(255,255,255,.65)" }}>La imagen aparece acá cuando la generes</span>
          </div>
        )}
        <div className="mk-historia-barra">
          <span />
        </div>
        <div className="mk-historia-cabecera">
          <span className="grid h-6 w-6 place-items-center rounded-full" style={{ background: "var(--indigo)", fontSize: 11 }}>
            {inicial}
          </span>
          <span className="truncate">{negocio || "Tu negocio"}</span>
          <span style={{ fontWeight: 400, opacity: 0.75 }}>· Publicidad</span>
        </div>
        <div className="mk-historia-pie">
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25, textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>
            {titular || "Titular del anuncio"}
          </div>
          <div className="mt-1" style={{ fontSize: 12.5, lineHeight: 1.4, opacity: 0.92, textShadow: "0 1px 3px rgba(0,0,0,.5)" }}>
            {visible}
            {oculto && "…"}
          </div>
          <div className="mk-historia-cta">{cta || "Enviar mensaje"}</div>
        </div>
      </div>
    );
  }

  const alto = Math.round(ancho / proporcion(formato));
  return (
    <div className="mk-anuncio" style={{ maxWidth: ancho }}>
      <div className="mk-anuncio-cabecera">
        <div className="mk-anuncio-avatar">{inicial}</div>
        <div className="min-w-0 leading-tight">
          <div className="truncate" style={{ fontWeight: 600 }}>
            {negocio || "Tu negocio"}
          </div>
          <div style={{ fontSize: 11.5, color: "#737373" }}>Publicidad · {red}</div>
        </div>
      </div>
      {plataforma !== "instagram" && (
        <div className="mk-anuncio-texto" style={{ paddingTop: 0, paddingBottom: 10 }}>
          {visible}
          {oculto && <span style={{ color: "#737373" }}>… Ver más</span>}
        </div>
      )}
      <div className="mk-anuncio-media" style={{ height: alto }}>
        {imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imagenUrl} alt="" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>Sin imagen todavía</span>
            <span style={{ fontSize: 11.5, color: "var(--muted-2)" }}>Se genera en el estudio en unos segundos</span>
          </div>
        )}
      </div>
      <div className="mk-anuncio-cta">
        <span className="truncate">{titular || "Titular del anuncio"}</span>
        <span className="ml-3 shrink-0 rounded-md px-3 py-1.5" style={{ background: "#e4e6eb", fontSize: 12.5 }}>
          {cta || "Enviar mensaje"}
        </span>
      </div>
      {/* El pie de Instagram es «negocio + copy». Sin copy queda el nombre del
          negocio solo, colgando bajo el botón como si fuera un error. */}
      {plataforma === "instagram" && visible.trim() !== "" && (
        <div className="mk-anuncio-texto">
          <span style={{ fontWeight: 600 }}>{negocio || "tu_negocio"}</span> {visible}
          {oculto && <span style={{ color: "#737373" }}>… más</span>}
        </div>
      )}
    </div>
  );
}
