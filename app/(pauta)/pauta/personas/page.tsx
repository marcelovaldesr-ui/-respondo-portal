import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { MODELO_ATRIBUCION, personasDeAnuncios } from "@/lib/ads/atribucion";
import { formatearMonto } from "@/lib/ads/moneda";
import { diaLegible, resolverRango } from "@/lib/ads/periodos";
import SelectorRango from "@/components/pauta/SelectorRango";

export const dynamic = "force-dynamic";

/** Cómo se lee cada etapa del embudo. Mismo vocabulario que la pantalla Embudo. */
const ETAPAS: Record<string, { texto: string; clase: string }> = {
  nuevo: { texto: "Llegó", clase: "pildora-neutra" },
  interesado: { texto: "Interesado", clase: "pildora-indigo" },
  cotizado: { texto: "Cotizado", clase: "pildora-alerta" },
  ganado: { texto: "Ganado", clase: "pildora-ok" },
  perdido: { texto: "Perdido", clase: "pildora-neutra" },
};

/**
 * PERSONAS — el recorrido, una fila por quien llegó.
 *
 * Es la pantalla que hace auditable a toda la sección. La tabla de anuncios
 * dice «14 conversaciones, 3 ventas»; acá se ve quiénes son esas 14, en qué
 * quedó cada una, y se puede abrir la conversación y leerla. Un informe que no
 * se puede bajar hasta el caso concreto hay que creerlo o descartarlo entero —
 * y a la primera cifra que no cuadre, se descarta entero.
 */
export default async function Personas({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; anuncio?: string }>;
}) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const params = await searchParams;
  const rango = resolverRango(params.p);
  const anuncio = (params.anuncio ?? "").trim() || undefined;

  const personas = await personasDeAnuncios(usuario.clienteId, rango, anuncio);
  const nombreAnuncio = anuncio ? personas[0]?.anuncio : null;

  return (
    <main className="px-5 py-6 sm:px-7 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="h-pagina">Personas</h1>
          <p className="sub-pagina">
            Quién llegó por un anuncio y en qué quedó, una por una
          </p>
        </div>
        <SelectorRango rango={rango} base="/pauta/personas" extra={{ anuncio }} />
      </div>

      {anuncio && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="pildora-indigo">
            {nombreAnuncio ? `Anuncio: ${nombreAnuncio}` : "Filtrado por un anuncio"}
          </span>
          <Link
            href={`/pauta/personas?p=${rango.clave}`}
            className="font-semibold underline"
            style={{ fontSize: "var(--t-micro)", color: "var(--muted)" }}
          >
            Ver todos
          </Link>
        </div>
      )}

      {personas.length === 0 ? (
        <div className="tarjeta mt-6">
          <div className="vacio">
            <div className="vacio-titulo">Nadie llegó por un anuncio en este período</div>
            <p className="vacio-texto">
              Prueba con un rango más largo, o revisa que tus avisos lleven a WhatsApp.
            </p>
          </div>
        </div>
      ) : (
        <div className="tarjeta mt-5 overflow-x-auto">
          <table className="tabla min-w-[820px]">
            <thead>
              <tr>
                <th>Persona</th>
                <th>Vino de</th>
                <th>Entró</th>
                <th>Etapa</th>
                <th className="text-center">Cotizó</th>
                <th className="text-center">Agendó</th>
                <th className="text-center">Compró</th>
                <th className="text-right">Cobrado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => {
                const etapa = ETAPAS[p.etapa] ?? ETAPAS.nuevo;
                return (
                  <tr key={p.chatId}>
                    <td className="max-w-[180px] truncate font-semibold">{p.nombre}</td>
                    <td
                      className="max-w-[200px] truncate"
                      style={{ color: "var(--muted)" }}
                      title={p.anuncio}
                    >
                      {p.anuncio}
                    </td>
                    <td style={{ color: "var(--muted-2)" }}>
                      {p.desde ? diaLegible(p.desde.slice(0, 10)) : "—"}
                    </td>
                    <td>
                      <span className={etapa.clase}>{etapa.texto}</span>
                    </td>
                    <td className="text-center">{p.cotizo ? <Si /> : <No />}</td>
                    <td className="text-center">{p.agendo ? <Si /> : <No />}</td>
                    <td className="text-center">{p.compro ? <Si /> : <No />}</td>
                    <td
                      className="cifra text-right font-semibold"
                      style={{ color: p.pagado > 0 ? "var(--indigo)" : "var(--muted-3)" }}
                    >
                      {p.pagado > 0 ? formatearMonto({ valor: p.pagado, moneda: "CLP" }) : "—"}
                    </td>
                    <td className="text-right">
                      <Link
                        href={`/clientes/${encodeURIComponent(p.chatId)}`}
                        className="font-semibold underline"
                        style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}
                      >
                        Abrir
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div
        className="mt-6 max-w-3xl space-y-2 leading-relaxed"
        style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}
      >
        <p>
          <strong style={{ color: "var(--muted)" }}>Cómo se atribuye:</strong> cada persona queda
          asignada al <strong>primer anuncio</strong> que la trajo, y esa atribución no vence. Si
          llegó en marzo por un aviso y compró en junio, la venta es de ese aviso. No es una
          preferencia: Meta manda el dato del anuncio solo en el primer mensaje de la conversación,
          así que no existe un segundo toque que registrar.
        </p>
        <p>
          Esto hace que nuestras cifras sean <strong>menores</strong> que las del Administrador de
          Anuncios, que además se atribuye conversiones por vistas y por ventanas de varios días.
          Son las que podemos defender una por una abriendo la conversación.
          <span className="sr-only"> Modelo: {MODELO_ATRIBUCION}.</span>
        </p>
      </div>
    </main>
  );
}

function Si() {
  return (
    <span
      aria-label="Sí"
      title="Sí"
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: "var(--ok)" }}
    />
  );
}

function No() {
  return (
    <span aria-label="No" title="No" style={{ color: "var(--muted-3)" }}>
      ·
    </span>
  );
}
