"use client";

import { useState } from "react";
import { TIPOS_CAMPO, type TipoCampo } from "@/lib/fichaServicio";

/**
 * CONFIGURACIÓN DE LA FICHA DE UN SERVICIO (migración 277) — lado del negocio.
 *
 * Es la pantalla que hace que la agenda sirva para cualquier rubro, así que
 * tiene que entenderla alguien que no es técnico. Dos decisiones:
 *
 *  - Empieza CERRADO y muestra un resumen ("2 datos"). Un dueño con 8 servicios
 *    no puede tener 8 formularios abiertos compitiendo por su atención.
 *  - Hay PLANTILLAS por rubro. Es la diferencia entre "configúralo tú" y "esto
 *    ya viene listo para tu clínica": el dueño aprieta una y ve el resultado,
 *    en vez de quedarse mirando un formulario vacío sin saber qué poner.
 */

export type CampoConfig = {
  id: string;
  etiqueta: string;
  tipo: TipoCampo;
  opciones: string[] | null;
  obligatorio: boolean;
  ayuda: string | null;
  orden: number;
};

/** Sugerencias por rubro. Cargan el formulario; el dueño confirma y ajusta. */
const PLANTILLAS: { rubro: string; campos: { etiqueta: string; tipo: TipoCampo; opciones?: string; obligatorio?: boolean }[] }[] = [
  {
    rubro: "Clínica / consulta médica",
    campos: [
      { etiqueta: "RUT del paciente", tipo: "rut", obligatorio: true },
      { etiqueta: "Previsión", tipo: "opciones", opciones: "Fonasa, Isapre, Particular", obligatorio: true },
      { etiqueta: "¿Es tu primera atención?", tipo: "si_no" },
      { etiqueta: "Motivo de la consulta", tipo: "parrafo" },
    ],
  },
  {
    rubro: "Taller mecánico",
    campos: [
      { etiqueta: "Patente", tipo: "texto", obligatorio: true },
      { etiqueta: "Marca y modelo", tipo: "texto", obligatorio: true },
      { etiqueta: "Kilometraje", tipo: "numero" },
      { etiqueta: "¿Qué le pasa al auto?", tipo: "parrafo" },
    ],
  },
  {
    rubro: "Veterinaria",
    campos: [
      { etiqueta: "Nombre de la mascota", tipo: "texto", obligatorio: true },
      { etiqueta: "Especie", tipo: "opciones", opciones: "Perro, Gato, Otro", obligatorio: true },
      { etiqueta: "Edad (años)", tipo: "numero" },
      { etiqueta: "Motivo", tipo: "parrafo" },
    ],
  },
  {
    rubro: "Estética / peluquería",
    campos: [
      { etiqueta: "¿Primera vez con nosotros?", tipo: "si_no" },
      { etiqueta: "¿Alguna alergia o condición que debamos saber?", tipo: "parrafo" },
    ],
  },
  {
    rubro: "Inmobiliaria / visitas",
    campos: [
      { etiqueta: "RUT", tipo: "rut", obligatorio: true },
      { etiqueta: "Propiedad de interés", tipo: "texto", obligatorio: true },
      { etiqueta: "Forma de pago", tipo: "opciones", opciones: "Contado, Crédito hipotecario, Por definir" },
    ],
  },
];

const NOMBRE_TIPO: Record<string, string> = Object.fromEntries(
  TIPOS_CAMPO.map((t) => [t.valor, t.nombre]),
);

export default function FichaServicioConfig({
  servicioId,
  servicioNombre,
  campos,
  bufferMin,
  crearCampo,
  eliminarCampo,
  guardarBuffer,
}: {
  servicioId: string;
  servicioNombre: string;
  campos: CampoConfig[];
  bufferMin: number;
  crearCampo: (fd: FormData) => void;
  eliminarCampo: (fd: FormData) => void;
  guardarBuffer: (fd: FormData) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<TipoCampo>("texto");
  const [etiqueta, setEtiqueta] = useState("");
  const [opciones, setOpciones] = useState("");

  const resumen =
    campos.length === 0
      ? "no pide datos extra"
      : `${campos.length} ${campos.length === 1 ? "dato" : "datos"} · ${campos
          .slice(0, 2)
          .map((c) => c.etiqueta)
          .join(", ")}${campos.length > 2 ? "…" : ""}`;

  return (
    <div className="mt-2 rounded-[7px] border" style={{ borderColor: "var(--borde)" }}>
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="min-w-0 text-[12.5px]" style={{ color: "var(--muted)" }}>
          <span className="font-bold" style={{ color: "var(--tinta)" }}>Ficha:</span> {resumen}
          {bufferMin > 0 && (
            <span> · {bufferMin} min de preparación</span>
          )}
        </span>
        <span className="shrink-0 text-[12px] font-bold" style={{ color: "var(--indigo)" }}>
          {abierto ? "Cerrar" : "Configurar"}
        </span>
      </button>

      {abierto && (
        <div className="border-t px-3 py-3.5" style={{ borderColor: "var(--borde)" }}>
          {/* Campos existentes */}
          {campos.length > 0 && (
            <div className="grid gap-1.5">
              {campos.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-[6px] px-2.5 py-2"
                  style={{ background: "#F7F8FC" }}
                >
                  <div className="min-w-0 text-[13px]">
                    <span className="font-bold">{c.etiqueta}</span>
                    <span style={{ color: "var(--muted-2)" }}>
                      {" "}· {NOMBRE_TIPO[c.tipo] ?? c.tipo}
                      {c.obligatorio ? " · obligatorio" : ""}
                    </span>
                    {c.opciones?.length ? (
                      <div className="text-[11.5px]" style={{ color: "var(--muted-2)" }}>
                        {c.opciones.join(" / ")}
                      </div>
                    ) : null}
                  </div>
                  <form action={eliminarCampo} className="shrink-0">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="servicio" value={servicioId} />
                    <button className="text-[11.5px] font-bold" style={{ color: "#B33A3A" }}>
                      Quitar
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          {/* Plantillas por rubro */}
          {campos.length === 0 && (
            <div className="mb-3">
              <div className="text-[12px] font-bold" style={{ color: "var(--muted-2)" }}>
                ¿Partimos de una plantilla?
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PLANTILLAS.map((p) => (
                  <button
                    key={p.rubro}
                    type="button"
                    onClick={() => {
                      const primero = p.campos[0];
                      setEtiqueta(primero.etiqueta);
                      setTipo(primero.tipo);
                      setOpciones(primero.opciones ?? "");
                    }}
                    className="rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition"
                    style={{ borderColor: "var(--borde)", color: "var(--indigo)" }}
                    title={p.campos.map((c) => c.etiqueta).join(" · ")}
                  >
                    {p.rubro}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
                Carga el primer dato sugerido — lo revisas, lo agregas y sigues con el resto.
              </p>
            </div>
          )}

          {/* Alta de un campo */}
          <form action={crearCampo} className="mt-3 grid gap-2">
            <input type="hidden" name="servicio" value={servicioId} />
            <div className="grid gap-2 sm:grid-cols-[1fr_170px]">
              <input
                name="etiqueta"
                required
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                className="campo"
                placeholder="Qué le preguntas (ej: RUT del paciente)"
                maxLength={60}
              />
              <select
                name="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as TipoCampo)}
                className="campo"
              >
                {TIPOS_CAMPO.map((t) => (
                  <option key={t.valor} value={t.valor}>{t.nombre}</option>
                ))}
              </select>
            </div>

            {tipo === "opciones" && (
              <input
                name="opciones"
                required
                value={opciones}
                onChange={(e) => setOpciones(e.target.value)}
                className="campo"
                placeholder="Opciones separadas por coma: Fonasa, Isapre, Particular"
              />
            )}

            <input name="ayuda" className="campo" placeholder="Pista bajo el campo (opcional)" maxLength={120} />

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" name="obligatorio" className="h-4 w-4" />
                Obligatorio para poder reservar
              </label>
              <button type="submit" className="btn-primario px-3.5 py-1.5 text-[13px]">
                Agregar dato
              </button>
            </div>
            <p className="text-[11.5px]" style={{ color: "var(--muted-2)" }}>
              {TIPOS_CAMPO.find((t) => t.valor === tipo)?.pista}
            </p>
          </form>

          {/* Preparación entre horas */}
          <form
            action={guardarBuffer}
            className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3.5"
            style={{ borderColor: "var(--borde)" }}
          >
            <input type="hidden" name="servicio" value={servicioId} />
            <div>
              <label className="text-[12.5px] font-bold">Preparación después de cada hora</label>
              <p className="text-[11.5px]" style={{ color: "var(--muted-2)" }}>
                Minutos para limpiar o preparar antes de la siguiente. No se le muestran al cliente.
              </p>
            </div>
            <input
              name="buffer"
              type="number"
              min={0}
              max={120}
              step={5}
              defaultValue={bufferMin}
              className="campo w-[90px]"
            />
            <button type="submit" className="btn-suave px-3 py-1.5 text-[12.5px]">Guardar</button>
          </form>

          <p className="mt-3 text-[11.5px]" style={{ color: "var(--muted-2)" }}>
            Estos datos se le piden a quien reserva <b>{servicioNombre}</b> y quedan
            guardados en la ficha de la hora.
          </p>
        </div>
      )}
    </div>
  );
}
