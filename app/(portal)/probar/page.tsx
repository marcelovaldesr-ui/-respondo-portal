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

  return (
    <main className="mx-auto max-w-4xl px-5 py-7 sm:px-8 lg:px-10 lg:py-10">
      <div className="eyebrow">En vivo</div>
      <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight lg:text-[32px]">
        Probar ahora
      </h1>
      <p className="mt-1.5 max-w-2xl text-[15px]" style={{ color: "var(--muted)" }}>
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
