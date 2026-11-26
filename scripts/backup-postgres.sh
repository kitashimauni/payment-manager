#!/usr/bin/env bash
set -euo pipefail

env_file="${1:-.env.docker}"
backup_dir="${2:-backups}"

if [[ ! -f "$env_file" ]]; then
  printf 'Compose environment file not found: %s\n' "$env_file" >&2
  exit 1
fi

umask 077
mkdir -p "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/payment-manager-$timestamp.dump"

if [[ -e "$backup_file" ]]; then
  printf 'Backup already exists: %s\n' "$backup_file" >&2
  exit 1
fi

temporary_file="$(mktemp "$backup_dir/.payment-manager-$timestamp.XXXXXX.partial")"
trap 'rm -f "$temporary_file"' EXIT

docker compose --env-file "$env_file" exec -T db \
  sh -c 'exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$temporary_file"

test -s "$temporary_file"
docker compose --env-file "$env_file" exec -T db pg_restore --list \
  < "$temporary_file" > /dev/null

mv "$temporary_file" "$backup_file"
trap - EXIT
printf 'Verified PostgreSQL archive: %s\n' "$backup_file"
