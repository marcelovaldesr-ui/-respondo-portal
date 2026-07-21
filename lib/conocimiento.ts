import { db } from "@/lib/db";

export type Ficha = {
  id: string;
  categoria: string;
  titulo: string;
  contenido: string;
  vigente: boolean;
  actualizadoEn: string;
};

/** Fichas del negocio del cliente logueado. Es la fuente de verdad del asistente. */
export async function listarFichas(clienteId: string): Promise<Ficha[]> {
  const { data } = await db()
    .from("ed_conocimiento")
    .select("id, categoria, titulo, contenido, vigente, actualizado_en")
    .eq("cliente_id", clienteId)
    .order("categoria")
    .order("titulo");

  return (data ?? []).map((f) => ({
    id: f.id as string,
    categoria: f.categoria as string,
    titulo: f.titulo as string,
    contenido: f.contenido as string,
    vigente: Boolean(f.vigente),
    actualizadoEn: f.actualizado_en as string,
  }));
}

export type Correccion = {
  id: string;
  empleadoId: string;
  empleadoNombre: string;
  pregunta: string;
  respuesta: string;
  activa: boolean;
};

/** Correcciones activas: tienen prioridad sobre el conocimiento general. */
export async function listarCorrecciones(clienteId: string): Promise<Correccion[]> {
  const supa = db();
  const { data: empleados } = await supa
    .from("ed_empleados")
    .select("id, nombre_publico")
    .eq("cliente_id", clienteId);

  if (!empleados?.length) return [];
  const porId = new Map(empleados.map((e) => [e.id as string, e.nombre_publico as string]));

  const { data } = await supa
    .from("ed_correcciones")
    .select("id, empleado_id, pregunta_cliente, respuesta_correcta, activa")
    .in(
      "empleado_id",
      empleados.map((e) => e.id as string),
    )
    .order("creado_en", { ascending: false });

  return (data ?? []).map((c) => ({
    id: c.id as string,
    empleadoId: c.empleado_id as string,
    empleadoNombre: porId.get(c.empleado_id as string) ?? "",
    pregunta: c.pregunta_cliente as string,
    respuesta: c.respuesta_correcta as string,
    activa: Boolean(c.activa),
  }));
}
