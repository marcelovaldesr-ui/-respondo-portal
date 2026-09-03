import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * El contacto existe y se devuelve con lo que el puente necesita — SIN pisar lo
 * que una persona editó (auditoría 3-sep-2026).
 *
 * Antes era un `upsert` con `nombre` (el pushname de WhatsApp), `telefono` y
 * `etiqueta: "lead"` en CADA mensaje: Cecilia corregía "juanito 🔥" a "Juan
 * Pérez – Constructora X" en la ficha y al siguiente mensaje volvía el emoji;
 * un contacto importado como "cliente" volvía a "lead". Ahora el nombre de
 * WhatsApp solo se usa para crear el contacto o rellenar uno sin nombre.
 */
export async function asegurarContacto(
  supa: SupabaseClient,
  p: { clienteId: string; chatId: string; nombre: string | null; telefono?: string | null },
): Promise<Record<string, unknown> | null> {
  const columnas =
    "nombre, telefono, etiquetas, etapa, etapa_manual, ultimo_mensaje_en, ultimo_mensaje_rol";
  const { data: existente } = await supa
    .from("ed_contactos")
    .select(columnas)
    .eq("cliente_id", p.clienteId)
    .eq("chat_id", p.chatId)
    .maybeSingle();

  if (existente) {
    if (!existente.nombre && p.nombre) {
      await supa
        .from("ed_contactos")
        .update({ nombre: p.nombre })
        .eq("cliente_id", p.clienteId)
        .eq("chat_id", p.chatId);
      return { ...existente, nombre: p.nombre };
    }
    return existente;
  }

  const { data: creado } = await supa
    .from("ed_contactos")
    .upsert(
      {
        cliente_id: p.clienteId,
        chat_id: p.chatId,
        nombre: p.nombre ?? undefined,
        telefono: p.telefono ?? `+${p.chatId}`,
        etiqueta: "lead",
      },
      { onConflict: "cliente_id,chat_id", ignoreDuplicates: true },
    )
    .select(columnas)
    .maybeSingle();
  return creado ?? null;
}
