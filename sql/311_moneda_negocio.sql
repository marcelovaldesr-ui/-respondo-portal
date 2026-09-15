-- ════════════════════════════════════════════════════════════════════════════
-- 311 · LA MONEDA EN QUE COBRA CADA NEGOCIO
--
-- POR QUÉ: Marketing tenía `monedaNegocio: "CLP"` escrito a mano en el código
-- (lib/marketing/datos.ts y lib/ads/atribucion.ts). Funcionaba porque todos los
-- clientes cobran en pesos, y por eso nadie lo notaba: el día que haya uno que
-- no, todas sus cifras de ingresos salen rotuladas en la moneda equivocada y
-- el retorno sobre la inversión se calcula mezclando unidades.
--
-- Nullable y SIN default a propósito: `null` significa «este negocio no declaró
-- su moneda» y el código usa la de la instalación (RESPONDO_MONEDA_NEGOCIO, o
-- CLP). Un default 'CLP' acá volvería a convertir un hueco en una afirmación,
-- que es justo el defecto que esta migración viene a sacar.
--
-- Idempotente: se puede correr dos veces.
-- ════════════════════════════════════════════════════════════════════════════

alter table ed_clientes add column if not exists moneda text;

comment on column ed_clientes.moneda is
  'Código ISO-4217 en que cobra este negocio (ej. CLP, USD). NULL = usa la moneda por defecto de la instalación. NO es la moneda de su cuenta publicitaria, que vive en ed_ads_conexion.moneda y la declara la plataforma.';

-- Un código ISO o nada. Evita que un «peso» o un «$» se cuele y termine en una
-- pantalla como si fuera una moneda.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ed_clientes_moneda_iso') then
    alter table ed_clientes
      add constraint ed_clientes_moneda_iso
      check (moneda is null or moneda ~ '^[A-Z]{3}$');
  end if;
end $$;
