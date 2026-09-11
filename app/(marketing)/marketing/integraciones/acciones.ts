"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { proveedorMeta } from "@/lib/ads/meta";
import { traducirFalla } from "@/lib/marketing/fallas";

/**
 * Acciones de la pantalla de conexión.
 *
 * ⚠️ REGLA DE AISLAMIENTO, EN LAS TRES: el `cliente_id` sale SIEMPRE de la
 * sesión y NUNCA del formulario, y todo `update` lleva su `.eq("cliente_id")`
 * aunque el id de la fila ya sea único. Es la barrera que impide que alguien
 * con sesión en el negocio A toque la conexión publicitaria del negocio B
 * cambiando un campo oculto.
 */

/**
 * Elige cuál de las cuentas publicitarias autorizadas es la de este negocio.
 *
 * Se pide explícitamente en vez de tomar la primera: quien administra dos
 * negocios ve las dos, y adivinar significaría mostrarle las cifras del otro
 * durante semanas sin que se note.
 *
 * La moneda y la zona horaria se copian de la CUENTA, no se asumen: son lo que
 * después evita sumar dólares con pesos y correr el gasto del primer día.
 */
export async function elegirCuenta(formData: FormData): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  const cuentaId = String(formData.get("cuentaId") ?? "").trim();
  if (!/^act_\d+$/.test(cuentaId)) {
    return { ok: false, motivo: "Esa no parece una cuenta publicitaria válida." };
  }

  // La lista viene de Meta con el token del propio negocio: si la cuenta no
  // está ahí, no es suya. Verificarlo acá evita guardar un id escrito a mano.
  const cuentas = await proveedorMeta.cuentas(usuario.clienteId);
  if (!cuentas.ok) return { ok: false, motivo: cuentas.error.mensaje };

  const elegida = cuentas.datos.find((c) => c.id === cuentaId);
  if (!elegida) {
    return { ok: false, motivo: "Esa cuenta no está entre las que autorizaste en Meta." };
  }

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .update({
        cuenta_id: elegida.id,
        cuenta_nombre: elegida.nombre,
        moneda: elegida.moneda,
        zona_horaria: elegida.zonaHoraria,
        estado: "conectada",
        ultimo_error: null,
        actualizado_en: new Date().toISOString(),
      })
      .eq("cliente_id", usuario.clienteId)
      .eq("proveedor", "meta");
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "integraciones", clienteId: usuario.clienteId, crudo: e }) };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/**
 * Guarda el dataset al que se le devuelven las conversiones.
 *
 * Es un id numérico que el dueño copia desde el Administrador de Eventos de
 * Meta. Se valida la forma antes de guardarlo: un dataset equivocado no da
 * error, simplemente hace que los eventos se manden a la nada durante meses.
 */
export async function guardarDataset(
  formData: FormData,
): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  const crudo = String(formData.get("dataset") ?? "").replace(/\s+/g, "");
  const vacio = crudo === "";

  if (!vacio && !/^\d{8,20}$/.test(crudo)) {
    return {
      ok: false,
      motivo: "El identificador del conjunto de datos es un número largo, sin letras ni espacios.",
    };
  }

  try {
    const { error } = await db()
      .from("ed_clientes")
      .update({ ads_dataset_id: vacio ? null : crudo })
      .eq("id", usuario.clienteId);
    if (error) throw new Error(error.message);
  } catch (e) {
    return {
      ok: false,
      motivo: traducirFalla({ proveedor: "almacen", operacion: "guardarDataset", clienteId: usuario.clienteId, crudo: e }),
    };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/**
 * Desconecta la cuenta publicitaria.
 *
 * Borra la fila entera y con ella el token: dejarlo guardado «por si acaso»
 * después de que alguien pidió desconectar es exactamente lo que nadie espera
 * que hagamos. Los datos de atribución NO se tocan — son nuestros, no de Meta.
 */
export async function desconectar(): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .delete()
      .eq("cliente_id", usuario.clienteId)
      .eq("proveedor", "meta");
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "integraciones", clienteId: usuario.clienteId, crudo: e }) };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}
