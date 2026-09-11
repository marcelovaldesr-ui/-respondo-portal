import type { Creatividad, EstadoCampana, EtapaLead } from "@/lib/marketing/tipos";

/**
 * LAS PÍLDORAS DE ESTADO — un solo vocabulario visual para todo Marketing.
 *
 * Un punto de color y una palabra. Sobrio a propósito: en una tabla de veinte
 * filas, veinte píldoras de fondo saturado convierten la pantalla en un
 * semáforo y ninguna se lee. El color dice el tono; la palabra dice el hecho.
 */
type Tono = "ok" | "indigo" | "alerta" | "neutro" | "peligro";

export function Pildora({ tono, children, tip }: { tono: Tono; children: React.ReactNode; tip?: string }) {
  return (
    <span className={`mk-estado ${tono}`} data-tip={tip}>
      {children}
    </span>
  );
}

const CAMPANA: Record<EstadoCampana, { texto: string; tono: Tono; tip?: string }> = {
  activa: { texto: "Activa", tono: "ok", tip: "Corriendo en Meta ahora." },
  pausada: { texto: "Pausada", tono: "alerta", tip: "Existe en Meta pero no está gastando." },
  terminada: { texto: "Terminada", tono: "neutro" },
  borrador: { texto: "Borrador", tono: "neutro", tip: "Le falta algo para poder llevarla a Meta." },
  lista: { texto: "Lista", tono: "indigo", tip: "Tiene todo: se puede llevar a Meta." },
  requiere_meta: { texto: "Requiere Meta", tono: "alerta", tip: "Está completa, pero la cuenta publicitaria no está conectada." },
  requiere_permiso: { texto: "Lista para Meta", tono: "indigo", tip: "Completa. Publicar desde Respondo requiere un permiso de Meta que no está habilitado; se lleva a mano." },
  publicada: { texto: "Publicada", tono: "ok" },
};

export function EstadoDeCampana({ estado }: { estado: EstadoCampana }) {
  const e = CAMPANA[estado];
  return (
    <Pildora tono={e.tono} tip={e.tip}>
      {e.texto}
    </Pildora>
  );
}

const CREATIVIDAD: Record<Creatividad["estado"], { texto: string; tono: Tono }> = {
  borrador: { texto: "Borrador", tono: "neutro" },
  lista: { texto: "Lista", tono: "indigo" },
  en_campana: { texto: "En campaña", tono: "ok" },
  archivada: { texto: "Archivada", tono: "neutro" },
};

export function EstadoDeCreatividad({ estado }: { estado: Creatividad["estado"] }) {
  const e = CREATIVIDAD[estado];
  return <Pildora tono={e.tono}>{e.texto}</Pildora>;
}

const LEAD: Record<EtapaLead, { texto: string; tono: Tono }> = {
  nuevo: { texto: "Llegó", tono: "neutro" },
  interesado: { texto: "Interesado", tono: "indigo" },
  cotizado: { texto: "Cotizado", tono: "alerta" },
  ganado: { texto: "Compró", tono: "ok" },
  perdido: { texto: "Perdido", tono: "neutro" },
};

export function EstadoDeLead({ etapa }: { etapa: EtapaLead }) {
  const e = LEAD[etapa];
  return <Pildora tono={e.tono}>{e.texto}</Pildora>;
}
