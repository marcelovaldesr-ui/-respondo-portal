/**
 * Siembra datos DEMO (placeholder, nada real) para el cliente "Respondo
 * (interno)" (99999999-9999-9999-9999-999999999999), al que ya está mapeada
 * la cuenta hirespondo@gmail.com. Objetivo: que el portal se vea poblado y
 * presentable para mostrarlo en una demo comercial.
 *
 * Persona elegida: "Clínica Dental Sonrisa" (ficticia) — rubro clínica
 * dental, vertical que ya está validada como prioritaria en la estrategia.
 * Nada de esto toca clientes reales (Impresora Color queda intacto).
 *
 * Idempotente: borra y reinserta solo lo de este cliente_id. Correr las
 * veces que haga falta.
 *
 *   npx tsx _seed_demo_hirespondo.ts
 */
import "./_env";
import { db } from "../lib/db";

const CLIENTE = "99999999-9999-9999-9999-999999999999";
const TINO = "a9999999-0000-0000-0000-000000000001";
const BETO = "a9999999-0000-0000-0000-000000000002";
const VERA = "a9999999-0000-0000-0000-000000000003";

function h(n: number) {
  return new Date(Date.now() - n * 3600_000).toISOString();
}

async function main() {
  const supa = db();

  console.log("1) Renombrando cliente a la persona demo...");
  {
    const { error } = await supa
      .from("ed_clientes")
      .update({
        nombre: "Clínica Dental Sonrisa (demo)",
        rubro: "clínica dental",
        telefono_escalacion: ["+56 9 0000 0000"],
        canal_escalacion: "whatsapp",
        destino_leads: "sheets",
      })
      .eq("id", CLIENTE);
    if (error) throw new Error("update ed_clientes: " + error.message);
  }

  console.log("2) Limpiando datos demo previos (si los hay)...");
  {
    const { data: emps } = await supa.from("ed_empleados").select("id").eq("cliente_id", CLIENTE);
    const ids = (emps ?? []).map((e) => e.id as string);
    if (ids.length) {
      await supa.from("ed_resultados").delete().in("empleado_id", ids);
      await supa.from("ed_escalaciones").delete().in("empleado_id", ids);
      await supa.from("ed_seguimientos").delete().in("empleado_id", ids);
      await supa.from("ed_chat_estado").delete().in("empleado_id", ids);
      await supa.from("ed_mensajes").delete().in("empleado_id", ids);
    }
    await supa.from("ed_contactos").delete().eq("cliente_id", CLIENTE);
    await supa.from("ed_conocimiento").delete().eq("cliente_id", CLIENTE);
    await supa.from("ed_metricas").delete().eq("cliente_id", CLIENTE);
    await supa.from("ed_empleados").delete().eq("cliente_id", CLIENTE);
  }

  console.log("3) Empleados...");
  {
    const { error } = await supa.from("ed_empleados").insert([
      { id: TINO, cliente_id: CLIENTE, rol: "tino", nombre_publico: "Tino", ficha_personalidad: { tono: "cercano y profesional" }, activo: true },
      { id: BETO, cliente_id: CLIENTE, rol: "rita", nombre_publico: "Beto", ficha_personalidad: { tono: "amable y proactivo" }, activo: true },
      { id: VERA, cliente_id: CLIENTE, rol: "vera", nombre_publico: "Vera", ficha_personalidad: { tono: "empático y cuidadoso" }, activo: true },
    ]);
    if (error) throw new Error("ed_empleados: " + error.message);
  }

  console.log("4) Base de conocimiento...");
  {
    const { error } = await supa.from("ed_conocimiento").insert([
      { cliente_id: CLIENTE, categoria: "precios", titulo: "Precios (demo)", contenido: "Limpieza dental (destartraje) $25.000. Blanqueamiento dental $80.000. Consulta de ortodoncia (evaluación) $15.000, se descuenta del tratamiento si se contrata. Urgencia dental (dolor, trauma) $30.000 la consulta. Precios referenciales de ejemplo, no reales." },
      { cliente_id: CLIENTE, categoria: "servicios", titulo: "Servicios (demo)", contenido: "Limpieza y prevención, blanqueamiento, ortodoncia, endodoncia, urgencias dentales. Atención con odontólogos certificados." },
      { cliente_id: CLIENTE, categoria: "horarios", titulo: "Horario de atención (demo)", contenido: "Lunes a viernes de 09:00 a 19:00, sábados de 09:00 a 13:00. Urgencias con cupo limitado los sábados. Domingo cerrado." },
      { cliente_id: CLIENTE, categoria: "politicas", titulo: "Políticas de reserva (demo)", contenido: "La hora se confirma con el nombre completo del paciente. Cambios o cancelaciones con mínimo 12 horas de aviso." },
      { cliente_id: CLIENTE, categoria: "faq", titulo: "Preguntas frecuentes (demo)", contenido: "¿Duele la limpieza? Es una molestia leve normalmente. ¿Cuánto dura el blanqueamiento? El efecto dura entre 6 y 12 meses según hábitos. ¿Atienden urgencias el mismo día? Sí, sujeto a disponibilidad de cupo." },
    ]);
    if (error) throw new Error("ed_conocimiento: " + error.message);
  }

  console.log("5) Contactos (con etiquetas y etapa de embudo)...");
  const contactos = [
    { chat_id: "56990099001", nombre: "Fernanda Rojas", etiqueta: "lead", etiquetas: ["posible_comprador", "cotizacion"], etapa: "cotizado" },
    { chat_id: "56990099002", nombre: "Ignacio Paredes", etiqueta: "cliente", etiquetas: ["agendado"], etapa: "ganado" },
    { chat_id: "56990099003", nombre: "Camila Torres", etiqueta: "lead", etiquetas: ["posible_comprador", "necesita_atencion"], etapa: "interesado" },
    { chat_id: "56990099004", nombre: "Rodrigo Muñoz", etiqueta: "cliente", etiquetas: ["reclamo"], etapa: "ganado" },
    { chat_id: "56990099005", nombre: "Paula Sepúlveda", etiqueta: "cliente", etiquetas: ["agendado"], etapa: "ganado" },
    { chat_id: "56990099006", nombre: "Diego Salazar", etiqueta: "cliente", etiquetas: [], etapa: "ganado" },
    { chat_id: "56990099007", nombre: "Javiera Contreras", etiqueta: "lead", etiquetas: [], etapa: "nuevo" },
  ];
  {
    const { error } = await supa.from("ed_contactos").insert(
      contactos.map((c) => ({
        cliente_id: CLIENTE,
        chat_id: c.chat_id,
        nombre: c.nombre,
        telefono: "+" + c.chat_id,
        etiqueta: c.etiqueta,
        etiquetas: c.etiquetas,
        etapa: c.etapa,
        etapa_manual: false,
      })),
    );
    if (error) throw new Error("ed_contactos: " + error.message);
  }

  console.log("6) Mensajes (esto dispara el trigger que actualiza ed_contactos.ultimo_mensaje_*)...");
  const mensajes: { empleado_id: string; chat_id: string; rol: "cliente" | "empleado" | "humano"; texto: string; creado_en: string }[] = [
    // Fernanda — cotización limpieza + blanqueamiento
    { empleado_id: TINO, chat_id: "56990099001", rol: "cliente", texto: "Hola! cuánto cuesta una limpieza dental?", creado_en: h(5.0) },
    { empleado_id: TINO, chat_id: "56990099001", rol: "empleado", texto: "¡Hola Fernanda! 👋 La limpieza dental (destartraje) está en $25.000. ¿Te gustaría agendar una hora?", creado_en: h(4.99) },
    { empleado_id: TINO, chat_id: "56990099001", rol: "cliente", texto: "Y el blanqueamiento? me interesan los dos", creado_en: h(4.9) },
    { empleado_id: TINO, chat_id: "56990099001", rol: "empleado", texto: "El blanqueamiento dental está en $80.000, dura entre 6 y 12 meses según tus hábitos. Haciendo los dos juntos te puedo coordinar el mismo día si quieres 😊", creado_en: h(4.89) },
    { empleado_id: TINO, chat_id: "56990099001", rol: "cliente", texto: "perfecto, lo voy a pensar y te aviso", creado_en: h(4.7) },

    // Ignacio — urgencia, agenda hora
    { empleado_id: TINO, chat_id: "56990099002", rol: "cliente", texto: "hola tengo un dolor de muela fuerte, pueden verme hoy?", creado_en: h(3.0) },
    { empleado_id: TINO, chat_id: "56990099002", rol: "empleado", texto: "Hola Ignacio, lamento el dolor 🙁 Sí, atendemos urgencias con cupo limitado. La consulta de urgencia es $30.000. ¿Puedes venir hoy a las 17:00?", creado_en: h(2.99) },
    { empleado_id: TINO, chat_id: "56990099002", rol: "cliente", texto: "si, a esa hora puedo", creado_en: h(2.9) },
    { empleado_id: TINO, chat_id: "56990099002", rol: "empleado", texto: "Listo Ignacio, te dejo agendado hoy a las 17:00 para urgencia dental 🦷", creado_en: h(2.89) },

    // Camila — ortodoncia, pide hablar con alguien
    { empleado_id: TINO, chat_id: "56990099003", rol: "cliente", texto: "hola, quiero info de ortodoncia para mi hija", creado_en: h(20.0) },
    { empleado_id: TINO, chat_id: "56990099003", rol: "empleado", texto: "Hola Camila 😊 La evaluación de ortodoncia cuesta $15.000 y se descuenta del tratamiento si se contrata. ¿Qué edad tiene tu hija?", creado_en: h(19.99) },
    { empleado_id: TINO, chat_id: "56990099003", rol: "cliente", texto: "12 años, prefiero hablar con alguien para que me expliquen bien las opciones y precios de tratamiento completo", creado_en: h(19.9) },
    { empleado_id: TINO, chat_id: "56990099003", rol: "empleado", texto: "Por supuesto, te derivo con el equipo para que te expliquen las alternativas de tratamiento con calma 🙌", creado_en: h(19.89) },

    // Rodrigo — reclamo
    { empleado_id: TINO, chat_id: "56990099004", rol: "cliente", texto: "hola, me hice la limpieza el lunes y me han sangrado las encías desde entonces, no me parece normal", creado_en: h(2.0) },
    { empleado_id: TINO, chat_id: "56990099004", rol: "empleado", texto: "Hola Rodrigo, lamento mucho lo que estás pasando 😔 Le aviso ahora mismo al equipo para que te contacten y revisen tu caso.", creado_en: h(1.99) },
    { empleado_id: TINO, chat_id: "56990099004", rol: "cliente", texto: "ya, espero que me llamen porque no quiero que se me infecte", creado_en: h(1.9) },

    // Paula — reactivación por Beto
    { empleado_id: BETO, chat_id: "56990099005", rol: "empleado", texto: "Hola Paula 😊 Ya pasaron 6 meses desde tu última limpieza. ¿Te agendo tu control?", creado_en: h(6.0) },
    { empleado_id: BETO, chat_id: "56990099005", rol: "cliente", texto: "ah verdad! si dale, esta semana si se puede", creado_en: h(5.7) },
    { empleado_id: BETO, chat_id: "56990099005", rol: "empleado", texto: "Perfecto, te dejo agendada el jueves a las 11:00 🦷", creado_en: h(5.69) },

    // Diego — encuesta postventa por Vera, positiva
    { empleado_id: VERA, chat_id: "56990099006", rol: "empleado", texto: "Hola Diego 🌟 ¿Cómo te fue con tu blanqueamiento? Del 1 al 10, ¿qué nota nos pondrías?", creado_en: h(15.0) },
    { empleado_id: VERA, chat_id: "56990099006", rol: "cliente", texto: "un 9! quedaron bien blancos", creado_en: h(14.7) },
    { empleado_id: VERA, chat_id: "56990099006", rol: "empleado", texto: "¡Nos alegra mucho leer eso! 🙌 ¿Nos dejarías una reseña en Google?", creado_en: h(14.69) },

    // Javiera — lead nuevo, sin responder aún
    { empleado_id: TINO, chat_id: "56990099007", rol: "cliente", texto: "Hola", creado_en: h(0.2) },
  ];
  {
    const { error } = await supa.from("ed_mensajes").insert(mensajes);
    if (error) throw new Error("ed_mensajes: " + error.message);
  }

  console.log("7) Estado de chat (bot/humano)...");
  {
    const { error } = await supa.from("ed_chat_estado").insert([
      { empleado_id: TINO, chat_id: "56990099001", modo: "bot" },
      { empleado_id: TINO, chat_id: "56990099002", modo: "bot" },
      { empleado_id: TINO, chat_id: "56990099003", modo: "humano" },
      { empleado_id: TINO, chat_id: "56990099004", modo: "humano" },
      { empleado_id: BETO, chat_id: "56990099005", modo: "bot" },
      { empleado_id: VERA, chat_id: "56990099006", modo: "bot" },
      { empleado_id: TINO, chat_id: "56990099007", modo: "bot" },
    ]);
    if (error) throw new Error("ed_chat_estado: " + error.message);
  }

  console.log("8) Resultados...");
  {
    const { error } = await supa.from("ed_resultados").insert([
      { empleado_id: TINO, chat_id: "56990099001", tipo: "lead_capturado", valor_clp: null, creado_en: h(4.99) },
      { empleado_id: TINO, chat_id: "56990099001", tipo: "cotizacion_enviada", valor_clp: 105000, creado_en: h(4.89) },
      { empleado_id: TINO, chat_id: "56990099002", tipo: "agendamiento", valor_clp: 30000, creado_en: h(2.89) },
      { empleado_id: TINO, chat_id: "56990099003", tipo: "lead_capturado", valor_clp: null, creado_en: h(19.89) },
      { empleado_id: BETO, chat_id: "56990099005", tipo: "cliente_reactivado", valor_clp: null, creado_en: h(5.69) },
      { empleado_id: BETO, chat_id: "56990099005", tipo: "agendamiento", valor_clp: 25000, creado_en: h(5.69) },
      { empleado_id: VERA, chat_id: "56990099006", tipo: "encuesta_respondida", valor_clp: null, creado_en: h(14.7) },
      { empleado_id: VERA, chat_id: "56990099006", tipo: "resena_conseguida", valor_clp: null, creado_en: h(14.69) },
    ]);
    if (error) throw new Error("ed_resultados: " + error.message);
  }

  console.log("9) Escalaciones...");
  {
    const { error } = await supa.from("ed_escalaciones").insert([
      { empleado_id: TINO, chat_id: "56990099003", trigger: "pedido_explicito", resumen: "Camila pide hablar con alguien para conocer opciones y precios de tratamiento de ortodoncia completo para su hija de 12 años.", notificado_a: ["+56 9 0000 0000"], creado_en: h(19.89), atendida_en: null },
      { empleado_id: TINO, chat_id: "56990099004", trigger: "sentimiento_negativo", resumen: "Rodrigo reporta sangrado de encías desde la limpieza del lunes. Requiere contacto del equipo a la brevedad.", notificado_a: ["+56 9 0000 0000"], creado_en: h(1.99), atendida_en: null },
    ]);
    if (error) throw new Error("ed_escalaciones: " + error.message);
  }

  console.log("10) Seguimientos...");
  {
    const { error } = await supa.from("ed_seguimientos").insert([
      { empleado_id: BETO, chat_id: "56990099005", tipo: "cliente_inactivo", plantilla_meta: "seguimiento_cotizacion", programado_para: h(6.1), enviado_en: h(6.0), respuesta_recibida: true },
    ]);
    if (error) throw new Error("ed_seguimientos: " + error.message);
  }

  console.log("11) Métricas...");
  {
    const { error } = await supa.from("ed_metricas").insert([
      { cliente_id: CLIENTE, periodo: "2026-07-01", es_basal: true, conversaciones: 9, leads_capturados: 3, escalaciones: 1, resueltas_sin_humano_pct: null, tiempo_respuesta_seg: 4200 },
      { cliente_id: CLIENTE, periodo: "2026-08-01", es_basal: false, conversaciones: 7, leads_capturados: 3, escalaciones: 2, resueltas_sin_humano_pct: 71.4, tiempo_respuesta_seg: 22 },
    ]);
    if (error) throw new Error("ed_metricas: " + error.message);
  }

  console.log("\n✅ Listo. Entra al portal con hirespondo@gmail.com y revisa el cliente 'Clínica Dental Sonrisa (demo)'.");
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
