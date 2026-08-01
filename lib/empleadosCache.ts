import * as React from "react";
import { db } from "@/lib/db";

/**
 * `cache` solo existe en el build de React que Next inyecta para los Server
 * Components. El paquete `react` estable (18.3.1) NO lo exporta, así que
 * importarlo directo revienta en cualquier contexto que no sea el render del
 * servidor — por ejemplo los scripts de scripts/, que son justamente los que
 * uso para medir y verificar contra la base real.
 *
 * Con el respaldo, en la app se memoriza por petición y fuera de ella la
 * función simplemente se llama como siempre: más lenta, nunca incorrecta.
 * Prefiero eso a un caché propio con Map a nivel de módulo, que sobreviviría
 * entre peticiones y serviría datos viejos sin que nadie se entere.
 */
const cache: <T extends (...args: never[]) => unknown>(fn: T) => T =
  (React as { cache?: <T extends (...args: never[]) => unknown>(fn: T) => T }).cache ??
  ((fn) => fn);

/**
 * LOS EMPLEADOS DEL CLIENTE, UNA SOLA VEZ POR PETICIÓN.
 *
 * EL PROBLEMA (medido el 31-jul-2026)
 * Casi todas las funciones de datos necesitan los empleado_id del cliente: es la
 * barrera de acceso de todo el portal. Cada una la consultaba por su cuenta, así
 * que abrir una pantalla disparaba la MISMA consulta 3 o 4 veces:
 *
 *   layout      → contadoresMenu → empleados
 *   página      → listarConversaciones → empleados
 *   página      → resumenEmpleados → empleados
 *   página      → resumenAhorro → empleados
 *
 * A ~210 ms cada una son 600-800 ms tirados en preguntar cuatro veces lo mismo,
 * en cada navegación. No se notaba antes del rediseño porque el layout no
 * consultaba nada; al agregar los contadores del menú, el costo pasó a pagarse
 * en TODAS las pantallas y la navegación se sintió lenta de golpe.
 *
 * LA SOLUCIÓN
 * `cache()` de React memoriza el resultado durante UNA petición del servidor.
 * La primera llamada consulta; las demás, dentro del mismo render, reciben lo
 * mismo sin tocar la base. Entre peticiones no cachea nada, así que un empleado
 * recién activado aparece en la siguiente carga: no hay riesgo de datos viejos.
 *
 * Fuera de un render de React (por ejemplo en los scripts de scripts/), `cache`
 * simplemente no memoriza y la función se comporta como una consulta normal.
 */
export type EmpleadoBasico = {
  id: string;
  rol: string;
  nombrePublico: string;
};

export const empleadosDeCliente = cache(
  async (clienteId: string): Promise<EmpleadoBasico[]> => {
    const { data } = await db()
      .from("ed_empleados")
      .select("id, rol, nombre_publico")
      .eq("cliente_id", clienteId);
    return (data ?? []).map((e) => ({
      id: e.id as string,
      rol: e.rol as string,
      nombrePublico: (e.nombre_publico as string) ?? "",
    }));
  },
);

/** Atajo para el caso más común: solo los ids, que es la barrera de acceso. */
export const idsEmpleadosDeCliente = cache(
  async (clienteId: string): Promise<string[]> =>
    (await empleadosDeCliente(clienteId)).map((e) => e.id),
);
