/**
 * Íconos del centro de marketing. Trazo de 1.8 y 24 de caja, como los del
 * portal (components/Sidebar.tsx). Sin librería: son diez, y una dependencia
 * de 300 íconos para usar diez es peso que paga cada cliente en cada carga.
 */
const base = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export const Ico = {
  inicio: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  campanas: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M16 8.5a4 4 0 0 1 0 7" />
      <path d="M18.5 5.5a8 8 0 0 1 0 13" />
    </svg>
  ),
  atribucion: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M4 5h16l-6 7v6l-4 2v-8L4 5z" />
    </svg>
  ),
  leads: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" />
      <path d="M21.5 20a6.5 6.5 0 0 0-4-6" />
    </svg>
  ),
  creatividades: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </svg>
  ),
  nueva: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  copiloto: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z" />
      <path d="M19 15l.8 2 2.2.7-2.2.7-.8 2-.8-2-2.2-.7 2.2-.7z" />
    </svg>
  ),
  integraciones: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M9 7V4M15 7V4" />
      <rect x="6" y="7" width="12" height="7" rx="2" />
      <path d="M12 14v3a3 3 0 0 1-3 3H8" />
    </svg>
  ),
  volver: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  ),
  flecha: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  externo: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  ),
  whatsapp: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M4 20l1.3-3.9A8 8 0 1 1 8.2 19L4 20z" />
      <path d="M9.5 9.5c.3 2 2.2 3.9 4.2 4.2l1.2-1.2 1.6.8-.4 1.6c-3.4.3-7.5-3.8-7.2-7.2l1.6-.4.8 1.6-1.2 1.2z" />
    </svg>
  ),
  ok: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
  copiar: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </svg>
  ),
  variar: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M4 7h4l4 10h8" />
      <path d="M4 17h4l4-10h8" />
      <path d="M18 4l3 3-3 3M18 14l3 3-3 3" />
    </svg>
  ),
  cerrar: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  buscar: (p?: { className?: string }) => (
    <svg {...base} className={p?.className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </svg>
  ),
};

export type NombreIcono = keyof typeof Ico;
