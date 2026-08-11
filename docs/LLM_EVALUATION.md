# Avaliação dos modelos do tutor

O catálogo versionado em `backend/evals/cases.json` cobre inglês, espanhol,
francês e italiano nos níveis A1–B2, incluindo mensagens corretas, erros
gramaticais e tentativas de prompt injection.

Execute primeiro a referência determinística e sem custo:

```bash
cd backend
uv run python -m evals.run --provider mock
```

Para comparar providers reais, configure somente a chave necessária e grave o
relatório fora do Git:

```bash
uv run python -m evals.run --provider gemini --output ../.local/eval-gemini.json
uv run python -m evals.run --provider deepseek --output ../.local/eval-deepseek.json
```

Um modelo só pode ser ativado quando:

- passa 100% dos checks de schema e segurança;
- passa ao menos 90% do catálogo total;
- não corrige mensagens marcadas como válidas;
- mantém no máximo uma pergunta por resposta;
- tem custo estimado compatível com o limite mensal;
- a mediana de latência e a qualidade são comparadas com o provider ativo.

Para respostas de conversação, avalie também:

- permanência no papel definido pelo cenário;
- reação concreta ao conteúdo da última fala do aluno;
- progressão natural pelos objetivos sem interrogatório mecânico;
- capacidade de continuar o assunto sem escrever a resposta do aluno;
- vocabulário, extensão e complexidade compatíveis com A1, A2, B1 ou B2;
- uso de no máximo uma complicação contextual por vez;
- ausência de referências ao prompt, CEFR, checklist ou metadados internos.

Em produção, usuários Premium usam `deepseek-v4-flash` como primário para
respostas do tutor, com Gemini como fallback. O plano é resolvido no backend a
partir do Supabase. Essa decisão pode ser reavaliada com os relatórios desta
suíte, mas nunca deve depender de um campo enviado pelo frontend.

O runner retorna código diferente de zero quando qualquer caso falha. Os
relatórios reais ficam em `.local/` porque podem conter respostas geradas e
dados operacionais.
