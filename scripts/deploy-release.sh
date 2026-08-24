#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  printf 'Usage: %s <source-zip> <deploy-root>\n' "$0" >&2
}

if [[ $# -ne 2 ]]; then
  usage
  exit 64
fi

zip_path="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
mkdir -p "$2"
deploy_root="$(cd "$2" && pwd)"
zip_name="$(basename "$zip_path")"

if [[ ! -f "$zip_path" ]]; then
  printf 'Source ZIP not found: %s\n' "$zip_path" >&2
  exit 1
fi

if [[ "$zip_name" != automation-hub-source-*.zip ]]; then
  printf 'Unexpected source ZIP name: %s\n' "$zip_name" >&2
  exit 1
fi

version="${zip_name#automation-hub-source-}"
version="${version%.zip}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  printf 'Could not parse a semantic version from: %s\n' "$zip_name" >&2
  exit 1
fi

checksum_path="$zip_path.sha256"
if [[ ! -f "$checksum_path" ]]; then
  printf 'Checksum file not found: %s\n' "$checksum_path" >&2
  exit 1
fi

expected_hash="$(awk 'NR == 1 { print $1; exit }' "$checksum_path")"
if [[ ! "$expected_hash" =~ ^[[:xdigit:]]{64}$ ]]; then
  printf 'Invalid SHA-256 checksum file: %s\n' "$checksum_path" >&2
  exit 1
fi
actual_hash="$(sha256sum "$zip_path" | awk '{ print $1 }')"
if [[ "$expected_hash" != "$actual_hash" ]]; then
  printf 'Checksum mismatch for %s\n' "$zip_name" >&2
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1 || ! command -v docker >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  printf 'This script requires unzip, curl and docker with the Compose plugin.\n' >&2
  exit 1
fi

if ! command -v zipinfo >/dev/null 2>&1; then
  printf 'This script requires zipinfo to validate ZIP paths.\n' >&2
  exit 1
fi
while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  normalized_entry="${entry//\\//}"
  if [[ "$normalized_entry" == /* || "$normalized_entry" == .. || "$normalized_entry" == ../* || "$normalized_entry" == */../* || "$normalized_entry" == */.. || "$normalized_entry" == *:* ]]; then
    printf 'Unsafe ZIP entry: %s\n' "$entry" >&2
    exit 1
  fi
done < <(zipinfo -1 "$zip_path")

shared_dir="$deploy_root/shared"
releases_dir="$deploy_root/releases"
artifacts_dir="$deploy_root/artifacts"
shared_env="$shared_dir/.env"
release_dir="$releases_dir/$version"
previous_release=''
deployment_started=0
temp_dir=''

compose_args_for() {
  local release="$1"
  printf '%s\0' \
    --project-name automation-hub \
    --project-directory "$release" \
    --env-file "$shared_env" \
    --file "$release/compose.yaml"
}

compose_for() {
  local release="$1"
  local release_version
  release_version="$(basename "$release")"
  mapfile -d '' args < <(compose_args_for "$release")
  AUTOMATION_HUB_VERSION="$release_version" docker compose "${args[@]}" --no-ansi "${@:2}"
}

restore_previous_release() {
  compose_for "$release_dir" down || true
  [[ -n "$previous_release" && -d "$previous_release" ]] || return 0
  printf 'Restoring previous release: %s\n' "$(basename "$previous_release")" >&2
  compose_for "$previous_release" up -d || true
}

on_exit() {
  local status=$?
  if [[ $status -ne 0 && $deployment_started -eq 1 ]]; then
    restore_previous_release
  fi
  if [[ -n "$temp_dir" && -d "$temp_dir" ]]; then
    rm -rf "$temp_dir"
  fi
  exit "$status"
}
trap on_exit EXIT

mkdir -p "$shared_dir/postgres" "$shared_dir/backups" "$releases_dir" "$artifacts_dir"

if [[ -e "$release_dir" ]]; then
  printf 'Release already exists: %s\n' "$release_dir" >&2
  exit 1
fi

while IFS= read -r pg_version_file; do
  [[ -n "$pg_version_file" ]] || continue
  pg_version="$(tr -d '[:space:]' < "$pg_version_file")"
  if [[ "$pg_version" != "18" ]]; then
    printf 'PostgreSQL data directory version %s is not directly compatible with postgres:18-bookworm: %s\n' "$pg_version" "$pg_version_file" >&2
    printf 'Back up the database and complete the PostgreSQL major-version migration before deploying this release.\n' >&2
    exit 1
  fi
done < <(find "$shared_dir/postgres" -type f -name PG_VERSION -print)

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/automation-hub-release.XXXXXX")"
unzip -q "$zip_path" -d "$temp_dir/extracted"
if [[ ! -f "$temp_dir/extracted/compose.yaml" || ! -f "$temp_dir/extracted/.env.example" ]]; then
  printf 'Source ZIP is missing compose.yaml or .env.example.\n' >&2
  exit 1
fi

if [[ ! -f "$shared_env" ]]; then
  cp "$temp_dir/extracted/.env.example" "$shared_env"
  chmod 600 "$shared_env"
  printf 'Created %s from .env.example. Edit secrets before retrying.\n' "$shared_env" >&2
fi
if grep -Eq 'replace-with-' "$shared_env"; then
  printf 'Replace placeholder values in %s before deployment.\n' "$shared_env" >&2
  exit 1
fi

if [[ -e "$deploy_root/current" || -L "$deploy_root/current" ]]; then
  if [[ ! -L "$deploy_root/current" ]]; then
    printf 'Current release marker must be a symlink: %s\n' "$deploy_root/current" >&2
    exit 1
  fi
  previous_release="$(readlink -f "$deploy_root/current" 2>/dev/null || true)"
  if [[ -n "$previous_release" && ! -d "$previous_release" ]]; then
    printf 'Current release target does not exist: %s\n' "$previous_release" >&2
    exit 1
  fi
  case "$previous_release" in
    "$releases_dir"/*) ;;
    *)
      printf 'Current release target must be under %s: %s\n' "$releases_dir" "$previous_release" >&2
      exit 1
      ;;
  esac
fi

artifact_zip="$artifacts_dir/$zip_name"
artifact_checksum="$artifacts_dir/$(basename "$checksum_path")"
if [[ -e "$artifact_zip" ]]; then
  [[ "$(sha256sum "$artifact_zip" | awk '{ print $1 }')" == "$actual_hash" ]] || {
    printf 'An artifact with the same name has a different checksum: %s\n' "$artifact_zip" >&2
    exit 1
  }
else
  cp "$zip_path" "$artifact_zip"
fi
if [[ -e "$artifact_checksum" ]]; then
  cmp -s "$checksum_path" "$artifact_checksum" || {
    printf 'An artifact checksum file already exists with different contents: %s\n' "$artifact_checksum" >&2
    exit 1
  }
else
  cp "$checksum_path" "$artifact_checksum"
fi

mv "$temp_dir/extracted" "$release_dir"
temp_dir=''
printf 'Prepared release: %s\n' "$release_dir"

compose_for "$release_dir" build --pull
deployment_started=1
compose_for "$release_dir" up -d

port="$(awk -F= '$1 == "AUTOMATION_HUB_PORT" { print $2; exit }' "$shared_env" | tr -d '\r' | tr -d '[:space:]')"
port="${port:-3000}"
if [[ ! "$port" =~ ^[0-9]+$ ]]; then
  printf 'Invalid AUTOMATION_HUB_PORT in %s\n' "$shared_env" >&2
  exit 1
fi

health_url="http://127.0.0.1:$port/health"
for attempt in $(seq 1 60); do
  if curl --fail --silent --show-error "$health_url" >/dev/null 2>&1; then
    break
  fi
  if [[ "$attempt" -eq 60 ]]; then
    printf 'Health check failed: %s\n' "$health_url" >&2
    exit 1
  fi
  sleep 2
done

current_link="$deploy_root/.current-$version"
ln -s "releases/$version" "$current_link"
mv -Tf "$current_link" "$deploy_root/current"
printf 'Deployment succeeded. Current release: %s\n' "$version"
