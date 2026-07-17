#!/usr/bin/env bash
# Weekly health check for NotionNext deployment
#
# 自动跑(cron)或手动跑(SSH 到 VPS 一次),输出追加到 /var/log/notionnext-weekly.log
# 监控 4 件事:API 健康 / Docker 内存 / 关键页面 TTFB / 磁盘占用
#
# 报警阈值(出问题 log 会有突出文本):
#   - api.ok=false              → Notion 不通
#   - api.latencyMs > 3000      → Notion 慢
#   - app memory > 1.5G         → 内存异常(限 2G)
#   - 任何 TTFB > 2s            → 网络或容器问题
#
# 查看最近一周报告:ssh tencent-vps 'tail -60 /var/log/notionnext-weekly.log'
# 查看最近 8 周:   ssh tencent-vps 'grep "Weekly check" /var/log/notionnext-weekly.log | tail -8'

set -uo pipefail

LOG=/var/log/notionnext-weekly.log
SITE="${NOTIONNEXT_SITE:-https://www.one2agi.com}"
APP_MEM_LIMIT_MB=2048   # docker-compose.yml 里 app memory limit
WARN_MEM_MB=1536        # 75% of limit → 触发警告

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

{
  echo ""
  echo "================================================================"
  echo "Weekly check @ $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "================================================================"
} >> "$LOG"

# ---------- 1. API Health ----------
echo "" >> "$LOG"
echo "--- 1. API Health ($SITE/api/health) ---" >> "$LOG"
HEALTH_RAW=$(curl -s --max-time 10 "$SITE/api/health" 2>&1)
HEALTH_HTTP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/api/health" 2>&1)
if [ "$HEALTH_HTTP" = "200" ]; then
  echo "$HEALTH_RAW" | jq . >> "$LOG"
  OK=$(echo "$HEALTH_RAW" | jq -r 'if has("ok") then .ok | tostring else "missing" end')
  LATENCY=$(echo "$HEALTH_RAW" | jq -r '.latencyMs // "?"')
  if [ "$OK" != "true" ]; then
    echo "⚠️  ALERT: api.ok=$OK (Notion not reachable)" >> "$LOG"
  fi
  if [ "$LATENCY" != "?" ] && [ "${LATENCY%.*}" -gt 3000 ] 2>/dev/null; then
    echo "⚠️  ALERT: latency=${LATENCY}ms (>3000ms)" >> "$LOG"
  fi
else
  echo "❌ FAIL: HTTP $HEALTH_HTTP — $HEALTH_RAW" >> "$LOG"
fi

# ---------- 2. Docker 内存 ----------
echo "" >> "$LOG"
echo "--- 2. Docker memory ---" >> "$LOG"
cd /opt/notionnext 2>/dev/null || cd /tmp
sudo docker stats --no-stream --format "  {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}" >> "$LOG" 2>&1

# 抓 app 内存数值,触发警告
APP_MEM_RAW=$(sudo docker stats notionnext-app --no-stream --format "{{.MemUsage}}" 2>/dev/null | head -1)
if [ -n "$APP_MEM_RAW" ]; then
  APP_MEM_MB=$(echo "$APP_MEM_RAW" | awk '{print $1}' | sed 's/MiB//;s/GiB/*1024/;s/MiB//' | bc 2>/dev/null)
  if [ -n "$APP_MEM_MB" ] && [ "${APP_MEM_MB%.*}" -gt "$WARN_MEM_MB" ] 2>/dev/null; then
    echo "⚠️  ALERT: app memory=${APP_MEM_RAW} (>${WARN_MEM_MB}MB,limit ${APP_MEM_LIMIT_MB}MB)" >> "$LOG"
  fi
fi

# ---------- 3. 关键页面 TTFB ----------
echo "" >> "$LOG"
echo "--- 3. TTFB samples ---" >> "$LOG"
for path in "/" "/archive" "/api/health" "/api/knowledge-graph?lang=zh-CN"; do
  TTFB=$(curl -sk -o /dev/null -w '%{time_starttransfer}' --max-time 15 "${SITE}${path}" 2>&1)
  printf "  %-45s %ss\n" "$path" "$TTFB" >> "$LOG"
  # 数字比较 (awk 浮点)
  IS_SLOW=$(awk -v t="$TTFB" 'BEGIN { print (t+0 > 2.0) ? "1" : "0" }')
  if [ "$IS_SLOW" = "1" ]; then
    echo "  ⚠️  ALERT: $path TTFB=${TTFB}s (>2s)" >> "$LOG"
  fi
done

# ---------- 4. 磁盘占用 ----------
echo "" >> "$LOG"
echo "--- 4. Disk usage ---" >> "$LOG"
df -h / /opt 2>/dev/null | tail -n +2 | awk '{printf "  %-20s used=%s/%s (%s)\n", $1, $3, $2, $5}' >> "$LOG"

echo "" >> "$LOG"
echo "✓ weekly-check done @ $(date '+%H:%M:%S')" >> "$LOG"