/**
 * ¿La sesión trae un correo VERIFICADO? (Fase 0, 11-sep-2026)
 *
 * El portal traduce "correo con sesión" → "negocio" vía portal_usuarios. Si
 * alguien pudiera obtener una sesión con un correo que no es suyo —un signUp
 * directo contra Supabase con la llave pública, si el proyecto tuviera la
 * confirmación de correo apagada—, entraría al negocio de ese correo. El acceso
 * normal (enlace mágico) siempre deja el correo confirmado, así que exigirlo
 * no cambia nada para los usuarios reales y cierra esa puerta en código, sin
 * depender de un ajuste del panel de Supabase.
 *
 * ⚠️ SIN IMPORTS: lo carga `node --test` directo.
 */
export function correoVerificadoDeSesion(
  user: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined,
): string | null {
  const email = user?.email?.toLowerCase().trim();
  if (!email) return null;
  if (!user?.email_confirmed_at && !user?.confirmed_at) return null;
  return email;
}
