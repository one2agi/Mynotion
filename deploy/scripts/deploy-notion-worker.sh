#!/usr/bin/env bash
# Deploy the authenticated Notion /api/v3 transport Worker.
# Secrets are accepted only through environment variables and stdin.
set -euo pipefail
export CI=1

: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${NOTION_API_PROXY_TOKEN:?NOTION_API_PROXY_TOKEN is required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONFIG="$PROJECT_DIR/cloudflare/notion-api-proxy/wrangler.jsonc"
WRANGLER=(pnpm dlx wrangler@4.110.0)

cd "$PROJECT_DIR"

echo "==> 1/4 Deploy Cloudflare Worker"
"${WRANGLER[@]}" deploy --config "$CONFIG"

echo "==> 2/4 Store encrypted Worker secret"
printf '%s' "$NOTION_API_PROXY_TOKEN" | \
  "${WRANGLER[@]}" secret put NOTION_PROXY_TOKEN --config "$CONFIG"

echo "==> 3/4 Select custom Worker domain"
PROXY_API_URL="${NOTION_API_PROXY_URL:-https://notion-api.faiz-world.com/api/v3}"
PROXY_API_URL="${PROXY_API_URL%/}"

PROXY_ORIGIN="${PROXY_API_URL%/api/v3}"
mkdir -p "$PROJECT_DIR/.artifacts"
umask 077
printf '%s\n' "$PROXY_API_URL" > "$PROJECT_DIR/.artifacts/notion-worker-url"

echo "==> 4/4 Verify Worker contract"
HEALTH_STATUS=000
UNAUTH_STATUS=000
for attempt in $(seq 1 12); do
  HEALTH_STATUS=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' \
    "$PROXY_ORIGIN/health") || HEALTH_STATUS=000
  UNAUTH_STATUS=$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' \
    -X POST -H 'content-type: application/json' --data '{}' \
    "$PROXY_API_URL/loadPageChunk") || UNAUTH_STATUS=000
  if [ "$HEALTH_STATUS" = "200" ] && [ "$UNAUTH_STATUS" = "401" ]; then
    break
  fi
  [ "$attempt" -lt 12 ] && sleep 5
done

if [ "$HEALTH_STATUS" != "200" ] || [ "$UNAUTH_STATUS" != "401" ]; then
  echo "Worker verification failed: health=$HEALTH_STATUS unauthenticated_api=$UNAUTH_STATUS" >&2
  exit 1
fi

echo "Worker URL: $PROXY_API_URL"
echo "Worker verified: health=200 unauthenticated_api=401"
