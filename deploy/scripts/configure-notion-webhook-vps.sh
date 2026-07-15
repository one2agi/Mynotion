#!/usr/bin/env bash
# Install and operate the Notion webhook scheduler on the Docker VPS.
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage: configure-notion-webhook-vps.sh <ssh-alias> <mode>

Modes: install | begin-setup | show-token | finish | status | disable
USAGE
}

if [ "$#" -ne 2 ]; then
  usage
  exit 1
fi

readonly SERVER=$1
readonly MODE=$2
if [[ "$SERVER" == -* ]] || [[ ! "$SERVER" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "SSH alias contains unsupported characters" >&2
  exit 1
fi
readonly SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly DEPLOY_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
readonly RUNNER=$SCRIPT_DIR/run-notion-refresh.sh
readonly SERVICE=$DEPLOY_DIR/systemd/notionnext-notion-refresh.service
readonly TIMER=$DEPLOY_DIR/systemd/notionnext-notion-refresh.timer

install_assets() {
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v flock >/dev/null || { echo "flock is required" >&2; exit 1; }
REMOTE
  ssh "$SERVER" 'sudo install -o root -g root -m 755 /dev/stdin /usr/local/sbin/run-notion-refresh' < "$RUNNER"
  ssh "$SERVER" 'sudo install -o root -g root -m 644 /dev/stdin /etc/systemd/system/notionnext-notion-refresh.service' < "$SERVICE"
  ssh "$SERVER" 'sudo install -o root -g root -m 644 /dev/stdin /etc/systemd/system/notionnext-notion-refresh.timer' < "$TIMER"
  ssh "$SERVER" 'sudo systemctl daemon-reload'
  echo "Notion webhook scheduler installed but not enabled"
}

begin_setup() {
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
ENV_FILE=/opt/notionnext/.env.production
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ] || \
  [ "$(stat -c %u:%g "$ENV_FILE")" != 0:0 ] || \
  [ "$(stat -c %a "$ENV_FILE")" != 600 ]; then
  echo "Environment file must be a root-owned mode 0600 regular file" >&2
  exit 1
fi
ENV_TMP=$(mktemp "${ENV_FILE}.tmp.XXXXXX")
trap 'rm -f "$ENV_TMP"' EXIT

test -f "$ENV_FILE"
awk '!/^NOTION_WEBHOOK_SETUP_MODE=/' "$ENV_FILE" > "$ENV_TMP"
printf 'NOTION_WEBHOOK_SETUP_MODE=true\n' >> "$ENV_TMP"
chown root:root "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv -f "$ENV_TMP" "$ENV_FILE"
trap - EXIT

systemctl disable --now notionnext-notion-refresh.timer >/dev/null
systemctl stop notionnext-notion-refresh.service >/dev/null

cd /opt/notionnext
CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' notionnext-app)
IMAGE_TAG=${CURRENT_IMAGE#notionnext:}
if [ -z "$IMAGE_TAG" ] || [ "$IMAGE_TAG" = "$CURRENT_IMAGE" ]; then
  echo "Unexpected app image name" >&2
  exit 1
fi
export IMAGE_TAG
docker compose --env-file "$ENV_FILE" up -d --no-deps --force-recreate app

for attempt in $(seq 1 48); do
  if curl -fsS --max-time 5 http://127.0.0.1:3030/api/health | grep -q '"ok":true'; then
    echo "Webhook setup mode enabled; create the Notion subscription now"
    exit 0
  fi
  sleep 5
done

echo "Application health check failed in webhook setup mode" >&2
docker compose --env-file "$ENV_FILE" logs --tail 80 app >&2
exit 1
REMOTE
}

show_token() {
  echo "WARNING: the next line is the one-time Notion verification token." >&2
  echo "Paste it only into the Notion Connection verification form." >&2
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
TOKEN_PATH=/tmp/notion-webhook-verification-token
docker exec notionnext-app sh -eu -c '
  TOKEN_PATH=/tmp/notion-webhook-verification-token
  test -f "$TOKEN_PATH"
  test "$(stat -c %a "$TOKEN_PATH")" = 600
  cat "$TOKEN_PATH"
'
REMOTE
}

finish_setup() {
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
umask 077

ENV_FILE=/opt/notionnext/.env.production
if [ ! -f "$ENV_FILE" ] || [ -L "$ENV_FILE" ] || \
  [ "$(stat -c %u:%g "$ENV_FILE")" != 0:0 ] || \
  [ "$(stat -c %a "$ENV_FILE")" != 600 ]; then
  echo "Environment file must be a root-owned mode 0600 regular file" >&2
  exit 1
fi
TOKEN_PATH=/tmp/notion-webhook-verification-token
TOKEN_FILE=$(mktemp /tmp/notion-webhook-verification-token.XXXXXX)
ENV_TMP=
BOOTSTRAP_RESPONSE=$(mktemp /tmp/notion-webhook-bootstrap-response.XXXXXX)
trap 'rm -f "$TOKEN_FILE" "$BOOTSTRAP_RESPONSE" ${ENV_TMP:-}' EXIT
chmod 600 "$TOKEN_FILE" "$BOOTSTRAP_RESPONSE"

systemctl disable --now notionnext-notion-refresh.timer >/dev/null
systemctl stop notionnext-notion-refresh.service >/dev/null

if docker exec notionnext-app sh -eu -c '
  TOKEN_PATH=/tmp/notion-webhook-verification-token
  test -f "$TOKEN_PATH"
  test "$(stat -c %a "$TOKEN_PATH")" = 600
'; then
  docker cp "notionnext-app:${TOKEN_PATH}" "$TOKEN_FILE" >/dev/null
  chmod 600 "$TOKEN_FILE"
  TOKEN=$(<"$TOKEN_FILE")
else
  mapfile -t TOKEN_LINES < <(awk '/^NOTION_WEBHOOK_VERIFICATION_TOKEN=/{print substr($0, index($0, "=") + 1)}' "$ENV_FILE")
  if [ "${#TOKEN_LINES[@]}" -ne 1 ]; then
    echo "No captured verification token is available" >&2
    exit 1
  fi
  TOKEN=${TOKEN_LINES[0]}
fi

if [[ ! "$TOKEN" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
  echo "Captured verification token is empty or contains unsupported characters" >&2
  exit 1
fi

ENV_TMP=$(mktemp "${ENV_FILE}.tmp.XXXXXX")
awk '!/^NOTION_WEBHOOK_(SETUP_MODE|VERIFICATION_TOKEN)=/' "$ENV_FILE" > "$ENV_TMP"
printf 'NOTION_WEBHOOK_VERIFICATION_TOKEN=%s\n' "$TOKEN" >> "$ENV_TMP"
chown root:root "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv -f "$ENV_TMP" "$ENV_FILE"
ENV_TMP=

docker exec notionnext-app rm -f "$TOKEN_PATH"

cd /opt/notionnext
CURRENT_IMAGE=$(docker inspect --format='{{.Config.Image}}' notionnext-app)
IMAGE_TAG=${CURRENT_IMAGE#notionnext:}
if [ -z "$IMAGE_TAG" ] || [ "$IMAGE_TAG" = "$CURRENT_IMAGE" ]; then
  echo "Unexpected app image name" >&2
  exit 1
fi
export IMAGE_TAG
docker compose --env-file "$ENV_FILE" up -d --no-deps --force-recreate app

HEALTHY=false
for attempt in $(seq 1 48); do
  if curl -fsS --max-time 5 http://127.0.0.1:3030/api/health | grep -q '"ok":true'; then
    HEALTHY=true
    break
  fi
  sleep 5
done
if [ "$HEALTHY" != true ]; then
  echo "Application health check failed after webhook setup" >&2
  docker compose --env-file "$ENV_FILE" logs --tail 80 app >&2
  exit 1
fi

mapfile -t REVALIDATION_LINES < <(awk '/^REVALIDATION_TOKEN=/{print substr($0, index($0, "=") + 1)}' "$ENV_FILE")
if [ "${#REVALIDATION_LINES[@]}" -ne 1 ] || [ -z "${REVALIDATION_LINES[0]}" ]; then
  echo "Exactly one non-empty REVALIDATION_TOKEN is required" >&2
  exit 1
fi
REVALIDATION_TOKEN=${REVALIDATION_LINES[0]}
if [[ ! "$REVALIDATION_TOKEN" =~ ^[A-Za-z0-9._~+/=-]+$ ]]; then
  echo "REVALIDATION_TOKEN contains unsupported characters" >&2
  exit 1
fi

{
  printf 'header = "Authorization: Bearer %s"\n' "$REVALIDATION_TOKEN"
  printf 'header = "Content-Type: application/json"\n'
  printf 'url = "http://127.0.0.1:3030/api/revalidate"\n'
  printf 'request = "POST"\n'
  printf 'data = "{\\"bootstrap\\":true}"\n'
} | curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time 240 \
  --output "$BOOTSTRAP_RESPONSE" \
  --config -

if ! grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' "$BOOTSTRAP_RESPONSE"; then
  echo "Bootstrap did not return ok=true; timer remains disabled" >&2
  exit 1
fi

systemctl enable --now notionnext-notion-refresh.timer
echo "Webhook verification stored, bootstrap succeeded, timer enabled"
REMOTE
}

show_status() {
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
ENV_FILE=/opt/notionnext/.env.production

printf 'timer-enabled=%s\n' "$(systemctl is-enabled notionnext-notion-refresh.timer 2>/dev/null || true)"
printf 'timer-active=%s\n' "$(systemctl is-active notionnext-notion-refresh.timer 2>/dev/null || true)"
printf 'service-active=%s\n' "$(systemctl is-active notionnext-notion-refresh.service 2>/dev/null || true)"
if awk -F= '$1 == "NOTION_WEBHOOK_VERIFICATION_TOKEN" && length($2) > 0 { found=1 } END { exit !found }' "$ENV_FILE"; then
  echo 'verification-token=configured'
else
  echo 'verification-token=missing'
fi
if awk -F= '$1 == "NOTION_WEBHOOK_SETUP_MODE" && $2 == "true" { found=1 } END { exit !found }' "$ENV_FILE"; then
  echo 'setup-mode=enabled'
else
  echo 'setup-mode=disabled'
fi
systemctl list-timers notionnext-notion-refresh.timer --no-pager
REMOTE
}

disable_scheduler() {
  ssh "$SERVER" 'sudo bash -s' <<'REMOTE'
set -euo pipefail
systemctl disable --now notionnext-notion-refresh.timer >/dev/null
systemctl stop notionnext-notion-refresh.service >/dev/null
echo "Notion webhook timer disabled; Redis and application caches were not changed"
REMOTE
}

case "$MODE" in
  install)
    install_assets
    ;;
  begin-setup)
    begin_setup
    ;;
  show-token)
    show_token
    ;;
  finish)
    finish_setup
    ;;
  status)
    show_status
    ;;
  disable)
    disable_scheduler
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage
    exit 1
    ;;
esac
