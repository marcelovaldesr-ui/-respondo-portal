-- ============================================================================
-- 200_portal.sql  ·  Portal del cliente de Respondo
-- ----------------------------------------------------------------------------
-- Aditivo sobre el motor 2.0 (100_empleados_digitales.sql + 101_addendum_n8n.sql).
-- 1) Crea portal_usuarios: mapea el email del dueño (login magic link) -> cliente_id.
-- 2) Siembra 2 clientes DEMO en el schema ed_ para poder mostrar el portal
--    lleno en reuniones mientras no haya un cliente vivo con datos reales.
--
-- Es IDEMPOTENTE: borra y reinserta SOLO los 2 cliente_id de demo (los datos de
-- clientes reales no se tocan). Se puede correr las veces que haga falta.
-- Requiere: haber aplicado antes 100 y 101.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tabla puente de usuarios del portal
-- ---------------------------------------------------------------------------
create table if not exists portal_usuarios (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,                 -- SIEMPRE en minúsculas
  cliente_id  uuid not null references ed_clientes(id) on delete cascade,
  rol         text not null default 'dueno' check (rol in ('dueno','staff')),
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);
create index if not exists idx_portal_usuarios_cliente on portal_usuarios(cliente_id);

-- ---------------------------------------------------------------------------
-- 2) SEED DEMO  (idempotente)
-- ---------------------------------------------------------------------------
-- Borrado en cascada de los 2 clientes demo (limpia empleados, mensajes,
-- escalaciones, conocimiento, métricas, seguimientos y portal_usuarios ligados).
delete from ed_clientes where id in (
  '11111111-1111-1111-1111-111111111111',  -- Estética Aurora
  '22222222-2222-2222-2222-222222222222'   -- Barbería Nogal
);

-- ===== Cliente 1: Estética Aurora (3 empleados: Tino, Beto, Vera) ===========
insert into ed_clientes (id, nombre, rubro, telefono_escalacion, canal_escalacion, destino_leads, activo)
values (
  '11111111-1111-1111-1111-111111111111',
  'Estética Aurora', 'estética y belleza',
  array['+56 9 6111 2233'], 'whatsapp', 'sheets', true
);

insert into ed_empleados (id, cliente_id, rol, nombre_publico, ficha_personalidad, activo) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tino', 'Tino',
   '{"tono":"cercano y profesional","emoji":"moderado","objetivo":"atender consultas y agendar"}', true),
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'rita', 'Beto',
   '{"tono":"amable y proactivo","emoji":"moderado","objetivo":"retomar cotizaciones y reactivar clientes"}', true),
  ('a1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'vera', 'Vera',
   '{"tono":"empático y cuidadoso","emoji":"suave","objetivo":"postventa, NPS y reseñas"}', true);

insert into ed_conocimiento (cliente_id, categoria, titulo, contenido) values
  ('11111111-1111-1111-1111-111111111111', 'precios', 'Precios depilación láser',
   'Depilación láser diodo por sesión: axilas $15.000, piernas completas $45.000, rostro $12.000, bikini $18.000. Pack de 6 sesiones: 15% de descuento. Limpieza facial profunda $25.000. Los precios son referenciales y pueden variar según evaluación.'),
  ('11111111-1111-1111-1111-111111111111', 'servicios', 'Servicios',
   'Depilación láser diodo, limpieza facial profunda, tratamiento antiacné, masaje reductivo. Atención con personal técnico certificado.'),
  ('11111111-1111-1111-1111-111111111111', 'horarios', 'Horario de atención',
   'Lunes a viernes de 10:00 a 19:00, sábados de 10:00 a 14:00. Domingos cerrado. Estamos en Viña del Mar.'),
  ('11111111-1111-1111-1111-111111111111', 'politicas', 'Políticas de reserva',
   'La reserva se confirma con 50% de abono. Cancelación o cambio con mínimo 24 horas de aviso; sin aviso se pierde el abono. No se realiza depilación láser en embarazadas ni sobre piel con bronceado reciente.'),
  ('11111111-1111-1111-1111-111111111111', 'faq', 'Preguntas frecuentes',
   '¿Duele el láser? Es una molestia leve, tipo elástico. ¿Cuántas sesiones necesito? Generalmente entre 6 y 8 según la zona y el tipo de piel; no garantizamos un número exacto, se evalúa caso a caso.');

-- Conversaciones (ed_mensajes). chat_id = número del contacto en WhatsApp.
insert into ed_mensajes (empleado_id, chat_id, rol, texto, creado_en) values
  -- Tino · Camila (termina en escalación por pedido explícito)
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'cliente',  '¡Hola! ¿Cuánto cuesta la depilación láser de axilas?', now() - interval '3 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'empleado', 'Hola Camila 👋 La depilación láser de axilas está en $15.000 por sesión. Si tomas el pack de 6 sesiones tienes un 15% de descuento. ¿Te gustaría reservar?', now() - interval '3 hours' + interval '20 seconds'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'cliente',  'Sí, quiero el pack. Prefiero hablar con alguien para coordinar la agenda', now() - interval '2 hours 55 minutes'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'empleado', '¡Perfecto! Te derivo con una de las chicas del equipo para coordinar tu pack y horario 😊', now() - interval '2 hours 55 minutes' + interval '15 seconds'),
  -- Tino · Rodrigo (resuelto por el bot)
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'cliente',  '¿Atienden los sábados?', now() - interval '1 day 2 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'empleado', 'Sí Rodrigo, los sábados atendemos de 10:00 a 14:00. ¿Qué tratamiento te interesa?', now() - interval '1 day 2 hours' + interval '18 seconds'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'cliente',  'Limpieza facial, gracias', now() - interval '1 day 1 hour 58 minutes'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'empleado', 'Genial, la limpieza facial profunda está en $25.000 y dura unos 50 minutos. ¿Te reservo un sábado?', now() - interval '1 day 1 hour 57 minutes'),
  -- Beto · Fernanda (reactivación de cotización)
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'empleado', 'Hola Fernanda 😊 Hace unos días cotizaste el pack de piernas completas. ¿Te quedó alguna duda o te ayudo a agendar la primera sesión?', now() - interval '5 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cliente',  '¡Ah, hola! Sí, se me había pasado. ¿Qué días tienen disponibles?', now() - interval '4 hours 40 minutes'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'empleado', '¡Genial que lo retomes! Tengo cupos esta semana jueves y viernes en la tarde. ¿Cuál te acomoda?', now() - interval '4 hours 39 minutes'),
  -- Vera · Josefa (postventa / NPS)
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'empleado', 'Hola Josefa 🌟 ¿Cómo quedaste con tu limpieza facial de ayer? Del 1 al 10, ¿qué nota nos pondrías?', now() - interval '20 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'cliente',  '¡Un 10! Quedé feliz con el resultado', now() - interval '19 hours 30 minutes'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'empleado', '¡Nos encanta leer eso! 🙌 ¿Te animarías a dejarnos una reseña en Google? Te dejo el enlace para que sea rapidito.', now() - interval '19 hours 29 minutes');

-- Escalación pendiente (Tino -> humano)
insert into ed_escalaciones (empleado_id, chat_id, trigger, resumen, notificado_a, creado_en, atendida_en) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'pedido_explicito',
   'Camila quiere contratar el pack de 6 sesiones de axilas y pidió hablar con una persona para coordinar agenda y pago.',
   array['+56 9 6111 2233'], now() - interval '2 hours 55 minutes', null);

-- Estado de cada chat
insert into ed_chat_estado (empleado_id, chat_id, modo) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'humano'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'bot'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'bot'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'bot');

-- Seguimiento de Beto (cotización retomada con respuesta)
insert into ed_seguimientos (empleado_id, chat_id, tipo, plantilla_meta, programado_para, enviado_en, respuesta_recibida) values
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cotizacion_sin_respuesta', 'seguimiento_cotizacion',
   now() - interval '5 hours 5 minutes', now() - interval '5 hours', true);

-- Métricas: basal (junio, pre-bot manual) vs mes actual (julio, con Respondo)
insert into ed_metricas (cliente_id, periodo, es_basal, conversaciones, leads_capturados, escalaciones, resueltas_sin_humano_pct, tiempo_respuesta_seg) values
  ('11111111-1111-1111-1111-111111111111', date '2026-06-01', true,  18,  5, 0, null,  5400),
  ('11111111-1111-1111-1111-111111111111', date '2026-07-01', false, 34, 12, 3, 82.50,   25);

-- ===== Cliente 2: Barbería Nogal (1 empleado: Tino) — para probar aislamiento =
insert into ed_clientes (id, nombre, rubro, telefono_escalacion, canal_escalacion, destino_leads, activo)
values (
  '22222222-2222-2222-2222-222222222222',
  'Barbería Nogal', 'barbería',
  array['+56 9 7222 3344'], 'telegram', 'sheets', true
);

insert into ed_empleados (id, cliente_id, rol, nombre_publico, ficha_personalidad, activo) values
  ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'tino', 'Tino',
   '{"tono":"relajado y directo","emoji":"bajo","objetivo":"atender y agendar cortes"}', true);

insert into ed_conocimiento (cliente_id, categoria, titulo, contenido) values
  ('22222222-2222-2222-2222-222222222222', 'precios', 'Precios',
   'Corte de pelo $8.000, arreglo de barba $5.000, combo corte + barba $11.000. Atención por orden de llegada o con reserva.'),
  ('22222222-2222-2222-2222-222222222222', 'horarios', 'Horario',
   'Martes a sábado de 10:00 a 20:00. Domingo y lunes cerrado. Estamos en Valparaíso.');

insert into ed_mensajes (empleado_id, chat_id, rol, texto, creado_en) values
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'cliente',  'hola, cuanto sale el corte?', now() - interval '6 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'empleado', '¡Hola Diego! El corte está en $8.000. Si lo quieres con barba, el combo sale $11.000. ¿Te agendo una hora?', now() - interval '6 hours' + interval '15 seconds'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'cliente',  'dale, mañana en la tarde', now() - interval '5 hours 50 minutes');

insert into ed_chat_estado (empleado_id, chat_id, modo) values
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'bot');

insert into ed_metricas (cliente_id, periodo, es_basal, conversaciones, leads_capturados, escalaciones, resueltas_sin_humano_pct, tiempo_respuesta_seg) values
  ('22222222-2222-2222-2222-222222222222', date '2026-06-01', true,  10, 3, 0, null, 3600),
  ('22222222-2222-2222-2222-222222222222', date '2026-07-01', false, 22, 7, 1, 88.00,  30);

-- ---------------------------------------------------------------------------
-- 3) Usuarios del portal (logins demo). Emails SIEMPRE en minúsculas.
--    Se incluye el email de Marcelo mapeado a Aurora para poder probar el login.
-- ---------------------------------------------------------------------------
insert into portal_usuarios (email, cliente_id, rol) values
  ('marcelo.valdes.r@mail.pucv.cl', '11111111-1111-1111-1111-111111111111', 'dueno'),
  ('aurora@demo.respondo.cl',       '11111111-1111-1111-1111-111111111111', 'dueno'),
  ('nogal@demo.respondo.cl',        '22222222-2222-2222-2222-222222222222', 'dueno');

-- Fin del seed.
