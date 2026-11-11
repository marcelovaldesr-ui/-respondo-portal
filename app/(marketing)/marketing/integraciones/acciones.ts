"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { proveedorMeta } from "@/lib/ads/meta";
import { conexionGoogleDe, cuentasDeGoogle, soloDigitos } from "@/lib/ads/google";
import { traducirFalla } from "@/lib/marketing/fallas";
import { cifrar } from "@/lib/cifrado";
import { puedeUsarTokenSistema } from "@/lib/ads/tokenSistema";

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

  // Se conserva lo descubierto en el callback (Página, etc.) y se agrega el
  // portafolio dueño de la cuenta recién elegida.
  const { data: previa } = await db()
    .from("ed_ads_conexion")
    .select("datos")
    .eq("cliente_id", usuario.clienteId)
    .eq("proveedor", "meta")
    .maybeSingle();
  const datos = {
    ...((previa?.datos as Record<string, unknown> | null) ?? {}),
    businessId: elegida.negocioId ?? null,
    businessNombre: elegida.negocioNombre ?? null,
  };

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .update({
        cuenta_id: elegida.id,
        datos,
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

/* ── Google Ads (Fase 6) ─────────────────────────────────────────────────────
 *
 * Mismas tres reglas que arriba y por los mismos motivos: el `cliente_id` sale
 * de la sesión, la cuenta se verifica contra la lista que autorizó el propio
 * negocio, y desconectar borra el token de verdad.
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Elige cuál de las cuentas de Google Ads autorizadas es la de este negocio.
 *
 * ⚠️ El id de Google son DÍGITOS (`123-456-7890` es el mismo que `1234567890`),
 * así que se normaliza antes de comparar: si no, elegir una cuenta copiada con
 * guiones de la interfaz de Google fallaría con «esa cuenta no está entre las
 * que autorizaste», que es un mensaje verdadero y una causa falsa.
 *
 * También se guarda `cuenta_padre_id`: es la administradora por la que hay que
 * entrar para leerla (`login-customer-id`). Sin ese dato, una cuenta que cuelga
 * de un MCC responde «USER_PERMISSION_DENIED» aunque el permiso esté bien.
 */
export async function elegirCuentaGoogle(formData: FormData): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  const pedida = soloDigitos(String(formData.get("cuentaId") ?? ""));
  if (!/^\d{6,15}$/.test(pedida)) {
    return { ok: false, motivo: "Ese no parece un identificador de cuenta de Google Ads." };
  }

  const con = await conexionGoogleDe(usuario.clienteId);
  if (!con) return { ok: false, motivo: "Primero hay que autorizar Google Ads." };

  const cuentas = await cuentasDeGoogle(con.refreshToken);
  if (!cuentas.ok) return { ok: false, motivo: cuentas.error.mensaje };

  const elegida = cuentas.datos.find((c) => c.id === pedida && !c.administradora);
  if (!elegida) {
    return { ok: false, motivo: "Esa cuenta no está entre las que autorizaste en Google, o es una cuenta administradora (no tiene campañas propias)." };
  }

  const fila: Record<string, unknown> = {
    cuenta_id: elegida.id,
    cuenta_nombre: elegida.nombre,
    cuenta_padre_id: elegida.padreId,
    moneda: elegida.moneda,
    zona_horaria: elegida.zonaHoraria,
    estado: "conectada",
    ultimo_error: null,
    actualizado_en: new Date().toISOString(),
  };

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .update(fila)
      .eq("cliente_id", usuario.clienteId)
      .eq("proveedor", "google");
    // Sin la 309 la columna no existe y el update entero falla: se reintenta.
    if (error && /cuenta_padre_id/.test(error.message)) {
      delete fila.cuenta_padre_id;
      const segundo = await db()
        .from("ed_ads_conexion")
        .update(fila)
        .eq("cliente_id", usuario.clienteId)
        .eq("proveedor", "google");
      if (segundo.error) throw new Error(segundo.error.message);
    } else if (error) {
      throw new Error(error.message);
    }
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "integraciones", clienteId: usuario.clienteId, crudo: e }) };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/** Desconecta Google Ads. Borra la fila y con ella el refresh token. */
export async function desconectarGoogle(): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .delete()
      .eq("cliente_id", usuario.clienteId)
      .eq("proveedor", "google");
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "integraciones", clienteId: usuario.clienteId, crudo: e }) };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/**
 * CONEXIÓN DE LA CUENTA PROPIA DE RESPONDO POR TOKEN DE USUARIO DEL SISTEMA.
 *
 * Por qué existe: Facebook Login for Business deshabilita el portafolio DUEÑO
 * de la app («This Meta Business Account owns the app»), así que el botón
 * Conectar no sirve para las cuentas publicitarias de Respondo mismo. Para los
 * activos propios, Meta documenta el token de usuario del sistema. Solo se
 * ofrece en los tenants de `lib/ads/tokenSistema.ts`; ningún cliente lo ve.
 *
 * El token se valida contra Meta antes de guardarse, se guarda cifrado con el
 * mismo propósito que el de OAuth y nunca vuelve a mostrarse.
 */
export async function conectarConTokenSistema(formData: FormData): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };
  if (!puedeUsarTokenSistema(usuario.clienteId)) {
    return { ok: false, motivo: "Esta opción no está disponible para este negocio." };
  }

  const token = String(formData.get("token") ?? "").trim();
  if (token.length < 40 || /\s/.test(token)) return { ok: false, motivo: "Ese no parece un token de Meta." };

  const cuentas = await proveedorMeta.cuentasConToken(token);
  if (!cuentas.ok) return { ok: false, motivo: `Meta rechazó el token: ${cuentas.error.mensaje}` };
  if (!cuentas.datos.length) {
    return { ok: false, motivo: "El token es válido, pero no tiene ninguna cuenta publicitaria asignada. Asígnala al usuario del sistema en Meta." };
  }
  const pedida = String(formData.get("cuentaId") ?? "").trim();
  const elegida = pedida ? cuentas.datos.find((c) => c.id === pedida) : cuentas.datos.length === 1 ? cuentas.datos[0] : null;
  if (!elegida) {
    return {
      ok: false,
      motivo: `El token ve ${cuentas.datos.length} cuentas (${cuentas.datos.map((c) => `${c.nombre} ${c.id}`).join(", ")}). Deja asignada solo la de este negocio al usuario del sistema.`,
    };
  }

  const datos: Record<string, unknown> = {
    origen: "usuario_sistema",
    businessId: elegida.negocioId ?? null,
    businessNombre: elegida.negocioNombre ?? null,
  };
  const paginas = await proveedorMeta.paginasConToken(token);
  if (paginas.ok) {
    datos.paginasDisponibles = paginas.datos.map((p) => ({ id: p.id, nombre: p.nombre }));
    if (paginas.datos.length === 1) {
      datos.paginaId = paginas.datos[0].id;
      datos.paginaNombre = paginas.datos[0].nombre;
      if (paginas.datos[0].instagramId) {
        datos.instagramId = paginas.datos[0].instagramId;
        datos.instagramUsuario = paginas.datos[0].instagramUsuario;
      }
    }
  }

  try {
    const { error } = await db()
      .from("ed_ads_conexion")
      .upsert(
        {
          cliente_id: usuario.clienteId,
          proveedor: "meta",
          token_cifrado: cifrar(token, "ads-token"),
          token_vence: null,
          cuenta_id: elegida.id,
          cuenta_nombre: elegida.nombre,
          moneda: elegida.moneda,
          zona_horaria: elegida.zonaHoraria,
          estado: "conectada",
          datos,
          ultimo_error: null,
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "cliente_id,proveedor" },
      );
    if (error) throw new Error(error.message);
  } catch (e) {
    return { ok: false, motivo: traducirFalla({ proveedor: "almacen", operacion: "integraciones", clienteId: usuario.clienteId, crudo: e }) };
  }

  revalidatePath("/marketing", "layout");
  return { ok: true };
}

// ── Conversiones a Meta (Conversions API for Business Messaging) ─────────────

/**
 * Guarda el flag y la configuración de conversiones del negocio.
 *
 * Lo que llega del formulario se pasa por `leerConfig` antes de guardar: una
 * regla mal escrita se descarta en vez de quedar guardada y calificar a todo
 * el mundo.
 */
export async function guardarConversionesMeta(formData: FormData): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };
  const { leerConfig } = await import("@/lib/ads/conversionesConfig");

  let crudo: unknown = null;
  try {
    crudo = JSON.parse(String(formData.get("config") ?? "{}"));
  } catch {
    return { ok: false, motivo: "La configuración no se pudo leer." };
  }
  const config = leerConfig(crudo);
  const activo = String(formData.get("activo") ?? "") === "1";

  const { error } = await db()
    .from("ed_clientes")
    .update({ conversiones_meta_activo: activo, conversiones_meta: config })
    .eq("id", usuario.clienteId);
  if (error) {
    return {
      ok: false,
      motivo: /conversiones_meta/.test(error.message)
        ? "Falta habilitar esta función en la base (migración 331)."
        : traducirFalla({ proveedor: "almacen", operacion: "guardarConversionesMeta", clienteId: usuario.clienteId, crudo: error }),
    };
  }
  revalidatePath("/marketing", "layout");
  return { ok: true };
}

/** Obtiene o crea el dataset de la WABA. También verifica el permiso. */
export async function obtenerDatasetMeta(): Promise<{ ok: boolean; motivo?: string; datasetId?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };
  const { obtenerOCrearDataset } = await import("@/lib/ads/colaEventos");
  const r = await obtenerOCrearDataset(usuario.clienteId);
  revalidatePath("/marketing", "layout");
  return r.ok ? { ok: true, datasetId: r.datasetId, motivo: r.mensaje } : { ok: false, motivo: r.mensaje };
}

/** Manda un evento con test_event_code para «Probar eventos». */
export async function enviarEventoPruebaMeta(): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("gestionar_integraciones");
  if (!usuario) return { ok: false, motivo: "Sesión no válida" };
  const { enviarEventoPrueba } = await import("@/lib/ads/colaEventos");
  const r = await enviarEventoPrueba(usuario.clienteId);
  revalidatePath("/marketing", "layout");
  return {
    ok: r.ok,
    motivo: r.mensaje + (r.ok && !r.usoClidReal ? " (Todavía no hay conversaciones de anuncio: se usó un identificador de ejemplo.)" : ""),
  };
}
