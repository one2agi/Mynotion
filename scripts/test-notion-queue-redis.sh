#!/usr/bin/env bash
set -euo pipefail

container="notionnext-webhook-queue-test-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "$container" \
  --publish 127.0.0.1::6379 redis:7-alpine >/dev/null

port="$(docker inspect --format '{{(index (index .NetworkSettings.Ports "6379/tcp") 0).HostPort}}' "$container")"

for _ in $(seq 1 60); do
  if docker exec "$container" redis-cli ping 2>/dev/null | grep -q PONG; then
    break
  fi
  sleep 0.25
done

docker exec "$container" redis-cli ping | grep -q PONG

REDIS_URL="redis://127.0.0.1:${port}" \
RUN_NOTION_QUEUE_REDIS_INTEGRATION=1 \
pnpm test -- __tests__/lib/notion-webhook/queue.redis.test.ts --runInBand
