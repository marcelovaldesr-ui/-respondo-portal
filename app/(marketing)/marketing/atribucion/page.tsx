import Link from "next/link";
import { exigirPermisoPortal } from "@/lib/auth";
import { resolverRango } from "@/lib/ads/periodos";
import { formatearMonto, formatearNumero, formatearPorcentaje } from "@/lib/ads/moneda";
import { cargarMarketing } from "@/lib/marketing/datos";
import { modoDemo } from "@/lib/marketing/modo";
import Cabecera from "@/components/marketing/Cabecera";
import Embudo from "@/components/marketing/Embudo";
import TablaAnuncios from "@/components/marketing/TablaAnuncios";

export const dynamic = "force-dynamic";

/**
 * ATRIBUCIÓN — de dónde viene cada venta.
 *
 * Es la pantalla que justifica toda la sección: Meta cuenta clics, acá se
 * cuenta lo que pasó DESPUÉS del clic, persona por persona. Tres bloques:
 * el embudo completo, la tabla por campaña con tasas (no solo totales) y la
 * tabla por anuncio. Desde cualquier cifra se puede bajar a las personas.
 */
export default async function Atribucion({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const usuario = await exigirPermisoPortal("generar_insights");
  const demo = await modoDemo();
  const rango = resolverRango((await searchParams).p);
  const p = await cargarMarketing(usuario.clienteId, rango, { demo });

  const reales = p.campanas.filter((c) => c.origen !== "borrador");
  const total = reales.reduce(
    (a, c) => ({ conversaciones: a.conversaciones + c.conversaciones, ventas: a.ventas + c.ventas, cobrado: a.cobrado + c.cobrado }),
    { conversaciones: 0, ventas: 0, cobrado: 0 },
  );
  const conAnuncio = p.leads.length;
  const totalContactos = conAnuncio + p.sinAnuncio;
  const conClid = p.leads.filter((l) => l.conClid).length;
  const enlaces = {
    conversaciones: `/marketing/leads?p=${rango.clave}`,
    calificados: `/marketing/leads?p=${rango.clave}&f=calificados`,
    avanzados: `/marketing/leads?p=${rango.clave}&f=cotizados`,
    ventas: `/marketing/leads?p=${rango.clave}&f=compraron`,
  };

  return (
    <main className="mk-pagina">
      <Cabecera
        eyebrow={`Marketing · ${p.demo ? "Gráfica Andina" : usuario.clienteNombre}`}
        titulo="Atribución"
        bajada="Qué pasó después del clic: cada conversación, cotización y venta unida al anuncio que la trajo."
        demo={p.demo}
        rango={rango}
        base="/marketing/atribucion"
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-12">
        <section className="tarjeta mk-seccion lg:col-span-7">
          <div className="mk-seccion-cabecera">
            <h2 className="h-seccion">Del anuncio a la venta</h2>
            <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{rango.etiqueta}</span>
          </div>
          <div className="mk-seccion-cuerpo">
            <Embudo escalones={p.embudo} enlaces={enlaces} />
          </div>
        </section>

        <section className="tarjeta mk-seccion lg:col-span-5">
          <div className="mk-seccion-cabecera">
            <h2 className="h-seccion">Cómo se atribuye</h2>
          </div>
          <div className="mk-seccion-cuerpo">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Dato titulo="Contactos del período" valor={formatearNumero(totalContactos)} nota="Por todas las vías" />
              <Dato titulo="Vinieron de un anuncio" valor={formatearNumero(conAnuncio)} nota={formatearPorcentaje(totalContactos ? (conAnuncio / totalContactos) * 100 : null) + " del total"} />
              <Dato titulo="Con identificador de clic" valor={formatearNumero(conClid)} nota="Se pueden devolver a Meta como conversión" />
              <Dato titulo="Ventas atribuidas" valor={`${formatearNumero(total.ventas)} · ${total.cobrado > 0 ? formatearMonto({ valor: total.cobrado, moneda: p.monedaNegocio }) : "—"}`} nota="Cobrado por enlace (piso)" fuerte />
            </dl>
            <div className="mt-4 rounded-md border px-3 py-2.5 leading-relaxed" style={{ borderColor: "var(--borde)", background: "var(--fondo-fila)", fontSize: "var(--t-micro)", color: "var(--muted)" }}>
              <div className="font-semibold" style={{ color: "var(--tinta)" }}>
                Modelo: primer contacto pagado
              </div>
              Cada persona se atribuye al primer anuncio de Facebook o Instagram desde el que escribió, aunque después vuelva por otra vía o compre semanas más tarde. No se reparte entre anuncios: una venta cuenta una vez, en un solo lugar. Meta marca el origen en el primer mensaje; Respondo lo guarda con la conversación.
            </div>
          </div>
        </section>
      </div>

      <section className="tarjeta mk-seccion mb-5">
        <div className="mk-seccion-cabecera">
          <h2 className="h-seccion">Por campaña</h2>
          <Link href={`/marketing/campanas?p=${rango.clave}`} className="font-semibold" style={{ fontSize: "var(--t-micro)", color: "var(--indigo)" }}>
            Campañas →
          </Link>
        </div>
        {reales.length === 0 ? (
          <div className="vacio">
            <div className="vacio-titulo">Todavía no hay conversaciones atribuidas</div>
            <p className="vacio-texto">La atribución empieza sola con el primer mensaje que llegue desde un anuncio. No hay nada que configurar.</p>
            <Link href="/marketing/campanas/nueva" className="btn-primario mt-4">Crear una campaña</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla min-w-[880px]">
              <thead>
                <tr>
                  <th>Campaña</th>
                  <th className="text-right">Conv.</th>
                  <th className="text-right" data-tip="Calificados ÷ conversaciones">Calif.</th>
                  <th className="text-right" data-tip="Cotizaron o reservaron ÷ conversaciones">Avanzan</th>
                  <th className="text-right" data-tip="Ventas ÷ conversaciones">Cierran</th>
                  <th className="text-right">Ventas</th>
                  <th className="text-right">Cobrado</th>
                  <th className="text-right" data-tip="Participación en las ventas del período">Peso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reales.map((c) => {
                  const t = (n: number) => formatearPorcentaje(c.conversaciones ? (n / c.conversaciones) * 100 : null);
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[300px]">
                        <Link href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}&t=embudo`} className="block truncate font-semibold hover:underline">
                          {c.nombre}
                        </Link>
                      </td>
                      <td className="cifra text-right">{formatearNumero(c.conversaciones)}</td>
                      <td className="cifra text-right">
                        {formatearNumero(c.calificados)} <span style={{ color: "var(--muted-2)", fontSize: "var(--t-micro)" }}>{t(c.calificados)}</span>
                      </td>
                      <td className="cifra text-right">
                        {formatearNumero(c.avanzados)} <span style={{ color: "var(--muted-2)", fontSize: "var(--t-micro)" }}>{t(c.avanzados)}</span>
                      </td>
                      <td className="cifra text-right">{t(c.ventas)}</td>
                      <td className="cifra text-right font-semibold">{formatearNumero(c.ventas)}</td>
                      <td className="cifra text-right font-semibold" style={{ color: c.cobrado > 0 ? "var(--indigo)" : "var(--muted-3)" }}>
                        {c.cobrado > 0 ? formatearMonto({ valor: c.cobrado, moneda: p.monedaNegocio }) : "—"}
                      </td>
                      <td className="text-right">
                        <span className="cifra">{formatearPorcentaje(total.ventas ? (c.ventas / total.ventas) * 100 : null)}</span>
                        <span className="mk-barra ml-2" style={{ width: Math.max(2, total.ventas ? (c.ventas / total.ventas) * 40 : 2) }} />
                      </td>
                      <td className="text-right">
                        <Link href={`/marketing/campanas/${encodeURIComponent(c.id)}?p=${rango.clave}&t=leads`} className="btn-chico">
                          Personas
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta mk-seccion">
        <div className="mk-seccion-cabecera">
          <h2 className="h-seccion">Por anuncio</h2>
          <span style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{formatearNumero(p.anuncios.length)} con actividad</span>
        </div>
        <TablaAnuncios anuncios={p.anuncios} monedaNegocio={p.monedaNegocio} periodo={rango.clave} mostrarCampana />
      </section>
    </main>
  );
}

function Dato({ titulo, valor, nota, fuerte }: { titulo: string; valor: string; nota: string; fuerte?: boolean }) {
  return (
    <div>
      <dt style={{ fontSize: "var(--t-micro)", color: "var(--muted-2)" }}>{titulo}</dt>
      <dd className="cifra mt-0.5 truncate" style={{ fontSize: "var(--t-fila)", fontWeight: 600, color: fuerte ? "var(--indigo)" : "var(--tinta)" }}>
        {valor}
      </dd>
      <dd style={{ fontSize: "var(--t-micro)", color: "var(--muted-3)" }}>{nota}</dd>
    </div>
  );
}
