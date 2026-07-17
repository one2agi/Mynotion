#!/usr/bin/env bash
# Configure or disable the Notion Worker transport on the Docker VPS.
# Usage: configure-notion-proxy-vps.sh <ssh-alias> [--disable]
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <ssh-alias> [--disable]" >&2
  exit 1
fi

SERVER="$1"
MODE="enable"
if [ "${2:-}" = "--disable" ]; then
  MODE="disable"
elif [ -n "${2:-}" ]; then
  echo "Unknown option: $2" >&2
  exit 1
fi

FRAGMENT=$(mktemp)
trap 'rm -f "$FRAGMENT"' EXIT
umask 077

if [ "$MODE" = "enable" ]; then
  : "${NOTION_API_PROXY_URL:?NOTION_API_PROXY_URL is required}"
  : "${NOTION_API_PROXY_TOKEN:?NOTION_API_PROXY_TOKEN is required}"

  case "$NOTION_API_PROXY_URL$NOTION_API_PROXY_TOKEN" in
    *$'\n'*|*$'\r'*)
      echo "Proxy configuration must not contain newlines" >&2
      exit 1
      ;;
  esac

  {
    printf 'NOTION_API_PROXY_URL=%s\n' "${NOTION_API_PROXY_URL%/}"
    printf 'NOTION_API_PROXY_TOKEN=%s\n' "$NOTION_API_PROXY_TOKEN"
    printf 'NOTION_API_PROXY_TIMEOUT_MS=%s\n' "${NOTION_API_PROXY_TIMEOUT_MS:-6000}"
    printf 'NOTION_API_PROXY_CIRCUIT_MS=%s\n' "${NOTION_API_PROXY_CIRCUIT_MS:-60000}"
  } > "$FRAGMENT"
fi

REMOTE_FRAGMENT="/tmp/notionnext-proxy.env"
ssh "$SERVER" "umask 077; cat > '$REMOTE_FRAGMENT'" < "$FRAGMENT"

MODE="$MODE" ssh "$SERVER" "MODE='$MODE' bash -s" <<'REMOTE'
set -euo pipefail

ENV_FILE=/opt/notionnext/.env.production
FRAGMENT=/tmp/notionnext-proxy.env
TMP_FILE=$(mktemp)
trap 'rm -f "$TMP_FILE" "$FRAGMENT"' EXIT

sudo awk '!/^NOTION_API_PROXY_(URL|TOKEN|TIMEOUT_MS|CIRCUIT_MS)=/' "$ENV_FILE" > "$TMP_FILE"
if [ "$MODE" = "enable" ]; then
  cat "$FRAGMENT" >> "$TMP_FILE"
fi
sudo install -m 600 "$TMP_FILE" "$ENV_FILE"

cd /opt/notionnext
CURRENT_IMAGE=$(sudo docker inspect --format='{{.Config.Image}}' notionnext-app)
IMAGE_TAG=${CURRENT_IMAGE#notionnext:}
export IMAGE_TAG
sudo --preserve-env=IMAGE_TAG docker compose up -d --no-deps --force-recreate app way

if [ "$MODE" = "enable" ]; then
  for container in notionnext-app notionnext-way; do
    sudo docker exec "$container" sh -lc '
      test -n "${NOTION_API_PROXY_URL:-}" &&
      test -n "${NOTION_API_PROXY_TOKEN:-}"
    '
  done
fi

for attempt in $(seq 1 24); do
  if curl -fsS http://127.0.0.1:3030/api/health | grep -q '"ok":true' &&
     curl -fsS http://127.0.0.1:3031/api/health | grep -q '"ok":true'; then
    echo "Notion proxy mode=$MODE; app/way health=ok"
    exit 0
  fi
  sleep 5
done

echo "Application health check failed after proxy mode=$MODE" >&2
sudo docker compose logs --tail 80 app way >&2
exit 1
REMOTE
