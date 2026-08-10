#!/usr/bin/env bash
# Run the audited research-to-migration pipeline with DeepSeek.

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "${script_dir}/.." && pwd)"
env_file="${project_root}/backend/.env"

language=""
level=""
content_type=""
count="1"
concept=""
migration_output=""
run_dir_override=""
repair_attempts="2"

usage() {
  cat <<'EOF'
Uso:
  scripts/run_learning_content_pipeline.sh \
    --language en --level A1 --content-type reading [opções]

Obrigatório:
  --language en|es|fr|it|all
  --level A1|A2|B1|B2
  --content-type reading|grammar|quick_lesson

Opções:
  --count N             Quantidade de candidatos (padrão: 1)
  --concept ID          Conceito da curriculum/cefr_matrix.json
  --output ARQUIVO      Caminho da migration SQL não publicada
  --run-dir DIRETÓRIO   Diretório exato da execução (uso por orquestradores)
  --repair-attempts N   Rodadas de reparo dos reprovados (padrão: 2)
  --env-file ARQUIVO    Arquivo com DEEPSEEK_API_KEY e DEEPSEEK_MODEL
  -h, --help            Exibe esta ajuda

Exemplo:
  scripts/run_learning_content_pipeline.sh \
    --language en --level A1 --content-type reading --count 2

Todos os idiomas de um nível (gera --count por idioma):
  scripts/run_learning_content_pipeline.sh \
    --language all --level A1 --content-type reading --count 10
EOF
}

while (($#)); do
  case "$1" in
    --language) language="${2:-}"; shift 2 ;;
    --level) level="${2:-}"; shift 2 ;;
    --content-type) content_type="${2:-}"; shift 2 ;;
    --count) count="${2:-}"; shift 2 ;;
    --concept) concept="${2:-}"; shift 2 ;;
    --output) migration_output="${2:-}"; shift 2 ;;
    --run-dir) run_dir_override="${2:-}"; shift 2 ;;
    --repair-attempts) repair_attempts="${2:-}"; shift 2 ;;
    --env-file) env_file="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$language" in en|es|fr|it|all) ;; *) echo "--language inválido" >&2; exit 2 ;; esac
case "$level" in A1|A2|B1|B2) ;; *) echo "--level inválido" >&2; exit 2 ;; esac
case "$content_type" in reading|grammar|quick_lesson) ;; *) echo "--content-type inválido" >&2; exit 2 ;; esac
if [[ ! "$count" =~ ^[1-9][0-9]*$ ]]; then
  echo "--count deve ser um inteiro maior que zero" >&2
  exit 2
fi
if [[ ! "$repair_attempts" =~ ^[0-9]+$ ]]; then
  echo "--repair-attempts deve ser um inteiro maior ou igual a zero" >&2
  exit 2
fi
if [[ "$language" == "all" && -n "$concept" ]]; then
  echo "--concept não pode ser combinado com --language all, pois os IDs são específicos por idioma" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  echo "Arquivo de ambiente não encontrado: $env_file" >&2
  exit 1
fi

# Reads only the requested key. Unlike `source`, this does not execute .env content
# or expose unrelated secrets to child processes. Multiline values are unsupported.
read_env_value() {
  local key="$1" line value
  line="$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=(.*)$/\2/p" "$env_file" | tail -n 1)"
  value="${line#"${line%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  else
    value="${value%%[[:space:]]#*}"
  fi
  printf '%s' "$value"
}

deepseek_api_key="$(read_env_value DEEPSEEK_API_KEY)"
deepseek_model="$(read_env_value DEEPSEEK_MODEL)"
if [[ -z "$deepseek_api_key" ]]; then
  echo "DEEPSEEK_API_KEY não está configurada em $env_file" >&2
  exit 1
fi
if [[ -z "$deepseek_model" ]]; then
  echo "DEEPSEEK_MODEL não está configurado em $env_file" >&2
  exit 1
fi

run_id="$(date -u +%Y%m%dT%H%M%SZ)-${language}-${level}-${content_type}"
if [[ -n "$run_dir_override" ]]; then
  if [[ "$run_dir_override" == /* ]]; then
    run_dir="$run_dir_override"
  else
    run_dir="${project_root}/${run_dir_override}"
  fi
else
  run_dir="${project_root}/.local/content-research/runs/${run_id}"
fi
audit_file="${run_dir}/audit.jsonl"
audit_summary="${run_dir}/audit-summary.json"
candidates_file="${run_dir}/candidates.jsonl"
validated_file="${run_dir}/validated-candidates.jsonl"
if [[ -z "$migration_output" ]]; then
  migration_output="${run_dir}/${run_id}_generated_learning_content.sql"
elif [[ "$migration_output" != /* ]]; then
  migration_output="${project_root}/${migration_output}"
fi
mkdir -p "$run_dir"

cd "$project_root"

echo "[1/4] Auditando o corpus..."
python3 scripts/audit_language_corpus.py \
  --output "$audit_file" \
  --summary "$audit_summary"

if [[ "$language" == "all" ]]; then
  languages=(en es fr it)
else
  languages=("$language")
fi

echo "[2/4] Gerando $count candidato(s) por idioma com DeepSeek..."
generation_failures=()
for current_language in "${languages[@]}"; do
  echo "  - ${current_language}/${level}/${content_type}"
  generate_command=(
    python3 scripts/generate_learning_candidates.py
    --audit "$audit_file"
    --output "$candidates_file"
    --language "$current_language"
    --level "$level"
    --content-type "$content_type"
    --count "$count"
    --provider deepseek
    --model "$deepseek_model"
  )
  if [[ -n "$concept" ]]; then
    generate_command+=(--concept "$concept")
  fi
  if ! DEEPSEEK_API_KEY="$deepseek_api_key" "${generate_command[@]}"; then
    generation_failures+=("$current_language")
    echo "Aviso: não foi possível gerar conteúdo para $current_language." >&2
    echo "Para retomar este diretório, repita o comando com: --run-dir $run_dir" >&2
  fi
done
unset deepseek_api_key

if [[ ! -s "$candidates_file" ]]; then
  echo "Nenhum candidato foi gerado; a validação e a migration não serão executadas." >&2
  exit 1
fi

echo "[3/4] Validando os candidatos..."
validation_status=0
python3 scripts/validate_learning_candidates.py \
  --input "$candidates_file" \
  --audit "$audit_file" \
  --output "$validated_file" || validation_status=$?
if ((validation_status > 1)); then
  echo "A validação falhou com erro operacional (status $validation_status)." >&2
  exit "$validation_status"
fi
repair_round=0
while ((validation_status == 1 && repair_round < repair_attempts)); do
  repair_round=$((repair_round + 1))
  echo "[3/4] Reparando candidatos reprovados (rodada $repair_round/$repair_attempts)..."
  DEEPSEEK_API_KEY="$(read_env_value DEEPSEEK_API_KEY)" \
    python3 scripts/repair_learning_candidates.py \
      --candidates "$candidates_file" \
      --validated "$validated_file" \
      --provider deepseek \
      --model "$deepseek_model" \
      --repair-round "$repair_round"
  validation_status=0
  python3 scripts/validate_learning_candidates.py \
    --input "$candidates_file" \
    --audit "$audit_file" \
    --output "$validated_file" || validation_status=$?
  if ((validation_status > 1)); then
    echo "A revalidação falhou com erro operacional (status $validation_status)." >&2
    exit "$validation_status"
  fi
done
if ((validation_status == 1)); then
  echo "Aviso: ainda há candidatos rejeitados; somente os aprovados entrarão na migration." >&2
fi

echo "[4/4] Criando migration revisável e não publicada..."
python3 scripts/build_learning_content_migration.py \
  --input "$validated_file" \
  --output "$migration_output"

echo "Pipeline concluído."
echo "Relatório: $audit_summary"
echo "Candidatos validados: $validated_file"
echo "Migration para revisão: $migration_output"
if ((${#generation_failures[@]})); then
  echo "Idiomas sem geração: ${generation_failures[*]}" >&2
  echo "A execução produziu resultados parciais. Consulte o audit-summary.json e complete o corpus." >&2
  exit 1
fi
