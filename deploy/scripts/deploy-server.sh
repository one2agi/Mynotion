#!/usr/bin/env bash
# 服务器端启动 / 重启 notionnext
#
# 假设:
#   - 镜像已通过 docker load -i notionnext-1.0.0.tar.gz 加载
#   - 项目代码已 scp 到 /opt/notionnext/ (含 docker-compose.yml, .env.production, deploy/)
#   - 服务器有 docker + docker compose
#   - 服务器架构 amd64 (如 arm64 需先在本地 cross-build)
#
# 用法: sudo /opt/notionnext/deploy/scripts/deploy-server.sh
set -euo pipefail

cd /opt/notionnext

echo "==> 1/5 检查前置条件"
command -v docker >/dev/null || { echo "docker 未安装"; exit 1; }
command -v docker >/dev/null && docker compose version >/dev/null || { echo "docker compose plugin 未装"; exit 1; }
test -f .env.production || { echo ".env.production 不在 /opt/notionnext/"; exit 1; }
test -f docker-compose.yml || { echo "docker-compose.yml 不在 /opt/notionnext/"; exit 1; }

echo "==> 2/5 拉取 redis 镜像(国内 mirror)"
docker pull docker.m.daocloud.io/library/redis:7-alpine || {
  echo "redis 镜像拉取失败,尝试官方源..."
  docker pull redis:7-alpine
}

echo "==> 3/5 启动服务"
docker compose up -d

echo "==> 4/5 等待 healthy (最多 90 秒)"
for i in {1..18}; do
  sleep 5
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' notionnext-app 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    echo "✅ app healthy (用了 ${i}*5 秒)"
    break
  fi
  echo "  等待中... (${i}/18, current: $STATUS)"
done

echo "==> 5/5 冒烟测试"
echo "--- /api/health ---"
curl -s http://127.0.0.1:3000/api/health | head -1 || echo "FAIL"
echo "--- 主页 ---"
curl -s -o /dev/null -w "HTTP %{http_code} time=%{time_total}s\n" http://127.0.0.1:3000/ || echo "FAIL"
echo "--- 知识图谱 ---"
curl -s -o /dev/null -w "HTTP %{http_code} time=%{time_total}s\n" "http://127.0.0.1:3000/api/knowledge-graph?lang=zh-CN" || echo "FAIL"

echo ""
echo "✅ 部署完成"
echo ""
echo "接下来:"
echo "  1) 配置反代(nginx)指向 127.0.0.1:3000 + HTTPS"
echo "  2) DNS 把 www.one2agi.com 切到服务器 IP"
echo "  3) 监控 docker compose ps + 日志 docker compose logs -f app"
