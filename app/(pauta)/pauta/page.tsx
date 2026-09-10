import Link from "next/link";
import { exigirUsuarioPortal } from "@/lib/auth";
import { cargarPauta } from "@/lib/pauta";
import { formatearMonto } from "@/lib/pagosCore";
import type { FilaPauta } from "@/lib/pautaCore";

export const dynamic = "force-dynamic";

const PERIODOS = [
  { dias: 30, label: "30 días" },
  { dias: 90, label: "90 días" },
  { dias: 365, label: "Un año" },
];

/** "18 ago" a partir de un ISO. Vacío si no hay fecha. */
function dia(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    day: "numeric",
    month: "short",
  }).format(d);
}

function Cifra({
  valor,
  rotulo,
  detalle,
  acento,
}: {
  valor: string;
  rotulo: string;
  detalle?: string;
  acento?: boolean;
}) {
  return (
    <div className="tarjeta p-4">
      <div style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{rotulo}</div>
      <div
        className="cifra mt-1 font-bold"
        style={{ fontSize: "26px", color: acento ? "var(--indigo)" : "inherit" }}
      >
        {valor}
      </div>
      {detalle ? (
        <div className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          {detalle}
        </div>
      ) : null}
    </div>
  );
}

function Fila({ f }: { f: FilaPauta }) {
  /**
   * Un aviso que trae conversaciones y cero ventas no se esconde ni se pinta de
   * rojo: se marca. El rojo es un juicio y todavía no hay con qué juzgar —
   * pueden ser tres conversaciones de esta semana.
   */
  const sinCerrar = f.conversaciones >= 5 && f.ventas === 0;

  return (
    <tr style={{ borderTop: "1px solid var(--nav-borde)" }}>
      <td className="py-3 pr-3 align-top">
        <div className="font-semibold leading-snug" style={{ fontSize: "var(--t-fila)" }}>
          {f.url ? (
            <a href={f.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {f.titular}
            </a>
          ) : (
            f.titular
          )}
        </div>
        <div className="mt-0.5" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
          {f.anuncioId ? `id ${f.anuncioId.slice(-8)}` : "sin id"}
          {f.primera ? ` · desde el ${dia(f.primera)}` : ""}
          {f.conClid > 0 ? ` · ${f.conClid} con clic identificado` : ""}
        </div>
        {sinCerrar ? (
          <div className="mt-1.5" style={{ fontSize: "var(--t-micro)", color: "#9A3412" }}>
            Trae conversaciones y todavía no cierra ninguna venta.
          </div>
        ) : null}
      </td>
      <td className="cifra py-3 pr-3 text-right align-top tabular-nums">{f.conversaciones}</td>
      <td className="cifra py-3 pr-3 text-right align-top tabular-nums">{f.cotizaciones}</td>
      <td className="cifra py-3 pr-3 text-right align-top tabular-nums">{f.agendadas}</td>
      <td className="cifra py-3 pr-3 text-right align-top tabular-nums font-semibold">{f.ventas}</td>
      <td
        className="cifra py-3 text-right align-top font-bold tabular-nums"
        style={{ color: f.pagado > 0 ? "var(--indigo)" : "var(--muted-2)" }}
      >
        {f.pagado > 0 ? formatearMonto(f.pagado) : "—"}
      </td>
    </tr>
  );
}

export default async function Pauta({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const params = await searchParams;
  const usuario = await exigirUsuarioPortal();
  const pedidos = Number(params.dias);
  const dias = PERIODOS.some((p) => p.dias === pedidos) ? pedidos : 90;

  const pauta = await cargarPauta(usuario.clienteId, dias);
  const { resumen, estado, filas } = pauta;

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">De dónde viene cada venta</h1>
        <span className="sub-titulo">
          Qué anuncio trajo la conversación, y cuál de esas conversaciones terminó en plata
        </span>
      </div>

      {/* Período */}
      <div className="mt-5 flex flex-wrap gap-2">
        {PERIODOS.map((p) => {
          const activo = p.dias === dias;
          return (
            <Link
              key={p.dias}
              href={`/pauta?dias=${p.dias}`}
              className="rounded-full px-3.5 py-1.5 text-[12.5px] font-bold"
              style={
                activo
                  ? { background: "var(--indigo)", color: "#fff" }
                  : { background: "#F1F2F7", color: "var(--muted)" }
              }
            >
              {p.label}
            </Link>
          );
        })}
      </div>

      {/* Estado de la atribución: qué se puede afirmar hoy y qué no */}
      <div
        className="tarjeta mt-5 p-4"
        style={{
          borderLeft: `3px solid ${estado.nivel === "listo" ? "var(--indigo)" : "#F59E0B"}`,
        }}
      >
        <div style={{ fontSize: "var(--t-menor)", lineHeight: 1.55 }}>{estado.mensaje}</div>
      </div>

      {resumen.conversaciones === 0 ? (
        <div className="tarjeta mt-6 p-8 text-center">
          <h2 className="h-seccion">Todavía no hay conversaciones desde anuncios</h2>
          <p
            className="mx-auto mt-2 max-w-lg text-[14px] leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Cuando alguien entre por un aviso de Facebook o Instagram, esta tabla se llena sola:
            no hay nada que instalar ni configurar. Si ya estás pauteando y esto sigue vacío,
            revisa que los avisos lleven a WhatsApp y no a un formulario o al perfil.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Cifra
              valor={String(resumen.conversaciones)}
              rotulo="Conversaciones desde anuncios"
              detalle={`${resumen.avisos} ${resumen.avisos === 1 ? "aviso" : "avisos"} distintos`}
            />
            <Cifra valor={String(resumen.agendadas)} rotulo="Terminaron agendando" />
            <Cifra
              valor={String(resumen.ventas)}
              rotulo="Terminaron en venta"
              detalle={
                resumen.porVenta > 0
                  ? `${resumen.porVenta} conversaciones por venta`
                  : "todavía ninguna"
              }
            />
            <Cifra
              valor={formatearMonto(resumen.pagado)}
              rotulo="Cobrado por Flow"
              detalle="solo pagos confirmados"
              acento
            />
          </div>

          <div className="tarjeta mt-5 overflow-x-auto p-5">
            <h2 className="h-seccion">Aviso por aviso</h2>
            <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
              Últimos {dias} días, contados por la fecha en que entró la conversación
            </p>
            <table className="mt-4 w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr style={{ fontSize: "var(--t-columna)", color: "var(--muted-2)" }}>
                  <th className="pb-2 pr-3 font-semibold uppercase">Anuncio</th>
                  <th className="pb-2 pr-3 text-right font-semibold uppercase">Conv.</th>
                  <th className="pb-2 pr-3 text-right font-semibold uppercase">Cotiz.</th>
                  <th className="pb-2 pr-3 text-right font-semibold uppercase">Agenda</th>
                  <th className="pb-2 pr-3 text-right font-semibold uppercase">Ventas</th>
                  <th className="pb-2 text-right font-semibold uppercase">Cobrado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <Fila key={f.clave} f={f} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Letra chica honesta: lo que esta pantalla NO dice */}
      <div className="mt-5 space-y-2 px-1" style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>
        <p>
          Se cuentan solo las conversaciones que Meta marcó como venidas de un anuncio de
          Facebook o Instagram (Click-to-WhatsApp). Quien llega por Google, por el perfil o
          porque ya te conocía no aparece acá
          {pauta.sinAnuncio > 0 ? `: en este período fueron ${pauta.sinAnuncio} contactos` : ""}.
        </p>
        <p>
          &quot;Cobrado&quot; es lo que se pagó por el enlace de pago. Una venta cobrada por
          transferencia o en el mesón no la vemos, así que la columna es un piso, no el total.
        </p>
      </div>
    </main>
  );
}
