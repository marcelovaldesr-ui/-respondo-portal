import { db } from "@/lib/db";
import { cifrar, descifrar } from "@/lib/cifrado";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CredencialesFlow } from "@/lib/flow/flowClient";
import type { FlowModo } from "@/lib/flow/flowCore";

/**
 * GESTIÓN DE CONFIGURACIÓN Y CREDENCIALES DE FLOW POR TENANT.
 *
 * Los secretos se guardan cifrados con AES-256-GCM en `ed_clientes.flow_secret_cifrado`.
 * NUNCA se devuelven al cliente ni se loguean en texto plano.
 */

export async function obtenerConfigFlow(
  clienteId: string,
  supa: SupabaseClient = db(),
): Promise<CredencialesFlow | null> {
  try {
    const { data, error } = await supa
      .from("ed_clientes")
      .select("flow_api_key, flow_secret_cifrado, flow_modo, flow_estado")
      .eq("id", clienteId)
      .maybeSingle();

    if (error || !data) return null;

    const apiKey = (data.flow_api_key as string | null)?.trim();
    const secretCifrado = (data.flow_secret_cifrado as string | null)?.trim();
    const modo = (data.flow_modo as FlowModo) || "sandbox";

    if (!apiKey || !secretCifrado) return null;

    const secretKey = descifrar(secretCifrado, "flow-secret");
    if (!secretKey) {
      console.error(`[flowConfig] Fallo al descifrar flow_secret_cifrado para cliente ${clienteId}`);
      return null;
    }

    return {
      apiKey,
      secretKey,
      modo,
    };
  } catch (err) {
    console.error("[flowConfig] Error al consultar configuración Flow:", err);
    return null;
  }
}

export async function guardarConfigFlow(
  clienteId: string,
  config: {
    apiKey: string;
    secretKey: string;
    modo: FlowModo;
  },
  supa: SupabaseClient = db(),
): Promise<{ ok: boolean; error?: string }> {
  try {
    const apiKey = config.apiKey.trim();
    const secretKey = config.secretKey.trim();
    if (!apiKey || !secretKey) {
      return { ok: false, error: "API Key y Secret Key son obligatorias" };
    }

    const secretCifrado = cifrar(secretKey, "flow-secret");

    const { error } = await supa
      .from("ed_clientes")
      .update({
        flow_api_key: apiKey,
        flow_secret_cifrado: secretCifrado,
        flow_modo: config.modo,
        flow_estado: "conectado",
      })
      .eq("id", clienteId);

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error al guardar credenciales";
    return { ok: false, error: msg };
  }
}
