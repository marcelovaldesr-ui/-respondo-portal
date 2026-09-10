/**
 * Cuando las tablas del estudio y del asistente no existen todavía, se dice
 * con nombre y apellido. Una galería vacía por falta de migración se ve igual
 * que una galería vacía por falta de trabajo, y son cosas opuestas.
 */
export default function AvisoMigracion() {
  return (
    <div className="tarjeta mb-4 p-4" style={{ borderLeft: "3px solid var(--alerta)", fontSize: "var(--t-menor)" }}>
      <strong>Falta un paso del lado del servidor.</strong> Las creatividades y los borradores de campaña se guardan en tablas que todavía no
      existen en la base de datos: hay que aplicar la migración <code>sql/303_marketing.sql</code> (está en <code>ADS_OWNER_ACTIONS.md</code>,
      como P0). Mientras tanto se puede generar y previsualizar, pero no guardar.
    </div>
  );
}
