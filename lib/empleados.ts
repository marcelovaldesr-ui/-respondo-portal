/**
 * Metadatos de los empleados digitales, por ROL del motor.
 *
 * OJO con los nombres: el motor guarda el rol `rita`, pero de cara al cliente
 * ese empleado se llama **Beto** (rename hecho solo en la marca). El nombre que
 * se muestra SIEMPRE sale de ed_empleados.nombre_publico; esto es el respaldo.
 *
 * Los avatares son recortes de los robots FLUX de la web viva (public/brand).
 */
export type RolEmpleado = "tino" | "rita" | "vera";

export const EMPLEADOS: Record<
  RolEmpleado,
  {
    nombrePorDefecto: string;
    funcion: string;
    descripcion: string;
    color: string;
    avatar: string;
    /** Lo que este empleado le aporta al negocio, en lenguaje del dueño. */
    entrega: string[];
  }
> = {
  tino: {
    nombrePorDefecto: "Tino",
    funcion: "Ventas y atención",
    descripcion: "Responde consultas, cotiza y agenda apenas llega el mensaje.",
    color: "#F97362",
    avatar: "/brand/tino.webp",
    entrega: ["Consultas atendidas", "Cotizaciones", "Agendamientos", "Leads capturados"],
  },
  rita: {
    nombrePorDefecto: "Beto",
    funcion: "Seguimiento y reactivación",
    descripcion: "Retoma cotizaciones sin respuesta y despierta clientes dormidos.",
    color: "#2563EB",
    avatar: "/brand/beto.webp",
    entrega: ["Cotizaciones retomadas", "Clientes reactivados", "Ventas recuperadas"],
  },
  vera: {
    nombrePorDefecto: "Vera",
    funcion: "Postventa y satisfacción",
    descripcion: "Pregunta cómo quedó el cliente y pide la reseña en el momento justo.",
    color: "#B84A86",
    avatar: "/brand/vera.webp",
    entrega: ["Encuestas enviadas", "Reseñas conseguidas", "Alertas de clientes molestos"],
  },
};

export function metaEmpleado(rol: string) {
  return EMPLEADOS[rol as RolEmpleado] ?? EMPLEADOS.tino;
}
