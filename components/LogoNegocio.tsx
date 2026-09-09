"use client";

import { useRef, useState } from "react";
import { guardarLogo } from "@/app/(portal)/informacion/accionesLogo";

/**
 * SUBIR EL LOGO DEL NEGOCIO.
 *
 * Mismo patrón que `Cobro.tsx`: estado local y llamada directa a la server
 * action, en vez de un `<form action>` a secas. Acá importa porque la subida
 * puede fallar por cosas que la persona sí puede arreglar (formato, peso), y
 * un formulario mudo la dejaría sin saber qué pasó.
 */
export default function LogoNegocio({ actual }: { actual: string | null }) {
  const [estado, setEstado] = useState<"idle" | "subiendo" | "listo">("idle");
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(actual);
  const input = useRef<HTMLInputElement>(null);

  const enviar = async (fd: FormData) => {
    setEstado("subiendo");
    setError(null);
    try {
      const r = await guardarLogo(fd);
      if (r.ok) {
        setEstado("listo");
        setTimeout(() => setEstado("idle"), 2500);
      } else {
        setEstado("idle");
        setError(r.error ?? "No se pudo guardar el logo");
      }
    } catch {
      setEstado("idle");
      setError("No se pudo guardar el logo");
    }
  };

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    // Vista previa inmediata: la persona ve SU logo antes de que termine de
    // subir. Si algo falla después, el error lo dice.
    setVista(URL.createObjectURL(f));
    const fd = new FormData();
    fd.set("logo", f);
    void enviar(fd);
  };

  const quitar = () => {
    setVista(null);
    if (input.current) input.current.value = "";
    const fd = new FormData();
    fd.set("quitar", "1");
    void enviar(fd);
  };

  return (
    <div className="flex flex-wrap items-center gap-4">
      <div
        className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border"
        style={{ borderColor: "var(--borde)", background: "#fff" }}
      >
        {vista ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={vista} alt="Logo del negocio" className="h-full w-full object-contain" />
        ) : (
          <span className="text-[11px]" style={{ color: "var(--muted-2)" }}>
            Sin logo
          </span>
        )}
      </div>

      <div className="min-w-[200px] flex-1">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={alElegir}
          disabled={estado === "subiendo"}
          className="block w-full text-[13px] file:mr-3 file:cursor-pointer file:rounded-lg file:border file:border-solid file:px-3 file:py-1.5 file:text-[13px]"
          style={{ color: "var(--muted)" }}
        />
        <p className="mt-2 text-[12px]" style={{ color: "var(--muted-2)" }}>
          {estado === "subiendo"
            ? "Subiendo…"
            : estado === "listo"
              ? "✓ Logo actualizado"
              : "PNG, JPG, WEBP o SVG, hasta 2 MB. Se ve mejor cuadrado y con fondo transparente."}
        </p>
        {error && (
          <p className="mt-1 text-[12px]" style={{ color: "var(--alerta, #B91C1C)" }}>
            {error}
          </p>
        )}
        {vista && estado !== "subiendo" && (
          <button
            type="button"
            onClick={quitar}
            className="mt-2 text-[12px] underline"
            style={{ color: "var(--muted-2)" }}
          >
            Quitar logo
          </button>
        )}
      </div>
    </div>
  );
}
