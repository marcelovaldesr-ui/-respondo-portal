/**
 * PANTALLA DE SIN CONEXIÓN.
 *
 * Es lo que el service worker muestra cuando alguien abre la app instalada y no
 * hay red. Sin esto se ve el dinosaurio de Chrome o la página de error de
 * Safari, que en una app con tu logo se lee como "esto se rompió".
 *
 * Vive fuera de `(portal)` a propósito: ese grupo exige sesión, y validar la
 * sesión necesita red. Una pantalla de sin conexión que necesita conexión no
 * sirve para nada.
 *
 * Es deliberadamente simple y sin datos: no muestra conversaciones viejas.
 * Para una bandeja de mensajes, mostrar información desactualizada es peor que
 * no mostrar nada — alguien podría creer que un cliente no ha escrito.
 */
export const metadata = { title: "Sin conexión · Respondo" };

export default function SinConexion() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center px-6 text-center"
      style={{ background: "var(--fondo, #FBFCFE)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icono/icono-192.png" alt="Respondo" width={64} height={64} style={{ borderRadius: 14 }} />

      <h1
        className="titular mt-5 text-[22px] font-bold"
        style={{ color: "var(--tinta, #131A32)" }}
      >
        Sin conexión
      </h1>
      <p className="mt-2 max-w-[320px] text-[14.5px]" style={{ color: "var(--muted, #5A6484)" }}>
        No pudimos conectarnos. Tus conversaciones están a salvo: apenas vuelva la señal, todo
        aparece al día.
      </p>

      <a
        href="/inicio"
        className="btn-primario mt-6 px-5 py-2.5 text-[14px]"
      >
        Reintentar
      </a>
    </main>
  );
}
