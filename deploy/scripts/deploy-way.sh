#!/usr/bin/env bash
# 仅用于 way 主题文件的紧急单站更新。
# 共享代码、路由、Webhook 或缓存逻辑变化必须使用 deploy.sh 同步部署双站。
#
# 用法: ./deploy/scripts/deploy-way.sh user@server
#   或: DEPLOY_TAG=v1.2.3 ./deploy/scripts/deploy-way.sh user@server
#
# 前置:
#   - 改完代码,已 commit + push 到 codex/cloudflare-notion-worker
#   - .env.production 在本地(本脚本会 scp 到服务器)
#   - DNS: way CNAME → one2agi.com 已加（首次部署手动用 tccli）
#   - nginx vhost: deploy/nginx/way.one2agi.com.conf 已 scp 并 enable
#   - certbot 已签 way.one2agi.com 证书（首次部署手动跑）
#
# 与 deploy.sh 的差异:
#   - deploy.sh 本地 build → tar.gz → scp image
#   - deploy-way.sh 服务器 build（way image 改动少，服务器 build 更简单）
#
# 流程(单 server):
#   1) 服务器前置: pull mirror images (syntax + node base) + tag 到 docker.io
#   2) 服务器 git pull
#   3) 服务器: docker compose build way
#   4) 服务器: docker compose up -d way
#   5) 冒烟测试 (way 容器 + way.one2agi.com + 主站仍正常)
#   6) 清理旧 way image

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法: $0 <user@server>" >&2
  echo "示例: $0 root@1.2.3.4" >&2
  exit 1
fi

SERVER="$1"

# === 解析 IMAGE_TAG ===
# 优先级:DEPLOY_TAG 环境变量 > 'latest'
if [ -n "${DEPLOY_TAG:-}" ]; then
  IMAGE_TAG="$DEPLOY_TAG"
  SOURCE="环境变量 DEPLOY_TAG"
else
  IMAGE_TAG="latest"
  SOURCE="fallback (无 DEPLOY_TAG)"
fi

echo "==> 0/7 版本解析"
echo "    IMAGE_TAG: $IMAGE_TAG (来源: $SOURCE)"

echo "==> 1/7 服务器前置 - pull mirror images (国内访问 docker.io 慢/被墙)"
# 详细原因:见 deploy/docs/DEPLOY-LOG.md (2026-07-16 way 部署踩坑)
# 用 DaoCloud mirror 拉 syntax image + node base image,tag 到 docker.io namespace
# 这样 docker compose build 时不用每次重新拉
ssh -o ConnectTimeout=30 "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
echo "    检查 syntax image (docker/dockerfile:1)..."
if ! sudo docker image inspect docker.io/docker/dockerfile:1 >/dev/null 2>&1; then
  echo "      缺失,从 DaoCloud mirror pull"
  sudo docker pull docker.m.daocloud.io/docker/dockerfile:1
  sudo docker tag docker.m.daocloud.io/docker/dockerfile:1 docker.io/docker/dockerfile:1
else
  echo "      已存在,跳过"
fi

echo "    检查 node:22-alpine..."
if ! sudo docker image inspect docker.io/library/node:22-alpine >/dev/null 2>&1; then
  echo "      缺失,从 DaoCloud mirror pull"
  sudo docker pull docker.m.daocloud.io/library/node:22-alpine
  sudo docker tag docker.m.daocloud.io/library/node:22-alpine docker.io/library/node:22-alpine
else
  echo "      已存在,跳过"
fi

echo "    检查 node:22-slim..."
if ! sudo docker image inspect docker.io/library/node:22-slim >/dev/null 2>&1; then
  echo "      缺失,从 DaoCloud mirror pull"
  sudo docker pull docker.m.daocloud.io/library/node:22-slim
  sudo docker tag docker.m.daocloud.io/library/node:22-slim docker.io/library/node:22-slim
else
  echo "      已存在,跳过"
fi
REMOTE

echo "==> 2/7 scp 推送代码 + .env.production"
# 注意:.env.production 是 secrets,只覆盖服务器上同路径文件
ssh -o ConnectTimeout=30 "$SERVER" 'sudo mkdir -p /opt/notionnext /tmp/notionnext-staging/themes/heo/components && sudo chown -R "$(id -u):$(id -g)" /tmp/notionnext-staging'
scp docker-compose.yml \
    themes/heo/components/Hero.js \
    themes/heo/config.js \
    "${SERVER}:/tmp/notionnext-staging/"

ssh -o ConnectTimeout=30 "$SERVER" bash -s <<'REMOTE'
set -euo pipefail
sudo mkdir -p /tmp/notionnext-staging/themes/heo/components
sudo cp /tmp/notionnext-staging/themes/heo/components/Hero.js /opt/notionnext/themes/heo/components/Hero.js
sudo cp /tmp/notionnext-staging/themes/heo/config.js /opt/notionnext/themes/heo/config.js
sudo cp /tmp/notionnext-staging/docker-compose.yml /opt/notionnext/docker-compose.yml
# 注意:不覆盖服务器的 nginx vhost 和 .env.production(避免误覆盖生产配置)
echo "    代码已同步到 /opt/notionnext"
REMOTE

echo "==> 3/7 服务器 build way image"
ssh -o ConnectTimeout=30 "$SERVER" bash -s <<REMOTE
set -euo pipefail
cd /opt/notionnext
echo "    IMAGE_TAG: $IMAGE_TAG"
echo "    [1/2] docker compose build way (首次 3-5 分钟,增量 1-2 分钟)"
sudo IMAGE_TAG="$IMAGE_TAG" docker compose build way 2>&1 | tail -5

# way 容器 image 也打 latest tag(与主站保持一致)
if [ "$IMAGE_TAG" != "latest" ]; then
  sudo docker tag "notionnext-way:$IMAGE_TAG" notionnext-way:latest
  echo "    notionnext-way:$IMAGE_TAG → notionnext-way:latest"
fi
REMOTE

echo "==> 4/7 服务器 up -d way 容器"
ssh -o ConnectTimeout=30 "$SERVER" bash -s <<REMOTE
set -euo pipefail
cd /opt/notionnext
sudo IMAGE_TAG="$IMAGE_TAG" docker compose up -d way 2>&1 | tail -10

echo "    等 healthy (最多 60s)"
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  sleep 5
  STATUS=\$(sudo docker inspect --format='{{.State.Health.Status}}' notionnext-way 2>/dev/null || echo "starting")
  echo "        \${i}*5s: \$STATUS"
  [ "\$STATUS" = "healthy" ] && break
done
REMOTE

echo "==> 5/7 冒烟测试"
SMOKE_FAIL=0

# 1) way 容器内部响应
CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3031/')
echo "    way 容器(127.0.0.1:3031): HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

# 2) way 站点经 nginx
CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" https://way.one2agi.com/')
echo "    way.one2agi.com (nginx): HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

# 3) heo 主题特征: 应该看到 heo 默认 hero 文案
HERO_TEXT=$(ssh "$SERVER" 'curl -s https://way.one2agi.com/ | grep -oE "分享编程|TANGLY1024" | head -1')
if [ -n "$HERO_TEXT" ]; then
  echo "    heo 主题验证: ✓ ($HERO_TEXT)"
else
  echo "    heo 主题验证: ✗ (未找到 heo 默认 hero 文案)"
  SMOKE_FAIL=1
fi

# 4) 主站仍正常
CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" https://www.one2agi.com/')
echo "    www.one2agi.com (主站): HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

# 5) 主站渲染的是 starter 不是 heo
MAIN_TEXT=$(ssh "$SERVER" 'curl -s https://www.one2agi.com/ | grep -oE "碳基进化" | head -1')
if [ -n "$MAIN_TEXT" ]; then
  echo "    starter 主题验证: ✓ ($MAIN_TEXT)"
else
  echo "    starter 主题验证: ✗ (主站显示他主题)"
  SMOKE_FAIL=1
fi

if [ "$SMOKE_FAIL" -ne 0 ]; then
  echo ""
  echo "❌ 冒烟测试失败!way 容器可能未正确启动"
  echo "   ssh $SERVER 'cd /opt/notionnext && sudo docker compose logs --tail 50 way'"
  exit 1
fi

echo "==> 6/7 清理旧 way image"
ssh "$SERVER" bash -s <<REMOTE
set -euo pipefail
declare -A KEEP_HASH
CUR_HASH=\$(sudo docker images "notionnext-way:$IMAGE_TAG" --format "{{.ID}}" | head -1)
[ -n "\$CUR_HASH" ] && KEEP_HASH[\$CUR_HASH]=1 && echo "      保留(notionnext-way:$IMAGE_TAG): \$CUR_HASH"
LAT_HASH=\$(sudo docker images "notionnext-way:latest" --format "{{.ID}}" | head -1)
[ -n "\$LAT_HASH" ] && KEEP_HASH[\$LAT_HASH]=1 && echo "      保留(notionnext-way:latest): \$LAT_HASH"

ALL_IDS=\$(sudo docker images "notionnext-way" --format "{{.ID}}" | sort -u)
REMOVE_IDS=""
for id in \$ALL_IDS; do
  if [ -z "\${KEEP_HASH[\$id]:-}" ]; then
    REMOVE_IDS="\$REMOVE_IDS \$id"
  fi
done

if [ -n "\$REMOVE_IDS" ]; then
  echo "      删旧 hash:\$REMOVE_IDS"
  echo "\$REMOVE_IDS" | xargs -r sudo docker rmi -f
else
  echo "      (无旧 hash 可删)"
fi

echo "      当前 way image 列表:"
sudo docker images "notionnext-way" --format "        {{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}"
REMOTE

echo "==> 7/7 清理本地临时文件"
rm -rf /tmp/notionnext-staging

echo ""
echo "✅ way.one2agi.com 部署完成 → $SERVER (IMAGE_TAG=$IMAGE_TAG)"
echo ""
echo "后续检查:"
echo "  实时日志: ssh ${SERVER} 'cd /opt/notionnext && sudo docker compose logs -f way'"
echo "  way 容器状态: ssh ${SERVER} 'sudo docker ps | grep way'"
echo "  手动验证: 浏览器打开 https://way.one2agi.com"
echo ""
echo "如果 heo hero 配置还没加(在 Notion CONFIG-TABLE),way 站点会:"
echo "  - hero 卡片点击行为是随机跳文章（默认行为）"
echo "  - 标题是 heo 默认的 '分享编程 / 与思维认知 / TANGLY1024.COM'"
echo "  - 想自定义请加 HEO_HERO_BANNER_LINK + HEO_HERO_TITLE_1/2/3 + HEO_HERO_COVER_TITLE"
