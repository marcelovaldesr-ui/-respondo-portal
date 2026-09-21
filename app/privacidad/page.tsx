export const dynamic = "force-static";

export const metadata = {
  title: "Política de privacidad — Respondo",
  description:
    "Cómo Respondo recibe, almacena y usa los datos de las cuentas publicitarias, de mensajería y de negocio que sus clientes autorizan a conectar.",
};

/**
 * Página pública de política de privacidad.
 *
 * Requerida por Meta App Review (Marketing API) para el campo "URL de la
 * política de privacidad" en Configuración de la aplicación. También sirve
 * para cualquier otra integración (WhatsApp Business, Instagram) que exija
 * una URL pública, activa y sin bloqueo geográfico.
 *
 * Contenido basado ÚNICAMENTE en el comportamiento real y verificado del
 * código de respondo-portal (cifrado de tokens, RLS de Supabase, borrado al
 * desconectar, Google Gemini como único tercero que recibe datos derivados).
 * No se inventan prácticas, plazos de retención ni terceros que no existan
 * en el código.
 */
export default function PoliticaDePrivacidad() {
  return (
    <main className="mx-auto max-w-[760px] px-6 py-14 text-[15px] leading-relaxed text-[#1c2333]">
      <img
        src="/brand/isotipo.svg"
        alt="Respondo"
        width={34}
        height={34}
        className="mb-6"
      />
      <h1 className="text-[26px] font-bold text-[#0A0E20]">
        Política de privacidad de Respondo
      </h1>
      <p className="mt-2 text-[13px] text-[#5b6981]">
        Última actualización: 21 de septiembre de 2026.
      </p>

      <p className="mt-6">
        Respondo (&quot;nosotros&quot;) es una plataforma SaaS B2B que provee
        empleados de inteligencia artificial y herramientas de gestión para
        pequeñas y medianas empresas. A pedido del propio negocio cliente
        (el &quot;Cliente&quot;), Respondo puede: (a) recibir y responder
        conversaciones de WhatsApp e Instagram en su nombre; (b) gestionar su
        agenda de citas, clases y membresías; y (c) conectarse a las cuentas
        publicitarias de Meta (Facebook/Instagram Ads) que el Cliente autorice,
        para leer y administrar campañas, conjuntos de anuncios, anuncios,
        creatividades, presupuestos y métricas. Cada Cliente conserva en todo
        momento la propiedad y el control de sus propios activos (número de
        WhatsApp, cuenta de Instagram, cuenta publicitaria, página); Respondo
        únicamente administra lo que el Cliente ha autorizado explícitamente a
        través de sus propios flujos de conexión (OAuth de Meta, WhatsApp
        Business API, etc.).

        Esta política describe qué datos recibe Respondo, con qué fin, dónde
        se almacenan, quién puede acceder a ellos y qué ocurre cuando el
        Cliente desconecta una integración.
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        1. Qué datos recibimos
      </h2>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>
          <strong>Datos de conexión con Meta Ads:</strong> cuando el Cliente
          conecta su cuenta de Meta (Facebook Login for Business), recibimos
          un token de acceso emitido por Meta y la lista de cuentas
          publicitarias, páginas y cuentas de Instagram que ese token autoriza
          a administrar.
        </li>
        <li>
          <strong>Datos de campañas y rendimiento:</strong> mientras la
          integración está activa, leemos en vivo desde la API de Meta los
          nombres, estados, presupuestos, audiencias, creatividades y
          métricas de las campañas que el Cliente gestiona. Estos datos se
          consultan en el momento en que el Cliente abre su panel de
          marketing; Respondo no mantiene una copia histórica propia de estos
          datos fuera de lo que Meta reporta en cada consulta.
        </li>
        <li>
          <strong>Conversaciones de negocio:</strong> mensajes recibidos y
          enviados por WhatsApp e Instagram en la cuenta del Cliente, para que
          el empleado de IA pueda responder consultas, agendar citas y dar
          seguimiento a leads.
        </li>
        <li>
          <strong>Datos operativos del Cliente:</strong> información de
          clientes finales, citas, clases, membresías y pagos que el propio
          Cliente ingresa o que resultan de su operación normal en el portal.
        </li>
      </ul>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        2. Cómo almacenamos y protegemos los tokens de acceso
      </h2>
      <p className="mt-3">
        El token de acceso de Meta nunca se almacena en texto plano. Se cifra
        con AES-256-GCM antes de guardarse en nuestra base de datos (Supabase
        / PostgreSQL), usando una llave derivada específica para este
        propósito. La tabla donde se guarda la conexión tiene seguridad a
        nivel de fila (Row Level Security) habilitada sin ninguna política que
        permita el acceso desde roles de cliente o de usuario autenticado: solo
        el rol de servicio del backend, ejecutándose en nuestra infraestructura,
        puede leer o escribir esa tabla. El token no se registra en logs, no se
        expone en el navegador del Cliente y no se comparte con nadie fuera de
        Respondo.
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        3. Con quién compartimos datos
      </h2>
      <p className="mt-3">
        Respondo no vende datos ni los comparte con terceros con fines
        publicitarios. Los únicos flujos de datos hacia terceros son:
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5">
        <li>
          <strong>Meta Platforms:</strong> para operar la integración misma
          (leer y administrar campañas mediante la Marketing API que el
          Cliente autorizó).
        </li>
        <li>
          <strong>Google (Gemini):</strong> usamos el modelo de lenguaje
          Gemini de Google para funciones de asistencia con IA sobre
          marketing (por ejemplo, sugerencias de optimización de campañas).
          Para estas funciones enviamos a Gemini datos de rendimiento ya
          derivados (métricas y textos de campaña), nunca el token de acceso
          de Meta ni credenciales.
        </li>
        <li>
          <strong>Infraestructura de hosting:</strong> Vercel (hosting de la
          aplicación) y Supabase (base de datos), que actúan como
          proveedores de infraestructura bajo sus propios términos de
          procesamiento de datos.
        </li>
      </ul>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        4. Retención y borrado
      </h2>
      <p className="mt-3">
        Cuando el Cliente desconecta una integración de Meta Ads desde su
        panel de Integraciones, el registro completo de esa conexión
        (incluido el token cifrado) se elimina de inmediato de nuestra base
        de datos. No conservamos copias de respaldo separadas del token una
        vez borrado. Los datos de campañas y métricas, al no almacenarse de
        forma persistente sino consultarse en vivo, dejan de estar
        disponibles para Respondo en el mismo momento en que se revoca el
        acceso.
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        5. Acceso interno
      </h2>
      <p className="mt-3">
        Respondo no cuenta con un panel de administración que exponga tokens
        en texto plano al equipo. El acceso a la infraestructura de
        producción está limitado al equipo técnico de Respondo y protegido
        por las credenciales de los proveedores de infraestructura
        (Supabase, Vercel, Meta for Developers).
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        6. Los derechos del Cliente
      </h2>
      <p className="mt-3">
        El Cliente puede desconectar en cualquier momento su cuenta de Meta
        Ads, WhatsApp o Instagram desde su propio panel de Respondo, lo que
        revoca el acceso y elimina los datos de conexión asociados descritos
        en la sección 4. Para solicitar información sobre los datos que
        Respondo procesa en su nombre, o para pedir la eliminación de datos
        operativos, el Cliente puede escribir a{" "}
        <a href="mailto:hirespondo@gmail.com" className="underline">
          hirespondo@gmail.com
        </a>
        .
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        7. Cambios a esta política
      </h2>
      <p className="mt-3">
        Podemos actualizar esta política cuando cambien nuestras prácticas de
        manejo de datos o los requisitos de las plataformas con las que nos
        integramos (Meta, WhatsApp, Google). La fecha de la última
        actualización se indica al comienzo de esta página.
      </p>

      <h2 className="mt-9 text-[19px] font-bold text-[#0A0E20]">
        8. Contacto
      </h2>
      <p className="mt-3">
        Para cualquier consulta sobre esta política o sobre el tratamiento de
        datos, escríbenos a{" "}
        <a href="mailto:hirespondo@gmail.com" className="underline">
          hirespondo@gmail.com
        </a>
        .
      </p>
    </main>
  );
}
