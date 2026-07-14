#!/usr/bin/env bash
# 一键部署:本地 build → 推送 → 服务器 load + 替换 → 冒烟测试 → 清理
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

echo "==> 0/7 版本解析"
echo "    IMAGE_TAG: $IMAGE_TAG (来源: $SOURCE)"

echo "==> 1/7 本地 build (IMAGE_TAG=$IMAGE_TAG)"
IMAGE_TAG="$IMAGE_TAG" docker compose build --no-cache app

echo "==> 2/7 打 latest tag"
if [ "$IMAGE_TAG" != "latest" ]; then
  docker tag "notionnext:$IMAGE_TAG" notionnext:latest
  echo "    notionnext:$IMAGE_TAG → notionnext:latest"
else
  echo "    (已是 latest,跳过)"
fi

echo "==> 3/7 导出镜像 (gzip 压缩)"
# 列出所有要 save 的 tag(当前 tag + latest)
TAGS_TO_SAVE="notionnext:$IMAGE_TAG"
[ "$IMAGE_TAG" != "latest" ] && TAGS_TO_SAVE="$TAGS_TO_SAVE notionnext:latest"
docker save $TAGS_TO_SAVE | gzip > "$ARCHIVE"
echo "    tar.gz: $(du -h "$ARCHIVE" | cut -f1)"
echo "    包含 tags: $TAGS_TO_SAVE"

echo "==> 4/7 scp 推送到 $SERVER"
scp "$ARCHIVE" "${SERVER}:/tmp/"

echo "==> 5/7 SSH 服务器: 加载 + 替换新容器(暂不清理旧)"
ssh -o StrictHostKeyChecking=accept-new "$SERVER" "IMAGE_TAG='$IMAGE_TAG' bash -s" <<REMOTE
set -euo pipefail
ARCHIVE_REMOTE=\$(ls -t /tmp/notionnext-*.tar.gz | head -1)
echo "    镜像: \$ARCHIVE_REMOTE"
echo "    IMAGE_TAG: \$IMAGE_TAG"

echo "    [1/3] docker load 加载新镜像"
sudo docker load -i "\$ARCHIVE_REMOTE"

cd /opt/notionnext
echo "    [2/3] docker compose down 停旧容器"
sudo docker compose down

echo "    [3/3] docker compose up -d 启动新容器"
# sudo 默认会重置环境变量(EnvReset),需要 -E 保留 IMAGE_TAG
# 同时把 IMAGE_TAG 写到 .env 文件供 docker compose 读(更稳)
echo "IMAGE_TAG=\$IMAGE_TAG" > .env.image_tag
sudo --preserve-env=IMAGE_TAG docker compose up -d

echo "    等 healthy (最多 90s)"
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  sleep 5
  STATUS=\$(sudo docker inspect --format='{{.State.Health.Status}}' notionnext-app 2>/dev/null || echo "starting")
  echo "        \${i}*5s: \$STATUS"
  [ "\$STATUS" = "healthy" ] && break
done
REMOTE

echo "==> 6/7 冒烟测试(确认新服务 OK 才继续清理)"
SMOKE_FAIL=0
CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/')
echo "    主页: HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:3000/api/knowledge-graph?lang=zh-CN"')
echo "    知识图谱: HTTP $CHECK"
[ "$CHECK" != "200" ] && SMOKE_FAIL=1

CHECK=$(ssh "$SERVER" 'curl -s http://127.0.0.1:3000/api/health | head -c 150')
echo "    /api/health: $CHECK..."
echo "$CHECK" | grep -q '"ok":true' || SMOKE_FAIL=1

if [ "$SMOKE_FAIL" -ne 0 ]; then
  echo ""
  echo "❌ 冒烟测试失败!不清理,保留旧镜像以便回滚"
  echo "   ssh $SERVER 'cd /opt/notionnext && sudo docker compose logs --tail 50 app'"
  exit 1
fi

echo "==> 7/7 清理(只清本项目,不动其他服务)"
echo "    [1/3] 清理本地临时 tar.gz"
rm -f "$ARCHIVE"

echo "    [2/3] SSH 服务器: 保留 notionnext:$IMAGE_TAG + latest,删其他 notionnext 旧 hash"
ssh "$SERVER" "IMAGE_TAG='$IMAGE_TAG' bash -s" <<'REMOTE'
set -euo pipefail
echo "      IMAGE_TAG: $IMAGE_TAG"

# 列出所有 notionnext 镜像(去重 ID + tag)
# 排除当前 IMAGE_TAG 和 latest 保留,其他都删
# 用 awk:第 1 列是 ID,其他是 tag(可能多行因为同一 ID 有多 tag)
# 简单方案:对每个 hash,如果不在 (IMAGE_TAG 或 latest) 上,删
declare -A KEEP_HASH
# 找当前 tag 的 hash
CUR_HASH=$(sudo docker images "notionnext:$IMAGE_TAG" --format "{{.ID}}" | head -1)
[ -n "$CUR_HASH" ] && KEEP_HASH[$CUR_HASH]=1 && echo "      保留(notionnext:$IMAGE_TAG): $CUR_HASH"
# 找 latest 的 hash
LAT_HASH=$(sudo docker images "notionnext:latest" --format "{{.ID}}" | head -1)
[ -n "$LAT_HASH" ] && KEEP_HASH[$LAT_HASH]=1 && echo "      保留(notionnext:latest): $LAT_HASH"

# 遍历所有 notionnext hash,删不在 KEEP 列表的
ALL_IDS=$(sudo docker images "notionnext" --format "{{.ID}}" | sort -u)
REMOVE_IDS=""
for id in $ALL_IDS; do
  if [ -z "${KEEP_HASH[$id]:-}" ]; then
    REMOVE_IDS="$REMOVE_IDS $id"
  fi
done

if [ -n "$REMOVE_IDS" ]; then
  echo "      删旧 hash:$REMOVE_IDS"
  echo "$REMOVE_IDS" | xargs -r sudo docker rmi -f
else
  echo "      (无旧 hash 可删)"
fi

# 只删 notionnext 临时 tar.gz
rm -f /tmp/notionnext-*.tar.gz

echo "      当前 notionnext 镜像列表:"
sudo docker images "notionnext" --format "        {{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}"
echo "      (其他服务的镜像未触碰)"
REMOTE

echo ""
echo "✅ 部署完成 → $SERVER (IMAGE_TAG=$IMAGE_TAG)"
echo ""
echo "后续可选:"
echo "  推送 .env.production(如改了): scp .env.production ${SERVER}:/opt/notionnext/.env.production && ssh ${SERVER} 'cd /opt/notionnext && IMAGE_TAG=$IMAGE_TAG sudo docker compose restart app'"
echo "  实时日志: ssh ${SERVER} 'cd /opt/notionnext && sudo docker compose logs -f app'"
echo "  回滚到上一版: ssh ${SERVER} 'cd /opt/notionnext && sudo docker compose down && IMAGE_TAG=<old-tag> sudo docker compose up -d'"
echo "  查看所有 notionnext 镜像: ssh ${SERVER} 'sudo docker images notionnext'"
