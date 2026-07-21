-- ============================================================================
-- 201_resultados_y_seed.sql  ·  Portal del cliente de Respondo
-- ----------------------------------------------------------------------------
-- 1) ed_contactos: nombre del contacto por chat (ed_mensajes solo guarda el
--    numero, sin esto la lista de conversaciones muestra puros telefonos).
-- 2) ed_resultados: registro de RESULTADOS del trabajo de cada empleado
--    (reseña conseguida, venta recuperada, agendamiento...). Sin esta tabla
--    no se pueden mostrar los numeros que mejor venden a Beto y Vera.
-- 3) Re-siembra los 2 clientes demo con volumen realista (reemplaza el seed
--    de 200_portal.sql, que quedo corto para demos).
--
-- Requiere 100, 101 y 200 aplicados. Es IDEMPOTENTE: borra y reinserta solo
-- los 2 cliente_id de demo. Correr las veces que haga falta.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Tablas nuevas
-- ---------------------------------------------------------------------------
create table if not exists ed_contactos (
  id             uuid primary key default gen_random_uuid(),
  cliente_id     uuid not null references ed_clientes(id) on delete cascade,
  chat_id        text not null,
  nombre         text,
  telefono       text,
  email          text,
  etiqueta       text not null default 'lead' check (etiqueta in ('lead','cliente','proveedor','otro')),
  notas          text,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (cliente_id, chat_id)
);
create index if not exists idx_ed_contactos_cliente on ed_contactos(cliente_id);

create table if not exists ed_resultados (
  id            uuid primary key default gen_random_uuid(),
  empleado_id   uuid not null references ed_empleados(id) on delete cascade,
  chat_id       text not null,
  tipo          text not null check (tipo in (
                  'lead_capturado','cotizacion_enviada','agendamiento','venta_confirmada',
                  'cotizacion_retomada','cliente_reactivado','venta_recuperada',
                  'encuesta_respondida','resena_conseguida','cliente_molesto')),
  valor_clp     integer,
  nota          jsonb not null default '{}',
  detectado_por text not null default 'bot' check (detectado_por in ('bot','humano','sistema')),
  creado_en     timestamptz not null default now()
);
create index if not exists idx_ed_resultados_emp on ed_resultados(empleado_id, creado_en desc);
create index if not exists idx_ed_resultados_tipo on ed_resultados(tipo);

-- ---------------------------------------------------------------------------
-- 2) Re-siembra demo (borra en cascada y reinserta)
-- ---------------------------------------------------------------------------
delete from ed_clientes where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into ed_clientes (id, nombre, rubro, telefono_escalacion, canal_escalacion, destino_leads, activo) values
  ('11111111-1111-1111-1111-111111111111', 'Estética Aurora', 'estética y belleza', array['+56 9 6111 2233'], 'whatsapp', 'sheets', true),
  ('22222222-2222-2222-2222-222222222222', 'Barbería Nogal', 'barbería', array['+56 9 7222 3344'], 'telegram', 'sheets', true);

insert into ed_empleados (id, cliente_id, rol, nombre_publico, ficha_personalidad, activo) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'tino', 'Tino', '{"tono":"cercano y profesional"}', true),
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'rita', 'Beto', '{"tono":"amable y proactivo"}', true),
  ('a1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'vera', 'Vera', '{"tono":"empático y cuidadoso"}', true),
  ('a2222222-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'tino', 'Tino', '{"tono":"relajado y directo"}', true);

insert into ed_conocimiento (cliente_id, categoria, titulo, contenido) values
  ('11111111-1111-1111-1111-111111111111', 'precios', 'Precios depilación láser', 'Depilación láser diodo por sesión: axilas $15.000, piernas completas $45.000, rostro $12.000, bikini $18.000. Pack de 6 sesiones: 15% de descuento. Limpieza facial profunda $25.000. Los precios son referenciales y pueden variar según evaluación.'),
  ('11111111-1111-1111-1111-111111111111', 'servicios', 'Servicios', 'Depilación láser diodo, limpieza facial profunda, tratamiento antiacné, masaje reductivo. Atención con personal técnico certificado.'),
  ('11111111-1111-1111-1111-111111111111', 'horarios', 'Horario de atención', 'Lunes a viernes de 10:00 a 19:00, sábados de 10:00 a 14:00. Domingos cerrado. Estamos en Viña del Mar.'),
  ('11111111-1111-1111-1111-111111111111', 'politicas', 'Políticas de reserva', 'La reserva se confirma con 50% de abono. Cancelación o cambio con mínimo 24 horas de aviso; sin aviso se pierde el abono. No se realiza depilación láser en embarazadas ni sobre piel con bronceado reciente.'),
  ('11111111-1111-1111-1111-111111111111', 'faq', 'Preguntas frecuentes', '¿Duele el láser? Es una molestia leve, tipo elástico. ¿Cuántas sesiones necesito? Generalmente entre 6 y 8 según la zona y el tipo de piel; no garantizamos un número exacto. Hay que llegar rasurada, sin cera ni depiladora las últimas 3 semanas y sin bronceado reciente.'),
  ('22222222-2222-2222-2222-222222222222', 'precios', 'Precios', 'Corte de pelo $8.000, arreglo de barba $5.000, combo corte + barba $11.000. Atención por orden de llegada o con reserva.'),
  ('22222222-2222-2222-2222-222222222222', 'horarios', 'Horario', 'Martes a sábado de 10:00 a 20:00. Domingo y lunes cerrado. Estamos en Valparaíso.');

insert into ed_contactos (cliente_id, chat_id, nombre, telefono, etiqueta) values
  ('11111111-1111-1111-1111-111111111111', '56990011001', 'Camila Reyes', '+56990011001', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011002', 'Rodrigo Pérez', '+56990011002', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011003', 'Antonia Vera', '+56990011003', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990011004', 'Ignacio Fuentes', '+56990011004', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011005', 'Valentina Soto', '+56990011005', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990011006', 'Josefina Cruz', '+56990011006', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011007', 'Paula Miranda', '+56990011007', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011008', 'Martín Ríos', '+56990011008', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011009', 'Constanza Díaz', '+56990011009', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990011010', 'Felipe Navarro', '+56990011010', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990011011', 'Daniela Cortés', '+56990011011', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990011012', 'Camila Bravo', '+56990011012', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990022001', 'Fernanda Soto', '+56990022001', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990022002', 'Sofía Herrera', '+56990022002', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990022003', 'Javiera Muñoz', '+56990022003', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990022004', 'Trinidad Rojas', '+56990022004', 'lead'),
  ('11111111-1111-1111-1111-111111111111', '56990022005', 'Macarena Silva', '+56990022005', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990033001', 'Josefa Lagos', '+56990033001', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990033002', 'Isidora Peña', '+56990033002', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990033003', 'Catalina Ruiz', '+56990033003', 'cliente'),
  ('11111111-1111-1111-1111-111111111111', '56990033004', 'Amanda Vidal', '+56990033004', 'cliente'),
  ('22222222-2222-2222-2222-222222222222', '56990044001', 'Diego Fuentes', '+56990044001', 'lead'),
  ('22222222-2222-2222-2222-222222222222', '56990044002', 'Cristóbal Lara', '+56990044002', 'lead'),
  ('22222222-2222-2222-2222-222222222222', '56990044003', 'Matías Soto', '+56990044003', 'cliente');

insert into ed_mensajes (empleado_id, chat_id, rol, texto, creado_en) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'cliente', '¡Hola! ¿Cuánto cuesta la depilación láser de axilas?', now() - interval '3.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'empleado', 'Hola Camila 👋 La depilación láser de axilas está en $15.000 por sesión. Si tomas el pack de 6 sesiones tienes un 15% de descuento. ¿Te gustaría reservar?', now() - interval '2.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'cliente', 'Sí, quiero el pack. Prefiero hablar con alguien para coordinar la agenda', now() - interval '2.92 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'empleado', '¡Perfecto! Te derivo con una de las chicas del equipo para coordinar tu pack y horario 😊', now() - interval '2.91 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'cliente', '¿Atienden los sábados?', now() - interval '26.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'empleado', 'Sí Rodrigo, los sábados atendemos de 10:00 a 14:00. ¿Qué tratamiento te interesa?', now() - interval '25.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'cliente', 'Limpieza facial, gracias', now() - interval '25.9 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'empleado', 'Genial, la limpieza facial profunda está en $25.000 y dura unos 50 minutos. ¿Te reservo un sábado?', now() - interval '25.89 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'cliente', 'Sí, el sábado 25 a las 11', now() - interval '25.5 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'empleado', 'Listo Rodrigo, te dejo agendado el sábado 25 a las 11:00 para limpieza facial. Te llega la confirmación por acá 🗓️', now() - interval '25.49 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'cliente', 'hola, el láser duele mucho?', now() - interval '48.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'empleado', 'Hola Antonia 😊 Es una molestia leve, tipo elástico. La mayoría lo tolera sin problema. ¿Qué zona te interesa tratar?', now() - interval '47.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'cliente', 'piernas completas', now() - interval '47.8 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'empleado', 'Piernas completas está en $45.000 por sesión, y con el pack de 6 sesiones tienes 15% de descuento. Generalmente se necesitan entre 6 y 8 sesiones según el tipo de piel.', now() - interval '47.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'cliente', 'Buenas, hacen tratamiento para el acné?', now() - interval '50.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'empleado', 'Hola Ignacio 👋 Sí, tenemos tratamiento antiacné. Se evalúa en la primera sesión para definir el plan. ¿Te gustaría agendar una evaluación?', now() - interval '49.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'cliente', 'cuanto sale la evaluación?', now() - interval '49.7 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'empleado', 'La evaluación va incluida en la primera sesión. Para darte el precio exacto del tratamiento necesito que te vea la especialista, porque depende del caso.', now() - interval '49.69 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'cliente', 'Hola! quiero cambiar mi hora del jueves', now() - interval '30.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'empleado', 'Hola Valentina 😊 Claro. ¿Para qué día te acomoda cambiarla?', now() - interval '29.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'cliente', 'para el viernes en la tarde si se puede', now() - interval '29.8 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'empleado', 'Perfecto, te muevo al viernes a las 16:30. Recuerda que los cambios con menos de 24 horas de aviso no se pueden reagendar, pero en tu caso alcanzamos justo 👍', now() - interval '29.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011006', 'cliente', 'precio bikini?', now() - interval '52.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011006', 'empleado', 'Hola Josefina 👋 Bikini está en $18.000 por sesión. Con el pack de 6 sesiones tienes 15% de descuento. ¿Te reservo una hora?', now() - interval '51.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011007', 'cliente', 'hola, estoy embarazada de 4 meses, puedo hacerme el laser?', now() - interval '8.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011007', 'empleado', 'Hola Paula 😊 Gracias por contarnos. Por seguridad no realizamos depilación láser durante el embarazo. Te derivo con el equipo para que te expliquen bien las alternativas y te agendemos para después.', now() - interval '7.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011008', 'cliente', 'dónde están ubicados?', now() - interval '54.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011008', 'empleado', 'Estamos en Viña del Mar 📍 Atendemos de lunes a viernes de 10:00 a 19:00 y sábados de 10:00 a 14:00. ¿Te gustaría agendar?', now() - interval '53.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011008', 'cliente', 'gracias, lo voy a pensar', now() - interval '53.5 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011008', 'empleado', 'Sin problema Martín, quedo atento por si te decides 😊', now() - interval '53.49 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'cliente', 'Hola, cuántas sesiones necesito para axilas?', now() - interval '56.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'empleado', 'Hola Constanza 👋 Generalmente entre 6 y 8 sesiones, pero depende del tipo de piel y del vello. No te puedo garantizar un número exacto sin evaluación.', now() - interval '55.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'cliente', 'ya, y me sirve el pack entonces', now() - interval '55.7 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'empleado', 'Sí, el pack de 6 sesiones te sale con 15% de descuento: $76.500 en total en vez de $90.000. Si necesitas más sesiones se cotizan aparte.', now() - interval '55.69 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'cliente', 'atienden hombres?', now() - interval '58.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'empleado', 'Hola Felipe 😊 Sí, atendemos a todos. ¿Qué zona te interesa?', now() - interval '57.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'cliente', 'espalda', now() - interval '57.8 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'empleado', 'Para espalda necesito que te vea la especialista para cotizarte bien, porque el precio varía según la extensión. ¿Te agendo una evaluación?', now() - interval '57.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'cliente', 'dale', now() - interval '57.6 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'empleado', 'Listo, ¿te acomoda el martes a las 18:00?', now() - interval '57.59 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011011', 'cliente', 'tengo que ir depilada o no?', now() - interval '60.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011011', 'empleado', 'Hola Daniela 👋 Tienes que llegar rasurada, sin cera ni depiladora en las últimas 3 semanas. Y sin bronceado reciente 🙌', now() - interval '59.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011012', 'cliente', 'me pueden hacer un descuento mayor si llevo 2 packs?', now() - interval '12.0 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011012', 'empleado', 'Hola Camila 😊 El descuento que manejo es el 15% del pack de 6 sesiones. Para una condición especial por dos packs prefiero que lo veas con el equipo, te derivo.', now() - interval '11.99 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'empleado', 'Hola Fernanda 😊 Hace unos días cotizaste el pack de piernas completas. ¿Te quedó alguna duda o te ayudo a agendar la primera sesión?', now() - interval '5.0 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cliente', '¡Ah, hola! Sí, se me había pasado. ¿Qué días tienen disponibles?', now() - interval '4.7 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'empleado', '¡Genial que lo retomes! Tengo cupos esta semana jueves y viernes en la tarde. ¿Cuál te acomoda?', now() - interval '4.69 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cliente', 'el jueves', now() - interval '4.5 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'empleado', 'Listo, te agendo el jueves. Te llega la confirmación 🗓️', now() - interval '4.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'empleado', 'Hola Sofía 👋 Vi que consultaste por limpieza facial hace un par de semanas. ¿Sigues interesada? Tengo cupos esta semana.', now() - interval '28.0 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'cliente', 'hola! si, pero ando corta de plata este mes', now() - interval '27.6 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'empleado', 'Te entiendo perfecto 😊 Quedo atento cuando te acomode, sin apuro. Cualquier cosa me escribes.', now() - interval '27.59 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'empleado', 'Hola Javiera 😊 Hace un tiempo que no te vemos por acá. ¿Te gustaría retomar tus sesiones de láser?', now() - interval '34.0 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'cliente', 'si! justo estaba pensando en eso', now() - interval '33.7 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'empleado', '¡Qué bueno! ¿Te acomoda esta semana o la próxima?', now() - interval '33.69 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'cliente', 'esta semana mejor', now() - interval '33.5 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'empleado', 'Perfecto, te dejo agendada. Bienvenida de vuelta 🙌', now() - interval '33.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'empleado', 'Hola Trinidad 👋 Te escribo porque quedó pendiente tu cotización de rostro. ¿Te ayudo a agendar?', now() - interval '40.0 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'cliente', 'ya no gracias, me hice el tratamiento en otro lado', now() - interval '39.6 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'empleado', 'Entendido Trinidad, gracias por avisar 😊 Quedamos a disposición si nos necesitas más adelante.', now() - interval '39.59 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'empleado', 'Hola Macarena 😊 Vi que terminaste tu pack de axilas. ¿Quieres que te reserve las sesiones de mantención?', now() - interval '44.0 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'cliente', 'si porfa, para el proximo mes', now() - interval '43.7 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'empleado', 'Anotado, te contacto a fin de mes para coordinar la fecha 👍', now() - interval '43.69 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'empleado', 'Hola Josefa 🌟 ¿Cómo quedaste con tu limpieza facial de ayer? Del 1 al 10, ¿qué nota nos pondrías?', now() - interval '20.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'cliente', '¡Un 10! Quedé feliz con el resultado', now() - interval '19.5 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'empleado', '¡Nos encanta leer eso! 🙌 ¿Te animarías a dejarnos una reseña en Google? Te dejo el enlace para que sea rapidito.', now() - interval '19.49 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'cliente', 'listo, ya la dejé', now() - interval '19.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'empleado', 'Hola Isidora 🌟 ¿Cómo te fue con tu sesión de láser? Del 1 al 10, ¿qué nota nos pondrías?', now() - interval '32.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'cliente', 'un 9, todo bien', now() - interval '31.6 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'empleado', '¡Gracias Isidora! 😊 ¿Nos dejarías una reseña en Google? Ayuda un montón a que otras personas nos conozcan.', now() - interval '31.59 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'cliente', 'dale, ahora la escribo', now() - interval '31.2 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'empleado', 'Hola Catalina 🌟 ¿Cómo quedaste con tu sesión del lunes? Del 1 al 10, ¿qué nota nos pondrías?', now() - interval '16.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'cliente', 'un 3, quedé con la piel irritada y nadie me avisó que podía pasar', now() - interval '15.6 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'empleado', 'Lamento mucho que te haya pasado eso, Catalina 😔 Le aviso ahora mismo al equipo para que te contacten y te ayuden.', now() - interval '15.59 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033004', 'empleado', 'Hola Amanda 🌟 ¿Cómo te fue con tu tratamiento? Del 1 al 10, ¿qué nota nos pondrías?', now() - interval '38.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033004', 'cliente', '8', now() - interval '37.6 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033004', 'empleado', '¡Gracias por responder Amanda! 😊 Si hay algo que podamos mejorar, cuéntanos, lo leemos todo.', now() - interval '37.59 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'cliente', 'hola, cuanto sale el corte?', now() - interval '6.0 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'empleado', '¡Hola Diego! El corte está en $8.000. Si lo quieres con barba, el combo sale $11.000. ¿Te agendo una hora?', now() - interval '5.99 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'cliente', 'dale, mañana en la tarde', now() - interval '5.8 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044002', 'cliente', 'atienden domingo?', now() - interval '22.0 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044002', 'empleado', 'Hola Cristóbal 👋 Los domingos y lunes estamos cerrados. Atendemos de martes a sábado de 10:00 a 20:00.', now() - interval '21.99 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'cliente', 'hay que reservar o llego no mas?', now() - interval '42.0 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'empleado', 'Puedes llegar por orden de llegada o reservar, como prefieras 😊 Reservando te aseguras la hora.', now() - interval '41.99 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'cliente', 'reservo entonces, jueves 7pm', now() - interval '41.7 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'empleado', 'Listo Matías, te dejo agendado el jueves a las 19:00 ✂️', now() - interval '41.69 hours');

insert into ed_chat_estado (empleado_id, chat_id, modo) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'humano'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011006', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011007', 'humano'),
  ('a1111111-0000-0000-0000-000000000001', '56990011008', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011011', 'bot'),
  ('a1111111-0000-0000-0000-000000000001', '56990011012', 'humano'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'bot'),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'bot'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'bot'),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'bot'),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'bot'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'bot'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'bot'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'humano'),
  ('a1111111-0000-0000-0000-000000000003', '56990033004', 'bot'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'bot'),
  ('a2222222-0000-0000-0000-000000000001', '56990044002', 'bot'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'bot');

insert into ed_resultados (empleado_id, chat_id, tipo, valor_clp, creado_en) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'lead_capturado', null, now() - interval '2.91 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'cotizacion_enviada', 76500, now() - interval '2.91 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'lead_capturado', null, now() - interval '25.49 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011002', 'agendamiento', 25000, now() - interval '25.49 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'lead_capturado', null, now() - interval '47.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011003', 'cotizacion_enviada', 229500, now() - interval '47.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011004', 'lead_capturado', null, now() - interval '49.69 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011005', 'agendamiento', null, now() - interval '29.79 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011006', 'lead_capturado', null, now() - interval '51.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011006', 'cotizacion_enviada', 91800, now() - interval '51.99 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'lead_capturado', null, now() - interval '55.69 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011009', 'cotizacion_enviada', 76500, now() - interval '55.69 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011010', 'lead_capturado', null, now() - interval '57.59 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011012', 'lead_capturado', null, now() - interval '11.99 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cotizacion_retomada', 229500, now() - interval '4.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'venta_recuperada', 229500, now() - interval '4.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'agendamiento', null, now() - interval '4.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'cotizacion_retomada', 25000, now() - interval '27.59 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'cliente_reactivado', null, now() - interval '33.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'venta_recuperada', 45000, now() - interval '33.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'agendamiento', null, now() - interval '33.49 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'cotizacion_retomada', 12000, now() - interval '39.59 hours'),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'cliente_reactivado', null, now() - interval '43.69 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'encuesta_respondida', null, now() - interval '19.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033001', 'resena_conseguida', null, now() - interval '19.0 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'encuesta_respondida', null, now() - interval '31.2 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033002', 'resena_conseguida', null, now() - interval '31.2 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'encuesta_respondida', null, now() - interval '15.59 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'cliente_molesto', null, now() - interval '15.59 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033004', 'encuesta_respondida', null, now() - interval '37.59 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'lead_capturado', null, now() - interval '5.8 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044001', 'agendamiento', 8000, now() - interval '5.8 hours'),
  ('a2222222-0000-0000-0000-000000000001', '56990044003', 'agendamiento', 11000, now() - interval '41.69 hours');

insert into ed_escalaciones (empleado_id, chat_id, trigger, resumen, notificado_a, creado_en, atendida_en) values
  ('a1111111-0000-0000-0000-000000000001', '56990011001', 'pedido_explicito', 'Camila quiere contratar el pack de 6 sesiones de axilas y pidió hablar con una persona para coordinar agenda y pago.', array['+56 9 6111 2233'], now() - interval '2.91 hours', null),
  ('a1111111-0000-0000-0000-000000000001', '56990011007', 'palabra_clave', 'Paula consultó por depilación láser estando embarazada de 4 meses. El bot no agendó y derivó por política de seguridad.', array['+56 9 6111 2233'], now() - interval '7.99 hours', now() - interval '7.5 hours'),
  ('a1111111-0000-0000-0000-000000000001', '56990011012', 'monto_alto', 'Camila pregunta por descuento adicional llevando 2 packs. El bot no ofreció descuentos fuera de política y derivó.', array['+56 9 6111 2233'], now() - interval '11.99 hours', now() - interval '11.5 hours'),
  ('a1111111-0000-0000-0000-000000000003', '56990033003', 'sentimiento_negativo', 'Catalina puso nota 3: piel irritada tras la sesión del lunes y dice que no le advirtieron. Requiere contacto del equipo.', array['+56 9 6111 2233'], now() - interval '15.59 hours', now() - interval '15.0 hours');

insert into ed_seguimientos (empleado_id, chat_id, tipo, plantilla_meta, programado_para, enviado_en, respuesta_recibida) values
  ('a1111111-0000-0000-0000-000000000002', '56990022001', 'cotizacion_sin_respuesta', 'seguimiento_cotizacion', now() - interval '5.1 hours', now() - interval '5.0 hours', true),
  ('a1111111-0000-0000-0000-000000000002', '56990022002', 'cotizacion_sin_respuesta', 'seguimiento_cotizacion', now() - interval '28.1 hours', now() - interval '28.0 hours', true),
  ('a1111111-0000-0000-0000-000000000002', '56990022003', 'cliente_inactivo', 'seguimiento_cotizacion', now() - interval '34.1 hours', now() - interval '34.0 hours', true),
  ('a1111111-0000-0000-0000-000000000002', '56990022004', 'cotizacion_sin_respuesta', 'seguimiento_cotizacion', now() - interval '40.1 hours', now() - interval '40.0 hours', true),
  ('a1111111-0000-0000-0000-000000000002', '56990022005', 'cliente_inactivo', 'seguimiento_cotizacion', now() - interval '44.1 hours', now() - interval '44.0 hours', true);

-- Metricas del mes: cuadran con las conversaciones realmente sembradas.
insert into ed_metricas (cliente_id, periodo, es_basal, conversaciones, leads_capturados, escalaciones, resueltas_sin_humano_pct, tiempo_respuesta_seg) values
  ('11111111-1111-1111-1111-111111111111', date '2026-06-01', true,  11, 3, 0, null,  5400),
  ('11111111-1111-1111-1111-111111111111', date '2026-07-01', false, 21, 8, 4, 80.95, 25),
  ('22222222-2222-2222-2222-222222222222', date '2026-06-01', true,  1, 0, 0, null,  3600),
  ('22222222-2222-2222-2222-222222222222', date '2026-07-01', false, 3, 1, 0, 100.0, 30);

insert into portal_usuarios (email, cliente_id, rol) values
  ('marcelo.valdes.r@mail.pucv.cl', '11111111-1111-1111-1111-111111111111', 'dueno'),
  ('aurora@demo.respondo.cl',       '11111111-1111-1111-1111-111111111111', 'dueno'),
  ('nogal@demo.respondo.cl',        '22222222-2222-2222-2222-222222222222', 'dueno'),
  ('hirespondo@gmail.com',          '11111111-1111-1111-1111-111111111111', 'dueno');

-- Fin.
