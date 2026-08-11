-- Remove conteúdos repetidos dentro do mesmo idioma e nível.
-- Pontuação, espaços e maiúsculas não tornam um título novo. Preserva-se a
-- versão mais completa e remapeia-se o progresso atual antes da exclusão.

create temporary table dedupe_quick_lessons on commit drop as
with ranked as (
  select id,
    first_value(id) over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by char_length(body) + char_length(questions::text) desc, id
    ) as keep_id,
    row_number() over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by char_length(body) + char_length(questions::text) desc, id
    ) as position
  from public.quick_lessons where is_published
)
select id as duplicate_id, keep_id from ranked where position > 1;

update public.learning_section_progress p set activity_id = m.keep_id
from dedupe_quick_lessons m
where p.section = 'quick_lesson' and p.activity_id = m.duplicate_id;

delete from public.learning_activity_progress duplicate
using dedupe_quick_lessons m
where duplicate.activity_type = 'quick_lesson'
  and duplicate.activity_id = m.duplicate_id
  and exists (
    select 1 from public.learning_activity_progress kept
    where kept.user_id = duplicate.user_id and kept.activity_id = m.keep_id
  );
update public.learning_activity_progress p set activity_id = m.keep_id
from dedupe_quick_lessons m
where p.activity_type = 'quick_lesson' and p.activity_id = m.duplicate_id;
update public.learning_activity_events e set activity_id = m.keep_id
from dedupe_quick_lessons m
where e.activity_type = 'quick_lesson' and e.activity_id = m.duplicate_id;
delete from public.quick_lessons lesson using dedupe_quick_lessons m
where lesson.id = m.duplicate_id;

create temporary table dedupe_reading_passages on commit drop as
with ranked as (
  select id,
    first_value(id) over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by char_length(body) + char_length(questions::text) desc, id
    ) as keep_id,
    row_number() over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by char_length(body) + char_length(questions::text) desc, id
    ) as position
  from public.reading_passages where is_published
)
select id as duplicate_id, keep_id from ranked where position > 1;

update public.learning_section_progress p set activity_id = m.keep_id
from dedupe_reading_passages m
where p.section = 'reading' and p.activity_id = m.duplicate_id;
delete from public.learning_activity_progress duplicate
using dedupe_reading_passages m
where duplicate.activity_type = 'reading'
  and duplicate.activity_id = m.duplicate_id
  and exists (
    select 1 from public.learning_activity_progress kept
    where kept.user_id = duplicate.user_id and kept.activity_id = m.keep_id
  );
update public.learning_activity_progress p set activity_id = m.keep_id
from dedupe_reading_passages m
where p.activity_type = 'reading' and p.activity_id = m.duplicate_id;
update public.learning_activity_events e set activity_id = m.keep_id
from dedupe_reading_passages m
where e.activity_type = 'reading' and e.activity_id = m.duplicate_id;
delete from public.reading_passages passage using dedupe_reading_passages m
where passage.id = m.duplicate_id;

create temporary table dedupe_grammar_topics on commit drop as
with topic_quality as (
  select topic.*,
    (select count(*) from public.grammar_exercises exercise
      where exercise.topic_id = topic.id and exercise.is_published) as exercise_count
  from public.grammar_topics topic where topic.is_published
), ranked as (
  select id,
    first_value(id) over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by exercise_count desc,
        char_length(overview_pt_br) + char_length(formation_pt_br)
          + char_length(use_cases::text) desc, id
    ) as keep_id,
    row_number() over (
      partition by language, level,
        regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
      order by exercise_count desc,
        char_length(overview_pt_br) + char_length(formation_pt_br)
          + char_length(use_cases::text) desc, id
    ) as position
  from topic_quality
)
select id as duplicate_id, keep_id from ranked where position > 1;

update public.learning_section_progress p set activity_id = m.keep_id
from dedupe_grammar_topics m
where p.section = 'grammar' and p.activity_id = m.duplicate_id;
delete from public.grammar_topics topic using dedupe_grammar_topics m
where topic.id = m.duplicate_id;

-- Segunda passada conservadora para títulos quase iguais: só une temas quando
-- título e conteúdo instrucional são ambos muito semelhantes.
create extension if not exists pg_trgm with schema extensions;
create temporary table dedupe_near_grammar_topics on commit drop as
with quality as (
  select topic.id, topic.language, topic.level, topic.title,
    topic.overview_pt_br, topic.formation_pt_br,
    (select count(*) from public.grammar_exercises exercise
      where exercise.topic_id = topic.id and exercise.is_published) * 1000000
      + char_length(topic.overview_pt_br) + char_length(topic.formation_pt_br)
      + char_length(topic.use_cases::text) as quality_score
  from public.grammar_topics topic where topic.is_published
)
select duplicate.id as duplicate_id,
  (select candidate.id from quality candidate
    where candidate.language = duplicate.language
      and candidate.level = duplicate.level
      and candidate.id <> duplicate.id
      and extensions.similarity(lower(candidate.title), lower(duplicate.title)) >= 0.82
      and greatest(
        extensions.similarity(lower(candidate.overview_pt_br), lower(duplicate.overview_pt_br)),
        extensions.similarity(lower(candidate.formation_pt_br), lower(duplicate.formation_pt_br))
      ) >= 0.82
      and (candidate.quality_score > duplicate.quality_score
        or (candidate.quality_score = duplicate.quality_score and candidate.id < duplicate.id))
    order by candidate.quality_score desc, candidate.id
    limit 1) as keep_id
from quality duplicate
where exists (
  select 1 from quality candidate
  where candidate.language = duplicate.language
    and candidate.level = duplicate.level
    and candidate.id <> duplicate.id
    and extensions.similarity(lower(candidate.title), lower(duplicate.title)) >= 0.82
    and greatest(
      extensions.similarity(lower(candidate.overview_pt_br), lower(duplicate.overview_pt_br)),
      extensions.similarity(lower(candidate.formation_pt_br), lower(duplicate.formation_pt_br))
    ) >= 0.82
    and (candidate.quality_score > duplicate.quality_score
      or (candidate.quality_score = duplicate.quality_score and candidate.id < duplicate.id))
);

create temporary table resolved_near_grammar_topics on commit drop as
with recursive chain(duplicate_id, keep_id, depth) as (
  select duplicate_id, keep_id, 1 from dedupe_near_grammar_topics
  union all
  select chain.duplicate_id, next_mapping.keep_id, chain.depth + 1
  from chain
  join dedupe_near_grammar_topics next_mapping
    on next_mapping.duplicate_id = chain.keep_id
)
select distinct on (duplicate_id) duplicate_id, keep_id
from chain order by duplicate_id, depth desc;

update dedupe_near_grammar_topics mapping
set keep_id = resolved.keep_id
from resolved_near_grammar_topics resolved
where resolved.duplicate_id = mapping.duplicate_id;

update public.learning_section_progress p set activity_id = m.keep_id
from dedupe_near_grammar_topics m
where p.section = 'grammar' and p.activity_id = m.duplicate_id;
delete from public.grammar_topics topic using dedupe_near_grammar_topics m
where topic.id = m.duplicate_id;

do $$
begin
  if exists (
    select 1 from public.quick_lessons where is_published
    group by language, level, regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
    having count(*) > 1
  ) then raise exception 'Deduplication failure: repeated quick lesson titles remain'; end if;
  if exists (
    select 1 from public.reading_passages where is_published
    group by language, level, regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
    having count(*) > 1
  ) then raise exception 'Deduplication failure: repeated reading titles remain'; end if;
  if exists (
    select 1 from public.grammar_topics where is_published
    group by language, level, regexp_replace(lower(title), '[^[:alnum:]]+', '', 'g')
    having count(*) > 1
  ) then raise exception 'Deduplication failure: repeated grammar titles remain'; end if;
end;
$$;
