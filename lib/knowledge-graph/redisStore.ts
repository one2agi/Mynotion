import type { GraphBlobStore } from './store'
import { redisClient } from '@/lib/cache/redis_cache'
import BLOG from '@/blog.config'

/**
 * Redis 实现 GraphBlobStore。
 * EdgeOne Pages 用 EdgeOne Blob,自建 Docker 用 Redis。
 * 两者通过 lib/knowledge-graph/store.ts 的 createGraphStore() 统一调用,
 * 上层业务代码(refresh / build / extract)无需感知。
 *
 * Key 命名约定:与 store.ts 里的 STATE_KEY / PUBLICATION_PREFIX /
 * graphVersionKey / pageSnapshotKey / refreshClaimKey 保持一致,
 * 未来需要回写 Blob 或跨环境数据迁移也不会撞 key。
 *
 * 实施注意:
 * - redisClient 在无 REDIS_URL 时是 `{}`(lib/cache/redis_cache.js),
 *   没有 get/set 方法,这里必须在入口校验
 * - ioredis 已内置 JSON 序列化扩展,可选;但我们手动 JSON.stringify 保持与
 *   EdgeOne Blob 的语义一致
 */
export function createRedisGraphStore(): GraphBlobStore {
  if (!BLOG.REDIS_URL) {
    throw new Error(
      'createRedisGraphStore called without REDIS_URL configured. Set REDIS_URL in .env.production.'
    )
  }
  if (typeof (redisClient as { get?: unknown }).get !== 'function') {
    throw new Error(
      'redisClient is not initialized. Check REDIS_URL and lib/cache/redis_cache.js.'
    )
  }

  const client = redisClient as {
    get(key: string): Promise<string | null>
    set(
      key: string,
      value: string,
      mode?: 'EX',
      seconds?: number,
      nx?: 'NX'
    ): Promise<'OK' | null>
    del(key: string): Promise<number>
    scan(
      cursor: string,
      ...args: Array<string | number>
    ): Promise<[string, string[]]>
  }

  return {
    async get(key: string): Promise<unknown> {
      const value = await client.get(key)
      if (value == null) return null
      try {
        const parsed: unknown = JSON.parse(value)
        return parsed
      } catch {
        // 兼容旧数据:原样返回 string
        return value
      }
    },

    async list(options?: { prefix?: string }) {
      const prefix = options?.prefix ?? ''
      // SCAN 替代 KEYS,避免阻塞 Redis。
      // ioredes 5.x scan 签名:scan(cursor, ...args),args 是字符串/数字。
      // 返回 [nextCursor, string[]]。
      const blobs: Array<{ key: string }> = []
      let cursor = '0'
      do {
        const result = await client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          '200'
        )
        const next = result[0]
        const keys = result[1] || []
        cursor = next
        for (const k of keys) blobs.push({ key: k })
      } while (cursor !== '0')
      return { blobs }
    },

    async setJSON(
      key: string,
      value: unknown,
      options?: { onlyIfNew?: boolean }
    ): Promise<void> {
      const json = JSON.stringify(value)
      if (options?.onlyIfNew) {
        // SET key value NX — 仅当 key 不存在时设置,失败返 null
        // 不带 EX 过期时间(knowledge-graph 持久化数据,不需要 TTL)
        // 用 client.call 绕过 ioredis 5.x TS 类型(NX 不在公开 overload)
        const result = (await (
          client as unknown as {
            call(...args: Array<string | number>): Promise<unknown>
          }
        ).call('SET', key, json, 'NX')) as 'OK' | null
        if (result === null) {
          const error = new Error(
            `PreconditionFailed: key '${key}' already exists`
          )
          ;(error as { code?: string }).code = 'PRECONDITION_FAILED'
          throw error
        }
        return
      }
      await client.set(key, json)
    },

    async delete(key: string): Promise<void> {
      await client.del(key)
    }
  }
}
