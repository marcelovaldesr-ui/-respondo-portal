-- ============================================================================
-- 284 · QUE TINO NO DEJE MORIR UNA CONVERSACIÓN QUE EL EQUIPO ABANDONÓ
-- ============================================================================
--
-- EL AGUJERO QUE TAPA
-- -------------------
-- Hoy, cuando alguien del equipo toca «Tomar el control», el modo del chat pasa
-- a 'humano' y Tino se apaga ahí PARA SIEMPRE: no existe ningún camino de vuelta
-- ni por tiempo ni por inactividad (`responderBot.ts`, «if (modo !== "bot")»).
--
-- El caso real de Impresora Color: Tino avanza la conversación, Cecilia toma el
-- control, contesta un par de mensajes y se le olvida. Esa conversación queda
-- muerta y NADIE se entera — ni ella, ni el dueño, ni el sistema. Un cliente que
-- preguntó y nunca recibió respuesta no reclama: se va.
--
-- ⚠️ TODO NACE APAGADO. `reingreso_activo` es false por defecto, así que aplicar
-- esta migración NO cambia el comportamiento de ningún cliente. Es el mismo
-- criterio de los cupos (migración 278): inerte hasta que alguien lo encienda a
-- propósito. Por eso se puede aplicar antes o después del despliegue sin riesgo.
-- ============================================================================

-- ── Interruptores por cliente ───────────────────────────────────────────────

alter table ed_clientes
  add column if not exists reingreso_activo boolean not null default false;
comment on column ed_clientes.reingreso_activo is
  'Si Tino puede volver a una conversación que el equipo dejó sin responder. Apagado por defecto.';

-- Tres horas: suficiente para que se note el abandono, y muy dentro de las 24 h
-- de la ventana de Meta, que es la otra restricción real. Más corto atropella a
-- quien está atendiendo; más largo y la conversación ya se enfrió.
alter table ed_clientes
  add column if not exists reingreso_minutos int not null default 180;
comment on column ed_clientes.reingreso_minutos is
  'Minutos sin respuesta del equipo antes de que Tino pueda reingresar.';

-- ⚠️ PRECIOS APARTE, Y APAGADO. En Impresora el listado cubre una fracción de lo
-- que venden y lo están completando. Con un catálogo parcial el riesgo no es que
-- el modelo invente de la nada: es que vea un producto parecido e INFIERA el
-- precio que falta. Se enciende cuando el catálogo esté completo — decisión del
-- negocio, no cambio de código.
alter table ed_clientes
  add column if not exists reingreso_precios boolean not null default false;
comment on column ed_clientes.reingreso_precios is
  'Habilita que Tino responda precios al reingresar. Solo con el catálogo completo.';

-- ── Memoria por conversación ────────────────────────────────────────────────

-- Con esto se cumple la regla «UNA sola vez por conversación», que es la que
-- evita lo que más molesta a un cliente: el asistente insistiendo con lo mismo.
alter table ed_chat_estado
  add column if not exists reingreso_en timestamptz;
comment on column ed_chat_estado.reingreso_en is
  'Cuándo reingresó Tino en esta conversación. Si tiene valor, no vuelve a entrar.';

-- El escape para negociaciones delicadas: acá Tino no entra, pase lo que pase.
alter table ed_chat_estado
  add column if not exists reingreso_bloqueado boolean not null default false;
comment on column ed_chat_estado.reingreso_bloqueado is
  'Interruptor por conversación para que Tino nunca reingrese (negociaciones delicadas).';

-- ── Índice del barrido ──────────────────────────────────────────────────────
--
-- El vigilante corre en el cron y busca chats en modo humano con el cliente
-- esperando. Sin índice, cada pasada haría un recorrido completo de la tabla.
-- Parcial: solo las filas que el barrido puede mirar, así ocupa casi nada.
create index if not exists idx_ed_chat_estado_reingreso
  on ed_chat_estado (modo, ultimo_entrante_en)
  where modo = 'humano' and reingreso_en is null and reingreso_bloqueado = false;

-- ── Verificación ────────────────────────────────────────────────────────────
-- Debe devolver 5 columnas nuevas y todo apagado.
select
  (select count(*) from information_schema.columns
    where table_name = 'ed_clientes'
      and column_name in ('reingreso_activo','reingreso_minutos','reingreso_precios')) as cols_clientes,
  (select count(*) from information_schema.columns
    where table_name = 'ed_chat_estado'
      and column_name in ('reingreso_en','reingreso_bloqueado')) as cols_chat_estado,
  (select count(*) from ed_clientes where reingreso_activo) as clientes_encendidos;
