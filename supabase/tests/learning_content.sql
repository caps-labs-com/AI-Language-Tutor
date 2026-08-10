begin;

set local role postgres;

do $$
declare
  catalog_row record;
  language_code text;
  a1_average numeric;
  a2_average numeric;
  b1_average numeric;
  b2_average numeric;
begin
  for catalog_row in
    select language, level, count(*) as lesson_count
    from public.quick_lessons
    where is_published
    group by language, level
  loop
    if catalog_row.lesson_count <> 50 then
      raise exception 'Quick lesson catalog failure: %/% has % rows',
        catalog_row.language, catalog_row.level, catalog_row.lesson_count;
    end if;
  end loop;

  if (
    select count(*)
    from (
      select language, level
      from public.quick_lessons
      where is_published
      group by language, level
    ) combinations
  ) <> 16 then
    raise exception 'Quick lesson catalog failure: expected 16 language/level combinations';
  end if;

  foreach language_code in array array['en', 'es', 'fr', 'it']
  loop
    select
      avg(char_length(body)) filter (where level = 'A1'),
      avg(char_length(body)) filter (where level = 'A2'),
      avg(char_length(body)) filter (where level = 'B1'),
      avg(char_length(body)) filter (where level = 'B2')
    into a1_average, a2_average, b1_average, b2_average
    from public.quick_lessons
    where language = language_code and is_published;

    if not (a1_average < a2_average and a2_average < b1_average and b1_average < b2_average) then
      raise exception 'Quick lesson complexity failure for %', language_code;
    end if;

    if exists (
      select level
      from public.grammar_topics
      where language = language_code and is_published
      group by level
      having count(*) < 10
    ) then
      raise exception 'Grammar catalog failure for %: expected at least 10 topics per level', language_code;
    end if;
  end loop;

  if exists (
    select topic.id
    from public.grammar_topics topic
    left join public.grammar_exercises exercise
      on exercise.topic_id = topic.id and exercise.is_published
    where topic.is_published
    group by topic.id, topic.level
    having count(exercise.id) <> case topic.level
      when 'A1' then 5
      when 'A2' then 6
      when 'B1' then 8
      when 'B2' then 10
    end
  ) then
    raise exception 'Grammar catalog failure: expected A1=5, A2=6, B1=8, B2=10 exercises per topic';
  end if;

  if exists (
    select 1
    from public.grammar_exercises
    where is_published
      and level in ('A1', 'A2')
      and (
        nullif(btrim(question), '') is null
        or jsonb_typeof(options) <> 'array'
        or jsonb_array_length(options) not between 2 and 6
        or answer_index < 0
        or answer_index >= jsonb_array_length(options)
        or nullif(btrim(explanation), '') is null
        or nullif(btrim(example), '') is null
      )
  ) then
    raise exception 'Grammar catalog failure: A1/A2 exercises must have question, options, answer, explanation and example';
  end if;

  if exists (
    select 1
    from public.grammar_exercises
    where is_published
      and level in ('B1', 'B2')
      and question in (
        'Choose the correct sentence.',
        'Elige la frase correcta.',
        'Choisissez la phrase correcte.',
        'Scegli la frase corretta.'
      )
  ) then
    raise exception 'Grammar catalog failure: B1/B2 still use generic stems';
  end if;

  if not exists (
    select 1
    from public.grammar_exercises
    where is_published
      and level in ('B1', 'B2')
      and (
        question like 'Which sentence correctly uses%'
        or question like 'What does this sentence express%'
        or question like '¿Qué frase usa correctamente%'
        or question like '¿Qué expresa esta frase%'
        or question like 'Quelle phrase utilise correctement%'
        or question like 'Que signifie cette phrase%'
        or question like 'Quale frase usa correttamente%'
        or question like 'Cosa esprime questa frase%'
      )
  ) then
    raise exception 'Grammar catalog failure: B1/B2 need mixed non-cloze exercise types';
  end if;

  if exists (
    select 1
    from public.grammar_exercises
    where is_published
      and (
        (level in ('A1', 'A2') and jsonb_array_length(options) not between 2 and 6)
        or (level in ('B1', 'B2') and jsonb_array_length(options) <> 4)
      )
  ) then
    raise exception 'Grammar catalog failure: A1/A2 need 2-6 options and B1/B2 need 4 options';
  end if;

  if exists (
    select 1
    from public.quick_lessons
    where is_published
      and (
        (level = 'A1' and jsonb_array_length(questions) <> 2)
        or (level = 'A2' and jsonb_array_length(questions) <> 3)
        or (level = 'B1' and jsonb_array_length(questions) <> 4)
        or (level = 'B2' and jsonb_array_length(questions) <> 5)
      )
  ) then
    raise exception 'Quick lesson failure: expected A1=2, A2=3, B1=4, B2=5 cloze questions';
  end if;

  if exists (
    select 1
    from public.quick_lessons lesson
    cross join lateral jsonb_array_elements(lesson.questions) as question(value)
    where lesson.is_published
      and lesson.level in ('A1', 'A2')
      and (
        position('___' in coalesce(question.value ->> 'prompt', '')) = 0
        or jsonb_array_length(question.value -> 'options') <> 3
        or question.value ->> 'prompt' in (
          'What helped Maya reach the goal?',
          'What helped Leo reach the goal?',
          'What helped Nina reach the goal?',
          'What helped Sam reach the goal?'
        )
      )
  ) then
    raise exception 'Quick lesson failure: A1/A2 questions must be topic-aligned cloze prompts';
  end if;

  if exists (
    select 1
    from public.quick_lessons lesson
    cross join lateral jsonb_array_elements(lesson.questions) as question(value)
    where lesson.is_published
      and lesson.level in ('B1', 'B2')
      and (
        jsonb_array_length(question.value -> 'options') <> 4
        or question.value ->> 'prompt' in (
          'What helped Maya reach the goal?',
          'What helped Leo reach the goal?',
          'What helped Nina reach the goal?',
          'What helped Sam reach the goal?'
        )
      )
  ) then
    raise exception 'Quick lesson failure: B1/B2 questions must keep 4 options and avoid generic stems';
  end if;

  if not exists (
    select 1
    from public.quick_lessons lesson
    cross join lateral jsonb_array_elements(lesson.questions) as question(value)
    where lesson.is_published
      and lesson.level in ('B1', 'B2')
      and position('___' in coalesce(question.value ->> 'prompt', '')) = 0
  ) then
    raise exception 'Quick lesson failure: B1/B2 need interpretation questions beyond cloze';
  end if;

  for catalog_row in
    select
      required.language,
      required_level.level,
      count(passage.id) as passage_count
    from unnest(array['en', 'es', 'fr', 'it']) as required(language)
    cross join unnest(array['A1', 'A2', 'B1', 'B2']) as required_level(level)
    left join public.reading_passages passage
      on passage.language = required.language
      and passage.level = required_level.level
      and passage.is_published
    group by required.language, required_level.level
  loop
    if catalog_row.passage_count < 10 then
      raise exception 'Reading catalog failure: %/% has %, expected at least 10 passages',
        catalog_row.language, catalog_row.level, catalog_row.passage_count;
    end if;
  end loop;

  if exists (
    select 1
    from public.reading_passages
    where is_published
      and (
        (level = 'A1' and jsonb_array_length(questions) <> 3)
        or (level = 'A2' and jsonb_array_length(questions) <> 4)
        or (level = 'B1' and jsonb_array_length(questions) <> 6)
        or (level = 'B2' and jsonb_array_length(questions) <> 8)
      )
  ) then
    raise exception 'Reading failure: expected A1=3, A2=4, B1=6, B2=8 questions';
  end if;

  if exists (
    select 1
    from public.reading_passages passage
    cross join lateral jsonb_array_elements(passage.questions) as question(value)
    where passage.is_published
      and passage.level in ('A1', 'A2')
      and (
        nullif(btrim(question.value ->> 'prompt'), '') is null
        or jsonb_typeof(question.value -> 'options') <> 'array'
        or jsonb_array_length(question.value -> 'options') not between 3 and 4
        or (question.value ->> 'answer_index')::int < 0
        or (question.value ->> 'answer_index')::int >= jsonb_array_length(question.value -> 'options')
        or nullif(btrim(question.value ->> 'explanation_pt_br'), '') is null
      )
  ) then
    raise exception 'Reading failure: A1/A2 questions must have prompt, 3-4 options, answer and explanation';
  end if;

  if exists (
    select 1
    from public.reading_passages passage
    cross join lateral jsonb_array_elements(passage.questions) as question(value)
    where passage.is_published
      and passage.level in ('B1', 'B2')
      and jsonb_array_length(question.value -> 'options') <> 4
  ) then
    raise exception 'Reading failure: B1/B2 questions need 4 options';
  end if;

  if not exists (
    select 1
    from public.reading_passages passage
    cross join lateral jsonb_array_elements(passage.questions) as question(value)
    where passage.is_published
      and passage.level in ('B1', 'B2')
      and position('___' in coalesce(question.value ->> 'prompt', '')) = 0
  ) then
    raise exception 'Reading failure: B1/B2 need interpretation questions beyond cloze';
  end if;

  if not exists (
    select 1
    from public.reading_passages passage
    cross join lateral jsonb_array_elements(passage.questions) as question(value)
    where passage.is_published
      and passage.level in ('B1', 'B2')
      and position('___' in coalesce(question.value ->> 'prompt', '')) > 0
      and length(coalesce(question.value -> 'options' ->> ((question.value ->> 'answer_index')::int), '')) >= 6
  ) then
    raise exception 'Reading failure: B1/B2 still need some multi-word or cloze items';
  end if;

end;
$$;

rollback;
