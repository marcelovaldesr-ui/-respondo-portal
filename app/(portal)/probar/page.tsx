import { db } from "@/lib/db";
import { exigirUsuarioPortal } from "@/lib/auth";
import ChatPrueba, { type EmpleadoSimple } from "@/components/ChatPrueba";

export const dynamic = "force-dynamic";

export default async function Probar() {
  const usuario = await exigirUsuarioPortal();

  const { data } = await db()
    .from("ed_empleados")
    .select("id, rol, nombre_publico")
    .eq("cliente_id", usuario.clienteId)
    .eq("activo", true)
    .order("rol");

  const empleados: EmpleadoSimple[] = (data ?? []).map((e) => ({
    id: e.id as string,
    rol: e.rol as string,
    nombrePublico: (e.nombre_publico as string) ?? "",
  }));

  // Sin empleados el chat de prueba no tiene a quién escribirle: el componente
  // asumía que siempre había al menos uno y reventaba al leer su nombre. Le
  // pasaría al primer cliente recién creado.
  if (empleados.length === 0) {
    return (
      <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
        <h1 className="h-pagina mt-1">Probar ahora</h1>
        <div className="tarjeta mt-6 p-8 text-center">
          <h2 className="h-seccion">Todavía no tienes un asistente activo</h2>
          <p
            className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            Cuando activemos a tu equipo digital vas a poder conversar con él acá, tal
            como lo hará un cliente. Escríbenos y lo dejamos andando.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div style={{ fontSize: "var(--t-menor)", color: "var(--muted)" }}>En vivo</div>
      <h1 className="h-pagina">Probar ahora</h1>
      <p className="sub-pagina max-w-2xl" style={{ color: "var(--muted)" }}>
        Escríbele a tu asistente como si fueras un cliente. Responde con los precios,
        horarios y políticas reales de {usuario.clienteNombre} — es el mismo cerebro que
        atiende tu WhatsApp.
      </p>

      <div className="mt-7">
        <ChatPrueba empleados={empleados} />
      </div>

      <p className="mt-6 text-[12px]" style={{ color: "var(--muted-2)" }}>
        Esta conversación es solo una prueba: no le llega a ningún cliente ni queda
        guardada en tus conversaciones.
      </p>
    </main>
  );
}
