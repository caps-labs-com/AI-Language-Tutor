# Pipeline de pesquisa de conteúdo

O coletor `scripts/collect_language_sources.py` pesquisa explicações,
exercícios, notícias e textos nos quatro idiomas do produto. O corpus resultante
é material de pesquisa, não conteúdo pronto para publicação.

## Princípios

1. Respeitar `robots.txt`, limitar frequência e identificar o user-agent.
2. Não contornar login, paywall, CAPTCHA ou bloqueio de acesso.
3. Guardar texto integral somente de domínios explicitamente classificados como
   licença aberta.
4. Para fontes protegidas ou de licença desconhecida, guardar apenas metadados,
   URL e trecho curto.
5. Manter URL, licença, política de uso, consulta, data e hash para auditoria.
6. Tratar todo texto externo como não confiável. Ele nunca vira prompt de sistema
   nem instrução para ferramentas.
7. Exigir revisão humana, checagem factual, classificação CEFR e verificação de
   originalidade antes da publicação.

## Execução A1 gratuita

Sem nenhuma chave, o script consulta as APIs públicas de Wikibooks e Wikinews:

```bash
python scripts/collect_language_sources.py \
  --languages en es fr it \
  --levels A1 \
  --results-per-query 5
```

O SQLite é salvo por padrão em:

```text
.local/content-research/sources.sqlite3
```

A pasta `.local/` já é ignorada pelo Git.

## Busca ampla com Brave Search

Para encontrar também British Council, Cambridge, TV5Monde, Lingolia e outras
fontes, crie uma chave da Brave Search API e exporte apenas na sessão local:

```bash
export BRAVE_SEARCH_API_KEY="sua-chave"
python scripts/collect_language_sources.py --levels A1 --results-per-query 10
```

Não coloque a chave em arquivos versionados. Sem `BRAVE_SEARCH_API_KEY`, essa
etapa é ignorada e o coletor continua com Wikimedia.

## Coleta máxima de todos os idiomas e níveis

O orquestrador executa separadamente as 16 combinações de idioma e nível, usa o
máximo de 20 resultados por consulta e consolida tudo no mesmo SQLite:

```bash
uv --directory backend run python ../scripts/collect_all_language_sources.py
```

Com Brave Search, exporte `BRAVE_SEARCH_API_KEY` antes do comando. Sem a chave,
o script continua apenas com as fontes selecionadas, Wikibooks, Wikiversity e
Wikinews. Para executar sem Brave explicitamente:

```bash
uv --directory backend run python ../scripts/collect_all_language_sources.py \
  --skip-brave
```

Cada combinação possui retries independentes. Os logs ficam em
`.local/content-research/logs/`, e o processo termina com código diferente de
zero se alguma combinação continuar falhando após as tentativas.

Para conferir os 16 comandos sem fazer requisições:

```bash
uv --directory backend run python ../scripts/collect_all_language_sources.py \
  --dry-run
```

Para descobrir URLs sem acessar as páginas encontradas:

```bash
python scripts/collect_language_sources.py --levels A1 --metadata-only
```

Para exportar uma cópia JSONL local:

```bash
python scripts/collect_language_sources.py \
  --levels A1 \
  --export-jsonl .local/content-research/sources.jsonl
```

## Dados armazenados

`research_sources` contém:

- idioma, nível sugerido e categoria;
- consulta e provedor de descoberta;
- URL de origem e atribuição;
- título, descrição e trecho;
- texto extraído somente quando permitido;
- licença e política de uso;
- status de `robots.txt`/download, erro, hash e timestamps.

`collection_runs` registra cada execução e suas contagens.

`source_discoveries` preserva todas as associações entre uma URL, idioma, nível,
categoria e consulta. Assim, a mesma fonte pode ser relevante para A1 e B1 sem
que uma execução sobrescreva a outra.

O nível é apenas uma pista derivada da consulta. Uma etapa posterior deve medir
vocabulário, tamanho de sentença, estruturas gramaticais e adequação CEFR.

## Processo para gerar conteúdo do produto

```text
descoberta -> corpus local -> seleção/licença -> geração com fontes citadas
          -> validação CEFR -> revisão linguística -> detecção de similaridade
          -> migration candidata -> revisão humana -> publicação
```

Conteúdo copyleft exige análise antes de gerar derivados para um produto
comercial. Fontes `metadata_and_short_excerpt_only` servem para identificar
tópicos, padrões curriculares e links de referência, não para reescrita próxima.

## Validação

```bash
uv --directory backend run ruff check ../scripts/collect_language_sources.py
uv --directory backend run pytest ../scripts/test_collect_language_sources.py
```

# Pipeline de auditoria e geração

O corpus coletado é material de pesquisa não confiável. Ele não deve ser copiado para o produto nem usado diretamente em migrations. O fluxo possui quatro gates independentes:

```text
sources.sqlite3 -> audit.jsonl -> candidates.jsonl
                -> validated-candidates.jsonl -> migration SQL revisável
```

1. Audite idioma, nível estimado, relevância, qualidade, licença e política de uso:

```bash
python3 scripts/audit_language_corpus.py
```

O nível estimado da fonte é informativo. Uma fonte B1/B2 pode fundamentar a
criação de um conteúdo original A1, portanto essa diferença gera um aviso, não
uma reprovação. O nível solicitado é aplicado ao prompt e obrigatório na
validação do candidato final.

Quando não existe fonte aprovada exatamente no nível solicitado, o gerador pode
usar fontes aprovadas de outros níveis do mesmo idioma e categoria, priorizando
as mais próximas. Para gramática, vários candidatos são distribuídos em ciclo
pelos conceitos previstos na matriz curricular; `--concept` continua permitindo
fixar um único conceito explicitamente.

2. Gere conteúdo original a partir de fontes aprovadas. Execute por idioma, nível e tipo. O modo `mock` permite validar o pipeline sem custo:

```bash
python3 scripts/generate_learning_candidates.py \
  --language en --level A1 --content-type reading --provider mock
```

Para geração real, use `--provider gemini` com `GEMINI_API_KEY`, ou `--provider deepseek` com `DEEPSEEK_API_KEY`. A chave deve existir somente no ambiente/secret manager, nunca em argumentos, arquivos do corpus ou Git.

3. Valide novamente o contrato do banco, a matriz CEFR, idioma, respostas, opções distintas e similaridade de 8-gramas com as fontes:

```bash
python3 scripts/validate_learning_candidates.py
```

O comando retorna código 1 se qualquer candidato for rejeitado. Avisos de nível heurístico não aprovam nem reprovam sozinhos; erros estruturais, fonte não aprovada e similaridade excessiva sempre reprovam.

4. Gere uma migration local para revisão humana:

```bash
python3 scripts/build_learning_content_migration.py
```

A saída padrão fica em `.local/content-research/migrations/` e usa `is_published = false`. Depois da revisão pedagógica, factual, autoral e de segurança, informe explicitamente um caminho versionado. `--publish` deve ser usado somente após essa revisão:

```bash
python3 scripts/build_learning_content_migration.py \
  --output supabase/migrations/AAAAMMDDHHMMSS_generated_learning_content.sql \
  --publish
```

O builder nunca conecta no Supabase nem aplica SQL. Ele ignora candidatos rejeitados e aborta quando não existe nenhum aprovado.

As quantidades de questões seguem o contrato efetivo do banco: leituras A1/A2/B1/B2 usam 3/4/6/8 questões e lições rápidas usam 2/3/4/5. Isso prevalece sobre faixas pedagógicas mais amplas da matriz curricular.

## Execução completa com DeepSeek

O orquestrador executa os quatro gates na ordem correta e lê somente
`DEEPSEEK_API_KEY` e `DEEPSEEK_MODEL` de `backend/.env`:

```bash
scripts/run_learning_content_pipeline.sh \
  --language en \
  --level A1 \
  --content-type reading \
  --count 2
```

Cada execução recebe um diretório isolado em
`.local/content-research/runs/`. O script exige a combinação explicitamente
para evitar uma geração cara de todos os idiomas e níveis por acidente. A
migration resultante continua não publicada. Para indicar outro caminho de
saída, use `--output`; isso não publica o conteúdo automaticamente.

Para executar todos os idiomas de um nível, use `all`. O valor de `--count` é
aplicado a cada idioma; portanto, o exemplo abaixo tenta gerar 40 conteúdos no
total:

```bash
scripts/run_learning_content_pipeline.sh \
  --language all --level A1 --content-type reading --count 10
```

O script continua quando um candidato é rejeitado e envia somente os aprovados
para a migration. Se faltar fonte aprovada para algum idioma, ele processa os
demais, informa a execução parcial e termina com status diferente de zero.

## Substituição completa de um nível

Para executar os quatro idiomas e os três tipos de conteúdo com 50 candidatos
por combinação:

```bash
scripts/run_level_content_pipeline.sh --level A1 --confirm-cost
```

Isso representa até 600 chamadas à DeepSeek. O lote executa 12 vezes o pipeline
individual e mantém os artefatos em `.local/content-research/batches/`. Somente
se todas as combinações concluírem ele cria duas migrations consecutivas:

1. exclusão de `reading_passages`, `quick_lessons` e `grammar_topics` do nível;
2. inserção publicada dos candidatos aprovados.

Se uma combinação falhar, nenhuma migration destrutiva é criada. Os arquivos
SQL são apenas gerados em `supabase/migrations`; o script não aplica migrations,
não adiciona arquivos ao Git e não faz commit.

Para retomar um lote interrompido sem repetir combinações validadas:

```bash
scripts/run_level_content_pipeline.sh \
  --level A1 --count 50 --confirm-cost \
  --resume .local/content-research/batches/ID-DO-LOTE
```

O gerador salva um checkpoint após cada candidato. Respostas vazias, JSON em
bloco Markdown e falhas temporárias da API são tratadas com até três tentativas.

Cada combinação de idioma e tipo precisa ter pelo menos 15 candidatos
aprovados. Se ficar abaixo disso, o orquestrador retoma o mesmo diretório e tenta
reparar os reprovados até duas vezes. Esses valores podem ser ajustados com
`--minimum-approved N` e `--combination-retries N`. Se o mínimo continuar não
atendido, o lote para sem criar a migration de exclusão.

Após a primeira validação, o pipeline normaliza variações equivalentes de
schema e reenvia somente os candidatos ainda rejeitados ao modelo, incluindo os
motivos objetivos da reprovação. Por padrão são realizadas até duas rodadas de
reparo; ajuste com `--repair-attempts N` ou use zero para desabilitar. Cada
reparo é revalidado e registrado em `generation.repair_history`.

Teste offline dos invariantes:

```bash
python3 -m unittest scripts/test_content_pipeline.py
```
