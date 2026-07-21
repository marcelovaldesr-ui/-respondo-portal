/**
 * Plantillas de conocimiento por rubro, con datos FICTICIOS de demostración.
 *
 * Para qué sirven: preparar el portal antes de una reunión de venta sin tener
 * los datos reales del prospecto. Se carga la plantilla del rubro, y en la demo
 * el asistente responde con precios y políticas coherentes de ese negocio.
 *
 * REGLA: en una demo siempre se dice que es un negocio de demostración.
 */

export type FichaPlantilla = {
  categoria: string;
  titulo: string;
  contenido: string;
};

export const PLANTILLAS: Record<
  string,
  { nombre: string; negocio: string; fichas: FichaPlantilla[] }
> = {
  estetica: {
    nombre: "Estética y belleza",
    negocio: "Estética Aurora",
    fichas: [
      {
        categoria: "precios",
        titulo: "Precios depilación láser",
        contenido:
          "Depilación láser diodo por sesión: axilas $15.000, piernas completas $45.000, rostro $12.000, bikini $18.000. Pack de 6 sesiones: 15% de descuento. Limpieza facial profunda $25.000. Los precios son referenciales y pueden variar según evaluación.",
      },
      {
        categoria: "servicios",
        titulo: "Servicios",
        contenido:
          "Depilación láser diodo, limpieza facial profunda, tratamiento antiacné, masaje reductivo. Atención con personal técnico certificado.",
      },
      {
        categoria: "horarios",
        titulo: "Horario de atención",
        contenido:
          "Lunes a viernes de 10:00 a 19:00, sábados de 10:00 a 14:00. Domingos cerrado.",
      },
      {
        categoria: "politicas",
        titulo: "Políticas de reserva",
        contenido:
          "La reserva se confirma con 50% de abono. Cancelación o cambio con mínimo 24 horas de aviso; sin aviso se pierde el abono. No se realiza depilación láser en embarazadas ni sobre piel con bronceado reciente.",
      },
      {
        categoria: "faq",
        titulo: "Preguntas frecuentes",
        contenido:
          "¿Duele el láser? Es una molestia leve, tipo elástico. ¿Cuántas sesiones necesito? Generalmente entre 6 y 8 según la zona y el tipo de piel; no garantizamos un número exacto. Hay que llegar rasurada, sin cera ni depiladora las últimas 3 semanas y sin bronceado reciente.",
      },
    ],
  },

  inmobiliaria: {
    nombre: "Inmobiliaria y corretaje",
    negocio: "Los Aromos Propiedades",
    fichas: [
      {
        categoria: "servicios",
        titulo: "Cartera vigente (resumen)",
        contenido:
          "Depto 2D/2B, Viña Centro, 58 m², UF 3.450 (venta), gastos comunes $85.000. Depto 1D/1B, Reñaca, 42 m², $450.000 mensual (arriendo), requisitos: renta 3x y aval. Casa 4D/3B, Quilpué El Sol, 120 m², UF 5.900 (venta), patio 200 m². Oficina 35 m², Viña Centro, $380.000 mensual. Local comercial 60 m², Av. Libertad, UF 4.200 (venta).",
      },
      {
        categoria: "precios",
        titulo: "Comisiones y servicios",
        contenido:
          "Venta de propiedades: comisión 2% + IVA al vendedor. Arriendo: 50% del primer mes + IVA a cada parte. Administración de arriendos: 8% + IVA mensual del canon. Tasación referencial: $60.000, que se descuenta si nos encarga la venta.",
      },
      {
        categoria: "politicas",
        titulo: "Proceso de visita",
        contenido:
          "Visitas coordinadas con 24 horas de anticipación, de lunes a sábado entre 10:00 y 18:00. Se piden nombre completo y teléfono. La dirección exacta se entrega al confirmar la visita.",
      },
      {
        categoria: "horarios",
        titulo: "Horario de atención",
        contenido:
          "Lunes a viernes de 9:30 a 18:30, sábados de 10:00 a 14:00. Domingos cerrado.",
      },
      {
        categoria: "faq",
        titulo: "Preguntas frecuentes",
        contenido:
          "¿Aceptan mascotas en arriendo? Depende de cada propietario, se consulta caso a caso. ¿Se puede negociar el precio? Toda oferta se presenta al propietario, no garantizamos aceptación. No entregamos direcciones exactas antes de confirmar la visita.",
      },
    ],
  },

  tienda: {
    nombre: "Tienda con catálogo",
    negocio: "Bicicletas Pacífico",
    fichas: [
      {
        categoria: "precios",
        titulo: "Catálogo destacado",
        contenido:
          'Urbana Aro 28 "Comuter One": $289.990 (negra o crema). MTB Aro 29 "Cerro Alto" (Shimano Altus 24v): $449.990. Gravel "Ruta Sur" (Shimano Sora): $749.990. E-bike urbana "Voltio" (autonomía 60 km): $1.190.000. Infantil Aro 20 "Pichón": $129.990. Accesorios: casco desde $24.990, kit de luces $15.990, candado U $22.990, portaequipaje $19.990.',
      },
      {
        categoria: "servicios",
        titulo: "Servicios de taller",
        contenido:
          "Mantención básica (frenos, cambios, lubricación): $19.990, lista en 48 horas. Mantención full (incluye rodamientos y centrado de ruedas): $39.990, lista en 3 a 5 días hábiles. Armado de bicicleta comprada en caja: $25.000.",
      },
      {
        categoria: "horarios",
        titulo: "Horario y ubicación",
        contenido:
          "Martes a sábado de 10:30 a 19:30. Domingo y lunes cerrado. Av. Demo 456, Valparaíso.",
      },
      {
        categoria: "politicas",
        titulo: "Despachos, cambios y garantía",
        contenido:
          "Despacho en Valparaíso y Viña $4.990, gratis sobre $300.000. Cambios dentro de 10 días con boleta y producto sin uso. Garantía de fábrica 6 meses en cuadro y componentes; no cubre desgaste por uso ni caídas.",
      },
      {
        categoria: "faq",
        titulo: "Preguntas frecuentes",
        contenido:
          "¿Tienen stock? El stock cambia a diario, siempre se confirma antes de prometer. ¿Hacen envíos a regiones? Sí, por pagar vía transporte externo. ¿Aceptan cuotas? Sí, con tarjetas de crédito bancarias.",
      },
    ],
  },
};

export const CATEGORIAS = [
  { valor: "precios", etiqueta: "Precios" },
  { valor: "servicios", etiqueta: "Servicios y productos" },
  { valor: "horarios", etiqueta: "Horarios y ubicación" },
  { valor: "politicas", etiqueta: "Políticas" },
  { valor: "faq", etiqueta: "Preguntas frecuentes" },
  { valor: "general", etiqueta: "Otra información" },
];
