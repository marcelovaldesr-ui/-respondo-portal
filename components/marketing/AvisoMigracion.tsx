/**
 * Cuando las tablas del estudio y del asistente no existen todavía, se dice —
 * pero en el idioma del dueño. Una galería vacía por falta de configuración se
 * ve igual que una galería vacía por falta de trabajo, y son cosas opuestas:
 * en la primera el dueño puede trabajar horas y perderlo todo al guardar.
 *
 * Lo que NO va acá: el nombre del archivo de migración, el documento interno
 * donde está anotado ni la etiqueta de prioridad. Eso es información nuestra,
 * no suya, y publicarla no le da ninguna acción —él no puede aplicarla—.
 */
export default function AvisoMigracion() {
  return (
    <div className="mk-panel mk-aviso mb-4" style={{ borderLeft: "3px solid var(--alerta)" }}>
      <strong>Falta terminar de habilitar el guardado.</strong> Puedes escribir anuncios, generar imágenes y armar campañas, pero todavía no
      se pueden guardar en tu cuenta. Es un paso nuestro y ya está avisado; escríbenos si lo necesitas hoy.
    </div>
  );
}
