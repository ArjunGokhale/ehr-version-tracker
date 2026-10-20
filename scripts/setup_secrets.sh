#!/usr/bin/env bash
# Copy the scanner's three settings from the local .env into GitHub Actions secrets.
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; . ./.env; set +a
for name in SUPABASE_URL SUPABASE_ANON_KEY INGEST_TOKEN; do
  printf '%s' "${!name}" | gh secret set "$name"
  echo "  set $name"
done
