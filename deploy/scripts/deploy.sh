#!/usr/bin/env bash
# 一键部署双站:本地 build → 推送 → 服务器 load + 替换 → 冒烟测试 → 清理
#
# 用法: ./deploy/scripts/deploy.sh user@server
#   或: DEPLOY_TAG=v1.2.3 ./deploy/scripts/deploy.sh user@server
#
# 版本策略:
#   默认:git describe --tags --abbrev=0(项目最新 tag,如 v4.10.5)
#   覆盖:DEPLOY_TAG 环境变量(支持任意 tag 名)
#   fallback:无 git tag 时用 'latest'
#
# 同时打两个 tag: <DEPLOY_TAG> 和 latest
#
# 前置:
#   - 改完代码,已 commit
#   - .env.production 在本地(如有更新,会单独 scp)
#   - 服务器已初始化(参考 deploy/docs/SERVER-DEPLOY.md § 0)
#
# 流程(先验证后清理):
#   1) 本地 build (IMAGE_TAG=$DEPLOY_TAG)
#   2) tag → latest
#   3) docker save (所有 tag) | gzip
#   4) scp 推送
#   5) SSH 服务器: load → down → up(IMAGE_TAG 传给 compose)
#   6) 冒烟测试 → OK 才继续
#   7) 清理(本地 tar.gz + 服务器除当前 tag/latest 外的 notionnext 镜像)
#
# 不会推送 .env.production(secrets 单独控制,避免误覆盖)
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法: $0 <user@server> [DEPLOY_TAG]" >&2
  echo "示例: $0 root@1.2.3.4" >&2
  echo "      DEPLOY_TAG=v1.0.0 $0 root@1.2.3.4" >&2
  exit 1
fi

SERVER="$1"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# === 解析 IMAGE_TAG ===
# 优先级:DEPLOY_TAG 环境变量 > git describe > 'latest'
if [ -n "${DEPLOY_TAG:-}" ]; then
  IMAGE_TAG="$DEPLOY_TAG"
  SOURCE="环境变量 DEPLOY_TAG"
elif cd "$PROJECT_DIR" && GIT_TAG=$(git describe --tags --abbrev=0 2>/dev/null); then
  IMAGE_TAG="$GIT_TAG"
  SOURCE="git describe (项目最新 tag)"
else
  IMAGE_TAG="latest"
  SOURCE="fallback (无 git tag)"
fi

cd "$PROJECT_DIR"
ARCHIVE="/tmp/notionnext-${IMAGE_TAG}-$(date +%Y%m%d-%H%M%S).tar.gz"
ARCHIVE_NAME="$(basename "$ARCHIVE")"

echo "==> 0.5/7 VPS webhook 状态预检"
ssh -o StrictHostKeyChecking=accept-new "$SERVER" 'bash -s' <<'REMOTE'
set -euo pipefail

assert_webhook_not_in_setup_mode() {
  local env_file=/opt/notionnext/.env.production
  if sudo awk -F= '$1 == "NOTION_WEBHOOK_SETUP_MODE" && $2 == "true" { found=1 } END { exit !found }' "$env_file"; then
    echo "❌ VPS 仍处于 NOTION_WEBHOOK_SETUP_MODE=true；请先完成 Notion webhook finish 后再部署" >&2
    echo "   webhook 地址: https://www.one2agi.com/api/notion-webhook" >&2
    exit 1
  fi
  if ! sudo awk -F= '$1 == "NOTION_WEBHOOK_VERIFICATION_TOKEN" && length($2) > 0 { found=1 } END { exit !found }' "$env_file"; then
    echo "❌ VPS 缺少 NOTION_WEBHOOK_VERIFICATION_TOKEN；请先完成 Notion webhook 配置" >&2
    echo "   webhook 地址: https://www.one2agi.com/api/notion-webhook" >&2
    exit 1
  fi
}

assert_notion_proxy_env_configured() {
  local env_file=/opt/notionnext/.env.production
  local proxy_url proxy_origin

  proxy_url=$(sudo awk -F= '$1 == "NOTION_API_PROXY_URL" && length($2) > 0 { print $2; exit }' "$env_file")
  if [ -z "$proxy_url" ]; then
    echo "❌ VPS 缺少 NOTION_API_PROXY_URL；Notion Worker 反代未启用" >&2
    echo "   先运行: ./deploy/scripts/configure-notion-proxy-vps.sh tencent-vps" >&2
    exit 1
  fi
  if ! sudo awk -F= '$1 == "NOTION_API_PROXY_TOKEN" && length($2) > 0 { found=1 } END { exit !found }' "$env_file"; then
    echo "❌ VPS 缺少 NOTION_API_PROXY_TOKEN；Notion Worker 反代未启用" >&2
    echo "   先运行: ./deploy/scripts/configure-notion-proxy-vps.sh tencent-vps" >&2
    exit 1
  fi

  proxy_origin="${proxy_url%/api/v3}"
  if [ "$proxy_origin" != "$proxy_url" ]; then
    if ! curl -fsS --max-time 8 "$proxy_origin/health" | grep -q '"ok":true'; then
      echo "❌ Notion Worker health check failed: $proxy_origin/health" >&2
      exit 1
    fi
  fi
}

assert_webhook_not_in_setup_mode
echo "    webhook env: ok"
assert_notion_proxy_env_configured
echo "    notion proxy env: ok"
REMOTE

echo "==> 0/7 版本解析"
echo "    IMAGE_TAG: $IMAGE_TAG (来源: $SOURCE)"

echo "==> 1/7 本地 build 双站 (IMAGE_TAG=$IMAGE_TAG)"
# 不带 --no-cache:复用 Docker layer cache。改代码 ~2-3 min,改 package.json 自动失效 pnpm install,改 Dockerfile 自动全重。
# 怀疑缓存异常时临时加 --no-cache 排查。
IMAGE_TAG="$IMAGE_TAG" docker compose --env-file .env.production build app way

echo "==> 2/7 打 latest tag"
if [ "$IMAGE_TAG" != "latest" ]; then
  docker tag "notionnext:$IMAGE_TAG" notionnext:latest
  docker tag "notionnext-way:$IMAGE_TAG" notionnext-way:latest
  echo "    notionnext:$IMAGE_TAG → notionnext:latest"
  echo "    notionnext-way:$IMAGE_TAG → notionnext-way:latest"
else
  echo "    (已是 latest,跳过)"
fi

echo "==> 3/7 导出镜像 (gzip 压缩)"
# 列出所有要 save 的 tag(当前 tag + latest)
TAGS_TO_SAVE="notionnext:$IMAGE_TAG notionnext-way:$IMAGE_TAG"
[ "$IMAGE_TAG" != "latest" ] && TAGS_TO_SAVE="$TAGS_TO_SAVE notionnext:latest notionnext-way:latest"
docker save $TAGS_TO_SAVE | gzip > "$ARCHIVE"
echo "    tar.gz: $(du -h "$ARCHIVE" | cut -f1)"
echo "    包含 tags: $TAGS_TO_SAVE"

echo "==> 4/7 scp 推送镜像与双站路由配置到 $SERVER"
scp "$ARCHIVE" "${SERVER}:/tmp/$ARCHIVE_NAME"
scp docker-compose.yml deploy/nginx/www.one2agi.com.conf "${SERVER}:/tmp/"
scp deploy/scripts/run-notion-refresh.sh \
  deploy/systemd/notionnext-notion-refresh.service \
  deploy/systemd/notionnext-notion-refresh.timer \
  "${SERVER}:/tmp/"

echo "==> 5/7 SSH 服务器: 加载 + 替换新容器(暂不清理旧)"
ssh -o StrictHostKeyChecking=accept-new "$SERVER" "IMAGE_TAG='$IMAGE_TAG' ARCHIVE_NAME='$ARCHIVE_NAME' bash -s" <<'REMOTE'
set -euo pipefail
ARCHIVE_REMOTE="/tmp/$ARCHIVE_NAME"

assert_image_exists() {
  local image="$1"
  if ! sudo docker image inspect "$image" >/dev/null 2>&1; then
    echo "Expected image $image not found after docker load; aborting instead of building or pulling" >&2
    exit 1
  fi
}

test -f "$ARCHIVE_REMOTE"
echo "    镜像: $ARCHIVE_REMOTE"
echo "    IMAGE_TAG: $IMAGE_TAG"

echo "    [1/3] docker load 加载新镜像"
sudo docker load -i "$ARCHIVE_REMOTE"
assert_image_exists "notionnext:$IMAGE_TAG"
assert_image_exists "notionnext-way:$IMAGE_TAG"

cd /opt/notionnext
sudo cp /tmp/docker-compose.yml /opt/notionnext/docker-compose.yml
sudo install -o root -g root -m 755 /tmp/run-notion-refresh.sh /usr/local/sbin/run-notion-refresh
sudo install -o root -g root -m 644 /tmp/notionnext-notion-refresh.service /etc/systemd/system/notionnext-notion-refresh.service
sudo install -o root -g root -m 644 /tmp/notionnext-notion-refresh.timer /etc/systemd/system/notionnext-notion-refresh.timer
sudo systemctl daemon-reload

# 早期部署使用 0-notionnext.conf 承载完整 www vhost；新版配置接管后必须先退役，
# 否则会重复声明 server/upstream。保留备份，便于人工回滚。
if [ -e /etc/nginx/sites-enabled/0-notionnext.conf ]; then
  LEGACY_NGINX_BACKUP="/etc/nginx/sites-available/0-notionnext.conf.disabled-$(date +%Y%m%d-%H%M%S)"
  sudo mkdir -p /etc/nginx/sites-available
  sudo mv /etc/nginx/sites-enabled/0-notionnext.conf "$LEGACY_NGINX_BACKUP"
  echo "    已退役旧 nginx vhost: $LEGACY_NGINX_BACKUP"
fi
sudo cp /tmp/www.one2agi.com.conf /etc/nginx/sites-enabled/www.one2agi.com.conf
sudo nginx -t
sudo systemctl reload nginx
echo "    [2/3] docker compose down 停旧容器"
sudo docker compose --env-file .env.production down

echo "    [3/3] docker compose up -d 启动新容器"
# sudo 默认会重置环境变量(EnvReset),需要 -E 保留 IMAGE_TAG
# 同时把 IMAGE_TAG 写到 .env 文件供 docker compose 读(更稳)
echo "IMAGE_TAG=$IMAGE_TAG" > .env.image_tag
sudo --preserve-env=IMAGE_TAG docker compose --env-file .env.production up -d

echo "    等 healthy (最多 90s)"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  sleep 5
  APP_STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' notionnext-app 2>/dev/null || echo "starting")
  WAY_STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' notionnext-way 2>/dev/null || echo "starting")
  echo "        ${i}*5s: app=$APP_STATUS way=$WAY_STATUS"
  [ "$APP_STATUS" = "healthy" ] && [ "$WAY_STATUS" = "healthy" ] && break
done
REMOTE

echo "==> 6/7 冒烟测试(确认新服务 OK 才继续清理)"
SMOKE_FAIL=0
CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/')
echo "    starter 主页(3030): HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3031/')
echo "    heo 内容站(3031): HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3031/api/knowledge-graph?lang=zh-CN"')
echo "    知识图谱: HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s http://127.0.0.1:3030/api/health | head -c 150')
echo "    /api/health: $CHECK..."
echo "$CHECK" | grep -q '"ok":true' || SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" https://www.one2agi.com/archive')
echo "    www 历史内容 308: HTTP $CHECK"
[ "$CHECK" != "308" ] && SMOKE_FAIL=1

assert_webhook_runtime_ready() {
  CHECK=$(ssh "$SERVER" 'cd /opt/notionnext && sudo docker compose exec -T app node -e '"'"'process.exit(process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN ? 0 : 1)'"'"'')
  echo "    webhook 容器环境: ok"
}

assert_webhook_public_contract() {
  WEBHOOK_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X POST https://www.one2agi.com/api/notion-webhook -H 'content-type: application/json' --data '{}')
  echo "    webhook 未签名 POST: HTTP $WEBHOOK_HTTP"
  [ "$WEBHOOK_HTTP" = "401" ] || SMOKE_FAIL=1
}

assert_refresh_timer_active() {
  TIMER_ENABLED=$(ssh "$SERVER" 'systemctl is-enabled notionnext-notion-refresh.timer 2>/dev/null || true')
  TIMER_STATUS=$(ssh "$SERVER" 'systemctl is-active notionnext-notion-refresh.timer 2>/dev/null || true')
  echo "    notion refresh timer: enabled=$TIMER_ENABLED active=$TIMER_STATUS"
  [ "$TIMER_ENABLED" = "enabled" ] && [ "$TIMER_STATUS" = "active" ] || SMOKE_FAIL=1
  ssh "$SERVER" "sudo grep -q '127.0.0.1:3031/api/revalidate' /usr/local/sbin/run-notion-refresh"
  echo "    notion refresh target: way(3031)"
}

assert_notion_proxy_runtime_ready() {
  ssh "$SERVER" 'cd /opt/notionnext && for service in app way; do sudo docker compose exec -T "$service" node -e '"'"'process.exit(process.env.NOTION_API_PROXY_URL && process.env.NOTION_API_PROXY_TOKEN ? 0 : 1)'"'"'; done'
  echo "    notion proxy 容器环境: ok"
}

assert_webhook_runtime_ready || SMOKE_FAIL=1
assert_webhook_public_contract
assert_refresh_timer_active
assert_notion_proxy_runtime_ready || SMOKE_FAIL=1

if [ "$SMOKE_FAIL" -ne 0 ]; then
  echo ""
  echo "❌ 冒烟测试失败!不清理,保留旧镜像以便回滚"
  echo "   ssh $SERVER 'cd /opt/notionnext && sudo docker compose logs --tail 50 app'"
  exit 1
fi

echo "==> 7/7 清理(只清本项目,不动其他服务)"
echo "    [1/3] 清理本地临时 tar.gz"
rm -f "$ARCHIVE"

echo "    [2/3] SSH 服务器: 保留双站当前 tag + latest,删其他旧 hash"
ssh "$SERVER" "IMAGE_TAG='$IMAGE_TAG' ARCHIVE_NAME='$ARCHIVE_NAME' bash -s" <<'REMOTE'
set -euo pipefail
echo "      IMAGE_TAG: $IMAGE_TAG"

cleanup_repository() {
  local repository="$1"
  local current_hash latest_hash all_ids remove_ids=""
  declare -A keep_hash=()

  current_hash=$(sudo docker images "$repository:$IMAGE_TAG" --format "{{.ID}}" | head -1)
  [ -n "$current_hash" ] && keep_hash[$current_hash]=1 && echo "      保留($repository:$IMAGE_TAG): $current_hash"

  latest_hash=$(sudo docker images "$repository:latest" --format "{{.ID}}" | head -1)
  [ -n "$latest_hash" ] && keep_hash[$latest_hash]=1 && echo "      保留($repository:latest): $latest_hash"

  all_ids=$(sudo docker images "$repository" --format "{{.ID}}" | sort -u)
  for id in $all_ids; do
    if [ -z "${keep_hash[$id]:-}" ]; then
      remove_ids="$remove_ids $id"
    fi
  done

  if [ -n "$remove_ids" ]; then
    echo "      删除 $repository 旧 hash:$remove_ids"
    echo "$remove_ids" | xargs -r sudo docker rmi -f
  else
    echo "      $repository 无旧 hash 可删"
  fi
}

cleanup_repository notionnext
cleanup_repository notionnext-way

# 只删本次上传的 notionnext 临时 tar.gz
rm -f "/tmp/$ARCHIVE_NAME"

echo "      当前双站镜像列表:"
sudo docker images --format "        {{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}" | grep -E '^        notionnext(-way)?:' || true
echo "      (其他服务的镜像未触碰)"
REMOTE

echo ""
echo "✅ 部署完成 → $SERVER (IMAGE_TAG=$IMAGE_TAG)"
echo ""
echo "后续可选:"
echo "  推送 .env.production(如改了): scp .env.production ${SERVER}:/opt/notionnext/.env.production && ssh ${SERVER} 'cd /opt/notionnext && sudo env IMAGE_TAG=$IMAGE_TAG docker compose --env-file .env.production restart app way'"
echo "  实时日志: ssh ${SERVER} 'cd /opt/notionnext && sudo docker compose logs -f app'"
echo "  回滚到上一版: ssh ${SERVER} 'cd /opt/notionnext && sudo docker compose --env-file .env.production down && sudo env IMAGE_TAG=<old-tag> docker compose --env-file .env.production up -d'"
echo "  查看双站镜像: ssh ${SERVER} 'sudo docker images --format \"{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}\" | grep notionnext'"
