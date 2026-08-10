#!/usr/bin/env bash
# Aplica o harness, todas as migrations e cada teste SQL em um PostgreSQL
# temporário. Cada arquivo de teste roda em sua própria transação e termina com
# rollback, então a ordem dos testes não altera o resultado.
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
container="lume-tutor-db-test-$$"
image="${POSTGRES_IMAGE:-postgres:17-alpine}"
password="lume-tutor-test"

cleanup() {
  docker rm --force "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Iniciando PostgreSQL temporário ($image)..."
docker run \
  --detach \
  --name "$container" \
  --env "POSTGRES_PASSWORD=$password" \
  --env POSTGRES_DB=postgres \
  "$image" >/dev/null

for _ in $(seq 1 60); do
  # Durante o initdb, a imagem oficial inicia um servidor temporário acessível
  # apenas pelo socket Unix e o encerra antes de subir o servidor definitivo.
  # Testar por TCP evita considerar esse servidor transitório como pronto.
  if docker exec "$container" pg_isready \
    --host 127.0.0.1 \
    --username postgres \
    --dbname postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker exec "$container" pg_isready \
  --host 127.0.0.1 \
  --username postgres \
  --dbname postgres >/dev/null 2>&1; then
  echo "PostgreSQL não ficou pronto em tempo." >&2
  docker logs "$container" >&2
  exit 1
fi

run_sql_file() {
  local label="$1"
  local file="$2"
  local transaction_mode="${3:-single}"
  local -a transaction_args=()
  if [ "$transaction_mode" = "single" ]; then
    transaction_args+=(--single-transaction)
  fi
  printf '  %-58s' "$label"
  if ! output="$(docker exec --interactive "$container" \
    psql --username postgres --dbname postgres \
      --no-psqlrc --quiet "${transaction_args[@]}" \
      --variable ON_ERROR_STOP=1 \
      --file - <"$file" 2>&1)"; then
    echo "FALHOU"
    echo "$output" >&2
    exit 1
  fi
  echo "ok"
}

echo "Aplicando harness..."
run_sql_file "harness.sql" "$project_root/supabase/tests/harness.sql"

echo "Aplicando migrations..."
migration_count=0
for migration in "$project_root"/supabase/migrations/*.sql; do
  run_sql_file "$(basename "$migration")" "$migration"
  migration_count=$((migration_count + 1))
done

echo "Executando testes..."
test_count=0
for test_file in "$project_root"/supabase/tests/*.sql; do
  [ "$(basename "$test_file")" = "harness.sql" ] && continue
  run_sql_file "$(basename "$test_file")" "$test_file" file-managed
  test_count=$((test_count + 1))
done

echo "$migration_count migrations aplicadas e $test_count arquivos de teste aprovados."
