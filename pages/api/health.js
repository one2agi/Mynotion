import BLOG from '@/blog.config'
import { checkNotionHealth } from '@/lib/health-check'

/**
 * 轻量健康检查端点。
 *
 * 用途:
 *   - Docker HEALTHCHECK (每 30s)
 *   - 反向代理 / 负载均衡健康探针
 *   - 外部监控(Prometheus / UptimeRobot / 阿里云监控)
 *
 * 设计原则:
 *   - 不鉴权(探针无法传 token)
 *   - 不打印 secrets(只暴露 pageId='set'/'missing' 等元信息)
 *   - 响应 < 1KB
 *   - timeout 2s,防止拖死 Node 进程
 *
 * 状态码:
 *   - 200:健康
 *   - 405:非 GET
 *   - 503:Notion API 不可达且无缓存
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  const start = Date.now()
  const health = await checkNotionHealth({ timeoutMs: 2000 })
  const latencyMs = Date.now() - start

  res.setHeader('Cache-Control', 'no-store')
  res.status(health.ok ? 200 : 503).json({
    ok: health.ok,
    latencyMs,
    notion: {
      reachable: health.reachable,
      pageId: BLOG.NOTION_PAGE_ID ? 'set' : 'missing',
      error: health.error
    },
    redis: {
      configured: Boolean(BLOG.REDIS_URL),
      connected: health.redisConnected
    },
    uptime: Math.round(process.uptime())
  })
}
