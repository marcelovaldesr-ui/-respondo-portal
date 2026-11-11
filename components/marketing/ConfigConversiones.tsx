"use client";

import { useState, useTransition } from "react";
import {
  enviarEventoPruebaMeta,
  guardarConversionesMeta,
  obtenerDatasetMeta,
} from "@/app/(marketing)/marketing/integraciones/acciones";
import type { ConfigConversiones, EventoConversion } from "@/lib/ads/conversionesConfig";

/**
 * CONFIGURACIÓN DE CONVERSIONES A META, por negocio.
 *
 * Todo lo que distingue a un tenant de otro vive acá y no en el código: el
 * interruptor, qué eventos se mandan, la regla de calificación, el código de
 * prueba y el nombre de partner. Paso a paso de activación en
 * docs/CONVERSIONES_META.md.
 */

type Fila = { producto: string; sinonimos: string; cantidadMinima: string };

export type EventoReciente = {
  tipo: string;
  estado: string;
  motivo: string | null;
  creadoEn: string;
  esPrueba: boolean;
  origen: string | null;
};

const NOMBRE: Record<EventoConversion, string> = {
  LeadSubmitted: "Pidió cotización (LeadSubmitted)",
  QualifiedLead: "Cotización calificada (QualifiedLead)",
  Purchase: "Venta con monto (Purchase)",
};

function fecha(iso: string): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${v("day")}/${v("month")} ${v("hour")}:${v("minute")}`;
}

export default function ConfigConversiones({
  activo: activoInicial,
  config,
  dataset,
  faltaMigracion,
  eventos,
}: {
  activo: boolean;
  config: ConfigConversiones;
  dataset: string;
  faltaMigracion: boolean;
  eventos: EventoReciente[];
}) {
  const [activo, setActivo] = useState(activoInicial);
  const [ev, setEv] = useState(config.eventos);
  const [filas, setFilas] = useState<Fila[]>(
    config.reglas.length
      ? config.reglas.map((r) => ({ producto: r.producto, sinonimos: r.sinonimos.join(", "), cantidadMinima: String(r.cantidadMinima) }))
      : [{ producto: "", sinonimos: "", cantidadMinima: "" }],
  );
  const [testCode, setTestCode] = useState(config.testEventCode ?? "");
  const [partner, setPartner] = useState(config.partnerAgent ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, iniciar] = useTransition();

  if (faltaMigracion) {
    return (
      <p style={{ fontSize: "12.5px", color: "var(--alerta)" }}>
        Falta habilitar esta función en la base (migración 331). Es un paso nuestro.
      </p>
    );
  }

  const guardar = () =>
    iniciar(async () => {
      const fd = new FormData();
      fd.set("activo", activo ? "1" : "0");
      fd.set(
        "config",
        JSON.stringify({
          eventos: ev,
          reglas: filas
            .filter((f) => f.producto.trim())
            .map((f) => ({
              producto: f.producto,
              sinonimos: f.sinonimos.split(",").map((s) => s.trim()).filter(Boolean),
              cantidadMinima: Number(f.cantidadMinima.replace(/\D/g, "")),
            })),
          testEventCode: testCode.trim() || null,
          partnerAgent: partner.trim() || null,
        }),
      );
      const r = await guardarConversionesMeta(fd);
      setMsg({ ok: r.ok, texto: r.ok ? "Guardado." : (r.motivo ?? "No se pudo guardar.") });
    });

  const accion = (fn: () => Promise<{ ok: boolean; motivo?: string }>) =>
    iniciar(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, texto: r.motivo ?? (r.ok ? "Listo." : "No se pudo.") });
    });

  const etiqueta = { fontSize: "12.5px", fontWeight: 600 } as const;
  const ayuda = { fontSize: "11px", color: "var(--muted-2)" } as const;

  return (
    <div className="space-y-5">
      {/* Interruptor */}
      <label className="flex items-start gap-2.5">
        <input type="checkbox" className="mt-1" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        <span>
          <span style={etiqueta}>Enviar los resultados de las conversaciones de anuncios a Meta</span>
          <span className="block" style={ayuda}>
            Apagado, nada sale y nada cambia. Solo cuentan las conversaciones que llegaron desde un anuncio Click-to-WhatsApp.
          </span>
        </span>
      </label>

      {/* Dataset */}
      <div>
        <div style={etiqueta}>Conjunto de datos (dataset)</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="cifra" style={{ fontSize: "12.5px" }}>{dataset || "sin configurar"}</span>
          <button type="button" className="btn-suave" disabled={pendiente} onClick={() => accion(obtenerDatasetMeta)}>
            {dataset ? "Volver a verificar con Meta" : "Obtener o crear desde WhatsApp"}
          </button>
        </div>
        <p className="mt-1" style={ayuda}>
          Lo pide a Meta con el token de este WhatsApp. Si falta el permiso de eventos, Meta lo dice acá.
        </p>
      </div>

      {/* Eventos */}
      <div>
        <div style={etiqueta}>Qué se le informa a Meta</div>
        <div className="mt-1 space-y-1">
          {(Object.keys(NOMBRE) as EventoConversion[]).map((k) => (
            <label key={k} className="flex items-center gap-2" style={{ fontSize: "12.5px" }}>
              <input type="checkbox" checked={ev[k]} onChange={(e) => setEv({ ...ev, [k]: e.target.checked })} />
              {NOMBRE[k]}
            </label>
          ))}
        </div>
      </div>

      {/* Regla */}
      <div>
        <div style={etiqueta}>Regla de cotización calificada</div>
        <p style={ayuda}>Califica cuando el producto calza y la cantidad es igual o mayor al mínimo. Sin reglas, solo se califica a mano.</p>
        <div className="mt-2 space-y-2">
          {filas.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input
                className="campo"
                style={{ maxWidth: 150 }}
                placeholder="calendarios"
                value={f.producto}
                onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, producto: e.target.value } : x)))}
              />
              <input
                className="campo"
                style={{ maxWidth: 220 }}
                placeholder="otros nombres: calendario, almanaque"
                value={f.sinonimos}
                onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, sinonimos: e.target.value } : x)))}
              />
              <span style={{ fontSize: "12px" }}>desde</span>
              <input
                className="campo cifra"
                style={{ maxWidth: 90 }}
                inputMode="numeric"
                placeholder="500"
                value={f.cantidadMinima}
                onChange={(e) => setFilas(filas.map((x, j) => (j === i ? { ...x, cantidadMinima: e.target.value } : x)))}
              />
              <span style={{ fontSize: "12px" }}>unidades</span>
              <button type="button" className="btn-texto" onClick={() => setFilas(filas.filter((_, j) => j !== i))}>
                Quitar
              </button>
            </div>
          ))}
          <button type="button" className="btn-texto" onClick={() => setFilas([...filas, { producto: "", sinonimos: "", cantidadMinima: "" }])}>
            + Agregar producto
          </button>
        </div>
      </div>

      {/* Prueba y partner */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span style={etiqueta}>Código de prueba (Test event code)</span>
          <input className="campo mt-1" placeholder="TEST12345" value={testCode} onChange={(e) => setTestCode(e.target.value)} />
          <span className="block" style={ayuda}>Del Administrador de eventos → Probar eventos. Solo lo usa el botón de prueba.</span>
        </label>
        <label className="block">
          <span style={etiqueta}>Nombre de partner (opcional)</span>
          <input className="campo mt-1" placeholder="asignado por Meta" value={partner} onChange={(e) => setPartner(e.target.value)} />
          <span className="block" style={ayuda}>Solo si Meta nos asignó uno.</span>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primario" disabled={pendiente} onClick={guardar}>
          {pendiente ? "Guardando…" : "Guardar"}
        </button>
        <button type="button" className="btn-suave" disabled={pendiente} onClick={() => accion(enviarEventoPruebaMeta)}>
          Enviar evento de prueba
        </button>
      </div>
      {msg && (
        <p role="status" style={{ fontSize: "12px", color: msg.ok ? "var(--ok)" : "var(--alerta)" }}>
          {msg.texto}
        </p>
      )}

      {/* Registro */}
      {eventos.length > 0 && (
        <div>
          <div style={etiqueta}>Últimos eventos</div>
          <table className="mt-1 w-full" style={{ fontSize: "11.5px" }}>
            <tbody>
              {eventos.map((e, i) => (
                <tr key={i} title={e.motivo ?? undefined}>
                  <td className="cifra py-0.5 pr-2" style={{ color: "var(--muted-2)" }}>{fecha(e.creadoEn)}</td>
                  <td className="pr-2">{e.tipo}{e.esPrueba ? " · prueba" : ""}</td>
                  <td className="pr-2">{e.estado}</td>
                  <td className="truncate" style={{ color: "var(--muted-2)", maxWidth: 260 }}>{e.motivo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
