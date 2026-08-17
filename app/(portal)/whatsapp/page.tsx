import { exigirPermisoPortal } from "@/lib/auth";
import { db } from "@/lib/db";
import ConectarWhatsApp from "@/components/ConectarWhatsApp";
import { instagramConfigurado } from "@/lib/instagramOAuth";

export const dynamic = "force-dynamic";

/**
 * Conexión de WhatsApp del cliente (Cloud API oficial vía Embedded Signup,
 * con Coexistencia: el número sigue funcionando en la app del negocio).
 */
export default async function PaginaWhatsApp({
  searchParams,
}: {
  searchParams: Promise<{ ig?: string }>;
}) {
  const usuario = await exigirPermisoPortal("gestionar_integraciones");
  const avisoIg = (await searchParams).ig ?? null;

  const { data } = await db()
    .from("ed_clientes")
    .select("nombre, waba_id, waba_phone_id, waba_token, waba_token_cifrado")
    .eq("id", usuario.clienteId)
    .maybeSingle();

  // Aparte y tolerante a fallo: si la migración 275 todavía no se aplicó, la
  // columna no existe y Supabase devuelve error. Pedirla en el select de arriba
  // tumbaría la página entera durante la ventana entre deploy y migración.
  const { data: extra } = await db()
    .from("ed_clientes")
    .select("waba_coexistencia")
    .eq("id", usuario.clienteId)
    .maybeSingle();
  const coexistencia = (extra?.waba_coexistencia ?? null) as boolean | null;

  // Igual de tolerante: la migración 281 puede no estar aplicada todavía y no
  // hay razón para que eso tumbe la página de WhatsApp, que es otra cosa.
  const { data: ig } = await db()
    .from("ed_clientes")
    .select("ig_user_id, ig_token_cifrado, ig_usuario, ig_token_vence")
    .eq("id", usuario.clienteId)
    .maybeSingle();

  // Sirve cualquiera de las dos columnas: la cifrada (279) o la vieja en claro,
  // que sigue existiendo hasta que corra la 280.
  const conectado = Boolean(
    data?.waba_id && data?.waba_phone_id && (data?.waba_token_cifrado || data?.waba_token),
  );

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-6 lg:px-8 lg:py-9">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="h-pagina">WhatsApp</h1>
        <span className="sub-titulo">El canal oficial de Meta para tu asistente</span>
      </div>

      <div className="tarjeta mt-6 p-6">
        {conectado ? (
          <>
            <div className="flex items-center gap-2.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: "#18A566" }}
              />
              <span className="text-[16px] font-bold">Número conectado</span>
            </div>
            <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
              Tu WhatsApp está conectado a la API oficial de Meta. Tu asistente
              responde automáticamente y tú puedes seguir usando la app de
              WhatsApp Business con normalidad: cuando escribas tú, el asistente
              se hace a un lado en esa conversación.
            </p>
            <dl className="mt-4 grid grid-cols-1 gap-2 text-[13.5px] sm:grid-cols-2">
              <div>
                <dt className="font-semibold" style={{ color: "var(--muted-2)" }}>
                  Cuenta de WhatsApp Business
                </dt>
                <dd className="font-mono">{data?.waba_id}</dd>
              </div>
              <div>
                <dt className="font-semibold" style={{ color: "var(--muted-2)" }}>
                  ID del número
                </dt>
                <dd className="font-mono">{data?.waba_phone_id}</dd>
              </div>
              <div>
                <dt className="font-semibold" style={{ color: "var(--muted-2)" }}>
                  Modo
                </dt>
                <dd>
                  {coexistencia === true
                    ? "Coexistencia — sigues usando tu app normalmente"
                    : coexistencia === false
                      ? "Solo API — este número ya no se usa desde la app"
                      : "Sin verificar"}
                </dd>
              </div>
            </dl>
            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--borde)" }}>
              <p className="text-[13.5px]" style={{ color: "var(--muted)" }}>
                ¿Necesitas reconectar o cambiar de número? Vuelve a ejecutar la
                conexión:
              </p>
              <div className="mt-3">
                <ConectarWhatsApp />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="text-[16px] font-bold">Conectar el WhatsApp del negocio</div>
            <ol
              className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px]"
              style={{ color: "var(--muted)" }}
            >
              <li>Pulsa el botón y entra con la cuenta de Facebook del negocio.</li>
              <li>
                Elige el número de WhatsApp. Si ya lo usas en la app de WhatsApp
                Business, podrás escanear un QR para conectarlo <b>sin dejar de
                usar la app</b> (llamadas incluidas).
              </li>
              <li>Listo: tu asistente comienza a atender ese número.</li>
            </ol>
            <div className="mt-5">
              <ConectarWhatsApp />
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
        La conexión usa el proceso oficial de Meta (Embedded Signup). Respondo
        nunca ve tu contraseña de Facebook.
      </p>

      <BloqueInstagram
        conectado={Boolean(ig?.ig_user_id && ig?.ig_token_cifrado)}
        usuario={(ig?.ig_usuario as string | null) ?? null}
        vence={(ig?.ig_token_vence as string | null) ?? null}
        aviso={avisoIg}
        disponible={instagramConfigurado()}
      />
    </div>
  );
}

/** Los mensajes de vuelta del callback, en castellano y sin tecnicismos. */
const AVISOS_IG: Record<string, { texto: string; malo: boolean }> = {
  ok: { texto: "Instagram quedó conectado.", malo: false },
  cancelado: { texto: "Cancelaste la conexión con Instagram.", malo: true },
  sin_configurar: { texto: "Instagram todavía no está habilitado en Respondo.", malo: true },
  faltan_datos: { texto: "Instagram no devolvió los datos necesarios. Inténtalo de nuevo.", malo: true },
  estado_invalido: { texto: "El enlace de conexión venció. Vuelve a empezar.", malo: true },
  codigo: { texto: "Instagram rechazó la autorización. Inténtalo de nuevo.", malo: true },
  token: { texto: "No se pudo completar la conexión con Instagram.", malo: true },
  // Este es el importante: parecería conectado pero no llegaría ningún mensaje.
  sin_webhook: {
    texto:
      "Se autorizó la cuenta pero no se pudo activar la recepción de mensajes, así que no la dimos por conectada. Vuelve a intentarlo.",
    malo: true,
  },
  guardar: { texto: "No se pudo guardar la conexión. Inténtalo de nuevo.", malo: true },
};

function BloqueInstagram({
  conectado,
  usuario,
  vence,
  aviso,
  disponible,
}: {
  conectado: boolean;
  usuario: string | null;
  vence: string | null;
  aviso: string | null;
  disponible: boolean;
}) {
  if (!disponible && !conectado) return null;
  const msg = aviso ? AVISOS_IG[aviso] : null;

  return (
    <>
      <div className="mt-9 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="h-pagina">Instagram</h2>
        <span className="sub-titulo">Los mensajes directos de tu cuenta</span>
      </div>

      {msg && (
        <div
          className="tarjeta mt-4 px-5 py-3 text-[13.5px]"
          style={{
            borderLeft: `3px solid ${msg.malo ? "var(--peligro)" : "var(--ok)"}`,
            background: msg.malo ? "var(--coral-suave)" : "var(--ok-suave)",
          }}
        >
          {msg.texto}
        </div>
      )}

      <div className="tarjeta mt-4 p-6">
        {conectado ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "#18A566" }} />
              <span className="text-[16px] font-bold">
                Cuenta conectada{usuario ? ` · @${usuario}` : ""}
              </span>
            </div>
            <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>
              Tu asistente responde los mensajes directos de Instagram igual que
              los de WhatsApp, y las conversaciones aparecen en la misma bandeja.
            </p>
            {vence && (
              <p className="mt-3 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
                La autorización se renueva sola. Próxima renovación antes del{" "}
                {new Date(vence).toLocaleDateString("es-CL", {
                  day: "numeric",
                  month: "long",
                  timeZone: "America/Santiago",
                })}
                .
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-[16px] font-bold">Conectar el Instagram del negocio</div>
            <ol
              className="mt-3 list-decimal space-y-1.5 pl-5 text-[14px]"
              style={{ color: "var(--muted)" }}
            >
              <li>
                Tu cuenta tiene que ser <b>profesional</b> (Empresa o Creador).
                Una cuenta personal no recibe mensajes por esta vía.
              </li>
              <li>Pulsa el botón y entra con la cuenta de Instagram del negocio.</li>
              <li>Autoriza a Respondo a leer y responder tus mensajes directos.</li>
            </ol>
            <div className="mt-5">
              <a href="/api/instagram/conectar" className="btn-primario inline-block">
                Conectar Instagram
              </a>
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-[12.5px]" style={{ color: "var(--muted-2)" }}>
        Respondo nunca ve tu contraseña: la autorización la entrega Instagram.
        Puedes desconectarla cuando quieras desde los ajustes de tu cuenta.{" "}
        <b>
          Ten presente que Instagram no permite escribirle a alguien pasadas 24 horas
          desde su último mensaje
        </b>
        , así que el seguimiento automático no opera en este canal.
      </p>
    </>
  );
}
