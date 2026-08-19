"use client";

import { useState, useTransition } from "react";
import { guardarFicha, reactivarCliente } from "@/app/(portal)/clientes/acciones";

/**
 * Datos editables de la ficha + reactivación del cliente.
 *
 * Las notas internas son el corazón de esto: "siempre pide factura", "prefiere
 * retirar los viernes", "es hermano del proveedor". Ese conocimiento hoy vive en
 * la cabeza de quien atiende y se pierde cuando no está.
 */
export default function FichaClienteEditor({
  chatId,
  nombre,
  telefono,
  email,
  notas,
  diasSinHablar,
}: {
  chatId: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  diasSinHablar: number | null;
}) {
  const [guardando, guardar] = useTransition();
  const [aviso, setAviso] = useState<string | null>(null);

  const [abrirReactivar, setAbrirReactivar] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [enviando, enviar] = useTransition();
  const [resultado, setResultado] = useState<string | null>(null);

  return (
    <>
      <form
        action={(fd) => {
          setAviso(null);
          fd.set("chatId", chatId);
          guardar(async () => {
            const r = await guardarFicha(fd);
            setAviso(r.ok ? "Guardado" : (r.error ?? "No se pudo guardar"));
          });
        }}
        className="tarjeta p-4"
      >
        <h2 className="h-seccion">Datos</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Nombre
            </span>
            <input name="nombre" defaultValue={nombre} className="campo mt-1" />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Teléfono de contacto
            </span>
            <input
              name="telefono"
              defaultValue={telefono ?? ""}
              placeholder={`+${chatId}`}
              className="campo mt-1"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Correo
            </span>
            <input
              name="email"
              type="email"
              defaultValue={email ?? ""}
              placeholder="Para enviarle cotizaciones o documentos"
              className="campo mt-1"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-[12px] font-semibold" style={{ color: "var(--muted)" }}>
              Notas internas
            </span>
            <textarea
              name="notas"
              defaultValue={notas ?? ""}
              rows={3}
              placeholder="Lo que conviene recordar de este cliente: cómo prefiere pagar, plazos, quién decide…"
              className="campo mt-1 resize-y"
            />
            <span className="mt-1 block text-[11.5px]" style={{ color: "var(--muted-2)" }}>
              Solo las ve tu equipo. El cliente nunca las lee.
            </span>
          </label>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? "Guardando…" : "Guardar"}
          </button>
          {aviso && (
            <span
              className="text-[12.5px] font-semibold"
              style={{ color: aviso === "Guardado" ? "var(--ok)" : "var(--alerta)" }}
            >
              {aviso}
            </span>
          )}
        </div>
      </form>

      {/* Reactivar */}
      <div className="tarjeta mt-4 p-4">
        <h2 className="h-seccion">Retomar el contacto</h2>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
          {diasSinHablar !== null && diasSinHablar >= 7
            ? `Llevan ${diasSinHablar} días sin hablar. Un mensaje puede revivir la venta.`
            : "Envíale un mensaje para retomar una conversación que quedó a medias."}
        </p>

        {!abrirReactivar ? (
          <button
            type="button"
            className="btn-suave mt-3"
            onClick={() => setAbrirReactivar(true)}
          >
            Escribir mensaje
          </button>
        ) : (
          <div className="mt-3">
            <textarea
              rows={3}
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value)}
              placeholder="Ej: Hola! Quedamos en la cotización de los pendones, ¿la alcanzaste a revisar?"
              className="campo resize-y"
            />
            <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
              Sale en horario hábil desde el WhatsApp de tu negocio. Si responde, tu
              asistente sigue la conversación con todo el contexto.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={enviando || mensaje.trim().length < 5}
                className="btn-primario"
                onClick={() => {
                  setResultado(null);
                  enviar(async () => {
                    const fd = new FormData();
                    fd.set("chatId", chatId);
                    fd.set("texto", mensaje.trim());
                    const r = await reactivarCliente(fd);
                    if (r.ok) {
                      // El aviso llega cuando la ventana de 24 h de WhatsApp
                      // está cerrada: el mensaje queda en cola, pero no sale
                      // hasta que el cliente escriba. Antes esto no se decía.
                      setResultado(
                        r.aviso ?? "Listo: queda en cola y sale en el próximo horario hábil.",
                      );
                      setMensaje("");
                      setAbrirReactivar(false);
                    } else {
                      setResultado(r.error ?? "No se pudo programar");
                    }
                  });
                }}
              >
                {enviando ? "Programando…" : "Programar envío"}
              </button>
              <button
                type="button"
                className="btn-suave"
                onClick={() => {
                  setAbrirReactivar(false);
                  setMensaje("");
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {resultado && (
          <p
            className="mt-2 text-[12.5px] font-semibold"
            style={{ color: resultado.startsWith("Listo") ? "var(--ok)" : "var(--alerta)" }}
          >
            {resultado}
          </p>
        )}
      </div>
    </>
  );
}
