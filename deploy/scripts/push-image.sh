#!/usr/bin/env bash
# 推送 notionnext:1.0.0 到服务器 (本地无外部 registry 场景)
#
# 用法: ./deploy/scripts/push-image.sh user@server
#   需先在本地 build: docker compose build app
#
# 流程:
#   1) docker save 导出 tar.gz
#   2) scp 推到服务器
#   3) 服务器 docker load 加载镜像
#   4) 提示用户去服务器跑 deploy-server.sh
#
# 安全: 不传 .env.production,服务器用 .env.production 文件
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "用法: $0 <user@server>" >&2
  echo "示例: $0 root@1.2.3.4" >&2
  exit 1
fi

SERVER="$1"
LOCAL_IMAGE="notionnext:1.0.0"
ARCHIVE="/tmp/notionnext-1.0.0.tar.gz"
REMOTE_PATH="/tmp/"

echo "==> 1/4 检查本地镜像"
docker images "$LOCAL_IMAGE" --format "{{.Repository}}:{{.Tag}} {{.Size}}" | head -1

echo "==> 2/4 导出镜像 (这会生成 ~400MB tar.gz)"
docker save "$LOCAL_IMAGE" | gzip > "$ARCHIVE"
ls -lh "$ARCHIVE"

echo "==> 3/4 scp 推送到 $SERVER"
scp "$ARCHIVE" "${SERVER}:${REMOTE_PATH}"

echo "==> 4/4 清理本地临时文件"
rm -f "$ARCHIVE"

echo ""
echo "✅ 镜像已推送到 ${SERVER}:${REMOTE_PATH}notionnext-1.0.0.tar.gz"
echo ""
echo "下一步 — 在服务器执行:"
echo "  ssh ${SERVER}"
echo "  sudo mv /tmp/notionnext-1.0.0.tar.gz /opt/notionnext/"
echo "  cd /opt/notionnext"
echo "  sudo docker load -i notionnext-1.0.0.tar.gz"
echo "  sudo docker compose up -d"
echo ""
echo "服务器需要预先装好 docker + docker compose + 反代(nginx/Caddy)"
