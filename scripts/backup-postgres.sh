#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 0 ]]; then
  printf 'Usage: %s\n' "$0" >&2
  exit 64
fi

release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
deploy_root="$(cd "$release_dir/../.." && pwd)"
data_env="$deploy_root/data/.env"
if [[ ! -f "$data_env" || ! -f "$release_dir/compose.yaml" ]]; then
  printf 'Expected data/.env and release/compose.yaml under: %s\n' "$deploy_root" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'This script requires docker with the Compose plugin.\n' >&2
  exit 1
fi

backup_dir="$deploy_root/data/backups"
mkdir -p "$backup_dir"
umask 077
timestamp="$(date -u +%Y%m%d-%H%M%S)"
backup_path="$backup_dir/postgres-$timestamp.dump"
if [[ -e "$backup_path" ]]; then
  printf 'Backup already exists: %s\n' "$backup_path" >&2
  exit 1
fi
backup_tmp="$(mktemp "$backup_dir/.postgres-$timestamp.XXXXXX")"
cleanup() {
  rm -f "$backup_tmp"
}
trap cleanup EXIT
release_version="$(basename "$release_dir")"

docker compose \
  --project-name automation-hub \
  --project-directory "$release_dir" \
  --env-file "$data_env" \
  --file "$release_dir/compose.yaml" \
  --no-ansi exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$backup_tmp"
chmod 600 "$backup_tmp"
mv "$backup_tmp" "$backup_path"
trap - EXIT
printf 'Created PostgreSQL backup for release %s: %s\n' "$release_version" "$backup_path"
