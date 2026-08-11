-- Cenários imersivos: personagem, progressão dramática e adequação por nível.

alter table public.conversation_scenarios
  add column character_role_pt_br text not null default 'Interlocutor do cenário'
    check (char_length(character_role_pt_br) between 1 and 300),
  add column character_personality_pt_br text not null default 'Atencioso, natural e colaborativo'
    check (char_length(character_personality_pt_br) between 1 and 600),
  add column situation_pt_br text not null default 'Conduza a situação descrita pelo objetivo.'
    check (char_length(situation_pt_br) between 1 and 1000),
  add column register_pt_br text not null default 'Neutro e adequado à situação'
    check (char_length(register_pt_br) between 1 and 300),
  add column conversation_beats_pt_br jsonb not null default '[]'::jsonb
    check (jsonb_typeof(conversation_beats_pt_br) = 'array'
      and jsonb_array_length(conversation_beats_pt_br) between 0 and 8),
  add column complications_pt_br jsonb not null default '[]'::jsonb
    check (jsonb_typeof(complications_pt_br) = 'array'
      and jsonb_array_length(complications_pt_br) between 0 and 5);

update public.conversation_scenarios
set character_role_pt_br = case category
      when 'professional' then 'Profissional experiente diretamente envolvido na situação'
      when 'travel' then 'Profissional local acostumado a orientar viajantes'
      else 'Pessoa real diretamente envolvida na situação cotidiana'
    end,
    character_personality_pt_br = case category
      when 'professional' then 'Educado, objetivo e exigente; reage aos argumentos e pede esclarecimentos concretos.'
      when 'travel' then 'Prestativo e eficiente, mas não antecipa todas as informações sem que o aluno pergunte.'
      else 'Natural, cordial e curioso; compartilha pequenas preferências e reage ao que o aluno disser.'
    end,
    situation_pt_br = description_pt_br || ' O personagem deve manter a situação realista e avançar gradualmente.',
    register_pt_br = case
      when category = 'professional' then 'Profissional e cortês'
      when id in ('doctor', 'hotel', 'airport') then 'Cortês e relativamente formal'
      else 'Natural e cotidiano'
    end,
    conversation_beats_pt_br = goals_pt_br,
    complications_pt_br = case
      when category = 'professional' then '["Surge uma restrição de prazo ou prioridade que exige negociação."]'::jsonb
      when category = 'travel' then '["Uma informação ou opção inicialmente desejada não está disponível."]'::jsonb
      else '["O personagem pede uma preferência ou esclarecimento adicional antes de prosseguir."]'::jsonb
    end;

insert into public.conversation_scenarios (
  id, category, title_pt_br, description_pt_br, objective_pt_br,
  min_level, max_level, planned_minutes, icon, accent, openings,
  goals_pt_br, sort_order, character_role_pt_br, character_personality_pt_br,
  situation_pt_br, register_pt_br, conversation_beats_pt_br, complications_pt_br
) values
(
  'bus-ticket', 'travel', 'Comprando uma passagem', 'Escolha destino, horário e quantidade de passagens.',
  'Compre uma passagem e confirme horário, plataforma e preço.', 'A1', 'A1', 8, 'plane', 'blue',
  '{"en":"Hello! Where would you like to travel today?","es":"¡Hola! ¿Adónde quiere viajar hoy?","fr":"Bonjour ! Où souhaitez-vous aller aujourd’hui ?","it":"Buongiorno! Dove desidera andare oggi?"}',
  '["Dizer o destino","Escolher um horário","Informar a quantidade","Confirmar preço e plataforma"]', 15,
  'Atendente da bilheteria', 'Paciente, cordial e prático; apresenta escolhas simples e espera o aluno decidir.',
  'Há alguns horários disponíveis. O atendente precisa entender exatamente qual passagem o aluno deseja.',
  'Cortês, simples e direto', '["Perguntar o destino","Oferecer dois horários","Confirmar quantidade","Informar preço e plataforma"]',
  '["O primeiro horário escolhido está lotado; ofereça duas alternativas simples."]'
),
(
  'asking-directions', 'travel', 'Pedindo informações', 'Pergunte como chegar a um lugar e confirme o caminho.',
  'Entenda instruções simples e confirme um ponto de referência.', 'A1', 'A1', 8, 'globe', 'teal',
  '{"en":"Hi! You look a little lost. Can I help?","es":"¡Hola! Parece que está un poco perdido. ¿Puedo ayudar?","fr":"Bonjour ! Vous semblez un peu perdu. Je peux vous aider ?","it":"Salve! Sembra un po’ perso. Posso aiutarla?"}',
  '["Dizer aonde quer ir","Entender direita ou esquerda","Identificar um ponto de referência","Agradecer e confirmar"]', 16,
  'Morador local', 'Amigável e claro; dá uma instrução de cada vez e verifica se foi compreendido.',
  'O aluno está em uma área movimentada e precisa encontrar um local próximo.', 'Cotidiano e prestativo',
  '["Descobrir o destino","Dar a primeira direção","Acrescentar um ponto de referência","Confirmar o caminho"]',
  '["Uma rua está fechada; indique uma rota alternativa curta."]'
),
(
  'basic-pharmacy', 'daily', 'Na farmácia', 'Explique uma necessidade simples e entenda como usar um produto.',
  'Pedir um produto e confirmar quantidade e instrução básica.', 'A1', 'A1', 8, 'health', 'amber',
  '{"en":"Good morning. What do you need today?","es":"Buenos días. ¿Qué necesita hoy?","fr":"Bonjour. De quoi avez-vous besoin aujourd’hui ?","it":"Buongiorno. Di cosa ha bisogno oggi?"}',
  '["Dizer o que precisa","Responder uma pergunta simples","Escolher uma opção","Confirmar como usar"]', 17,
  'Farmacêutico que orienta sobre produtos comuns sem diagnosticar', 'Cuidadoso, claro e responsável; faz perguntas básicas e recomenda procurar um médico diante de sinais graves.',
  'O aluno procura um produto comum. O personagem não faz diagnóstico nem prescreve tratamento.', 'Cortês e claro',
  '["Entender a necessidade","Perguntar duração ou preferência","Apresentar opção comum","Explicar uso do rótulo"]',
  '["O produto inicialmente pedido está indisponível; ofereça uma alternativa equivalente sem alegações médicas."]'
),
(
  'daily-routine', 'daily', 'Falando sobre a rotina', 'Conte como é seu dia e descubra a rotina de outra pessoa.',
  'Descrever horários, hábitos e uma preferência cotidiana.', 'A1', 'A1', 8, 'users', 'purple',
  '{"en":"Hi! What time do you usually start your day?","es":"¡Hola! ¿A qué hora empieza normalmente su día?","fr":"Salut ! À quelle heure commencez-vous normalement votre journée ?","it":"Ciao! A che ora inizi normalmente la giornata?"}',
  '["Dizer um horário","Descrever duas atividades","Falar de uma preferência","Fazer uma pergunta de volta"]', 18,
  'Novo colega em uma conversa informal', 'Curioso e simpático; também compartilha detalhes breves da própria rotina.',
  'Duas pessoas estão se conhecendo e comparam hábitos cotidianos.', 'Informal e amistoso',
  '["Perguntar sobre manhã","Comparar trabalho ou estudo","Falar de tempo livre","Convidar uma pergunta recíproca"]',
  '["Os horários são muito diferentes; pergunte como o aluno organiza o tempo."]'
),
(
  'lost-luggage', 'travel', 'Bagagem extraviada', 'Relate o desaparecimento de uma mala e forneça detalhes.',
  'Registrar a bagagem perdida e combinar como receber atualizações.', 'A2', 'A2', 10, 'plane', 'blue',
  '{"en":"I’m sorry your bag did not arrive. Could you describe it?","es":"Lamento que su maleta no haya llegado. ¿Puede describirla?","fr":"Je suis désolé que votre valise ne soit pas arrivée. Pouvez-vous la décrire ?","it":"Mi dispiace che la valigia non sia arrivata. Può descriverla?"}',
  '["Descrever a mala","Informar o voo","Dar endereço de contato","Confirmar o protocolo"]', 19,
  'Funcionário do setor de bagagens', 'Calmo, metódico e empático; pede uma informação por vez.',
  'A mala não apareceu na esteira e é necessário abrir um registro.', 'Profissional e acessível',
  '["Pedir descrição","Confirmar etiqueta ou voo","Coletar contato","Explicar próximo passo"]',
  '["O número da etiqueta não está disponível; peça outra forma de identificar a bagagem."]'
),
(
  'return-product', 'daily', 'Trocando um produto', 'Explique um problema e negocie troca ou reembolso.',
  'Apresentar o problema, mostrar comprovante e escolher uma solução.', 'A2', 'A2', 10, 'shopping', 'coral',
  '{"en":"Hello. How can I help you with this purchase?","es":"Hola. ¿Cómo puedo ayudarle con esta compra?","fr":"Bonjour. Comment puis-je vous aider avec cet achat ?","it":"Buongiorno. Come posso aiutarla con questo acquisto?"}',
  '["Explicar o defeito","Dizer quando comprou","Apresentar o comprovante","Escolher troca ou reembolso"]', 20,
  'Atendente de loja', 'Educado e orientado por regras; busca solução, mas precisa confirmar detalhes.',
  'O aluno volta à loja com um produto problemático.', 'Cortês e objetivo',
  '["Ouvir o problema","Confirmar compra","Explicar opções","Concluir a solução"]',
  '["O mesmo modelo não está em estoque; ofereça crédito ou outro produto."]'
),
(
  'weekend-plans', 'daily', 'Combinando o fim de semana', 'Faça sugestões e combine horário e local.',
  'Chegar a um plano que agrade às duas pessoas.', 'A2', 'A2', 10, 'users', 'teal',
  '{"en":"Are you free this weekend? I’d like to do something together.","es":"¿Está libre este fin de semana? Me gustaría hacer algo juntos.","fr":"Vous êtes libre ce week-end ? J’aimerais faire quelque chose ensemble.","it":"Sei libero questo fine settimana? Mi piacerebbe fare qualcosa insieme."}',
  '["Sugerir uma atividade","Explicar uma preferência","Combinar horário","Definir local"]', 21,
  'Amigo fazendo planos', 'Espontâneo, bem-humorado e flexível; tem preferências próprias.',
  'Duas pessoas tentam conciliar interesses e disponibilidade.', 'Informal e natural',
  '["Perguntar disponibilidade","Trocar sugestões","Comparar preferências","Fechar horário e local"]',
  '["A previsão do tempo muda; proponha adaptar o plano."]'
),
(
  'new-neighbor', 'daily', 'Conhecendo o vizinho', 'Converse sobre o bairro, serviços e convivência.',
  'Apresentar-se, pedir uma recomendação e combinar ajuda simples.', 'A2', 'A2', 10, 'home', 'purple',
  '{"en":"Hi, I’m your neighbor from across the hall. Did you just move in?","es":"Hola, soy su vecino de enfrente. ¿Acaba de mudarse?","fr":"Bonjour, je suis votre voisin d’en face. Vous venez d’emménager ?","it":"Ciao, sono il vicino di fronte. Ti sei appena trasferito?"}',
  '["Apresentar-se","Perguntar sobre o bairro","Pedir recomendação","Combinar contato ou ajuda"]', 22,
  'Vizinho antigo do prédio', 'Acolhedor e conversador sem ser invasivo; conhece bem a região.',
  'O aluno acabou de se mudar e encontra um vizinho no corredor.', 'Informal e cordial',
  '["Dar boas-vindas","Perguntar sobre mudança","Recomendar um serviço","Oferecer ajuda limitada"]',
  '["Há uma regra do prédio que o novo morador ainda não conhece."]'
),
(
  'project-update', 'professional', 'Atualização de projeto', 'Apresente progresso, riscos e próximos passos.',
  'Dar uma atualização clara e negociar uma prioridade.', 'B1', 'B1', 12, 'briefcase', 'navy',
  '{"en":"Let’s review the project. What has your team completed so far?","es":"Revisemos el proyecto. ¿Qué ha completado su equipo hasta ahora?","fr":"Faisons le point sur le projet. Qu’est-ce que votre équipe a terminé ?","it":"Facciamo il punto sul progetto. Cosa ha completato il suo team?"}',
  '["Resumir progresso","Explicar um obstáculo","Justificar prioridade","Definir próximo passo"]', 23,
  'Gerente responsável pelo projeto', 'Atento, pragmático e questionador; valoriza fatos, prazos e propostas.',
  'Uma reunião curta avalia andamento e riscos antes de uma entrega.', 'Profissional e direto',
  '["Pedir panorama","Investigar risco","Questionar prioridade","Acordar ação e responsável"]',
  '["Um prazo é antecipado; peça ao aluno que reorganize prioridades."]'
),
(
  'formal-complaint', 'professional', 'Reclamação formal', 'Explique uma falha de serviço e busque reparação.',
  'Organizar fatos, demonstrar impacto e negociar uma solução.', 'B1', 'B1', 12, 'support', 'coral',
  '{"en":"I understand you want to make a formal complaint. Please tell me what happened.","es":"Entiendo que quiere presentar una reclamación formal. Dígame qué ocurrió.","fr":"Je comprends que vous souhaitez déposer une réclamation. Dites-moi ce qui s’est passé.","it":"Capisco che desidera presentare un reclamo formale. Mi dica cosa è successo."}',
  '["Relatar fatos em ordem","Explicar impacto","Responder a uma objeção","Propor reparação"]', 24,
  'Supervisor de atendimento', 'Profissional e cético sem ser hostil; verifica fatos antes de autorizar solução.',
  'O atendimento anterior não resolveu o problema e o aluno pede escalonamento.', 'Formal e controlado',
  '["Ouvir cronologia","Checar evidência","Explicar limite da empresa","Negociar reparação"]',
  '["A solução pedida excede a política; apresente uma contraproposta razoável."]'
),
(
  'cultural-exchange', 'daily', 'Intercâmbio cultural', 'Compare costumes sem generalizações.',
  'Explicar um costume brasileiro e explorar diferenças culturais.', 'B1', 'B1', 12, 'globe', 'teal',
  '{"en":"I’m curious about everyday life in Brazil. What custom would you explain to a visitor?","es":"Tengo curiosidad por la vida cotidiana en Brasil. ¿Qué costumbre explicaría a un visitante?","fr":"La vie quotidienne au Brésil m’intéresse. Quelle coutume expliqueriez-vous à un visiteur ?","it":"Sono curioso della vita quotidiana in Brasile. Quale usanza spiegherebbe a un visitatore?"}',
  '["Descrever um costume","Dar exemplo pessoal","Comparar com outro país","Evitar generalização"]', 25,
  'Colega estrangeiro genuinamente curioso', 'Aberto, reflexivo e respeitoso; compartilha comparações e pede exemplos.',
  'Duas pessoas trocam experiências culturais sem representar toda uma população.', 'Informal, respeitoso e reflexivo',
  '["Escolher costume","Pedir contexto","Compartilhar contraste","Explorar exceções"]',
  '["O personagem apresenta uma interpretação equivocada e aceita ser corrigido."]'
),
(
  'travel-disruption', 'travel', 'Problema durante a viagem', 'Reorganize planos após atraso ou cancelamento.',
  'Entender alternativas e escolher uma solução justificando prioridades.', 'B1', 'B1', 12, 'plane', 'amber',
  '{"en":"Your connection has been cancelled. Let’s look at the available alternatives.","es":"Su conexión ha sido cancelada. Veamos las alternativas disponibles.","fr":"Votre correspondance a été annulée. Regardons les solutions possibles.","it":"La coincidenza è stata cancellata. Vediamo le alternative disponibili."}',
  '["Confirmar o problema","Explicar prioridade","Comparar alternativas","Negociar assistência"]', 26,
  'Agente de viagens durante uma operação irregular', 'Calmo e eficiente, porém limitado pelas opções disponíveis.',
  'Um cancelamento exige escolher entre chegar mais tarde, mudar rota ou pernoitar.', 'Profissional e empático',
  '["Explicar cancelamento","Descobrir prioridade","Apresentar alternativas","Confirmar nova logística"]',
  '["A alternativa mais rápida exige uma conexão adicional ou custo diferente."]'
),
(
  'performance-review', 'professional', 'Avaliação de desempenho', 'Discuta resultados, feedback e desenvolvimento.',
  'Defender resultados, responder a críticas e negociar metas.', 'B2', 'B2', 15, 'briefcase', 'navy',
  '{"en":"Let’s discuss your performance this cycle. How would you assess your main results?","es":"Hablemos de su desempeño este ciclo. ¿Cómo evaluaría sus principales resultados?","fr":"Parlons de vos performances ce semestre. Comment évaluez-vous vos principaux résultats ?","it":"Parliamo della sua performance di questo periodo. Come valuta i risultati principali?"}',
  '["Avaliar resultados com evidências","Responder a feedback difícil","Identificar desenvolvimento","Negociar meta"]', 27,
  'Gestor experiente conduzindo avaliação', 'Justo, analítico e direto; reconhece evidências, mas questiona afirmações vagas.',
  'Uma avaliação formal equilibra resultados, lacunas e expectativas futuras.', 'Profissional, diplomático e preciso',
  '["Solicitar autoavaliação","Confrontar evidências","Explorar desenvolvimento","Negociar meta mensurável"]',
  '["O gestor discorda parcialmente da autoavaliação e apresenta um exemplo concreto."]'
),
(
  'crisis-meeting', 'professional', 'Reunião de crise', 'Priorize ações sob pressão e comunique riscos.',
  'Construir um plano imediato diante de uma falha crítica.', 'B2', 'B2', 15, 'headphones', 'coral',
  '{"en":"We have a serious service outage and limited information. What should we do first?","es":"Tenemos una interrupción grave y poca información. ¿Qué debemos hacer primero?","fr":"Nous avons une panne grave et peu d’informations. Que devons-nous faire en premier ?","it":"Abbiamo un grave disservizio e poche informazioni. Cosa dobbiamo fare per prima cosa?"}',
  '["Definir prioridade","Avaliar risco e incerteza","Contestar proposta","Comunicar decisão"]', 28,
  'Diretor responsável pela resposta à crise', 'Decisivo e exigente; testa pressupostos e exige justificativas concisas.',
  'Uma equipe precisa agir antes de conhecer todas as causas, protegendo clientes e operação.', 'Urgente, profissional e controlado',
  '["Estabelecer fatos","Priorizar contenção","Debater comunicação","Designar ação e revisão"]',
  '["Uma nova informação contradiz a hipótese inicial; exija adaptação do plano."]'
),
(
  'ai-ethics-debate', 'professional', 'Debate sobre ética em IA', 'Analise benefícios, riscos e responsabilidades.',
  'Defender uma posição nuançada e responder a objeções.', 'B2', 'B2', 15, 'debate', 'purple',
  '{"en":"Should companies be allowed to use AI for decisions that affect people’s careers?","es":"¿Deberían las empresas usar IA para decisiones que afectan la carrera de las personas?","fr":"Les entreprises devraient-elles utiliser l’IA pour des décisions qui affectent les carrières ?","it":"Le aziende dovrebbero usare l’IA per decisioni che influenzano la carriera delle persone?"}',
  '["Apresentar tese","Definir limite ou princípio","Responder a contraexemplo","Propor salvaguarda"]', 29,
  'Debatedor informado com posição parcialmente contrária', 'Rigoroso, respeitoso e intelectualmente honesto; reconhece bons argumentos e explora consequências.',
  'O debate busca uma política equilibrada, não uma vitória retórica.', 'Formal, argumentativo e nuançado',
  '["Solicitar posição","Testar princípio","Apresentar caso-limite","Buscar salvaguarda comum"]',
  '["Apresente um caso em que o princípio do aluno produz uma consequência indesejada."]'
),
(
  'conference-networking', 'professional', 'Networking em conferência', 'Crie conexão profissional sem parecer ensaiado.',
  'Apresentar trabalho, descobrir interesses comuns e propor continuidade.', 'B2', 'B2', 15, 'users', 'teal',
  '{"en":"I don’t think we’ve met. What brought you to this conference?","es":"Creo que no nos conocemos. ¿Qué le ha traído a esta conferencia?","fr":"Je crois que nous ne nous connaissons pas. Qu’est-ce qui vous amène à cette conférence ?","it":"Non credo che ci siamo già conosciuti. Cosa l’ha portata a questa conferenza?"}',
  '["Apresentar-se com naturalidade","Explorar interesse comum","Explicar projeto com clareza","Propor próximo contato"]', 30,
  'Especialista da área encontrado durante intervalo', 'Sociável, perspicaz e ocupado; demonstra interesse quando recebe detalhes específicos.',
  'Uma conversa espontânea durante o intervalo pode gerar colaboração, mas o tempo é limitado.', 'Profissional, natural e cordial',
  '["Abrir conversa","Encontrar ponto comum","Trocar visão sobre trabalho","Combinar continuidade"]',
  '["O personagem precisa sair em poucos minutos; peça uma síntese convincente e um próximo passo."]'
)
on conflict (id) do update set
  title_pt_br = excluded.title_pt_br,
  description_pt_br = excluded.description_pt_br,
  objective_pt_br = excluded.objective_pt_br,
  openings = excluded.openings,
  goals_pt_br = excluded.goals_pt_br,
  character_role_pt_br = excluded.character_role_pt_br,
  character_personality_pt_br = excluded.character_personality_pt_br,
  situation_pt_br = excluded.situation_pt_br,
  register_pt_br = excluded.register_pt_br,
  conversation_beats_pt_br = excluded.conversation_beats_pt_br,
  complications_pt_br = excluded.complications_pt_br,
  is_published = true,
  updated_at = now();
