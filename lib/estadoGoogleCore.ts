/**
 * ESTADO HONESTO DE LA CONEXIÓN CON GOOGLE CALENDAR (Fase 0, 11-sep-2026).
 *
 * Antes la configuración decía «Conectado ✓» con que existieran credenciales
 * guardadas y el interruptor encendido, aunque Google llevara días rechazando
 * el token: el error aparecía debajo, en rojo, al lado del ✓ verde. Y un
 * refresh token que no se podía descifrar se trataba como "sin conectar" sin
 * dejar rastro, mientras la pantalla seguía mostrando «Conectado».
 *
 * El estado se deriva de `gcal_ultimo_error`, que escriben las llamadas reales
 * (freeBusy, crear/borrar evento, refresco del token) — no de la mera
 * presencia de credenciales.
 *
 * ⚠️ SIN IMPORTS: lo carga `node --test` directo.
 */

export type EstadoGoogle = "desconectado" | "conectado" | "necesita_reconexion" | "error_acceso" | "error";

export const TEXTO_ESTADO_GOOGLE: Record<EstadoGoogle, string> = {
  desconectado: "Sin conectar",
  conectado: "Conectado",
  necesita_reconexion: "Necesita reconexión",
  error_acceso: "Error de acceso",
  error: "Con errores",
};

/**
 * ¿Este error lo produjo una LECTURA de disponibilidad (o el refresco del
 * token)? Solo esos los puede limpiar una lectura exitosa: un error al CREAR o
 * BORRAR un evento (p. ej. calendario compartido solo para ver ocupado) no se
 * arregla porque freeBusy funcione, y borrarlo mostraría «Conectado» mintiendo.
 */
export function errorLimpiablePorLectura(err: string | null | undefined): boolean {
  const e = (err ?? "").trim();
  return /^(no se pudo leer tu disponibilidad|sin acceso al calendario|oauth:)/.test(e);
}

/** Prefijo con el que se anota un refresh token ilegible (clave rotada o dato corrupto). */
export const ERROR_TOKEN_ILEGIBLE = "reconexión: la autorización guardada ya no es válida";

export function estadoConexionGoogle(p: {
  gcal_sync?: boolean | null;
  gcal_ultimo_error?: string | null;
}): { estado: EstadoGoogle; texto: string; detalle: string | null } {
  const err = (p.gcal_ultimo_error ?? "").trim();
  // Sin sincronizar, igual se muestra el último motivo (p. ej. un calendario
  // rechazado al guardarlo): esconderlo dejaba al dueño sin saber por qué.
  if (!p.gcal_sync) return { estado: "desconectado", texto: TEXTO_ESTADO_GOOGLE.desconectado, detalle: err || null };
  if (!err) return { estado: "conectado", texto: TEXTO_ESTADO_GOOGLE.conectado, detalle: null };

  let estado: EstadoGoogle = "error";
  if (/invalid_grant|expired|revoked|reconexi[oó]n|token has been|unauthorized_client|invalid_client/i.test(err)) {
    estado = "necesita_reconexion";
  } else if (/insufficient|forbidden|permission|not ?found|notFound|\b40[34]\b|scope|no tiene acceso|writer access|cuenta de servicio/i.test(err)) {
    estado = "error_acceso";
  }
  return { estado, texto: TEXTO_ESTADO_GOOGLE[estado], detalle: err };
}
