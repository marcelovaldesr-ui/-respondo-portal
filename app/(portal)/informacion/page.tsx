import { exigirUsuarioPortal } from "@/lib/auth";
import { listarFichas, listarCorrecciones, type Ficha } from "@/lib/conocimiento";
import { CATEGORIAS, PLANTILLAS } from "@/lib/plantillasRubro";
import {
  crearFicha,
  actualizarFicha,
  alternarVigencia,
  eliminarFicha,
  cargarPlantilla,
} from "./acciones";

export const dynamic = "force-dynamic";

function etiquetaCategoria(valor: string) {
  return CATEGORIAS.find((c) => c.valor === valor)?.etiqueta ?? valor;
}

function TarjetaFicha({ f }: { f: Ficha }) {
  return (
    <div className="tarjeta p-5" style={{ opacity: f.vigente ? 1 : 0.6 }}>
      <form action={actualizarFicha}>
        <input type="hidden" name="id" value={f.id} />
        <div className="flex items-center justify-between gap-3">
          <input
            name="titulo"
            defaultValue={f.titulo}
            className="titular w-full border-0 bg-transparent p-0 text-[17px] font-bold outline-none"
          />
          {!f.vigente && <span className="pildora shrink-0" style={{ background: "#F1F2F7", color: "var(--muted)" }}>Apagada</span>}
        </div>
        <textarea
          name="contenido"
          defaultValue={f.contenido}
          rows={5}
          className="campo mt-3 resize-y text-[14px] leading-relaxed"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primario px-4 py-2 text-[14px]">
            Guardar
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <form action={alternarVigencia}>
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="vigente" value={String(f.vigente)} />
          <button type="submit" className="btn-suave px-4 py-2 text-[13px]">
            {f.vigente ? "Apagar" : "Encender"}
          </button>
        </form>
        <details className="ml-auto">
          <summary
            className="cursor-pointer list-none text-[12px] font-semibold"
            style={{ color: "var(--muted-2)" }}
          >
            Eliminar
          </summary>
          <form action={eliminarFicha} className="mt-2">
            <input type="hidden" name="id" value={f.id} />
            <button
              type="submit"
              className="btn px-3 py-1.5 text-[12px] text-white"
              style={{ background: "#B91C1C" }}
            >
              Sí, eliminar definitivamente
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}

export default async function Informacion() {
  const usuario = await exigirUsuarioPortal();
  const [fichas, correcciones] = await Promise.all([
    listarFichas(usuario.clienteId),
    listarCorrecciones(usuario.clienteId),
  ]);

  const vigentes = fichas.filter((f) => f.vigente).length;
  const porCategoria = CATEGORIAS.map((c) => ({
    ...c,
    fichas: fichas.filter((f) => f.categoria === c.valor),
  })).filter((g) => g.fichas.length > 0);

  return (
    <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">Cerebro</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">
        Información del negocio
      </h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
        Esto es todo lo que tus empleados saben de {usuario.clienteNombre}. Solo pueden
        afirmar lo que está escrito acá: si algo no aparece, no lo inventan — te derivan
        la conversación.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <span className="pildora-indigo">{vigentes} fichas activas</span>
        {fichas.length > vigentes && (
          <span className="pildora" style={{ background: "#F1F2F7", color: "var(--muted)" }}>
            {fichas.length - vigentes} apagadas
          </span>
        )}
      </div>

      {/* Agregar */}
      <details className="tarjeta mt-7 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          + Agregar información
        </summary>
        <form action={crearFicha} className="mt-4">
          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <label className="text-[13px] font-bold">Categoría</label>
              <select name="categoria" className="campo mt-1.5">
                {CATEGORIAS.map((c) => (
                  <option key={c.valor} value={c.valor}>
                    {c.etiqueta}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[13px] font-bold">Título</label>
              <input
                name="titulo"
                required
                placeholder="Ej: Precios de mantención"
                className="campo mt-1.5"
              />
            </div>
          </div>
          <label className="mt-3 block text-[13px] font-bold">Contenido</label>
          <textarea
            name="contenido"
            required
            rows={4}
            placeholder="Escríbelo como se lo explicarías a alguien que recién entra a trabajar contigo."
            className="campo mt-1.5 resize-y text-[14px]"
          />
          <button type="submit" className="btn-primario mt-3">
            Agregar
          </button>
        </form>
      </details>

      {/* Fichas */}
      {porCategoria.map((g) => (
        <section key={g.valor} className="mt-9">
          <h2 className="titular text-[17px] font-bold">{g.etiqueta}</h2>
          <div className="mt-3 grid gap-4">
            {g.fichas.map((f) => (
              <TarjetaFicha key={f.id} f={f} />
            ))}
          </div>
        </section>
      ))}

      {fichas.length === 0 && (
        <div
          className="mt-7 rounded-2xl border border-dashed p-10 text-center"
          style={{ borderColor: "var(--borde-fuerte)", color: "var(--muted)" }}
        >
          Todavía no hay información cargada. Sin esto, tu asistente deriva todas las
          consultas.
        </div>
      )}

      {/* Correcciones */}
      {correcciones.length > 0 && (
        <section className="mt-11">
          <h2 className="titular text-[17px] font-bold">Correcciones</h2>
          <p className="mt-1 text-[14px]" style={{ color: "var(--muted)" }}>
            Respuestas puntuales que tienen prioridad sobre todo lo anterior.
          </p>
          <div className="mt-3 grid gap-3">
            {correcciones.map((c) => (
              <div key={c.id} className="tarjeta-plana p-4">
                <div className="text-[13px]" style={{ color: "var(--muted)" }}>
                  Si preguntan
                </div>
                <div className="font-bold">{c.pregunta}</div>
                <div className="mt-2 text-[13px]" style={{ color: "var(--muted)" }}>
                  Responde
                </div>
                <div className="text-[14.5px]">{c.respuesta}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Plantillas de rubro */}
      <details className="tarjeta-plana mt-11 p-5">
        <summary className="titular cursor-pointer list-none text-[16px] font-bold">
          Plantillas de rubro (para demostraciones)
        </summary>
        <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
          Cargan fichas de ejemplo con datos <strong>ficticios</strong> de un negocio de
          ese rubro. Sirven para preparar una demo cuando todavía no tienes los datos
          reales. Se agregan a lo que ya existe, no reemplazan nada.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {Object.entries(PLANTILLAS).map(([clave, p]) => (
            <form key={clave} action={cargarPlantilla} className="tarjeta p-4">
              <input type="hidden" name="rubro" value={clave} />
              <div className="titular text-[15px] font-bold">{p.nombre}</div>
              <div className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>
                {p.negocio} · {p.fichas.length} fichas
              </div>
              <button type="submit" className="btn-suave mt-3 w-full py-2 text-[13px]">
                Cargar
              </button>
            </form>
          ))}
        </div>
      </details>
    </main>
  );
}
