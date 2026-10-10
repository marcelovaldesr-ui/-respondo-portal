-- ============================================================================
-- 322_solo_mensajeria.sql · Interruptor "Solo mensajería" por negocio
-- ----------------------------------------------------------------------------
-- PARA QUÉ
--   Cuentas como Kambak (tarjetas de sellos digitales) usan el portal SOLO como
--   tubería de WhatsApp: salen los mensajes que su sistema pide por API o que
--   una persona manda a mano desde la bandeja. Ningún empleado IA (Tino, Beto,
--   Vera, Isabel) lee ni responde, no hay seguimientos ni reactivaciones
--   automáticas y no se gasta ni un token del modelo.
--
-- QUÉ HACE
--   1. Agrega ed_clientes.solo_mensajeria (boolean, apagado por defecto).
--   2. Un trigger impide que una cuenta de solo mensajería encienda por
--      accidente las funciones automáticas que gastan modelo o escriben solas
--      (reingreso, seguimiento de cotizaciones, eventos de anuncios).
--      Usa to_jsonb(NEW) para no fallar si alguna de esas columnas no existe
--      todavía en la base.
--
-- SEGURO DE APLICAR
--   · Idempotente (se puede correr varias veces).
--   · Todos los negocios existentes quedan en false: nada cambia para ellos.
--   · El código del portal tolera que esta migración falte (trata la columna
--     inexistente como "nadie es solo mensajería").
--
-- DESHACER
--   drop trigger if exists ed_solo_mensajeria_guardia on ed_clientes;
--   drop function if exists ed_solo_mensajeria_guardia();
--   alter table ed_clientes drop column if exists solo_mensajeria;
-- ============================================================================

alter table ed_clientes
  add column if not exists solo_mensajeria boolean not null default false;

comment on column ed_clientes.solo_mensajeria is
  'true = cuenta de solo mensajería: ningún empleado IA responde ni escribe solo, sin seguimientos ni reactivaciones automáticas, sin llamadas al modelo. Solo salen mensajes pedidos por API o enviados a mano desde la bandeja.';

create or replace function ed_solo_mensajeria_guardia()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  j jsonb := to_jsonb(new);
begin
  if coalesce(new.solo_mensajeria, false) then
    if coalesce((j ->> 'reingreso_activo')::boolean, false)
       or coalesce((j ->> 'cotizacion_seguimiento')::boolean, false)
       or nullif(j ->> 'ads_dataset_id', '') is not null then
      raise exception
        'Cuenta de solo mensajería: no admite reingreso automático, seguimiento de cotizaciones ni eventos de anuncios'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ed_solo_mensajeria_guardia on ed_clientes;
create trigger ed_solo_mensajeria_guardia
  before insert or update on ed_clientes
  for each row execute function ed_solo_mensajeria_guardia();

-- Verificación (debe devolver la columna y 0 o más cuentas de solo mensajería)
select
  (select count(*) from information_schema.columns
    where table_name = 'ed_clientes' and column_name = 'solo_mensajeria') as columna,
  (select count(*) from ed_clientes where solo_mensajeria) as cuentas_solo_mensajeria;
