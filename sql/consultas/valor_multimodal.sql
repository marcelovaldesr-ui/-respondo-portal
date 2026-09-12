-- ═════════════════════════════════════════════════════════════════════════════
-- ¿CUÁNTO VALDRÍAN AUDIO Y VISIÓN? — la evidencia que no está en el código
--
-- SOLO LECTURA. No cambia nada. Se puede correr en producción sin riesgo.
--
-- POR QUÉ ESTA CONSULTA DECIDE MÁS QUE CUALQUIER BENCHMARK
--
-- Se puede medir con lujo de detalle si Gemini transcribe bien un audio y
-- seguir sin saber si conviene encenderlo, porque falta el dato que manda:
--
--   · CUÁNTOS audios y fotos llegan de verdad (si son el 1 %, no hay caso).
--   · CUÁNTO TARDA HOY una persona en contestar ese audio. Si contesta en tres
--     minutos, transcribir ahorra tres minutos y asume el riesgo de cotizar
--     sobre un número mal oído. Si tarda cuatro horas —o no contesta— el
--     cálculo cambia por completo.
--
-- Ese segundo número es EL número. Todo lo demás es secundario.
--
-- Cómo correrla: pegar en el SQL editor de Supabase (proyecto «hq respoboto»)
-- y ejecutar. Son cinco bloques; el resultado de cada uno sale por separado.
-- ═════════════════════════════════════════════════════════════════════════════


-- ── 1 · ¿CUÁNTA MEDIA LLEGA? ────────────────────────────────────────────────
-- Mensajes de clientes de los últimos 90 días, por tipo y por negocio.
-- Si `audio` o `imagen` son una fracción mínima del total, la decisión ya está
-- tomada: no vale la pena la complejidad.

select
  c.nombre                                        as negocio,
  count(*)                                        as mensajes_cliente,
  count(*) filter (where m.media_tipo = 'audio')  as audios,
  count(*) filter (where m.media_tipo = 'imagen') as imagenes,
  count(*) filter (where m.media_tipo is null)    as texto_puro,
  round(100.0 * count(*) filter (where m.media_tipo = 'audio')  / nullif(count(*), 0), 2) as pct_audio,
  round(100.0 * count(*) filter (where m.media_tipo = 'imagen') / nullif(count(*), 0), 2) as pct_imagen
from ed_mensajes m
join ed_empleados e on e.id = m.empleado_id
join ed_clientes  c on c.id = e.cliente_id
where m.rol = 'cliente'
  and m.creado_en > now() - interval '90 days'
group by c.nombre
order by mensajes_cliente desc;


-- ── 2 · ⭐ ¿CUÁNTO TARDA HOY UNA PERSONA EN CONTESTAR UN AUDIO? ─────────────
-- El número que decide. Para cada audio de cliente, cuánto pasó hasta el
-- siguiente mensaje del negocio (rol 'humano' o 'empleado') en ese mismo chat.
--
-- Cómo leerlo:
--   mediana < 10 min   → el equipo ya cubre bien los audios. Transcribir
--                        ahorra poco y agrega riesgo de número mal oído.
--   mediana > 60 min   → hay conversaciones enfriándose. Ahí sí hay valor.
--   sin_respuesta alto → audios que nadie contestó nunca. El peor caso, y el
--                        mejor argumento a favor de transcribir.

with audios as (
  select m.id, m.empleado_id, m.chat_id, m.creado_en
  from ed_mensajes m
  where m.rol = 'cliente'
    and m.media_tipo = 'audio'
    and m.creado_en > now() - interval '90 days'
),
respuesta as (
  select
    a.id,
    a.creado_en as audio_en,
    (select min(r.creado_en)
       from ed_mensajes r
      where r.empleado_id = a.empleado_id
        and r.chat_id     = a.chat_id
        and r.rol in ('humano', 'empleado')
        and r.creado_en   > a.creado_en) as contestado_en
  from audios a
)
select
  count(*)                                                          as audios_totales,
  count(*) filter (where contestado_en is null)                     as sin_respuesta_nunca,
  round(avg(extract(epoch from (contestado_en - audio_en)) / 60)::numeric, 1)  as promedio_min,
  round((percentile_cont(0.5) within group (
          order by extract(epoch from (contestado_en - audio_en)) / 60))::numeric, 1) as mediana_min,
  round((percentile_cont(0.9) within group (
          order by extract(epoch from (contestado_en - audio_en)) / 60))::numeric, 1) as p90_min,
  count(*) filter (where contestado_en - audio_en < interval '10 minutes') as contestados_en_10min,
  count(*) filter (where contestado_en - audio_en > interval '2 hours')    as contestados_tras_2h
from respuesta;


-- ── 3 · ¿SE PIERDEN CONVERSACIONES POR LOS AUDIOS? ─────────────────────────
-- Las derivaciones que abre el propio sistema al recibir un audio
-- (lib/derivacionesCore.ts → RESUMEN_AUDIO), y cuántas quedaron sin atender.

select
  count(*)                                       as derivaciones_por_audio,
  count(*) filter (where atendida_en is null)    as nunca_atendidas,
  round((percentile_cont(0.5) within group (
          order by extract(epoch from (atendida_en - creado_en)) / 60))::numeric, 1) as mediana_min_hasta_atender
from ed_escalaciones
where resumen like 'El cliente mandó un audio%'
  and creado_en > now() - interval '90 days';


-- ── 4 · LAS FOTOS, ¿VIENEN SOLAS O CON TEXTO? ──────────────────────────────
-- Una foto CON pie de foto ya trae parte de la intención escrita: ahí visión
-- aporta menos de lo que parece. Una foto SOLA es donde podría aportar.
-- (El marcador del adjunto lo agrega el parser; «con pie de foto» = hay algo
--  además del marcador.)

select
  count(*)                                                              as imagenes,
  count(*) filter (where m.texto ~ '^\[el cliente envió una imagen[^\]]*\]$') as sin_pie_de_foto,
  count(*) filter (where m.texto !~ '^\[el cliente envió una imagen[^\]]*\]$') as con_pie_de_foto,
  round(avg(length(m.texto)))                                           as largo_promedio_texto
from ed_mensajes m
where m.rol = 'cliente'
  and m.media_tipo = 'imagen'
  and m.creado_en > now() - interval '90 days';


-- ── 5 · ¿QUÉ PREGUNTA TINO DESPUÉS DE UNA FOTO? ────────────────────────────
-- Las 40 respuestas que Tino dio justo después de recibir una imagen. No hay
-- forma automática de puntuarlas: se leen.
--
-- La pregunta al leerlas: ¿alguna de estas la habría evitado ver la foto? Si la
-- respuesta es «casi ninguna», visión es NO-GO y no hace falta ningún
-- benchmark para saberlo.

with fotos as (
  select m.empleado_id, m.chat_id, m.creado_en, m.texto as pie
  from ed_mensajes m
  where m.rol = 'cliente'
    and m.media_tipo = 'imagen'
    and m.creado_en > now() - interval '90 days'
  order by m.creado_en desc
  limit 40
)
select
  f.pie,
  (select r.texto
     from ed_mensajes r
    where r.empleado_id = f.empleado_id
      and r.chat_id     = f.chat_id
      and r.rol         = 'empleado'
      and r.creado_en   > f.creado_en
    order by r.creado_en
    limit 1) as respondio_tino
from fotos f
order by f.creado_en desc;
