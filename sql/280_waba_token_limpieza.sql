-- 280_waba_token_limpieza.sql
--
-- ⚠️⚠️ NO APLICAR TODAVÍA. Es el ÚLTIMO paso de la migración 279.
--
-- Esta migración BORRA el token de WhatsApp en texto plano. Después de correrla
-- no hay forma de recuperarlo: si el cifrado estuviera mal, el cliente queda
-- mudo y hay que rehacer el Embedded Signup con él al teléfono.
--
-- APLICAR SOLO CUANDO SE CUMPLAN LAS CUATRO:
--   1) sql/279_waba_token_cifrado.sql aplicada
--   2) el código que lee `waba_token_cifrado` DESPLEGADO en producción
--   3) `npx tsx scripts/cifrar_tokens.ts --aplicar` corrido sin errores
--   4) VERIFICADO EN VIVO que cada cliente en transporte='cloud' sigue
--      enviando y recibiendo mensajes de verdad — no que la columna tenga
--      datos, sino que un mensaje llegó a un teléfono
--
-- El punto 4 es el que importa. Que el dato esté en la base no prueba que
-- funcione: esa lección salió cara con la agenda vacía de 11 días (12-ago).

-- Corta si queda algún cliente activo sin cifrar: es más barato fallar acá que
-- descubrirlo con un cliente mudo.
do $$
declare
  faltantes int;
begin
  select count(*) into faltantes
    from ed_clientes
   where activo = true
     and waba_token is not null
     and waba_token_cifrado is null;

  if faltantes > 0 then
    raise exception
      'Hay % cliente(s) activo(s) con token en texto plano y sin cifrar. Corre scripts/cifrar_tokens.ts --aplicar antes de esta migración.',
      faltantes;
  end if;
end $$;

update ed_clientes
   set waba_token = null
 where waba_token is not null;

comment on column ed_clientes.waba_token is
  'OBSOLETA y siempre null desde la migración 280. El token vive cifrado en waba_token_cifrado. No escribir acá.';

-- La columna NO se elimina: dejarla en null es reversible y no obliga a
-- coordinar el borrado con un despliegue. Se puede eliminar más adelante,
-- cuando ninguna versión del código en circulación la mencione.

select
  (select count(*) from ed_clientes where waba_token is not null)          as en_claro,   -- espera 0
  (select count(*) from ed_clientes where waba_token_cifrado is not null)  as cifrados;   -- los clientes conectados
