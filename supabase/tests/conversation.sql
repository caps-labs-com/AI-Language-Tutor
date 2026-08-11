begin;

set local role postgres;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'conversation-a@example.test',
    '',
    now(),
    '{}',
    '{"display_name":"Conversa A"}',
    now(),
    now()
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'conversation-b@example.test',
    '',
    now(),
    '{}',
    '{"display_name":"Conversa B"}',
    now(),
    now()
  );

-- O cliente nunca deve conseguir criar uma sessão nem executar as RPCs.
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
begin
  begin
    insert into public.conversation_sessions (
      user_id, scenario_id, target_language, learner_level, planned_minutes
    ) values (
      '30000000-0000-0000-0000-000000000001', 'coffee', 'en', 'A1', 10
    );
    raise exception 'Authorization failure: client created a conversation session';
  exception
    when insufficient_privilege or check_violation then null;
  end;

  begin
    perform public.start_conversation_session(
      '30000000-0000-0000-0000-000000000001', 'coffee', 'en', 'A1'
    );
    raise exception 'Authorization failure: client executed start_conversation_session';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform public.get_conversation_context(
      '00000000-0000-0000-0000-000000000000', '30000000-0000-0000-0000-000000000001', 12
    );
    raise exception 'Authorization failure: client executed get_conversation_context';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

set local role service_role;

do $$
declare
  level_code text;
begin
  foreach level_code in array array['A1', 'A2', 'B1', 'B2'] loop
    if (
      select count(*)
      from public.conversation_scenarios
      where is_published and min_level = level_code and max_level = level_code
    ) < 6 then
      raise exception 'Conversation catalog failure: % needs at least 6 level-specific scenarios', level_code;
    end if;
  end loop;

  if exists (
    select 1
    from public.conversation_scenarios
    where is_published
      and (
        nullif(btrim(character_role_pt_br), '') is null
        or nullif(btrim(character_personality_pt_br), '') is null
        or nullif(btrim(situation_pt_br), '') is null
        or jsonb_array_length(conversation_beats_pt_br) < 2
      )
  ) then
    raise exception 'Conversation catalog failure: published scenarios need complete persona metadata';
  end if;

  if exists (
    select 1
    from public.conversation_scenarios
    where is_published
      and (char_length(cefr_rationale_pt_br) < 20
        or jsonb_typeof(complexity_controls_pt_br) <> 'array'
        or jsonb_array_length(complexity_controls_pt_br) = 0)
  ) then
    raise exception 'Conversation catalog failure: published scenarios need CEFR rationale and controls';
  end if;

  if exists (
    select 1 from public.conversation_scenarios
    where id in ('coffee', 'restaurant') and (min_level <> 'A1' or max_level <> 'A2')
  ) or exists (
    select 1 from public.conversation_scenarios
    where id = 'airport' and (min_level <> 'A2' or max_level <> 'B1')
  ) or exists (
    select 1 from public.conversation_scenarios
    where id = 'free' and (min_level <> 'A2' or max_level <> 'B2')
  ) then
    raise exception 'Conversation catalog failure: broad scenarios are not CEFR aligned';
  end if;
end;
$$;

do $$
declare
  first_start jsonb;
  resumed_start jsonb;
  active_session_id uuid;
  exchange jsonb;
  context jsonb;
  completion jsonb;
begin
  first_start := public.start_conversation_session(
    '30000000-0000-0000-0000-000000000001', 'coffee', 'en', 'A2'
  );

  if not (first_start ->> 'allowed')::boolean then
    raise exception 'Conversation failure: first session was blocked (%)', first_start ->> 'reason';
  end if;
  if (first_start ->> 'resumed')::boolean then
    raise exception 'Conversation failure: a brand new session was reported as resumed';
  end if;

  active_session_id := (first_start ->> 'session_id')::uuid;

  if (
    select count(*)
    from public.conversation_messages
    where session_id = active_session_id and role = 'tutor' and sequence = 1
  ) <> 1 then
    raise exception 'Conversation failure: opening message was not persisted';
  end if;

  -- Retomada: o mesmo cenário e idioma continuam a sessão existente.
  resumed_start := public.start_conversation_session(
    '30000000-0000-0000-0000-000000000001', 'coffee', 'en', 'A2'
  );
  if not (resumed_start ->> 'resumed')::boolean then
    raise exception 'Conversation failure: active session was not resumed';
  end if;
  if (resumed_start ->> 'session_id')::uuid <> active_session_id then
    raise exception 'Conversation failure: resume returned a different session';
  end if;

  -- Idioma sem abertura cadastrada é recusado antes de qualquer escrita.
  if (
    public.start_conversation_session(
      '30000000-0000-0000-0000-000000000001', 'coffee', 'de', 'A2'
    ) ->> 'reason'
  ) <> 'scenario_language_unavailable' then
    raise exception 'Conversation failure: unsupported language was accepted';
  end if;

  if (
    public.start_conversation_session(
      '30000000-0000-0000-0000-000000000001', 'interview', 'en', 'A1'
    ) ->> 'reason'
  ) <> 'scenario_level_unavailable' then
    raise exception 'Conversation failure: scenario outside learner level was accepted';
  end if;

  exchange := public.append_conversation_exchange(
    active_session_id,
    '30000000-0000-0000-0000-000000000001',
    'I want one coffee',
    'Sure! What size would you like?',
    jsonb_build_object(
      'original', 'I want one coffee',
      'corrected', 'I''d like a coffee, please.',
      'explanation_pt_br', 'Em pedidos, "I''d like..." soa mais natural.',
      'severity', 'minor'
    ),
    '31111111-1111-4111-8111-111111111111'
  );

  if not (exchange ->> 'stored')::boolean then
    raise exception 'Conversation failure: exchange was not stored (%)', exchange ->> 'reason';
  end if;
  if (exchange ->> 'learner_sequence')::integer <> 2
    or (exchange ->> 'tutor_sequence')::integer <> 3 then
    raise exception 'Conversation failure: unexpected message sequence';
  end if;

  if (
    select message_count from public.conversation_sessions where id = active_session_id
  ) <> 3 then
    raise exception 'Conversation failure: message_count was not updated';
  end if;
  if (
    select correction_count from public.conversation_sessions where id = active_session_id
  ) <> 1 then
    raise exception 'Conversation failure: correction_count was not updated';
  end if;

  exchange := public.append_conversation_exchange(
    active_session_id,
    '30000000-0000-0000-0000-000000000001',
    'I want one coffee',
    'Sure! What size would you like?',
    null,
    '31111111-1111-4111-8111-111111111111'
  );
  if not (exchange ->> 'replayed')::boolean then
    raise exception 'Conversation failure: duplicate request was not replayed';
  end if;
  if (
    select message_count from public.conversation_sessions where id = active_session_id
  ) <> 3 then
    raise exception 'Conversation failure: duplicate request created messages';
  end if;

  context := public.get_conversation_context(
    active_session_id, '30000000-0000-0000-0000-000000000001', 12
  );
  if not (context ->> 'found')::boolean then
    raise exception 'Conversation failure: context was not found';
  end if;
  if jsonb_array_length(context -> 'recent_messages') <> 3 then
    raise exception 'Conversation failure: context returned the wrong message count';
  end if;
  -- A janela precisa chegar ao modelo em ordem cronológica.
  if (context -> 'recent_messages' -> 0 ->> 'sequence')::integer <> 1
    or (context -> 'recent_messages' -> 2 ->> 'sequence')::integer <> 3 then
    raise exception 'Conversation failure: context messages are out of order';
  end if;
  if jsonb_array_length(context -> 'previously_corrected') <> 1 then
    raise exception 'Conversation failure: previous corrections were not summarised';
  end if;

  -- Outro aluno nunca alcança a sessão, mesmo pelo backend.
  if (
    public.get_conversation_context(
      active_session_id, '30000000-0000-0000-0000-000000000002', 12
    ) ->> 'found'
  )::boolean then
    raise exception 'Authorization failure: context leaked to another user';
  end if;

  if (
    public.append_conversation_exchange(
      active_session_id,
      '30000000-0000-0000-0000-000000000002',
      'hello',
      'hi',
      null,
      '31111111-1111-4111-8111-111111111112'
    ) ->> 'reason'
  ) <> 'session_not_found' then
    raise exception 'Authorization failure: another user appended to the session';
  end if;

  completion := public.complete_conversation_session(
    active_session_id,
    '30000000-0000-0000-0000-000000000001',
    'Você fez um pedido completo',
    'Boa! Você manteve a conversa em inglês do começo ao fim.',
    jsonb_build_array('Usou frases completas', 'Respondeu no contexto'),
    jsonb_build_array(
      jsonb_build_object(
        'title_pt_br', 'Tamanhos de bebida',
        'detail_pt_br', 'Use "large" em vez de "big".'
      )
    ),
    jsonb_build_array(
      jsonb_build_object('term', 'large', 'translation_pt_br', 'grande')
    ),
    80,
    '31111111-1111-4111-8111-111111111111'
  );

  if not (completion ->> 'completed')::boolean then
    raise exception 'Conversation failure: session was not completed';
  end if;
  if (select status from public.conversation_sessions where id = active_session_id) <> 'completed' then
    raise exception 'Conversation failure: status was not set to completed';
  end if;
  if (select ended_at from public.conversation_sessions where id = active_session_id) is null then
    raise exception 'Conversation failure: ended_at was not recorded';
  end if;

  -- Uma sessão encerrada não aceita novas mensagens.
  if (
    public.append_conversation_exchange(
      active_session_id,
      '30000000-0000-0000-0000-000000000001',
      'one more',
      'reply',
      null,
      '31111111-1111-4111-8111-111111111113'
    ) ->> 'reason'
  ) <> 'session_not_active' then
    raise exception 'Conversation failure: completed session accepted a new exchange';
  end if;
end;
$$;

-- Limite gratuito de duas sessões por dia.
do $$
declare
  blocked jsonb;
begin
  perform public.start_conversation_session(
    '30000000-0000-0000-0000-000000000001', 'airport', 'en', 'A2'
  );

  blocked := public.start_conversation_session(
    '30000000-0000-0000-0000-000000000001', 'free', 'en', 'A2'
  );
  if (blocked ->> 'allowed')::boolean then
    raise exception 'Budget failure: the daily session limit was not enforced';
  end if;
  if (blocked ->> 'reason') <> 'daily_session_limit' then
    raise exception 'Budget failure: unexpected block reason %', blocked ->> 'reason';
  end if;
end;
$$;

-- Limite de mensagens por sessão.
do $$
declare
  active_session_id uuid;
  blocked jsonb;
begin
  update public.llm_budget_policies
  set max_learner_messages_per_session = 1
  where id = true;

  update public.plan_entitlements
  set metadata = jsonb_build_object('max_learner_messages_per_session', 1)
  where plan_id = 'free' and feature_key = 'conversation_session';

  active_session_id := (
    public.start_conversation_session(
      '30000000-0000-0000-0000-000000000002', 'airport', 'es', 'B1'
    ) ->> 'session_id'
  )::uuid;

  perform public.append_conversation_exchange(
    active_session_id, '30000000-0000-0000-0000-000000000002', 'hola', 'buenas', null, null
  );

  blocked := public.append_conversation_exchange(
    active_session_id, '30000000-0000-0000-0000-000000000002', 'otra', 'respuesta', null, null
  );
  if (blocked ->> 'stored')::boolean then
    raise exception 'Conversation failure: per-session message limit was not enforced';
  end if;
  if (blocked ->> 'reason') <> 'session_message_limit' then
    raise exception 'Conversation failure: unexpected limit reason %', blocked ->> 'reason';
  end if;
end;
$$;

-- Sessões esquecidas são encerradas e não bloqueiam o aluno para sempre.
do $$
declare
  expired integer;
begin
  update public.conversation_sessions
  set last_activity_at = now() - interval '3 hours'
  where user_id = '30000000-0000-0000-0000-000000000002'
    and status = 'active';

  expired := public.expire_idle_conversation_sessions(
    '30000000-0000-0000-0000-000000000002'
  );
  if expired < 1 then
    raise exception 'Conversation failure: idle session was not expired';
  end if;
  if exists (
    select 1
    from public.conversation_sessions
    where user_id = '30000000-0000-0000-0000-000000000002'
      and status = 'active'
  ) then
    raise exception 'Conversation failure: idle session is still active';
  end if;
end;
$$;

-- Leitura pelo dono, e somente pelo dono.
set local role authenticated;
select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000001', true);

do $$
begin
  if (select count(*) from public.conversation_sessions) <> 2 then
    raise exception 'RLS failure: owner cannot read exactly their own sessions';
  end if;
  if (select count(*) from public.session_summaries) <> 1 then
    raise exception 'RLS failure: owner cannot read their own summary';
  end if;
  if (select count(*) from public.conversation_messages) < 3 then
    raise exception 'RLS failure: owner cannot read their own messages';
  end if;
  if (select count(*) from public.conversation_scenarios) <> 30 then
    raise exception 'RLS failure: published scenarios are not readable';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '30000000-0000-0000-0000-000000000002', true);

do $$
begin
  if exists (
    select 1
    from public.conversation_messages
    where user_id = '30000000-0000-0000-0000-000000000001'
  ) then
    raise exception 'RLS failure: another user can read conversation messages';
  end if;
  if exists (select 1 from public.session_summaries) then
    raise exception 'RLS failure: another user can read session summaries';
  end if;

  begin
    update public.conversation_sessions
    set status = 'completed'
    where user_id = '30000000-0000-0000-0000-000000000001';
    if found then
      raise exception 'RLS failure: another user updated a conversation session';
    end if;
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

rollback;
