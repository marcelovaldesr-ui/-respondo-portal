/**
 * Tipos compartidos del inbox.
 *
 * Viven aparte de los componentes para que el hook, las burbujas y el
 * compositor hablen del mismo objeto sin importarse entre sí.
 */

export type MediaUI = {
  /** imagen | documento | audio | video | sticker | otro */
  tipo: string;
  mime: string | null;
  nombre: string | null;
  /** URL de nuestro proxy autenticado, nunca la del proveedor. */
  url: string;
};

/**
 * Estados de entrega. Se re-exporta el tipo del servidor a propósito: mantener
 * dos listas de los mismos valores es cómo aparece un estado que una mitad del
 * código entiende y la otra ignora en silencio.
 */
import type { EstadoEnvio } from "@/lib/inboxConsulta";
export type { EstadoEnvio };

export type MensajeUI = {
  /**
   * Id real de la base, o uno temporal `tmp:…` mientras el envío está en vuelo.
   *
   * ⚠️ Es la CLAVE de React. Antes se usaba el índice del arreglo, y con una
   * lista que se reemplazaba entera cada 4 segundos eso obligaba a React a
   * re-montar todas las burbujas: las imágenes se volvían a pedir y parpadeaban.
   */
  id: string;
  rol: string;
  texto: string;
  creadoEn: string;
  estado?: EstadoEnvio;
  media?: MediaUI | null;
  /** Vista previa local mientras el adjunto sube (blob del navegador). */
  previa?: string | null;
  /** El envío falló: se muestra con opción de reintentar. */
  fallido?: boolean;
};
