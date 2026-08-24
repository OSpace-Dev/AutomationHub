#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s <deploy-root>\n' "$0" >&2
  exit 64
fi

deploy_root="$(cd "$1" && pwd)"
shared_env="$deploy_root/shared/.env"
current_release="$deploy_root/current"
if [[ ! -f "$shared_env" || ! -f "$current_release/compose.yaml" ]]; then
  printf 'Expected shared/.env and current/compose.yaml under: %s\n' "$deploy_root" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'This script requires docker with the Compose plugin.\n' >&2
  exit 1
fi

backup_dir="$deploy_root/shared/backups"
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
release_version="$(basename "$(readlink -f "$current_release")")"

docker compose \
  --project-name automation-hub \
  --project-directory "$current_release" \
  --env-file "$shared_env" \
  --file "$current_release/compose.yaml" \
  --no-ansi exec -T postgres \
  sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
  > "$backup_tmp"
chmod 600 "$backup_tmp"
mv "$backup_tmp" "$backup_path"
trap - EXIT
printf 'Created PostgreSQL backup for release %s: %s\n' "$release_version" "$backup_path"
