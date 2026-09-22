"use client";

import { useEffect, useState, useTransition } from "react";
import {
  obtenerVistaPreviaPublicacionAccion,
  publicarCampanaNativaAccion,
} from "@/app/(marketing)/marketing/campanas/acciones";
import type { ResultadoPublicacion, VistaPreviaPublicacion } from "@/lib/ads/publicacion";
import type { Proveedor } from "@/lib/ads/canal";
import { Ico } from "@/components/marketing/Iconos";
import { formatearMonto } from "@/lib/ads/moneda";

export default function ModalPublicarCampana({
  borradorId,
  nombreBorrador,
  proveedorInicial = "meta",
  abierto,
  alCerrar,
  alPublicarExitoso,
}: {
  borradorId: string;
  nombreBorrador: string;
  proveedorInicial?: Proveedor;
  abierto: boolean;
  alCerrar: () => void;
  alPublicarExitoso?: (res: ResultadoPublicacion) => void;
}) {
  const [proveedor, setProveedor] = useState<Proveedor>(proveedorInicial);
  const [vista, setVista] = useState<VistaPreviaPublicacion | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoPublicacion | null>(null);
  const [publicando, iniciarPublicacion] = useTransition();

  useEffect(() => {
    if (!abierto) {
      setResultado(null);
      return;
    }
    setCargandoVista(true);
    setErrorCarga(null);
    obtenerVistaPreviaPublicacionAccion(borradorId, proveedor)
      .then((r) => {
        if (r.ok) {
          setVista(r.vistaPrevia);
        } else {
          setErrorCarga(r.motivo);
        }
      })
      .catch((e) => setErrorCarga(String(e)))
      .finally(() => setCargandoVista(false));
  }, [abierto, borradorId, proveedor]);

  if (!abierto) return null;

  const ejecutarPublicacion = () => {
    iniciarPublicacion(async () => {
      const res = await publicarCampanaNativaAccion(borradorId, proveedor);
      setResultado(res);
      if (res.ok && alPublicarExitoso) {
        alPublicarExitoso(res);
      }
    });
  };

  const nombrePlat = proveedor === "meta" ? "Meta Ads" : "Google Ads";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.65)", backdropFilter: "blur(4px)" }}
    >
      <div
        className="mk-tarjeta flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden shadow-2xl"
        style={{ background: "var(--fondo)" }}
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b px-6 py-4" style={{ borderColor: "var(--borde)" }}>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold" style={{ fontSize: "16px" }}>
                Publicar campaña en {nombrePlat}
              </span>
              <span className="mk-pildora uppercase" style={{ background: "var(--fondo-2)", fontSize: "10.5px" }}>
                PAUSED / PAUSADA
              </span>
            </div>
            <p className="text-xs text-muted mt-0.5">{nombreBorrador}</p>
          </div>
          <button
            type="button"
            className="text-muted hover:text-foreground p-1"
            onClick={alCerrar}
            disabled={publicando}
          >
            ✕
          </button>
        </div>

        {/* Selector de plataforma */}
        <div className="flex border-b px-6 pt-3" style={{ borderColor: "var(--borde)", background: "var(--fondo-2)" }}>
          <button
            type="button"
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              proveedor === "meta"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted"
            }`}
            onClick={() => setProveedor("meta")}
            disabled={publicando}
          >
            Meta Ads (Facebook & Instagram)
          </button>
          <button
            type="button"
            className={`border-b-2 px-4 py-2 text-sm font-medium ${
              proveedor === "google"
                ? "border-primary text-foreground font-semibold"
                : "border-transparent text-muted"
            }`}
            onClick={() => setProveedor("google")}
            disabled={publicando}
          >
            Google Ads (Búsqueda / Search)
          </button>
        </div>

        {/* Cuerpo scrollable */}
        <div className="overflow-y-auto p-6 space-y-4" style={{ fontSize: "13px" }}>
          {/* Regla de Dinero / Alerta Clara */}
          <div
            className="rounded-lg p-3.5"
            style={{ background: "rgba(227, 242, 253, 0.7)", border: "1px solid #90caf9", color: "#0d47a1" }}
          >
            <div className="flex items-start gap-2.5">
              <span className="text-base font-bold">🛡️</span>
              <div>
                <p className="font-semibold" style={{ fontSize: "13px" }}>
                  Protección de presupuesto activo
                </p>
                <p className="mt-0.5 text-xs" style={{ lineHeight: 1.45 }}>
                  Esta acción creará la campaña <strong>REALMENTE</strong> en tu cuenta de {nombrePlat}, pero lo
                  hará en estado <strong>PAUSADA</strong>. No empezará a gastar dinero hasta que tú la actives
                  explícitamente.
                </p>
              </div>
            </div>
          </div>

          {cargandoVista && (
            <div className="py-8 text-center" style={{ color: "var(--muted-2)" }}>
              Cargando parámetros de publicación y validando cuenta…
            </div>
          )}

          {errorCarga && (
            <div className="rounded-lg p-3" style={{ background: "#fdf1ee", color: "var(--tinta)" }}>
              {errorCarga}
            </div>
          )}

          {/* Resultado de la publicación si ya se ejecutó */}
          {resultado && (
            <div
              className={`rounded-lg p-4 ${
                resultado.ok ? "border border-green-500/30" : "border border-red-500/30"
              }`}
              style={{
                background: resultado.ok ? "var(--ok-suave)" : "#fdf1ee",
                color: resultado.ok ? "var(--ok)" : "var(--tinta)",
              }}
            >
              <div className="flex items-start gap-2.5">
                <span className="text-lg">{resultado.ok ? "✅" : "⚠️"}</span>
                <div className="space-y-1.5">
                  <p className="font-semibold">{resultado.mensaje}</p>
                  {resultado.campaignId && (
                    <p className="text-xs">
                      <strong>Campaign ID nativo:</strong> <code>{resultado.campaignId}</code>
                    </p>
                  )}
                  {resultado.adGroupOrAdSetId && (
                    <p className="text-xs">
                      <strong>{proveedor === "meta" ? "AdSet ID" : "AdGroup ID"}:</strong>{" "}
                      <code>{resultado.adGroupOrAdSetId}</code>
                    </p>
                  )}
                  {resultado.creativeIds?.length ? (
                    <p className="text-xs">
                      <strong>Creative ID:</strong> <code>{resultado.creativeIds.join(", ")}</code>
                    </p>
                  ) : null}
                  {resultado.adIds?.length ? (
                    <p className="text-xs">
                      <strong>Anuncio ID:</strong> <code>{resultado.adIds.join(", ")}</code>
                    </p>
                  ) : null}
                  {resultado.urlNativa && (
                    <div className="pt-2">
                      <a
                        href={resultado.urlNativa}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-suave mk-btn-lg inline-flex items-center gap-1.5 text-xs font-semibold"
                      >
                        {Ico.externo({ className: "h-3.5 w-3.5" })} Ver en {nombrePlat}
                      </a>
                    </div>
                  )}
                  {resultado.nativeErrors?.length ? (
                    <div className="mt-2 rounded p-2 text-xs" style={{ background: "rgba(0,0,0,0.04)" }}>
                      {resultado.nativeErrors.map((e, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <p className="font-medium text-red-600">{e.mensaje}</p>
                          {e.accionSugerida && <p className="text-muted">Acción: {e.accionSugerida}</p>}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Vista previa detallada */}
          {vista && !resultado && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-lg p-3" style={{ background: "var(--fondo-2)" }}>
                <div>
                  <span className="mk-dato-mini-etiqueta">Cuenta destino</span>
                  <p className="font-medium">{vista.cuentaNombre || "Cuenta conectada"}</p>
                  <p className="text-xs text-muted">ID: {vista.cuentaId || "No detectado"}</p>
                </div>
                <div>
                  <span className="mk-dato-mini-etiqueta">Presupuesto diario</span>
                  <p className="font-medium">
                    {vista.presupuesto.diario ? formatearMonto(vista.presupuesto.diario) : "No definido"}
                  </p>
                  <p className="text-xs text-muted">Moneda: {vista.moneda}</p>
                </div>
                <div>
                  <span className="mk-dato-mini-etiqueta">Objetivo y Destino</span>
                  <p className="font-medium capitalize">{vista.objetivo}</p>
                  <p className="text-xs text-muted">{vista.destinoDetalle}</p>
                </div>
                <div>
                  <span className="mk-dato-mini-etiqueta">Estado de creación</span>
                  <p className="font-medium text-amber-600">PAUSADA (sin gasto activo)</p>
                  <p className="text-xs text-muted">Activación posterior manual</p>
                </div>
              </div>

              {proveedor === "meta" && vista.identidad ? (
                <div className="flex items-center gap-3 rounded-lg p-3" style={{ background: "var(--fondo-2)" }}>
                  {vista.identidad.fotoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={vista.identidad.fotoUrl}
                      alt={`Foto de perfil de ${vista.identidad.nombre}`}
                      className="h-10 w-10 rounded-full object-cover"
                    />
                  ) : null}
                  <div>
                    <span className="mk-dato-mini-etiqueta">Se publicará como</span>
                    <p className="font-medium">{vista.identidad.nombre}</p>
                    <p className="text-xs text-muted">Página de Facebook · ID {vista.identidad.paginaId}</p>
                  </div>
                </div>
              ) : null}

              <div>
                <span className="mk-dato-mini-etiqueta">Audiencia / Ubicación</span>
                <p className="mt-0.5">{vista.audienciaResumen}</p>
              </div>

              {/* Anuncios / Copys */}
              <div>
                <span className="mk-dato-mini-etiqueta">Contenido del anuncio ({vista.anuncios.length})</span>
                <div className="mt-1 space-y-2">
                  {vista.anuncios.map((ad, idx) => (
                    <div key={idx} className="rounded p-2.5" style={{ background: "var(--fondo-2)" }}>
                      <p className="font-medium">{ad.titular}</p>
                      <p className="text-xs text-muted mt-0.5 line-clamp-2">{ad.texto}</p>
                      <span className="mt-1 inline-block text-[11px] font-semibold text-primary">
                        Botón CTA: {ad.cta}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Palabras clave si es Google */}
              {proveedor === "google" && vista.palabrasClave?.length ? (
                <div>
                  <span className="mk-dato-mini-etiqueta">Palabras clave ({vista.palabrasClave.length})</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {vista.palabrasClave.map((kw, idx) => (
                      <span key={idx} className="mk-chip text-xs">
                        {kw.texto} [{kw.concordancia}]
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Parámetros de Atribución y Tracking */}
              <div>
                <span className="mk-dato-mini-etiqueta">Parámetros de Atribución (UTMs)</span>
                <code
                  className="mt-1 block overflow-x-auto rounded p-2 text-xs"
                  style={{ background: "var(--fondo-2)" }}
                >
                  {Object.entries(vista.trackingUtm)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("&")}
                </code>
              </div>

              {/* Bloqueos o Advertencias */}
              {vista.bloqueos.length > 0 && (
                <div className="rounded p-3 text-xs" style={{ background: "#fdf1ee", color: "var(--tinta)" }}>
                  <p className="font-semibold">No se puede publicar todavía:</p>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    {vista.bloqueos.map((b, idx) => (
                      <li key={idx}>{b}</li>
                    ))}
                  </ul>
                </div>
              )}

              {vista.advertencias.length > 0 && (
                <div className="rounded p-2.5 text-xs text-amber-800" style={{ background: "#fff8e1" }}>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {vista.advertencias.map((a, idx) => (
                      <li key={idx}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botones de acción al pie */}
        <div
          className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--borde)", background: "var(--fondo-2)" }}
        >
          <button type="button" className="btn-texto text-sm" onClick={alCerrar} disabled={publicando}>
            {resultado ? "Cerrar" : "Cancelar"}
          </button>
          {!resultado && (
            <button
              type="button"
              className="btn-primario mk-btn-lg"
              disabled={publicando || cargandoVista || !vista?.puedePublicar}
              onClick={ejecutarPublicacion}
            >
              {publicando
                ? `Publicando en ${nombrePlat}…`
                : `Confirmar y publicar en ${nombrePlat} (Pausada)`}
            </button>
          )}
          {resultado?.ok && (
            <button type="button" className="btn-primario mk-btn-lg" onClick={alCerrar}>
              Listo
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
