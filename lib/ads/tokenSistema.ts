/**
 * Tenants que se conectan a Meta con un token de USUARIO DEL SISTEMA en vez
 * del botón Conectar (Facebook Login for Business).
 *
 * Solo el tenant de Respondo mismo: sus cuentas publicitarias pertenecen al
 * portafolio dueño de la app, y Business Login no deja compartirlas con la app
 * propia. Para los clientes el camino sigue siendo el botón Conectar.
 */
const TENANTS_TOKEN_SISTEMA = new Set<string>([
  "77777777-7777-7777-7777-777777777777", // Respondo (cuentas propias)
]);

export function puedeUsarTokenSistema(clienteId: string): boolean {
  return TENANTS_TOKEN_SISTEMA.has(clienteId);
}
