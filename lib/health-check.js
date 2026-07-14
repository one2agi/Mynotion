import BLOG from '@/blog.config'
import { redisClient } from '@/lib/cache/redis_cache'
import { getPost } from '@/lib/db/SiteDataApi'

/**
 * 健康检查 — 探测 Notion / Redis 可达性。
 *
 * 用法:被 /api/health 调用,Docker HEALTHCHECK 间接调它。
 * 行为:
 *   - 200:Notion API 可达(返回 post)→ 视为健康
 *   - 200:Notion 不可达但已能拿到 cached post → 视为健康(降级)
 *   - 503:Notion 不可达且无缓存 → 视为不健康
 *
 * 严格 timeout(默认 2s)防止健康检查拖死 Node 进程。
 *
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs=2000]
 * @returns {Promise<{ok: boolean, reachable: boolean, redisConnected: boolean, error: string|null}>}
 */
export async function checkNotionHealth({ timeoutMs = 2000 } = {}) {
  const result = {
    ok: true,
    reachable: false,
    redisConnected: false,
    error: null
  }

  // 1) Redis PING(可选,不致命)
  if (BLOG.REDIS_URL) {
    try {
      const client = redisClient
      if (client && typeof client.ping === 'function') {
        const pong = await Promise.race([
          client.ping(),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error('redis ping timeout')),
              timeoutMs
            )
          )
        ])
        result.redisConnected = pong === 'PONG'
      }
    } catch (e) {
      result.redisConnected = false
      // Redis 不可达只警告,不影响整体健康
    }
  }

  // 2) Notion 探测
  if (!BLOG.NOTION_PAGE_ID) {
    result.ok = false
    result.error = 'NOTION_PAGE_ID not configured'
    return result
  }

  const pageId = BLOG.NOTION_PAGE_ID.split(',')[0]
  try {
    const post = await Promise.race([
      getPost(pageId),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('notion fetch timeout')), timeoutMs)
      )
    ])
    if (post && post.id) {
      result.reachable = true
    } else {
      result.error = 'getPost returned null/empty'
    }
  } catch (e) {
    result.error = String((e && e.message) || e)
  }

  if (!result.reachable) {
    // Notion 不可达视为不健康(若没有 cache,服务降级)
    result.ok = false
  }

  return result
}
