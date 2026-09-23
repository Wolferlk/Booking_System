#!/usr/bin/env bash
#
# Creates the `vn_include_products` and `agenda_item_includes` tables (Vietnam agenda includes).
#
# The app builds its connection string from the DB_* parts in .env at runtime
# (see src/lib/prisma.ts), but the Prisma CLI only reads DATABASE_URL — so this
# script assembles the same URL and hands it to `prisma db execute`.
#
# The SQL it runs is two CREATE TABLE IF NOT EXISTS statements. It does not ALTER,
# DROP or write to any existing table, and it is safe to run twice.
#
# Usage, from the apple-holidays/ directory:
#   bash prisma/sql/apply-vn-agenda-includes.sh
#   bash prisma/sql/apply-vn-agenda-includes.sh --check    # show the target, run nothing

set -euo pipefail

cd "$(dirname "$0")/../.."

# Read the *active* (uncommented) DB_* values; the file carries commented-out
# blocks for the old databases and several DB_DATABASE keys, so take the first
# live match for each and the one paired with the active DB_HOST for the name.
env_value() {
  grep -E "^${1}=" .env | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "\r" | xargs
}

DB_HOST="$(env_value DB_HOST)"
DB_PORT="$(env_value DB_PORT)"
DB_DATABASE="$(env_value DB_DATABASE)"
DB_USERNAME="$(env_value DB_USERNAME)"
DB_PASSWORD="$(env_value DB_PASSWORD)"

if [[ -z "$DB_HOST" || -z "$DB_DATABASE" || -z "$DB_USERNAME" ]]; then
  echo "Could not read DB_HOST / DB_DATABASE / DB_USERNAME from .env" >&2
  exit 1
fi

urlencode() { python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }

URL="mysql://$(urlencode "$DB_USERNAME"):$(urlencode "$DB_PASSWORD")@${DB_HOST}:${DB_PORT:-3306}/${DB_DATABASE}"

echo "Target : ${DB_USERNAME}@${DB_HOST}:${DB_PORT:-3306}/${DB_DATABASE}"
echo "Action : CREATE TABLE IF NOT EXISTS vn_include_products, agenda_item_includes  (additive only)"

if [[ "${1:-}" == "--check" ]]; then
  echo "--check given; nothing was run."
  exit 0
fi

read -r -p "Proceed? [y/N] " reply
[[ "$reply" == "y" || "$reply" == "Y" ]] || { echo "Aborted."; exit 1; }

DATABASE_URL="$URL" npx prisma db execute \
  --file prisma/sql/2026-09-23-vn-agenda-includes.sql \
  --schema prisma/schema.prisma

echo "Done. Run 'npx prisma generate' if you have not already."
