/**
 * Redis 长 TTL 兜底存储
 *
 * 与 lib/cache/redis_cache.js 的区别:
 * - redis_cache 用 7.5 min 短 TTL,做"快速 cache 层"
 * - redis_fallback 用 7 天长 TTL,做"跨容器重启兜底层"
 *
 * 设计目的:
 * 当 Notion 拉取失败时,getOrSetDataWithCache 先查 Redis fallback(7 天内都还有),
 * 再查 stale(本地内存/文件,容器重启就丢)。这保证:
 * - 短时间 Notion 不可达:用 stale(快速)
 * - 容器重启 + Notion 仍不可达:用 Redis fallback(只要 7 天内成功过一次)
 * - 长时间 Notion 不可达 + fallback 也过期:才 throw
 *
 * REDIS_URL 缺失时所有操作都是 no-op,不影响流程。
 */
import BLOG from '@/blog.config'
import { redisClient } from './redis_cache'

const FALLBACK_TTL_SEC = 7 * 24 * 60 * 60 // 7 天
const KEY_PREFIX = 'fallback:'

function isRedisReady() {
  return Boolean(BLOG.REDIS_URL) && typeof redisClient?.set === 'function'
}

/**
 * 写 Redis 兜底(7 天 TTL)
 * @param {string} key - 原始 cache key(会自动加 fallback: 前缀)
 * @param {*} data - 要保存的数据(会被 JSON.stringify)
 */
export async function saveFallback(key, data) {
  if (!isRedisReady()) return
  try {
    await redisClient.set(
      `${KEY_PREFIX}${key}`,
      JSON.stringify(data),
      'EX',
      FALLBACK_TTL_SEC
    )
  } catch (e) {
    console.warn(`[redis_fallback] save failed key:${key}`, e.message)
  }
}

/**
 * 读 Redis 兜底
 * @param {string} key - 原始 cache key
 * @returns {*} 反序列化的数据,失败或不存在返 null
 */
export async function loadFallback(key) {
  if (!isRedisReady()) return null
  try {
    const raw = await redisClient.get(`${KEY_PREFIX}${key}`)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    console.warn(`[redis_fallback] load failed key:${key}`, e.message)
    return null
  }
}
