"use client";

import { useState } from "react";
import { supabaseNavegador } from "@/lib/supabaseNavegador";

const MENSAJES: Record<string, string> = {
  "enlace-invalido": "Ese enlace no es válido. Pide uno nuevo.",
  "enlace-expirado":
    "El enlace expiró o ya se usó. Los enlaces son de un solo uso: pide otro.",
};

export default function FormularioLogin({ error }: { error?: string }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviado" | "error">("idle");
  const [mensaje, setMensaje] = useState("");

  // Error que viene de la URL (enlace fallido) mientras no se intente otro envío.
  const errorUrl = estado === "idle" && error ? MENSAJES[error] ?? error : "";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    setMensaje("");
    try {
      const supa = supabaseNavegador();
      const { error: err } = await supa.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (err) throw err;
      setEstado("enviado");
    } catch (err) {
      setEstado("error");
      const m = (err as Error).message;
      setMensaje(
        m.includes("rate limit")
          ? "Se alcanzó el límite de correos por hora de Supabase. Espera un rato o pide un enlace directo."
          : m,
      );
    }
  }

  if (estado === "enviado") {
    return (
      <div>
        <div
          className="mb-3 flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--indigo-suave)" }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--indigo)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7l9 6 9-6M3 7v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z" />
          </svg>
        </div>
        <div className="titular text-[19px] font-bold">Revisa tu correo</div>
        <p className="mt-2 text-[14.5px]" style={{ color: "var(--muted)" }}>
          Enviamos un enlace de acceso a{" "}
          <strong style={{ color: "var(--tinta)" }}>{email}</strong>. Ábrelo desde este
          mismo dispositivo y entrarás directo, sin contraseña.
        </p>
        <button
          onClick={() => {
            setEstado("idle");
            setEmail("");
          }}
          className="mt-4 text-[14px] font-semibold underline"
          style={{ color: "var(--indigo)" }}
        >
          Usar otro correo
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={enviar}>
      <label htmlFor="email" className="block text-[14px] font-bold">
        Tu correo
      </label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="nombre@tunegocio.cl"
        className="campo mt-2"
      />
      <button type="submit" disabled={estado === "enviando"} className="btn-primario mt-4 w-full">
        {estado === "enviando" ? "Enviando..." : "Enviar enlace de acceso"}
      </button>
      <p className="mt-3 text-center text-[12px]" style={{ color: "var(--muted-2)" }}>
        Sin contraseñas. Te llega un enlace de un solo uso.
      </p>

      {(estado === "error" || errorUrl) && (
        <p
          className="mt-3 rounded-xl p-3 text-[14px]"
          style={{ background: "#FEF2F2", color: "#B91C1C" }}
        >
          {errorUrl || mensaje}
        </p>
      )}
    </form>
  );
}
