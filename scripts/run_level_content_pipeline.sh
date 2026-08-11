#!/usr/bin/env bash
# Generate every supported content type and language for one CEFR level.

set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "${script_dir}/.." && pwd)"

level=""
count="50"
confirmed="false"
migrations_dir="${project_root}/supabase/migrations"
resume_dir=""
minimum_approved="15"
combination_retries="2"

usage() {
  cat <<'EOF'
Uso:
  scripts/run_level_content_pipeline.sh --level A1 --confirm-cost

Opções:
  --level A1|A2|B1|B2  Nível que será inteiramente substituído
  --count N             Conteúdos por idioma e tipo (padrão: 50)
  --confirm-cost        Confirma até 4 × 3 × count chamadas à DeepSeek
  --migrations-dir DIR  Destino das duas migrations
  --resume DIRETÓRIO    Retoma um lote existente em .local
  --minimum-approved N  Mínimo aprovado por idioma/tipo (padrão: 15)
  --combination-retries N  Retentativas se ficar abaixo do mínimo (padrão: 2)
  -h, --help            Exibe esta ajuda

O script executa, para en/es/fr/it, os tipos reading, grammar e quick_lesson.
Somente depois de todas as execuções concluírem cria:
  1. migration que apaga o conteúdo antigo do nível;
  2. migration que insere os candidatos aprovados e publicados.
EOF
}

while (($#)); do
  case "$1" in
    --level) level="${2:-}"; shift 2 ;;
    --count) count="${2:-}"; shift 2 ;;
    --confirm-cost) confirmed="true"; shift ;;
    --migrations-dir) migrations_dir="${2:-}"; shift 2 ;;
    --resume) resume_dir="${2:-}"; shift 2 ;;
    --minimum-approved) minimum_approved="${2:-}"; shift 2 ;;
    --combination-retries) combination_retries="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Argumento desconhecido: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$level" in A1|A2|B1|B2) ;; *) echo "--level inválido" >&2; exit 2 ;; esac
if [[ ! "$count" =~ ^[1-9][0-9]*$ ]]; then
  echo "--count deve ser um inteiro maior que zero" >&2
  exit 2
fi
if [[ ! "$minimum_approved" =~ ^[1-9][0-9]*$ ]]; then
  echo "--minimum-approved deve ser um inteiro maior que zero" >&2
  exit 2
fi
if [[ ! "$combination_retries" =~ ^[0-9]+$ ]]; then
  echo "--combination-retries deve ser um inteiro maior ou igual a zero" >&2
  exit 2
fi
if ((minimum_approved > count)); then
  echo "--minimum-approved não pode ser maior que --count" >&2
  exit 2
fi

total_calls=$((4 * 3 * count))
if [[ "$confirmed" != "true" ]]; then
  echo "Esta operação pode realizar até $total_calls chamadas à DeepSeek." >&2
  echo "Revise o custo e execute novamente com --confirm-cost." >&2
  exit 2
fi

if [[ "$migrations_dir" != /* ]]; then
  migrations_dir="${project_root}/${migrations_dir}"
fi

if [[ -n "$resume_dir" ]]; then
  if [[ "$resume_dir" == /* ]]; then
    batch_dir="$resume_dir"
  else
    batch_dir="${project_root}/${resume_dir}"
  fi
  if [[ ! -d "$batch_dir" ]]; then
    echo "Diretório de retomada não encontrado: $batch_dir" >&2
    exit 1
  fi
  batch_id="$(basename -- "$batch_dir")"
else
  batch_id="$(date -u +%Y%m%dT%H%M%SZ)-all-${level}-content"
  batch_dir="${project_root}/.local/content-research/batches/${batch_id}"
fi
combined_validated="${batch_dir}/validated-candidates.jsonl"
manifest_output="${batch_dir}/migration.manifest.json"
mkdir -p "$batch_dir"
: >"$combined_validated"

languages=(en es fr it)
content_types=(reading grammar quick_lesson)
completed=0

approved_in_file() {
  python3 - "$1" <<'PY'
import json
import sys

approved = 0
for line in open(sys.argv[1], encoding="utf-8"):
    record = json.loads(line)
    if record.get("status") == "approved" and record.get("validation", {}).get("errors") == []:
        approved += 1
print(approved)
PY
}

cd "$project_root"
for current_language in "${languages[@]}"; do
  for current_type in "${content_types[@]}"; do
    completed=$((completed + 1))
    run_dir="${batch_dir}/runs/${current_language}-${current_type}"
    echo "[$completed/12] ${current_language}/${level}/${current_type}: $count candidatos"
    retries_used=0
    while true; do
      current_approved=0
      if [[ -s "${run_dir}/candidates.jsonl" && -s "${run_dir}/audit.jsonl" ]]; then
        revalidation_status=0
        python3 scripts/validate_learning_candidates.py \
          --input "${run_dir}/candidates.jsonl" \
          --audit "${run_dir}/audit.jsonl" \
          --output "${run_dir}/validated-candidates.jsonl" || revalidation_status=$?
        if ((revalidation_status > 1)); then
          echo "Falha operacional ao revalidar ${current_language}/${current_type}." >&2
          exit "$revalidation_status"
        fi
      fi
      if [[ -s "${run_dir}/validated-candidates.jsonl" ]]; then
        current_approved="$(approved_in_file "${run_dir}/validated-candidates.jsonl")"
        echo "  Aprovados: $current_approved/$count; mínimo: $minimum_approved."
        if ((current_approved >= minimum_approved)); then
          break
        fi
        if ((retries_used >= combination_retries)); then
          echo "${current_language}/${current_type} permaneceu abaixo de $minimum_approved aprovados após $combination_retries retentativas." >&2
          echo "Nenhuma migration de exclusão foi criada. Resultados: $batch_dir" >&2
          exit 1
        fi
        retries_used=$((retries_used + 1))
        echo "  Retentativa $retries_used/$combination_retries: reparando os reprovados."
      fi
      if ! scripts/run_learning_content_pipeline.sh \
        --language "$current_language" \
        --level "$level" \
        --content-type "$current_type" \
        --count "$count" \
        --minimum-approved "$minimum_approved" \
        --run-dir "$run_dir"; then
        echo "Falha em ${current_language}/${level}/${current_type}." >&2
        echo "Nenhuma migration de exclusão foi criada. Resultados: $batch_dir" >&2
        echo "Retome com: $0 --level $level --count $count --confirm-cost --resume $batch_dir" >&2
        exit 1
      fi
    done
    if [[ ! -s "${run_dir}/validated-candidates.jsonl" ]]; then
      echo "Validação ausente para ${current_language}/${current_type}." >&2
      echo "Nenhuma migration de exclusão foi criada." >&2
      exit 1
    fi
    cat "${run_dir}/validated-candidates.jsonl" >>"$combined_validated"
  done
done

approved_count="$(python3 - "$combined_validated" <<'PY'
import json
import sys

approved = 0
for line in open(sys.argv[1], encoding="utf-8"):
    record = json.loads(line)
    if record.get("status") == "approved" and record.get("validation", {}).get("errors") == []:
        approved += 1
print(approved)
PY
)"
if ((approved_count == 0)); then
  echo "Nenhum candidato foi aprovado. Nenhuma migration foi criada." >&2
  exit 1
fi

delete_timestamp="$(date -u +%Y%m%d%H%M%S)"
insert_timestamp="$(date -u -d '1 second' +%Y%m%d%H%M%S)"
level_slug="${level,,}"
delete_migration="${migrations_dir}/${delete_timestamp}_delete_old_${level_slug}_learning_content.sql"
insert_migration="${migrations_dir}/${insert_timestamp}_insert_generated_${level_slug}_learning_content.sql"

if [[ -e "$delete_migration" || -e "$insert_migration" ]]; then
  echo "Já existe uma migration com o timestamp calculado; aguarde e tente novamente." >&2
  exit 1
fi
mkdir -p "$migrations_dir"

printf '%s\n' \
  "-- Replace all learning catalog content for CEFR ${level}." \
  "-- This migration must run immediately before its generated insertion migration." \
  "" \
  "delete from public.reading_passages where level = '${level}';" \
  "delete from public.quick_lessons where level = '${level}';" \
  "delete from public.grammar_topics where level = '${level}';" \
  >"$delete_migration"

if ! python3 scripts/build_learning_content_migration.py \
  --input "$combined_validated" \
  --output "$insert_migration" \
  --manifest-output "$manifest_output" \
  --publish; then
  mv "$delete_migration" "${batch_dir}/delete-migration-not-ready.sql"
  echo "Falha ao construir a inserção; a migration de exclusão foi retirada de supabase/migrations." >&2
  exit 1
fi

echo "Lote concluído com $approved_count candidatos aprovados de até $total_calls gerados."
echo "Resultados locais: $batch_dir"
echo "Migration de exclusão: $delete_migration"
echo "Migration de inserção: $insert_migration"
echo "Revise ambas antes de adicioná-las ao Git. Nenhuma migration foi aplicada ao Supabase."
