import { armarMetricas, type DatosPropios } from "@/lib/ads/metricas";
import { hallazgos } from "@/lib/ads/insights";
import { capacidadesDemo } from "@/lib/marketing/capacidades";
import { analizarAds } from "@/lib/ads/analisis";
import { detectarSenales, profundidadDe, type Senales } from "@/lib/ads/senales";
import { armarEmbudoAdaptativo } from "@/lib/marketing/embudoAdaptativo";
import type { FilaRendimiento } from "@/lib/ads/canal";
import type { FilaPauta, ResumenPauta } from "@/lib/ads/atribucionCore";
import { diasEntre, sumarDias, type Rango } from "@/lib/ads/periodos";
import type {
  BorradorCampana,
  Creatividad,
  EscalonEmbudo,
  FilaAnuncio,
  FilaCampana,
  Lead,
  Panorama,
  PuntoDiario,
} from "@/lib/marketing/tipos";

/**
 * DATOS DE DEMOSTRACIÓN — un negocio que no existe, con números que sí cuadran.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 * Hasta que un cliente acumula tráfico atribuido, el centro de marketing se ve
 * vacío, y una pantalla vacía no se puede diseñar, vender ni evaluar. Este
 * módulo produce un `Panorama` completo para un negocio ficticio, de manera
 * DETERMINISTA (mismo período → mismos números) y por el MISMO camino que los
 * datos reales: las métricas pasan por `armarMetricas` y los hallazgos por
 * `hallazgos`. Así la demo enseña exactamente lo que el producto hace con
 * datos de verdad — no una maqueta pintada.
 *
 * REGLAS QUE NO SE NEGOCIAN
 *  · Nunca se mezcla con datos reales: `datos.ts` elige UNO de los dos
 *    caminos y las pantallas lo marcan con la píldora «Datos de demostración».
 *  · Nada de acá se escribe en la base. Las acciones (guardar creatividad,
 *    borrador) en modo demo devuelven un resultado en memoria y avisan.
 *  · El negocio es inventado: «Gráfica Andina» no existe, ni sus clientes.
 *
 * Los números están calibrados con órdenes de magnitud de una pyme chilena que
 * invierte ~$400.000/mes en Meta: decenas de conversaciones por semana, no
 * miles; ventas de $30.000 a $400.000.
 */

export const NEGOCIO_DEMO = {
  nombre: "Gráfica Andina",
  rubro: "Imprenta y gráfica publicitaria",
  ciudad: "Chillán",
  moneda: "CLP",
};

/* ── Un generador determinista ──────────────────────────────────────────────
   Sin `Math.random`: dos cargas de la misma pantalla tienen que verse iguales,
   o la persona que evalúa el producto cree que los números "se mueven solos". */
function semilla(texto: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── Campañas y anuncios ──────────────────────────────────────────────────── */

type CampanaBase = {
  id: string;
  nombre: string;
  objetivo: string;
  estado: FilaCampana["estado"];
  gastoDiario: number;
  /** Conversaciones por día, promedio. */
  convDia: number;
  /** Tasa de calificación y de venta. Esto es lo que diferencia una campaña buena de una mala. */
  califica: number;
  vende: number;
  ticket: number;
  desde: string;
  anuncios: { id: string; titular: string; cuerpo: string; peso: number; imagen: string }[];
};

const CAMPANAS_BASE: CampanaBase[] = [
  {
    id: "c_pendones",
    nombre: "Pendones para ferias · Septiembre",
    objetivo: "cotizaciones",
    estado: "activa",
    gastoDiario: 6500,
    convDia: 2.4,
    califica: 0.62,
    vende: 0.31,
    ticket: 68000,
    desde: "-34",
    anuncios: [
      { id: "a_pend_1", titular: "Pendón roller listo en 24 horas", cuerpo: "Imprime tu pendón hoy y retíralo mañana. Cotiza por WhatsApp.", peso: 0.55, imagen: "pendon-feria" },
      { id: "a_pend_2", titular: "¿Feria este fin de semana? Te salvamos", cuerpo: "Pendones, gigantografías y flyers con entrega express.", peso: 0.45, imagen: "pendon-express" },
    ],
  },
  {
    id: "c_tarjetas",
    nombre: "Tarjetas de presentación · Pymes",
    objetivo: "conversaciones",
    estado: "activa",
    gastoDiario: 3200,
    convDia: 3.1,
    califica: 0.34,
    vende: 0.09,
    ticket: 24000,
    desde: "-28",
    anuncios: [
      { id: "a_tarj_1", titular: "1.000 tarjetas desde $19.990", cuerpo: "Diseño incluido. Escríbenos y te mandamos la prueba.", peso: 0.7, imagen: "tarjetas" },
      { id: "a_tarj_2", titular: "Tu tarjeta dice quién eres", cuerpo: "Papel couché 350 g, terminación mate o brillante.", peso: 0.3, imagen: "tarjetas-mate" },
    ],
  },
  {
    id: "c_giganto",
    nombre: "Gigantografías · Locales comerciales",
    objetivo: "ventas",
    estado: "activa",
    gastoDiario: 5100,
    convDia: 1.3,
    califica: 0.71,
    vende: 0.42,
    ticket: 145000,
    desde: "-21",
    anuncios: [
      { id: "a_gig_1", titular: "Renueva la fachada de tu local", cuerpo: "Gigantografía en PVC o tela, instalación incluida en Chillán.", peso: 0.6, imagen: "gigantografia" },
      { id: "a_gig_2", titular: "Que te vean desde la calle", cuerpo: "Letreros y gigantografías resistentes al agua. Cotiza hoy.", peso: 0.4, imagen: "letrero" },
    ],
  },
  {
    id: "c_poleras",
    nombre: "Poleras sublimadas · Eventos",
    objetivo: "cotizaciones",
    estado: "activa",
    gastoDiario: 2800,
    convDia: 2.9,
    califica: 0.28,
    vende: 0.0,
    ticket: 0,
    desde: "-16",
    anuncios: [
      { id: "a_pol_1", titular: "Poleras para tu equipo desde 10 unidades", cuerpo: "Sublimación full color. Pide tu cotización por WhatsApp.", peso: 0.65, imagen: "poleras" },
      { id: "a_pol_2", titular: "¿Aniversario, corrida o bautizo?", cuerpo: "Poleras personalizadas con tu diseño en 5 días.", peso: 0.35, imagen: "poleras-evento" },
    ],
  },
  {
    id: "c_remkt",
    nombre: "Remarketing · Cotizaron y no compraron",
    objetivo: "ventas",
    estado: "pausada",
    gastoDiario: 1800,
    convDia: 0.6,
    califica: 0.8,
    vende: 0.38,
    ticket: 52000,
    desde: "-30",
    anuncios: [
      { id: "a_rem_1", titular: "Tu cotización sigue vigente", cuerpo: "Mantenemos el precio hasta el viernes. Retoma por WhatsApp.", peso: 1, imagen: "remarketing" },
    ],
  },
];

const NOMBRES = [
  "Camila Soto", "Rodrigo Pérez", "Valentina Muñoz", "Ignacio Rojas", "Fernanda Díaz",
  "Matías Contreras", "Josefa Araya", "Sebastián Fuentes", "Antonia Vega", "Diego Navarro",
  "Constanza Pizarro", "Felipe Castro", "Martina Reyes", "Benjamín Torres", "Isidora Silva",
  "Vicente Morales", "Catalina Espinoza", "Tomás Herrera", "Emilia Carrasco", "Joaquín Bravo",
  "Florencia Lagos", "Cristóbal Vidal", "Renata Ortiz", "Gaspar Olivares", "Amanda Sepúlveda",
  "Lucas Tapia", "Maite Riquelme", "Bastián Salazar", "Paz Alarcón", "Nicolás Gutiérrez",
  "Ferretería El Roble", "Clínica Dental Ñuble", "Café Ítaca", "Gimnasio Fuerza Sur", "Colegio San Ignacio",
  "Pastelería La Abuela", "Taller Mecánico Ruiz", "Inmobiliaria Bío Bío", "Veterinaria Huellas", "Escuela de Danza Alma",
];

const MENSAJES: Record<string, string[]> = {
  nuevo: ["Hola, vi el anuncio y quería consultar precios", "Buenas, ¿hacen envíos a Los Ángeles?", "¿Tienen catálogo?"],
  interesado: ["¿Me puedes mandar fotos de trabajos anteriores?", "Necesito 2 pendones para el sábado, ¿alcanzan?", "¿Qué medidas manejan?"],
  cotizado: ["Ya recibí la cotización, lo converso con mi socio", "¿El precio incluye instalación?", "Perfecto, lo veo y te confirmo"],
  ganado: ["Listo, pagado por el enlace ✅", "Ya transferí, ¿cuándo lo retiro?", "Quedó espectacular, gracias"],
  perdido: ["Al final lo hicimos con otro proveedor, gracias igual", "Muy caro para lo que necesito", "Lo dejo para más adelante"],
};

/* ── La serie diaria y los leads se derivan del mismo generador ──────────── */

function construir(rango: Rango) {
  const azar = semilla(`${rango.desde}|${rango.hasta}`);
  const hoy = rango.hasta;
  const dias = diasEntre(rango.desde, rango.hasta);

  const serie: PuntoDiario[] = [];
  const leads: Lead[] = [];
  const porAnuncio = new Map<string, FilaAnuncio>();
  const porCampana = new Map<string, FilaCampana>();

  let n = 0;
  for (let i = 0; i < dias; i++) {
    const dia = sumarDias(rango.desde, i);
    const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
    // Los fines de semana cae la actividad: es lo que se ve en cualquier cuenta real.
    const factorDia = dow === 0 ? 0.45 : dow === 6 ? 0.7 : 1;
    const punto: PuntoDiario = {
      dia,
      gasto: 0,
      impresiones: 0,
      clics: 0,
      conversaciones: 0,
      calificados: 0,
      ventas: 0,
      cobrado: 0,
    };

    for (const c of CAMPANAS_BASE) {
      const inicio = sumarDias(hoy, Number(c.desde));
      if (dia < inicio) continue;
      if (c.estado === "pausada" && dia > sumarDias(hoy, -9)) continue;

      const gasto = Math.round(c.gastoDiario * factorDia * (0.75 + azar() * 0.5));
      const impresiones = Math.round(gasto * (5.2 + azar() * 2.5));
      const clics = Math.round(impresiones * (0.011 + azar() * 0.012));
      punto.gasto! += gasto;
      punto.impresiones! += impresiones;
      punto.clics! += clics;

      const conv = Math.round(c.convDia * factorDia * (0.5 + azar()));
      for (let k = 0; k < conv; k++) {
        const r = azar();
        let acumulado = 0;
        let anuncio = c.anuncios[0];
        for (const a of c.anuncios) {
          acumulado += a.peso;
          if (r <= acumulado) {
            anuncio = a;
            break;
          }
        }
        const calificado = azar() < c.califica;
        const compro = calificado && azar() < c.vende;
        const cotizo = calificado && azar() < 0.8;
        const agendo = calificado && c.objetivo === "reservas" && azar() < 0.5;
        const perdido = !compro && calificado && azar() < 0.25;
        const etapa: Lead["etapa"] = compro
          ? "ganado"
          : perdido
            ? "perdido"
            : cotizo
              ? "cotizado"
              : calificado
                ? "interesado"
                : "nuevo";
        const cobrado = compro ? Math.round(c.ticket * (0.6 + azar() * 0.9) / 1000) * 1000 : 0;
        const hora = String(9 + Math.floor(azar() * 11)).padStart(2, "0");
        const min = String(Math.floor(azar() * 60)).padStart(2, "0");
        const nombre = NOMBRES[n % NOMBRES.length];
        n++;

        leads.push({
          chatId: `demo-${c.id}-${dia}-${k}`,
          nombre,
          telefono: `+56 9 ${String(4000 + (n * 37) % 6000).padStart(4, "0")} ${String((n * 91) % 10000).padStart(4, "0")}`,
          origen: azar() < 0.35 ? "instagram" : "meta",
          campanaId: c.id,
          campanaNombre: c.nombre,
          anuncioId: anuncio.id,
          anuncioTitular: anuncio.titular,
          llegoEn: `${dia}T${hora}:${min}:00-03:00`,
          etapa,
          calificado,
          cotizo,
          agendo,
          compro,
          cobrado,
          ultimoMensaje: MENSAJES[etapa][n % MENSAJES[etapa].length],
          conClid: azar() < 0.86,
        });

        punto.conversaciones += 1;
        if (calificado) punto.calificados += 1;
        if (compro) {
          punto.ventas += 1;
          punto.cobrado += cobrado;
        }

        const fa = porAnuncio.get(anuncio.id) ?? {
          id: anuncio.id,
          campanaId: c.id,
          campanaNombre: c.nombre,
          titular: anuncio.titular,
          cuerpo: anuncio.cuerpo,
          url: "https://www.facebook.com/",
          imagenUrl: `/marketing/demo/${anuncio.imagen}.jpg`,
          gasto: 0,
          moneda: MONEDA_DEMO,
          impresiones: 0,
          clics: 0,
          conversaciones: 0,
          calificados: 0,
          cotizaciones: 0,
          agendadas: 0,
          avanzados: 0,
          ventas: 0,
          cobrado: 0,
          conClid: 0,
        };
        fa.conversaciones += 1;
        if (calificado) fa.calificados += 1;
        if (cotizo) fa.cotizaciones += 1;
        if (agendo) fa.agendadas += 1;
        // Una sola vez por persona, igual que en la atribución real.
        if (cotizo || agendo) fa.avanzados += 1;
        if (compro) {
          fa.ventas += 1;
          fa.cobrado += cobrado;
        }
        if (leads[leads.length - 1].conClid) fa.conClid += 1;
        porAnuncio.set(anuncio.id, fa);
      }

      // Gasto, impresiones y clics del día repartidos por peso de anuncio.
      for (const a of c.anuncios) {
        const fa = porAnuncio.get(a.id) ?? {
          id: a.id,
          campanaId: c.id,
          campanaNombre: c.nombre,
          titular: a.titular,
          cuerpo: a.cuerpo,
          url: "https://www.facebook.com/",
          imagenUrl: `/marketing/demo/${a.imagen}.jpg`,
          gasto: 0,
          moneda: MONEDA_DEMO,
          impresiones: 0,
          clics: 0,
          conversaciones: 0,
          calificados: 0,
          cotizaciones: 0,
          agendadas: 0,
          avanzados: 0,
          ventas: 0,
          cobrado: 0,
          conClid: 0,
        };
        fa.gasto = (fa.gasto ?? 0) + Math.round(gasto * a.peso);
        fa.impresiones = (fa.impresiones ?? 0) + Math.round(impresiones * a.peso);
        fa.clics = (fa.clics ?? 0) + Math.round(clics * a.peso);
        porAnuncio.set(a.id, fa);
      }
    }
    serie.push(punto);
  }

  // Campañas: la suma de sus anuncios.
  for (const c of CAMPANAS_BASE) {
    const anuncios = [...porAnuncio.values()].filter((a) => a.campanaId === c.id);
    const sum = (f: (a: FilaAnuncio) => number | null) =>
      anuncios.reduce((s, a) => s + (f(a) ?? 0), 0);
    const gasto = sum((a) => a.gasto);
    const conversaciones = sum((a) => a.conversaciones);
    const ventas = sum((a) => a.ventas);
    const cobrado = sum((a) => a.cobrado);
    const inicio = sumarDias(hoy, Number(c.desde));
    porCampana.set(c.id, {
      id: c.id,
      nombre: c.nombre,
      origen: "meta",
      estado: c.estado,
      objetivo: c.objetivo,
      gasto,
      moneda: "CLP",
      impresiones: sum((a) => a.impresiones),
      clics: sum((a) => a.clics),
      conversaciones,
      calificados: sum((a) => a.calificados),
      avanzados: sum((a) => a.avanzados),
      ventas,
      cobrado,
      costoPorConversacion: conversaciones ? gasto / conversaciones : null,
      costoPorVenta: ventas ? gasto / ventas : null,
      roas: gasto ? cobrado / gasto : null,
      anuncios: anuncios.filter((a) => a.conversaciones > 0).length,
      desde: inicio < rango.desde ? rango.desde : inicio,
      hasta: c.estado === "pausada" ? sumarDias(hoy, -9) : hoy,
    });
  }

  return { serie, leads, anuncios: [...porAnuncio.values()], campanas: [...porCampana.values()] };
}

/* ── Creatividades y borradores de demostración ───────────────────────────── */

const CREATIVIDADES_DEMO: Omit<Creatividad, "rendimiento" | "creadoEn" | "actualizadoEn">[] = [
  {
    id: "cr_pendon_feria",
    nombre: "Pendón en feria · luz natural",
    objetivo: "cotizaciones",
    producto: "Pendón roller 80×200",
    oferta: "Listo en 24 horas",
    plataforma: "ambas",
    formato: "1:1",
    concepto: "Mostrar el producto en el contexto real donde se usa: una feria con gente.",
    gancho: "¿Feria este fin de semana?",
    titular: "Pendón roller listo en 24 horas",
    texto: "Imprime tu pendón hoy y retíralo mañana. Diseño incluido si nos mandas tu logo. Cotiza por WhatsApp y te respondemos al tiro.",
    cta: "Cotizar por WhatsApp",
    imagenUrl: "/marketing/demo/pendon-feria.jpg",
    imagenPrompt: "Pendón roller-up impreso en alta calidad en una feria comercial, luz natural, sin texto.",
    estado: "en_campana",
    campanaId: "c_pendones",
    campanaNombre: "Pendones para ferias · Septiembre",
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_pendon_express",
    nombre: "Pendón express · variante urgencia",
    objetivo: "cotizaciones",
    producto: "Pendón roller 80×200",
    oferta: "Entrega express",
    plataforma: "instagram",
    formato: "4:5",
    concepto: "Variante que apela a la urgencia de quien organiza un evento a última hora.",
    gancho: "Te salvamos la feria",
    titular: "¿Feria este fin de semana? Te salvamos",
    texto: "Pendones, gigantografías y flyers con entrega express en Chillán. Escríbenos con lo que necesitas y te decimos si alcanzamos.",
    cta: "Escribir ahora",
    imagenUrl: "/marketing/demo/pendon-express.jpg",
    imagenPrompt: "Primer plano de un pendón enrollable recién impreso saliendo de un plotter, taller de imprenta, luz cálida.",
    estado: "en_campana",
    campanaId: "c_pendones",
    campanaNombre: "Pendones para ferias · Septiembre",
    varianteDe: "cr_pendon_feria",
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_tarjetas",
    nombre: "Tarjetas · precio de entrada",
    objetivo: "conversaciones",
    producto: "Tarjetas de presentación",
    oferta: "1.000 desde $19.990",
    plataforma: "ambas",
    formato: "1:1",
    concepto: "Precio concreto y bajo como gancho. Trae muchas conversaciones, no todas serias.",
    gancho: "1.000 tarjetas desde $19.990",
    titular: "1.000 tarjetas desde $19.990",
    texto: "Diseño incluido. Papel couché 350 g. Escríbenos y te mandamos la prueba antes de imprimir.",
    cta: "Pedir prueba",
    imagenUrl: "/marketing/demo/tarjetas.jpg",
    imagenPrompt: "Tarjetas de presentación apiladas sobre madera clara, papel texturizado, fotografía de producto minimalista.",
    estado: "en_campana",
    campanaId: "c_tarjetas",
    campanaNombre: "Tarjetas de presentación · Pymes",
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_giganto",
    nombre: "Gigantografía · fachada renovada",
    objetivo: "ventas",
    producto: "Gigantografía PVC",
    oferta: "Instalación incluida",
    plataforma: "facebook",
    formato: "16:9",
    concepto: "Antes/después implícito: un local que se ve nuevo desde la calle.",
    gancho: "Que te vean desde la calle",
    titular: "Renueva la fachada de tu local",
    texto: "Gigantografía en PVC o tela, instalación incluida en Chillán. Mándanos una foto de tu local y te cotizamos hoy.",
    cta: "Cotizar con foto",
    imagenUrl: "/marketing/demo/gigantografia.jpg",
    imagenPrompt: "Fachada de un local comercial pequeño con una gigantografía colorida recién instalada, calle chilena, tarde soleada.",
    estado: "en_campana",
    campanaId: "c_giganto",
    campanaNombre: "Gigantografías · Locales comerciales",
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_poleras",
    nombre: "Poleras · equipo",
    objetivo: "cotizaciones",
    producto: "Poleras sublimadas",
    oferta: "Desde 10 unidades",
    plataforma: "instagram",
    formato: "4:5",
    concepto: "Grupo con poleras iguales: vende pertenencia, no tela.",
    gancho: "Tu equipo, con la misma polera",
    titular: "Poleras para tu equipo desde 10 unidades",
    texto: "Sublimación full color que no se despinta. Pide tu cotización por WhatsApp con la cantidad y el diseño.",
    cta: "Cotizar",
    imagenUrl: "/marketing/demo/poleras.jpg",
    imagenPrompt: "Cinco poleras de colores vivos con estampado sublimado colgadas en perchero, fondo neutro, fotografía de producto.",
    estado: "en_campana",
    campanaId: "c_poleras",
    campanaNombre: "Poleras sublimadas · Eventos",
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_stickers",
    nombre: "Stickers · lista para probar",
    objetivo: "conversaciones",
    producto: "Stickers troquelados",
    oferta: "100 unidades desde $8.990",
    plataforma: "instagram",
    formato: "9:16",
    concepto: "Producto de entrada barato para captar emprendedores que después piden más.",
    gancho: "Tu marca en todas partes",
    titular: "Stickers troquelados desde $8.990",
    texto: "Vinilo resistente al agua. Mándanos tu logo y te mostramos cómo quedan.",
    cta: "Mandar logo",
    imagenUrl: "/marketing/demo/stickers.jpg",
    imagenPrompt: "Hoja de stickers troquelados de colores sobre escritorio de diseñador, vista cenital, luz suave.",
    estado: "lista",
    campanaId: null,
    campanaNombre: null,
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_navidad",
    nombre: "Calendarios corporativos · borrador",
    objetivo: "ventas",
    producto: "Calendarios corporativos",
    oferta: "Pedido anticipado con 15% de descuento",
    plataforma: "ambas",
    formato: "1:1",
    concepto: "Adelantarse a la temporada: quien pide en octubre paga menos.",
    gancho: "Diciembre llega antes de lo que crees",
    titular: "Calendarios con tu marca, 15% menos si pides ahora",
    texto: "Pedido anticipado hasta el 31 de octubre. Papel premium, espiral metálico.",
    cta: "Reservar precio",
    imagenUrl: null,
    imagenPrompt: null,
    estado: "borrador",
    campanaId: null,
    campanaNombre: null,
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
  {
    id: "cr_remkt",
    nombre: "Remarketing · cotización vigente",
    objetivo: "ventas",
    producto: "Cualquiera cotizado",
    oferta: "Precio mantenido hasta el viernes",
    plataforma: "ambas",
    formato: "1:1",
    concepto: "Hablarle a quien ya pidió precio: la objeción no es el producto, es el momento.",
    gancho: "Tu cotización sigue vigente",
    titular: "Tu cotización sigue vigente",
    texto: "Mantenemos el precio que te dimos hasta el viernes. Retoma la conversación por WhatsApp y lo dejamos listo.",
    cta: "Retomar",
    imagenUrl: "/marketing/demo/remarketing.jpg",
    imagenPrompt: "Escritorio de oficina con una cotización impresa y un teléfono mostrando WhatsApp, luz de mañana, sin texto legible.",
    estado: "archivada",
    campanaId: "c_remkt",
    campanaNombre: "Remarketing · Cotizaron y no compraron",
    varianteDe: null,
    origen: "generada",
    textoManual: false,
    estrategia: null,
  },
];

function borradoresDemo(hoy: string): BorradorCampana[] {
  return [
    {
      id: "b_calendarios",
      nombre: "Calendarios corporativos · Preventa",
      objetivo: "ventas",
      oferta: "15% de descuento por pedido anticipado hasta el 31 de octubre",
      audiencia: {
        ubicacion: "Chillán y alrededores (25 km)",
        edadDesde: 28,
        edadHasta: 60,
        intereses: ["Pequeñas empresas", "Emprendimiento", "Marketing"],
        nota: "Dueños de negocio que ya compraron material impreso este año.",
      },
      presupuestoDiario: 4000,
      presupuestoTotal: 120000,
      moneda: "CLP",
      destino: "whatsapp",
      creatividadIds: ["cr_navidad"],
      copies: [
        { titular: "Calendarios con tu marca, 15% menos si pides ahora", texto: "Pedido anticipado hasta el 31 de octubre. Papel premium, espiral metálico.", cta: "Reservar precio" },
        { titular: "Regala algo que se use todo el año", texto: "Calendarios corporativos con tu logo. Reserva en octubre y ahorra.", cta: "Cotizar" },
      ],
      estado: "borrador",
      notas: "Falta la imagen de la creatividad. Lanzar la primera semana de octubre.",
      creadoEn: `${sumarDias(hoy, -2)}T10:12:00-03:00`,
      actualizadoEn: `${sumarDias(hoy, -1)}T16:40:00-03:00`,
    },
  ];
}

/* ── El panorama completo ─────────────────────────────────────────────────── */

/**
 * LAS TRES DEMOSTRACIONES, QUE SON LOS TRES CLIENTES REALES.
 *
 * ⭐ No es una demo con interruptores de adorno: cada variante reproduce un
 * negocio que existe y que va a usar esto.
 *   · `meta`     — pauta en Meta y NO trae la conversación (un estudio jurídico).
 *   · `google`   — pauta en Búsqueda, con términos y palabras clave.
 *   · `completo` — las dos cosas más el circuito cerrado de Respondo.
 *
 * Las tres pasan por los MISMOS componentes y el MISMO dominio. Esa es la regla
 * que hace que la demo sirva para evaluar el producto: si una variante se viera
 * bien solo porque la demo dibuja campos que producción no puede llenar, la
 * demo estaría mintiendo sobre el producto, que es peor que no tenerla.
 */
export type VarianteDemo = "completo" | "meta" | "google";

/** Campañas de Meta en el vocabulario multicanal, deterministas. */
function filasMetaDemo(campanas: FilaCampana[], factor = 1): FilaRendimiento[] {
  return campanas
    .filter((c) => c.origen !== "borrador")
    .map((c, i) => ({
      proveedor: "meta" as const,
      nivel: "campana" as const,
      id: c.id,
      nombre: c.nombre,
      estado: (i === 3 ? "pausada" : "activa") as "activa" | "pausada",
      objetivo: i % 2 === 0 ? "Mensajes" : "Ventas",
      presupuestoDiario: { valor: 6000 + i * 1500, moneda: "CLP" },
      impresiones: Math.round((c.impresiones ?? 0) * factor),
      clics: Math.round((c.clics ?? 0) * factor),
      gasto: { valor: Math.round((c.gasto ?? 0) * factor), moneda: "CLP" },
      alcance: Math.round(((c.impresiones ?? 0) / 2.4) * factor),
      frecuencia: i === 0 ? 3.4 : 1.6 + i * 0.2,
      resultados: { cantidad: Math.max(1, Math.round(c.conversaciones * factor)), tipo: "mensajes" as const },
      valorResultados: null,
    }));
}

/**
 * Google en la demo: una cuenta de Búsqueda con su jerarquía completa.
 *
 * Los términos incluyen a propósito un caso que el motor NO debe recomendar
 * excluir —uno que choca con una palabra clave activa— porque esa verificación
 * es la lección más cara que dejó la cuenta real de Impresora Color.
 */
function filasGoogleDemo(factor = 1): FilaRendimiento[] {
  const clp = (valor: number) => ({ valor: Math.round(valor * factor), moneda: "CLP" });
  const n = (x: number) => Math.round(x * factor);
  const campanas: FilaRendimiento[] = [
    {
      proveedor: "google", nivel: "campana", id: "g-1", nombre: "Búsqueda · Imprenta Chillán",
      estado: "activa", objetivo: "Búsqueda", presupuestoDiario: { valor: 4000, moneda: "CLP" },
      impresiones: n(18420), clics: n(742), gasto: clp(96800),
      resultados: { cantidad: n(48), tipo: "conversiones_web" }, valorResultados: null,
      extra: { tipoCrudo: "SEARCH" },
    },
    {
      proveedor: "google", nivel: "campana", id: "g-2", nombre: "Máximo rendimiento · Estampados",
      estado: "activa", objetivo: "Máximo rendimiento", presupuestoDiario: { valor: 3000, moneda: "CLP" },
      impresiones: n(52100), clics: n(410), gasto: clp(58400),
      resultados: { cantidad: n(6), tipo: "conversiones_web" }, valorResultados: null,
      extra: { tipoCrudo: "PERFORMANCE_MAX" },
    },
  ];
  const grupos: FilaRendimiento[] = [
    { proveedor: "google", nivel: "grupo", id: "gg-1", nombre: "Tarjetas y flyers", campanaId: "g-1", campanaNombre: campanas[0].nombre, estado: "activa", objetivo: "Búsqueda", impresiones: n(9800), clics: n(451), gasto: clp(52300), resultados: { cantidad: n(34), tipo: "conversiones_web" } },
    { proveedor: "google", nivel: "grupo", id: "gg-2", nombre: "Pendones y gigantografía", campanaId: "g-1", campanaNombre: campanas[0].nombre, estado: "activa", objetivo: "Búsqueda", impresiones: n(8620), clics: n(291), gasto: clp(44500), resultados: { cantidad: n(14), tipo: "conversiones_web" } },
  ];
  /**
   * Los anuncios de la cuenta. Existen en la demo porque existen en producción
   * (`NIVELES_DE.google` los incluye) y porque son lo único que la pestaña
   * «Anuncios» de una campaña puede mostrarle a un negocio sin conversaciones
   * propias: sin ellos la variante «google» enseñaría una lista vacía, que es
   * justo el defecto que se corrigió.
   */
  const anuncios: FilaRendimiento[] = [
    { proveedor: "google", nivel: "anuncio", id: "ad-1", nombre: "Anuncio 1 · Tarjetas 500 unidades", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "activa", impresiones: n(5400), clics: n(268), gasto: clp(29800), resultados: { cantidad: n(21), tipo: "conversiones_web" } },
    { proveedor: "google", nivel: "anuncio", id: "ad-2", nombre: "Anuncio 2 · Flyers full color", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "activa", impresiones: n(4400), clics: n(183), gasto: clp(22500), resultados: { cantidad: n(13), tipo: "conversiones_web" } },
    { proveedor: "google", nivel: "anuncio", id: "ad-3", nombre: "Anuncio 3 · Pendones 1x2", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-2", grupoNombre: grupos[1].nombre, estado: "pausada", impresiones: n(3900), clics: n(121), gasto: clp(19400), resultados: { cantidad: n(6), tipo: "conversiones_web" } },
    { proveedor: "google", nivel: "anuncio", id: "ad-4", nombre: "Anuncio 4 · Estampados por mayor", campanaId: "g-2", campanaNombre: campanas[1].nombre, estado: "activa", impresiones: n(21000), clics: n(164), gasto: clp(24100), resultados: { cantidad: n(2), tipo: "conversiones_web" } },
  ];
  const palabras: FilaRendimiento[] = [
    { proveedor: "google", nivel: "palabra", id: "kw-1", nombre: "imprenta chillan", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "activa", impresiones: n(4100), clics: n(232), gasto: clp(24800), resultados: { cantidad: n(22), tipo: "conversiones_web" }, extra: { concordancia: "PHRASE" } },
    { proveedor: "google", nivel: "palabra", id: "kw-2", nombre: "tarjetas de presentacion", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "activa", impresiones: n(3200), clics: n(140), gasto: clp(15600), resultados: { cantidad: n(9), tipo: "conversiones_web" }, extra: { concordancia: "BROAD" } },
    { proveedor: "google", nivel: "palabra", id: "kw-3", nombre: "impresion de planos", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-2", grupoNombre: grupos[1].nombre, estado: "activa", impresiones: n(2600), clics: n(96), gasto: clp(18900), resultados: null, extra: { concordancia: "BROAD" } },
  ];
  const terminos: FilaRendimiento[] = [
    { proveedor: "google", nivel: "termino", id: "imprenta chillan precios", nombre: "imprenta chillan precios", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "desconocido", impresiones: n(820), clics: n(74), gasto: clp(7900), resultados: { cantidad: n(8), tipo: "conversiones_web" }, extra: { estadoTermino: "NONE", palabraQueLoDisparo: "imprenta chillan", concordancia: "PHRASE" } },
    { proveedor: "google", nivel: "termino", id: "trabajos de imprenta sueldo", nombre: "trabajos de imprenta sueldo", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-1", grupoNombre: grupos[0].nombre, estado: "desconocido", impresiones: n(640), clics: n(38), gasto: clp(16400), resultados: null, extra: { estadoTermino: "NONE", palabraQueLoDisparo: "imprenta chillan", concordancia: "BROAD" } },
    // ⚠️ Este término CONTIENE una palabra clave activa: el motor no debe
    // proponer excluirlo, tiene que decir por qué no.
    { proveedor: "google", nivel: "termino", id: "impresion de planos a1", nombre: "impresion de planos a1", campanaId: "g-1", campanaNombre: campanas[0].nombre, grupoId: "gg-2", grupoNombre: grupos[1].nombre, estado: "desconocido", impresiones: n(410), clics: n(29), gasto: clp(12200), resultados: null, extra: { estadoTermino: "NONE", palabraQueLoDisparo: "impresion de planos", concordancia: "BROAD" } },
  ];
  return [...campanas, ...grupos, ...anuncios, ...palabras, ...terminos];
}

export function panoramaDemo(rango: Rango, variante: VarianteDemo = "completo"): Panorama {
  const actual = construir(rango);

  // Período anterior del mismo largo, por el mismo generador, para comparar.
  const largo = diasEntre(rango.desde, rango.hasta);
  const anterior: Rango = {
    ...rango,
    desde: sumarDias(rango.desde, -largo),
    hasta: sumarDias(rango.desde, -1),
  };
  const previo = construir(anterior);

  const totales = (s: PuntoDiario[]) =>
    s.reduce(
      (acc, p) => ({
        gasto: acc.gasto + (p.gasto ?? 0),
        impresiones: acc.impresiones + (p.impresiones ?? 0),
        clics: acc.clics + (p.clics ?? 0),
        conversaciones: acc.conversaciones + p.conversaciones,
        calificados: acc.calificados + p.calificados,
        ventas: acc.ventas + p.ventas,
        cobrado: acc.cobrado + p.cobrado,
      }),
      { gasto: 0, impresiones: 0, clics: 0, conversaciones: 0, calificados: 0, ventas: 0, cobrado: 0 },
    );

  // El gasto por anuncio se reparte con redondeo; el total del período tiene
  // que ser la suma de lo que muestran las filas, no la serie sin redondear,
  // para que Inicio, Campañas y Atribución cuadren peso por peso.
  const deMeta = (anuncios: { gasto: number | null; impresiones: number | null; clics: number | null }[]) => ({
    gasto: anuncios.reduce((s, a) => s + (a.gasto ?? 0), 0),
    impresiones: anuncios.reduce((s, a) => s + (a.impresiones ?? 0), 0),
    clics: anuncios.reduce((s, a) => s + (a.clics ?? 0), 0),
  });
  const t = { ...totales(actual.serie), ...deMeta(actual.anuncios) };
  const tp = { ...totales(previo.serie), ...deMeta(previo.anuncios) };
  const cotizaciones = actual.anuncios.reduce((s, a) => s + a.cotizaciones, 0);
  const agendadas = actual.anuncios.reduce((s, a) => s + a.agendadas, 0);
  const avanzados = actual.anuncios.reduce((s, a) => s + a.avanzados, 0);

  const propios: DatosPropios = {
    conversaciones: t.conversaciones,
    cotizaciones,
    agendadas,
    avanzados,
    ventas: t.ventas,
    cobrado: { valor: t.cobrado, moneda: "CLP" },
  };
  const propiosAntes: DatosPropios = {
    conversaciones: tp.conversaciones,
    cotizaciones: previo.anuncios.reduce((s, a) => s + a.cotizaciones, 0),
    agendadas: previo.anuncios.reduce((s, a) => s + a.agendadas, 0),
    avanzados: previo.anuncios.reduce((s, a) => s + a.avanzados, 0),
    ventas: tp.ventas,
    cobrado: { valor: tp.cobrado, moneda: "CLP" },
  };

  const metricas = armarMetricas({
    plataforma: { impresiones: t.impresiones, clics: t.clics, gasto: { valor: t.gasto, moneda: "CLP" } },
    propios,
    anteriores: {
      plataforma: { impresiones: tp.impresiones, clics: tp.clics, gasto: { valor: tp.gasto, moneda: "CLP" } },
      propios: propiosAntes,
    },
  });

  // Los hallazgos salen del MISMO motor que en producción, alimentado con las
  // filas de atribución que produciría la base.
  const filas: FilaPauta[] = actual.anuncios.map((a) => ({
    clave: a.id,
    anuncioId: a.id,
    titular: a.titular,
    url: a.url,
    tipo: "Anuncio",
    conversaciones: a.conversaciones,
    cotizaciones: a.cotizaciones,
    avanzados: a.avanzados,
    agendadas: a.agendadas,
    ventas: a.ventas,
    pagado: a.cobrado,
    conClid: a.conClid,
    primera: "",
    ultima: "",
  }));
  const resumen: ResumenPauta = {
    avisos: filas.length,
    conversaciones: t.conversaciones,
    agendadas,
    ventas: t.ventas,
    pagado: t.cobrado,
    conClid: filas.reduce((s, f) => s + f.conClid, 0),
    porVenta: t.ventas ? t.conversaciones / t.ventas : 0,
  };
  const senales = hallazgos({
    filas,
    resumen,
    propios,
    propiosAntes,
    periodo: rango.etiqueta.toLowerCase(),
  });

  /**
   * ⚠️ El embudo de la demo se arma MÁS ABAJO con `armarEmbudoAdaptativo`, ya
   * conociendo la variante: el de seis escalones fijos que había acá quedaba
   * con cuatro en cero en las variantes sin conversaciones, que es exactamente
   * la pantalla que esta fase vino a eliminar. `armarEmbudo` se conserva
   * exportado porque es aritmética probada y la usan los tests de la Fase 4.
   */
  const hoy = rango.hasta;
  const creatividades: Creatividad[] = CREATIVIDADES_DEMO.map((c, i) => {
    const anuncio = actual.anuncios.find((a) => a.imagenUrl === c.imagenUrl);
    return {
      ...c,
      creadoEn: `${sumarDias(hoy, -40 + i * 4)}T11:00:00-03:00`,
      actualizadoEn: `${sumarDias(hoy, -3 - i)}T15:30:00-03:00`,
      rendimiento: anuncio
        ? {
            gasto: anuncio.gasto,
            impresiones: anuncio.impresiones,
            clics: anuncio.clics,
            conversaciones: anuncio.conversaciones,
            ventas: anuncio.ventas,
          }
        : null,
    };
  });

  const borradores = borradoresDemo(hoy);
  const campanas: FilaCampana[] = [
    ...actual.campanas,
    ...borradores.map<FilaCampana>((b) => ({
      id: b.id,
      nombre: b.nombre,
      origen: "borrador",
      estado: b.estado,
      objetivo: b.objetivo,
      gasto: null,
      moneda: b.moneda,
      impresiones: null,
      clics: null,
      conversaciones: 0,
      calificados: 0,
      avanzados: 0,
      ventas: 0,
      cobrado: 0,
      costoPorConversacion: null,
      costoPorVenta: null,
      roas: null,
      anuncios: b.creatividadIds.length,
      desde: null,
      hasta: null,
    })),
  ];

  /* ── La variante ──────────────────────────────────────────────────────────
   *
   * Se arma al final, sobre el panorama completo, y SACANDO lo que ese negocio
   * no tendría. Restar es lo correcto y no sumar: si cada variante se
   * construyera aparte, la de Meta podría quedar con un campo que la real no
   * puede llenar, y la demo dejaría de ser una prueba honesta del producto.
   */
  const filasMeta = variante === "google" ? [] : filasMetaDemo(actual.campanas);
  const filasGoogle = variante === "meta" ? [] : filasGoogleDemo();
  const filasAds = [...filasMeta, ...filasGoogle];
  const filasAntes = [
    ...(variante === "google" ? [] : filasMetaDemo(previo.campanas, 0.82)),
    ...(variante === "meta" ? [] : filasGoogleDemo(0.78)),
  ];

  const conConversaciones = variante === "completo";
  const senalesDemo: Senales = detectarSenales({
    hayCuentaPublicitaria: filasAds.length > 0,
    plataformaReportaResultados: filasAds.some((f) => f.resultados && f.resultados.cantidad > 0),
    hayConversacionesAtribuidas: conConversaciones,
    hayIngresosAtribuidos: conConversaciones,
  });

  const filasCampana = filasAds.filter((f) => f.nivel === "campana");
  const embudoDemo = armarEmbudoAdaptativo(
    {
      impresiones: filasCampana.reduce((a, f) => a + f.impresiones, 0),
      clics: filasCampana.reduce((a, f) => a + f.clics, 0),
      resultados: filasCampana.reduce((a, f) => a + (f.resultados?.cantidad ?? 0), 0) || null,
      tipoResultado: filasCampana[0]?.resultados?.tipo ?? null,
      conversaciones: conConversaciones ? t.conversaciones : 0,
      calificados: conConversaciones ? t.calificados : 0,
      avanzados: conConversaciones ? avanzados : 0,
      ventas: conConversaciones ? t.ventas : 0,
    },
    senalesDemo,
  );

  const capacidades = capacidadesDemo(variante);
  const canalesDemo = capacidades.canales
    .map((c) => ({
      ...c,
      conectado:
        c.proveedor === "meta" ? variante !== "google" : variante !== "meta",
    }))
    .filter((c) => c.conectado || variante === "completo");

  const campanasDeLaVariante = campanas.filter((c) => {
    if (c.origen === "borrador") return true;
    if (variante === "meta") return c.proveedor !== "google";
    if (variante === "google") return false;
    return true;
  });
  const campanasGoogle: FilaCampana[] = filasGoogle
    .filter((f) => f.nivel === "campana")
    .map((f) => ({
      id: f.id,
      nombre: f.nombre,
      origen: "google" as const,
      proveedor: "google" as const,
      estado: "activa" as const,
      objetivo: f.objetivo ?? null,
      gasto: f.gasto.valor,
      moneda: f.gasto.moneda,
      impresiones: f.impresiones,
      clics: f.clics,
      conversaciones: 0,
      calificados: 0,
      avanzados: 0,
      ventas: 0,
      cobrado: 0,
      costoPorConversacion: null,
      costoPorVenta: null,
      roas: null,
      anuncios: 0,
      desde: null,
      hasta: null,
      resultados: f.resultados?.cantidad ?? null,
      tipoResultado: f.resultados?.tipo ?? null,
      costoPorResultado: f.resultados?.cantidad ? f.gasto.valor / f.resultados.cantidad : null,
    }));

  return {
    rango,
    demo: true,
    monedaNegocio: MONEDA_DEMO,
    capacidades: { ...capacidades, canales: canalesDemo },
    metaConectada: variante !== "google",
    errorPublicidad: null,
    metricas,
    serie: actual.serie,
    embudo: embudoDemo,
    campanas: [...campanasDeLaVariante, ...campanasGoogle],
    anuncios: conConversaciones
      ? actual.anuncios.sort((a, b) => b.cobrado - a.cobrado || b.conversaciones - a.conversaciones)
      : [],
    leads: conConversaciones ? actual.leads.sort((a, b) => (a.llegoEn < b.llegoEn ? 1 : -1)) : [],
    creatividades,
    borradores,
    hallazgos: conConversaciones ? senales : [],
    senales: senalesDemo,
    profundidad: profundidadDe(senalesDemo),
    canales: canalesDemo,
    fallasCanales: [],
    filasAds,
    analisis: analizarAds({
      filas: filasAds,
      filasAntes,
      periodo: rango.etiqueta.toLowerCase(),
      dias: largo,
    }),
    estado: {
      items: [
        { titulo: "WhatsApp conectado", estado: "ok", detalle: "Las conversaciones entran y se atribuyen solas." },
        { titulo: "Cuenta publicitaria de Meta", estado: "ok", detalle: `${NEGOCIO_DEMO.nombre} · factura en CLP` },
        { titulo: "Devolverle las ventas a Meta", estado: "ok", detalle: "Se envían Lead, Schedule y Purchase con el identificador del clic." },
        { titulo: "Primera creatividad", estado: "ok", detalle: "8 creatividades en el estudio." },
        { titulo: "Primera campaña", estado: "ok", detalle: "5 campañas con datos." },
      ],
      listos: 5,
      total: 5,
      hayAtribucion: true,
    },
    sinAnuncio: conConversaciones ? 41 : 0,
    almacenListo: true,
  };
}

/**
 * El embudo, con la tasa entre escalones. Se comparte con la carga real: es
 * aritmética, no dato.
 */
export function armarEmbudo(v: {
  impresiones: number | null;
  clics: number | null;
  conversaciones: number;
  calificados: number;
  avanzados: number;
  ventas: number;
}): EscalonEmbudo[] {
  const tasa = (a: number | null, b: number | null) =>
    a === null || b === null || !b ? null : (a / b) * 100;
  return [
    {
      clave: "impresiones",
      etiqueta: "Impresiones",
      valor: v.impresiones,
      tasa: null,
      definicion: "Veces que Meta mostró un anuncio. Lo reporta Meta.",
    },
    {
      clave: "clics",
      etiqueta: "Clics",
      valor: v.clics,
      tasa: tasa(v.clics, v.impresiones),
      definicion: "Personas que apretaron el anuncio. Lo reporta Meta.",
    },
    {
      clave: "conversaciones",
      etiqueta: "Conversaciones",
      valor: v.conversaciones,
      tasa: tasa(v.conversaciones, v.clics),
      definicion: "Personas que escribieron por WhatsApp después del clic. Lo contamos nosotros.",
    },
    {
      clave: "calificados",
      etiqueta: "Calificados",
      valor: v.calificados,
      tasa: tasa(v.calificados, v.conversaciones),
      definicion: "Conversaciones que avanzaron a «interesado» o más en el embudo, o que cotizaron, reservaron o compraron.",
    },
    {
      clave: "avanzados",
      etiqueta: "Cotizaron o reservaron",
      valor: v.avanzados,
      tasa: tasa(v.avanzados, v.calificados),
      definicion: "Se envió una cotización o se tomó una hora.",
    },
    {
      clave: "ventas",
      etiqueta: "Ventas",
      valor: v.ventas,
      tasa: tasa(v.ventas, v.conversaciones),
      definicion: "Venta confirmada o cobro pagado por el enlace. La tasa es sobre conversaciones.",
    },
  ];
}

/* ── El contexto comercial de la demostración ───────────────────────────────
   Se escribe a mano, como el resto de la demo, pero con la MISMA forma que
   produce el ensamblado real: si algún día el modelo cambia, esto deja de
   compilar y la demo no puede quedar mostrando una forma que producción ya no
   entrega. Es el mismo criterio con el que la demo se construye restando del
   panorama completo en vez de inventando campos. */
import type { ContextoComercial } from "@/lib/marketing/contextoComercialCore";
import { inferirVoz } from "@/lib/marketing/vozMarca";

/**
 * La demo cobra y gasta en pesos chilenos, y lo dice UNA vez.
 *
 * Es una constante de los datos de demostración, no un supuesto del producto:
 * la regla de la demo es mostrar lo que producción puede mostrar, y producción
 * lee la moneda de la cuenta y del cliente.
 */
const MONEDA_DEMO = "CLP";

export function contextoComercialDemo(): ContextoComercial {
  return {
    negocio: { nombre: NEGOCIO_DEMO.nombre, rubro: NEGOCIO_DEMO.rubro, zona: NEGOCIO_DEMO.ciudad, sitio: null },
    vende: [
      { nombre: "Pendón roller 80×200", tipo: "producto", detalle: "Estructura de aluminio y bolso incluidos.", precio: "$34.990", fuente: "catalogo" },
      { nombre: "Tarjetas de presentación", tipo: "producto", detalle: "Couché 350 g, mate o brillante, 1.000 unidades.", precio: "$19.990", fuente: "catalogo" },
      { nombre: "Gigantografía PVC", tipo: "producto", detalle: "Por metro cuadrado, resistente al agua.", precio: null, fuente: "catalogo" },
      { nombre: "Poleras sublimadas", tipo: "producto", detalle: "Full color, desde 10 unidades.", precio: null, fuente: "catalogo" },
      { nombre: "Stickers troquelados", tipo: "producto", detalle: "Vinilo resistente al agua, 100 unidades.", precio: "$8.990", fuente: "catalogo" },
    ],
    capacidades: ["Diseño gráfico incluido", "Entrega express", "Retiro en local"],
    audiencia: {
      descripcion: "Negocios y organizadores de eventos de Chillán que necesitan material impreso con poca anticipación.",
      rubros: ["comercio", "eventos", "gimnasios", "restaurantes"],
    },
    propuesta: {
      problema: "El material se necesita para una fecha concreta y la imprenta de siempre no alcanza a entregarlo.",
      resultado: "El trabajo sale a tiempo y con el diseño resuelto, sin tener que buscar un diseñador aparte.",
    },
    diferenciadores: ["Diseño incluido cuando se imprime con nosotros", "Entrega en 24 horas en productos de tienda"],
    ofertas: [{ texto: "Pendón roller listo en 24 horas, con diseño incluido.", fuente: "conocimiento", reserva: null }],
    pruebas: [{ texto: "Imprenta en Chillán desde 1998.", fuente: "conocimiento", reserva: null }],
    voz: inferirVoz(NEGOCIO_DEMO.rubro),
    noAfirmar: [
      "Ningún resultado, porcentaje ni cifra de desempeño: no tenemos con qué respaldarlo.",
      "Nada sobre plazos distintos de las 24 horas ya confirmadas.",
    ],
    vocabularioCliente: [
      "Piden «pendón» o «roller» para ferias y eventos, casi siempre con apuro.",
      "Preguntan si el diseño está incluido antes que el precio.",
      "La objeción más común es el plazo, no el precio: «¿alcanza para el sábado?».",
    ],
    fuentes: [
      { rol: "catalogo", titulo: "Qué imprimimos", motivo: "el título anuncia lo que el negocio vende" },
      { rol: "precio", titulo: "Precios fijos de tienda", motivo: "trae precios concretos" },
      { rol: "voz", titulo: "Cómo nombran los clientes los productos", motivo: "describe cómo escribe la marca" },
    ],
    descartados: [
      { titulo: "Datos de transferencia (abono)", motivo: "es información operativa" },
      { titulo: "Preguntas frecuentes", motivo: "es una pregunta frecuente" },
    ],
  };
}
