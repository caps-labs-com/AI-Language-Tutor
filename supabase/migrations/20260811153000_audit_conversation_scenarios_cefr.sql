-- Auditoria pedagógica dos cenários segundo as funções comunicativas do CEFR.
-- O nível representa a complexidade da tarefa, não apenas o assunto.

alter table public.conversation_scenarios
  add column cefr_rationale_pt_br text not null default 'Prática comunicativa contextualizada.'
    check (char_length(cefr_rationale_pt_br) between 20 and 1000),
  add column complexity_controls_pt_br jsonb not null
    default '["Adequar vocabulário e interação ao nível declarado."]'::jsonb
    check (jsonb_typeof(complexity_controls_pt_br) = 'array'
      and jsonb_array_length(complexity_controls_pt_br) between 1 and 6);

-- Cenários antigos com faixa A1-B2 misturavam tarefas elementares e avançadas.
-- O prompt ainda adapta a linguagem dentro da faixa, mas a demanda comunicativa
-- agora permanece coerente com os descritores de cada nível.
update public.conversation_scenarios
set min_level = 'A1', max_level = 'A2',
    cefr_rationale_pt_br = 'A1 pede e confirma itens previsíveis; A2 acrescenta preferências, variações e pequenos problemas cotidianos.',
    complexity_controls_pt_br = '["Vocabulário concreto e frequente","Uma decisão por turno","No A2, pedir motivo simples ou lidar com item indisponível"]'
where id in ('coffee', 'restaurant');

update public.conversation_scenarios
set min_level = 'A2', max_level = 'B1',
    cefr_rationale_pt_br = 'A2 consegue realizar transações rotineiras de viagem; B1 explica imprevistos e compara alternativas com alguma autonomia.',
    complexity_controls_pt_br = '["A2 recebe perguntas diretas e sequenciais","B1 precisa explicar prioridade e consequência","Sem jargão operacional"]'
where id = 'airport';

update public.conversation_scenarios
set min_level = 'A2', max_level = 'B2',
    cefr_rationale_pt_br = 'Conversa sem tema exige autonomia além do repertório A1; a progressão vai de troca cotidiana conectada a discussão espontânea e nuançada.',
    complexity_controls_pt_br = '["A2 recebe assunto concreto e apoio contextual","B1 narra e justifica opiniões","B2 sustenta nuance e mudança de perspectiva"]'
where id = 'free';

update public.conversation_scenarios
set cefr_rationale_pt_br = 'B1 apresenta experiências e opiniões conectadas; B2 desenvolve argumentos, responde a objeções e negocia com precisão.',
    complexity_controls_pt_br = '["B1 usa perguntas claras e vocabulário profissional geral","B2 exige evidências, ressalvas e reformulação","Evitar conhecimento técnico específico"]'
where id in ('interview', 'meeting');

update public.conversation_scenarios
set cefr_rationale_pt_br = 'A1 realiza trocas previsíveis com palavras frequentes, informações pessoais, números, horários e necessidades imediatas.',
    complexity_controls_pt_br = '["Uma pergunta curta por turno","Escolhas concretas quando necessário","Sem inferência, idioma ou justificativa abstrata"]'
where min_level = 'A1' and max_level = 'A1';

update public.conversation_scenarios
set cefr_rationale_pt_br = 'A2 conduz transações cotidianas, descreve situações simples, faz comparações básicas e oferece razões curtas.',
    complexity_controls_pt_br = '["Frases curtas conectadas","Um pequeno imprevisto por conversa","Razões e descrições simples, sem argumentação extensa"]'
where min_level = 'A2' and max_level = 'A2';

update public.conversation_scenarios
set cefr_rationale_pt_br = 'B1 sustenta discurso conectado sobre temas familiares, narra fatos, explica motivos e negocia soluções práticas.',
    complexity_controls_pt_br = '["Solicitar razões e exemplos","Introduzir consequência realista","Linguagem geral, sem especialização"]'
where min_level = 'B1' and max_level = 'B1';

update public.conversation_scenarios
set cefr_rationale_pt_br = 'B2 argumenta com espontaneidade, avalia trade-offs, responde a objeções e ajusta posição ou estratégia com nuance.',
    complexity_controls_pt_br = '["Contestar pressupostos com respeito","Exigir justificativa e ressalva","Permitir linguagem idiomática clara no contexto"]'
where min_level = 'B2' and max_level = 'B2';

do $$
begin
  if exists (
    select 1 from public.conversation_scenarios
    where is_published
      and (jsonb_array_length(complexity_controls_pt_br) = 0
        or char_length(cefr_rationale_pt_br) < 20)
  ) then
    raise exception 'Conversation CEFR audit failure: published scenario lacks rationale or controls';
  end if;
end;
$$;
