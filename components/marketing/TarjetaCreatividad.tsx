import Link from "next/link";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { Creatividad } from "@/lib/marketing/tipos";
import { EstadoDeCreatividad } from "@/components/marketing/Estado";
import { urlDeImagen } from "@/lib/marketing/imagenes";

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", day: "numeric", month: "numeric" }).formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("day")} ${MESES[Number(v("month")) - 1] ?? ""}`;
}

/**
 * UNA CREATIVIDAD EN LA GALERÍA — visual primero.
 *
 * La imagen ocupa la mayor parte de la tarjeta porque la imagen ES el
 * producto de esta sección. El marco es cuadrado para que la grilla alinee;
 * el formato real se anuncia en la esquina y se ve completo en el detalle.
 *
 * Al pasar el mouse aparecen las tres acciones que de verdad se usan —abrir,
 * variar, usar en campaña— sobre la imagen, sin robarle espacio permanente al
 * contenido. El rendimiento solo aparece cuando existe: sin datos de Meta no
 * se dibujan ceros.
 */
export default function TarjetaCreatividad({
  c,
  monedaNegocio = "CLP",
  conAcciones = true,
}: {
  c: Creatividad;
  monedaNegocio?: string;
  conAcciones?: boolean;
}) {
  const r = c.rendimiento;
  const href = `/marketing/creatividades/${encodeURIComponent(c.id)}`;
  return (
    <article className="mk-creatividad">
      <div className="mk-creatividad-visual">
        {c.imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={urlDeImagen(c.imagenUrl) ?? ""} alt={c.titular} loading="lazy" />
        ) : (
          <div className="mk-creatividad-sinimagen">
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--indigo)", lineHeight: 1.35 }}>
              {c.gancho || c.titular}
            </span>
            <span style={{ fontSize: "11.5px" }}>Sin imagen todavía</span>
          </div>
        )}
        <span className="mk-creatividad-formato">{c.formato}</span>
        {conAcciones && (
          <div className="mk-creatividad-acciones">
            <Link href={href}>Abrir</Link>
            <Link href={`/marketing/creatividades/nueva?variarDe=${encodeURIComponent(c.id)}`}>Variar</Link>
            <Link href={`/marketing/campanas/nueva?creatividad=${encodeURIComponent(c.id)}`}>Usar</Link>
          </div>
        )}
      </div>
      <div className="mk-creatividad-cuerpo">
        <div className="flex items-start justify-between gap-2">
          <Link href={href} className="mk-creatividad-titulo truncate hover:underline" title={c.nombre}>
            {c.nombre}
          </Link>
          <EstadoDeCreatividad estado={c.estado} />
        </div>
        <p className="mk-creatividad-copy">{c.titular}</p>
        <div className="truncate" style={{ fontSize: "11.5px", color: "var(--muted-3)" }}>
          {c.campanaNombre ?? "Sin campaña"} · {fechaCorta(c.actualizadoEn)}
        </div>
        {r && (
          <div className="mk-creatividad-datos">
            <Dato etiqueta="Gasto" valor={r.gasto === null ? "—" : formatearMonto({ valor: r.gasto, moneda: monedaNegocio })} />
            <Dato etiqueta="Conv." valor={formatearNumero(r.conversaciones)} />
            <Dato etiqueta="Ventas" valor={formatearNumero(r.ventas)} fuerte />
          </div>
        )}
      </div>
    </article>
  );
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="mk-dato-mini">
      <div className="mk-dato-mini-etiqueta">{etiqueta}</div>
      <div className="mk-dato-mini-valor" style={fuerte ? { color: "var(--indigo)" } : undefined}>
        {valor}
      </div>
    </div>
  );
}
