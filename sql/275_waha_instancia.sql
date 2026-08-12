-- ============================================================================
-- 275_waha_instancia.sql · Separar la identidad WAHA de la identidad Meta
-- ----------------------------------------------------------------------------
-- HALLAZGO (11-ago-2026, antes de conectar el primer número por Coexistencia):
-- `ed_clientes.waba_phone_id` está haciendo DOS trabajos incompatibles a la vez:
--
--   1) lib/waha.ts  → clientePorInstancia(): mapea el NOMBRE de la instancia de
--      WAHA (texto, ej. 'impresora-color') al cliente. Así se rutean HOY los
--      mensajes entrantes de Impresora Color, el único cliente en producción.
--   2) lib/whatsapp.ts → configPorPhoneId(): mapea el phone_number_id NUMÉRICO
--      de Meta al cliente, para la Cloud API oficial.
--
-- El problema aparece justo en el peor momento: app/api/whatsapp/onboarding
-- hace `waba_phone_id = <phone_number_id numérico>` al terminar el Embedded
-- Signup. En ese instante el mapeo de WAHA deja de existir y los entrantes por
-- WAHA quedan huérfanos ("sin_cliente"). Si además algo de la vía oficial no
-- quedó fino (token, webhook, número a medio onboardear), Tino se queda MUDO
-- sin camino de vuelta, porque el dato viejo ya se sobrescribió.
--
-- Es el mismo patrón que causó el apagón de 21 h de agosto: una sola variable
-- compartida entre dos sistemas, sin señal visible cuando se desincroniza.
--
-- Con esta migración cada vía tiene SU columna:
--   waha_instancia  → identidad en WAHA   (texto libre)
--   waba_phone_id   → identidad en Meta   (solo dígitos)
-- y volver atrás vuelve a ser una línea: update ed_clientes set transporte='waha'.
--
-- APLICAR EN SUPABASE (SQL editor). Seguro y reversible: solo agrega una
-- columna y copia el valor que ya existe.
-- ============================================================================

-- 1) Columna propia para la instancia de WAHA.
alter table ed_clientes add column if not exists waha_instancia text;

-- 2) Backfill: los waba_phone_id que NO son numéricos nunca fueron de Meta —
--    son nombres de instancia de WAHA mal alojados. Se mueven a su columna.
update ed_clientes
   set waha_instancia = waba_phone_id
 where waba_phone_id is not null
   and waba_phone_id !~ '^[0-9]+$'
   and waha_instancia is null;

-- 3) Limpiar el campo de Meta en esas filas: dejarlo con un nombre de instancia
--    hace que configPorPhoneId() pueda resolver un cliente equivocado.
update ed_clientes
   set waba_phone_id = null
 where waba_phone_id is not null
   and waba_phone_id !~ '^[0-9]+$';

-- 4) Blindaje: que la columna de Meta no vuelva a aceptar texto no numérico.
alter table ed_clientes drop constraint if exists ed_clientes_waba_phone_id_check;
alter table ed_clientes add constraint ed_clientes_waba_phone_id_check
  check (waba_phone_id is null or waba_phone_id ~ '^[0-9]+$');

-- 5) ¿El número quedó de verdad en Coexistencia (app + Cloud API) o es un
--    número solo-API? Meta lo expone en is_on_biz_app; sin guardarlo no hay
--    forma de distinguir un caso del otro después, y son operativamente muy
--    distintos (en Coexistencia Cecilia sigue respondiendo desde su teléfono).
alter table ed_clientes add column if not exists waba_coexistencia boolean;

comment on column ed_clientes.waba_coexistencia is
  'true = el número funciona a la vez en la app de WhatsApp Business y en la Cloud API (Coexistencia). null = sin verificar.';

-- 6) Índices de resolución (uno por vía).
create index if not exists idx_ed_clientes_waha_instancia on ed_clientes(waha_instancia);
create unique index if not exists uq_ed_clientes_waba_phone
  on ed_clientes(waba_phone_id) where waba_phone_id is not null;

comment on column ed_clientes.waha_instancia is
  'Nombre de la instancia de WAHA (vía no oficial) que mapea a este cliente. Independiente de waba_phone_id (Meta).';
comment on column ed_clientes.waba_phone_id is
  'phone_number_id NUMÉRICO de la WhatsApp Cloud API de Meta. Nunca un nombre de instancia de WAHA.';

-- Verificación: Impresora Color debe quedar con waha_instancia='impresora-color'
-- y waba_phone_id=null (hasta que se conecte por Embedded Signup).
select nombre, transporte, waha_instancia, waba_phone_id
  from ed_clientes
 order by nombre;
