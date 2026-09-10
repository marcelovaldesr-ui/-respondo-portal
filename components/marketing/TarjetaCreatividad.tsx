import Link from "next/link";
import { formatearMonto, formatearNumero } from "@/lib/ads/moneda";
import type { Creatividad } from "@/lib/marketing/tipos";

const ESTADO: Record<Creatividad["estado"], { texto: string; clase: string }> = {
  borrador: { texto: "Borrador", clase: "pildora-neutra" },
  lista: { texto: "Lista", clase: "pildora-indigo" },
  en_campana: { texto: "En campaña", clase: "pildora-ok" },
  archivada: { texto: "Archivada", clase: "pildora-neutra" },
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Santiago", day: "numeric", month: "numeric" }).formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("day")} ${MESES[Number(v("month")) - 1] ?? ""}`;
}

/**
 * UNA CREATIVIDAD EN LA GALERÍA. Visual primero: la imagen en su formato real,
 * el titular encima, y abajo lo que importa —estado, campaña, y rendimiento
 * cuando lo hay—. Sin datos de Meta no se muestran ceros: se dice que no hay.
 */
export default function TarjetaCreatividad({
  c,
  monedaNegocio = "CLP",
  compacta = false,
}: {
  c: Creatividad;
  monedaNegocio?: string;
  compacta?: boolean;
}) {
  const e = ESTADO[c.estado];
  const r = c.rendimiento;
  return (
    <Link href={`/marketing/creatividades/${encodeURIComponent(c.id)}`} className="tarjeta mk-creatividad">
      {/* La galería usa un marco uniforme (1:1) para que las tarjetas alineen; el
          formato real va en la esquina y se ve completo en el detalle. */}
      <div className="mk-creatividad-visual" style={{ aspectRatio: "1 / 1" }} title={`Formato ${c.formato}`}>
        {c.imagenUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.imagenUrl} alt={c.titular} loading="lazy" />
        ) : (
          <div className="mk-creatividad-sinimagen">
            <span className="font-semibold" style={{ color: "var(--muted)", fontSize: "var(--t-menor)" }}>
              {c.gancho || c.titular}
            </span>
            <span style={{ fontSize: "var(--t-micro)" }}>Sin imagen todavía</span>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded px-1.5 py-0.5 font-semibold" style={{ background: "rgba(15,23,42,.72)", color: "#fff", fontSize: 10.5 }}>
          {c.formato}
        </span>
      </div>
      <div className="mk-creatividad-cuerpo">
        <div className="flex items-start justify-between gap-2">
          <div className="truncate font-semibold" style={{ fontSize: "var(--t-fila)" }} title={c.nombre}>
            {c.nombre}
          </div>
          <span className={`${e.clase} shrink-0`}>{e.texto}</span>
        </div>
        <div className="truncate" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          {c.campanaNombre ?? "Sin campaña"} · {fechaCorta(c.actualizadoEn)}
        </div>
        {r ? (
          <div className="mt-1 grid grid-cols-3 gap-1 border-t pt-2" style={{ borderColor: "var(--borde)" }}>
            <Dato etiqueta="Gasto" valor={r.gasto === null ? "—" : formatearMonto({ valor: r.gasto, moneda: monedaNegocio })} />
            <Dato etiqueta="Conv." valor={formatearNumero(r.conversaciones)} />
            <Dato etiqueta="Ventas" valor={formatearNumero(r.ventas)} fuerte />
          </div>
        ) : (
          !compacta && (
            <div className="mt-1 border-t pt-2" style={{ borderColor: "var(--borde)", fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>
              Sin datos de rendimiento todavía
            </div>
          )
        )}
      </div>
    </Link>
  );
}

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor: string; fuerte?: boolean }) {
  return (
    <div className="min-w-0">
      <div style={{ fontSize: 10, color: "var(--muted-3)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{etiqueta}</div>
      <div className="cifra truncate" style={{ fontSize: "var(--t-menor)", fontWeight: fuerte ? 600 : 500 }}>
        {valor}
      </div>
    </div>
  );
}
