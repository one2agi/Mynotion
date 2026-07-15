#!/usr/bin/env bash
# Run one authenticated dirty-page refresh from the VPS host.
set -euo pipefail

readonly ENV_FILE=/opt/notionnext/.env.production
readonly LOCK_FILE=/run/lock/notionnext-notion-refresh.lock

if [ "$(id -u)" -ne 0 ]; then
  echo "Notion refresh runner must run as root" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Notion refresh environment file is missing" >&2
  exit 1
fi

mapfile -t TOKEN_LINES < <(awk '/^REVALIDATION_TOKEN=/{print substr($0, index($0, "=") + 1)}' "$ENV_FILE")
if [ "${#TOKEN_LINES[@]}" -ne 1 ] || [ -z "${TOKEN_LINES[0]}" ]; then
  echo "Exactly one non-empty REVALIDATION_TOKEN is required" >&2
  exit 1
fi
readonly REVALIDATION_TOKEN=${TOKEN_LINES[0]}

# Curl config values are quoted, so restrict the token to header-safe characters.
if [[ ! "$REVALIDATION_TOKEN" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
  echo "REVALIDATION_TOKEN contains unsupported characters" >&2
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  echo "Notion refresh already running; skipped"
  exit 0
fi

umask 077
RESPONSE_FILE=$(mktemp /tmp/notionnext-refresh-response.XXXXXX)
trap 'rm -f "$RESPONSE_FILE"' EXIT

{
  printf 'header = "Authorization: Bearer %s"\n' "$REVALIDATION_TOKEN"
  printf 'header = "Content-Type: application/json"\n'
  printf 'url = "http://127.0.0.1:3030/api/revalidate"\n'
  printf 'request = "POST"\n'
  printf 'data = "{\\"dirty\\":true}"\n'
} | curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time 240 \
  --output "$RESPONSE_FILE" \
  --config -

if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$RESPONSE_FILE"; then
  echo "Notion dirty refresh did not return ok=true" >&2
  exit 1
fi

echo "Notion dirty refresh completed"
