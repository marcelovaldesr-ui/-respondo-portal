"use server";

import { revalidatePath } from "next/cache";
import { obtenerUsuarioConPermiso } from "@/lib/auth";
import { modoDemo } from "@/lib/marketing/modo";
import { cupoDisponible } from "@/lib/marketing/cupo";
import {
  cambiarEstadoCreatividad,
  eliminarCreatividad,
  generarImagen,
  generarPaquete,
  guardarCreatividad,
  obtenerCreatividad,
  type EntradaCreatividad,
} from "@/lib/marketing/creatividades";
import type { PaqueteCreativo, PedidoCreativo } from "@/lib/marketing/creatividadesCore";
import type { Creatividad, FormatoCreatividad } from "@/lib/marketing/tipos";

/**
 * ACCIONES DEL ESTUDIO CREATIVO.
 *
 * Reglas que valen para todas:
 *   · El `cliente_id` sale de la sesión, nunca del formulario.
 *   · En DEMO se puede generar (texto e imagen de muestra) pero NO guardar:
 *     los datos de demostración no se mezclan con los del negocio. Cada
 *     acción de escritura lo dice con estas palabras en vez de fallar mudo.
 *   · Generar texto e imagen son DOS pasos separados a propósito: la imagen
 *     tarda ~5 s y puede fallar; el texto no tiene por qué esperarla.
 */

const DEMO_BLOQUEADO = "Estás en datos de demostración: se puede probar, pero no se guarda. Apaga la demo para crear de verdad.";

/** Imágenes de muestra para no gastar generación en la demo. */
const IMAGENES_DEMO: Record<FormatoCreatividad, string> = {
  "1:1": "/marketing/demo/pendon-feria.jpg",
  "4:5": "/marketing/demo/pendon-express.jpg",
  "9:16": "/marketing/demo/poleras-evento.jpg",
  "16:9": "/marketing/demo/gigantografia.jpg",
};

export async function generarTextoCreativo(
  pedido: Omit<PedidoCreativo, "contexto">,
): Promise<{ ok: true; paquete: PaqueteCreativo; demo: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };
  const r = await generarPaquete(usuario.clienteId, pedido, demo);
  return r.ok ? { ok: true, paquete: r.paquete, demo } : r;
}

export async function generarImagenCreativa(
  prompt: string,
  formato: FormatoCreatividad,
): Promise<{ ok: true; url: string; demo: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: true, url: IMAGENES_DEMO[formato] ?? IMAGENES_DEMO["1:1"], demo: true };
  const topado = await cupoDisponible(usuario.clienteId, "imagen");
  if (topado) return { ok: false, motivo: topado };
  const r = await generarImagen(usuario.clienteId, prompt.slice(0, 1200), formato);
  return r.ok ? { ok: true, url: r.url, demo: false } : r;
}

export async function guardarCreatividadAccion(
  entrada: EntradaCreatividad,
  id?: string,
): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  if (!entrada.titular.trim() || !entrada.texto.trim()) return { ok: false, motivo: "Faltan el titular o el texto." };
  const r = await guardarCreatividad(usuario.clienteId, entrada, id);
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function cambiarEstadoCreatividadAccion(id: string, estado: Creatividad["estado"]): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await cambiarEstadoCreatividad(usuario.clienteId, id, estado);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo cambiar el estado." };
}

export async function duplicarCreatividadAccion(id: string): Promise<{ ok: true; id: string } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const c = await obtenerCreatividad(usuario.clienteId, id);
  if (!c) return { ok: false, motivo: "No se encontró la creatividad." };
  const r = await guardarCreatividad(usuario.clienteId, {
    ...c,
    nombre: `${c.nombre} (copia)`.slice(0, 80),
    estado: "borrador",
    campanaId: null,
    varianteDe: c.id,
  });
  if (r.ok) revalidatePath("/marketing", "layout");
  return r;
}

export async function eliminarCreatividadAccion(id: string): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };
  const ok = await eliminarCreatividad(usuario.clienteId, id);
  if (ok) revalidatePath("/marketing", "layout");
  return ok ? { ok } : { ok, motivo: "No se pudo eliminar." };
}

/* ══════════════════════════════════════════════════════════════════════════
   ESTUDIO 2.0 — contexto comercial, copy con estrategia y piezas propias.

   Las reglas de arriba siguen valiendo todas: el `cliente_id` sale de la
   sesión, en demo se prueba pero no se guarda, y cada paso es una acción
   aparte para que un fallo no se lleve por delante lo que ya salió bien.
   ══════════════════════════════════════════════════════════════════════════ */

import { contextoComercial, corregirContexto } from "@/lib/marketing/contextoComercial";
import { completitud, type ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import { generarCopy, type ResultadoCopy } from "@/lib/marketing/copy";
import type { PedidoCopy } from "@/lib/marketing/copyCore";
import { promptDeImagen, direccionEnPalabras } from "@/lib/marketing/visualCore";
import type { DireccionVisual, Angulo } from "@/lib/marketing/copyCore";
import { piezasExistentes, subirPieza, type PiezaExistente } from "@/lib/marketing/assets";
import { MAX_BYTES_SUBIDA } from "@/lib/marketing/assetsCore";

/**
 * Lo que Respondo entiende del negocio, para mostrarlo y poder corregirlo.
 *
 * `reconstruir` es la salida controlada para un contexto que se editó a mano y
 * quedó obsoleto: vuelve a leer las fichas y reaplica encima lo que la persona
 * había corregido. La pantalla lo ofrece como una acción aparte y explicada,
 * no como el botón de refrescar de todos los días.
 *
 * ⚠️ El `clienteId` sale de la sesión, nunca del formulario: reconstruir el
 * contexto de otro negocio sería reescribirle su ficha comercial.
 */
export async function contextoDelNegocioAccion(
  refrescar = false,
  reconstruir = false,
): Promise<{ ok: true; contexto: ContextoComercial; completitud: ReturnType<typeof completitud>; editado: boolean; persistible: boolean } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const r = await contextoComercial(usuario.clienteId, { demo, refrescar, reconstruir });
  return { ok: true, contexto: r.contexto, completitud: completitud(r.contexto), editado: r.editado, persistible: r.persistible };
}

/**
 * Guarda la corrección que escribió la persona.
 *
 * ⚠️ Solo se aceptan los campos que la pantalla deja editar. El contexto
 * completo llega del navegador, y aceptar el objeto entero permitiría
 * escribir `fuentes`, `descartados` o `noAfirmar` desde una petición
 * fabricada — es decir, desactivar las prohibiciones del propio negocio.
 */
export async function corregirContextoAccion(
  parcial: Pick<ContextoComercial, "vende" | "audiencia" | "propuesta" | "ofertas">,
): Promise<{ ok: boolean; motivo?: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };

  const actual = await contextoComercial(usuario.clienteId);
  const fusionado: ContextoComercial = {
    ...actual.contexto,
    vende: (parcial.vende ?? []).slice(0, 40).map((v) => ({
      nombre: String(v.nombre ?? "").slice(0, 80),
      tipo: v.tipo === "servicio" || v.tipo === "plan" ? v.tipo : "producto",
      detalle: String(v.detalle ?? "").slice(0, 200),
      precio: v.precio ? String(v.precio).slice(0, 40) : null,
      fuente: "declarado",
    })),
    audiencia: {
      descripcion: String(parcial.audiencia?.descripcion ?? "").slice(0, 300),
      rubros: (parcial.audiencia?.rubros ?? []).slice(0, 12).map((r) => String(r).slice(0, 40)),
    },
    propuesta: {
      problema: String(parcial.propuesta?.problema ?? "").slice(0, 400),
      resultado: String(parcial.propuesta?.resultado ?? "").slice(0, 300),
    },
    ofertas: (parcial.ofertas ?? []).slice(0, 6).map((o) => ({
      texto: String(o.texto ?? "").slice(0, 300),
      fuente: "declarado",
      reserva: null,
    })),
  };
  const r = await corregirContexto(usuario.clienteId, fusionado);
  if (r.ok) revalidatePath("/marketing", "layout");
  return r.ok ? { ok: true } : { ok: false, motivo: r.motivo };
}

/** El copy, con estrategia, crítica y reescritura. */
export async function generarCopyAccion(pedido: PedidoCopy): Promise<ResultadoCopy> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const topado = await cupoDisponible(usuario.clienteId, "texto");
  if (topado) return { ok: false, motivo: topado };
  return generarCopy(usuario.clienteId, pedido, { demo });
}

/**
 * La imagen, dirigida por el ángulo del anuncio.
 *
 * Recibe la DIRECCIÓN (sujeto, concepto, composición), no un prompt escrito
 * por el navegador: así el prompt se arma siempre con la lista de negativos y
 * nadie puede pedir desde fuera una captura de pantalla falsa ni un logo.
 */
export async function generarImagenDirigidaAccion(
  direccion: DireccionVisual | null,
  angulo: Angulo,
  formato: FormatoCreatividad,
  producto: string,
): Promise<{ ok: true; url: string; demo: boolean; enPalabras: string } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  const demo = await modoDemo();
  const { contexto } = await contextoComercial(usuario.clienteId, { demo });
  const enPalabras = direccionEnPalabras(contexto, direccion, angulo, producto);

  if (demo) return { ok: true, url: IMAGENES_DEMO[formato] ?? IMAGENES_DEMO["1:1"], demo: true, enPalabras };
  const topado = await cupoDisponible(usuario.clienteId, "imagen");
  if (topado) return { ok: false, motivo: topado };

  const prompt = promptDeImagen(contexto, direccion, angulo, formato, producto);
  const r = await generarImagen(usuario.clienteId, prompt, formato);
  return r.ok ? { ok: true, url: r.url, demo: false, enPalabras } : r;
}

/**
 * Subir un diseño propio.
 *
 * Llega un `FormData` porque una acción de servidor no recibe `File` suelto.
 * El archivo se valida DECODIFICÁNDOLO, no por su nombre ni por el tipo que
 * declara el formulario: los dos los escribe el navegador.
 */
export async function subirDisenoAccion(
  datos: FormData,
): Promise<{ ok: true; url: string; puntero: string; aviso: string | null } | { ok: false; motivo: string }> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return { ok: false, motivo: "Sesión no válida." };
  if (await modoDemo()) return { ok: false, motivo: DEMO_BLOQUEADO };

  const archivo = datos.get("archivo");
  const formato = String(datos.get("formato") ?? "1:1") as FormatoCreatividad;
  /**
   * La plataforma viene del mismo formulario y se valida contra la lista: el
   * aviso de recorte nombraba «Meta» en duro y este Estudio también arma
   * piezas para Google. Un valor que no esté en la lista se ignora y el aviso
   * queda neutral, que es la respuesta correcta cuando no se sabe.
   */
  const crudaPlataforma = String(datos.get("plataforma") ?? "");
  const plataforma = (["instagram", "facebook", "ambas", "google"] as const).find((x) => x === crudaPlataforma);
  if (!(archivo instanceof File)) return { ok: false, motivo: "No llegó ningún archivo." };
  if (archivo.size > MAX_BYTES_SUBIDA) {
    return { ok: false, motivo: `La imagen pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo son 8 MB.` };
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const r = await subirPieza(usuario.clienteId, bytes, formato, plataforma);
  return r.ok ? { ok: true, url: r.url, puntero: r.puntero, aviso: r.aviso } : r;
}

/** Las piezas que el negocio ya tiene, para reutilizar sin generar ni subir. */
export async function piezasExistentesAccion(): Promise<PiezaExistente[]> {
  const usuario = await obtenerUsuarioConPermiso("generar_insights");
  if (!usuario) return [];
  if (await modoDemo()) return [];
  return piezasExistentes(usuario.clienteId);
}
