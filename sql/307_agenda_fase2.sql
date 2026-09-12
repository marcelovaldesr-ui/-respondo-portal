-- ─────────────────────────────────────────────────────────────────────────────
-- 307 · AGENDA (Fase 2) — una sola inscripción por persona y clase.
--
-- QUÉ ARREGLA. En las clases grupales el solape es el producto: doce personas
-- en el mismo bloque a propósito. Por eso el EXCLUDE anti-solape de ed_citas
-- (migración 220, reescrito en la 260) ignora las inscripciones. El efecto
-- lateral es que nada impedía que la MISMA persona ocupara dos lugares de la
-- misma clase: dos toques seguidos en "Confirmar mi cupo" con señal mala, y una
-- clase de ocho lugares quedaba con siete personas y un fantasma.
--
-- lib/clases.ts ya mira antes de llamar al RPC, pero mirar y después escribir no
-- es una transacción: entre las dos cosas caben dos peticiones simultáneas. Este
-- índice cierra la ventana en la base, que es el único lugar donde se cierra de
-- verdad.
--
-- POR QUÉ PARCIAL. Solo aplica a inscripciones vivas (`clase_id` no nulo y
-- estado agendada/confirmada/reagendada). Quien canceló y se vuelve a inscribir
-- debe poder hacerlo, y las horas 1:1 (clase_id nulo) no entran acá: esas ya las
-- protege el EXCLUDE.
--
-- POR QUÉ chat_id. Es la identidad del alumno en este producto: no hay cuentas,
-- el teléfono (o el chat de WhatsApp) es quien eres. Si viene nulo —una
-- inscripción cargada a mano sin teléfono— Postgres trata los nulos como
-- distintos y el índice no estorba, que es lo correcto: sin identidad no se
-- puede afirmar que sean la misma persona.
--
-- ANTES DE APLICAR. Si ya hubiera duplicados, la creación del índice falla y no
-- deja nada a medias. Para verlos:
--
--   select clase_id, chat_id, count(*)
--     from ed_citas
--    where clase_id is not null
--      and chat_id is not null
--      and estado in ('agendada','confirmada','reagendada')
--    group by 1,2 having count(*) > 1;
--
-- Cada fila de ese resultado es una persona con dos lugares en la misma clase:
-- hay que cancelar el sobrante (no borrarlo) antes de volver a correr esto.
--
-- ES OPCIONAL. Sin esta migración el portal funciona igual; solo queda con la
-- protección de código, que cubre el caso real (el dedo nervioso) pero no la
-- carrera exacta. lib/clases.ts ya traduce el 23505 a "ya estás inscrito".
-- ─────────────────────────────────────────────────────────────────────────────

create unique index if not exists ed_citas_inscripcion_unica
  on ed_citas (clase_id, chat_id)
  where clase_id is not null
    and chat_id is not null
    and estado in ('agendada', 'confirmada', 'reagendada');
