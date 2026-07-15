// __tests__/lib/cache/redis_fallback.test.js
//
// 验证 redis_fallback.js 的行为:
// 1. saveFallback 写 Redis 长 TTL(7 天)
// 2. loadFallback 读回数据
// 3. 无 REDIS_URL 时是 no-op(不抛错)
//
// 关联功能:作为 getOrSetDataWithCache 的"跨容器重启兜底"层,
// 失败时优先查 Redis fallback(7 天)再查 stale(本地内存/文件)

jest.mock('@/blog.config', () => ({
  REDIS_URL: 'redis://test',
  isProd: true
}))

jest.mock('@/lib/cache/redis_cache', () => {
  const set = jest.fn()
  const get = jest.fn()
  return {
    redisClient: { set, get },
    __mockSet: set,
    __mockGet: get
  }
})

import { saveFallback, loadFallback } from '@/lib/cache/redis_fallback'
import * as redisCacheMock from '@/lib/cache/redis_cache'

describe('redis_fallback', () => {
  beforeEach(() => {
    redisCacheMock.__mockSet.mockReset()
    redisCacheMock.__mockGet.mockReset()
  })

  describe('saveFallback', () => {
    test('调用 redis.set 并使用 7 天 TTL', async () => {
      redisCacheMock.__mockSet.mockResolvedValue('OK')
      const data = { allPages: [{ id: 'p1' }] }

      await saveFallback('test:key', data)

      expect(redisCacheMock.__mockSet).toHaveBeenCalledTimes(1)
      const [key, value, mode, ttl] = redisCacheMock.__mockSet.mock.calls[0]
      expect(key).toBe('fallback:test:key')
      expect(JSON.parse(value)).toEqual(data)
      expect(mode).toBe('EX')
      // 7 天 = 604800 秒
      expect(ttl).toBe(7 * 24 * 60 * 60)
    })

    test('Redis set 抛错时不传播(降级为 no-op)', async () => {
      redisCacheMock.__mockSet.mockRejectedValue(new Error('redis connection lost'))

      // 不应 throw
      await expect(saveFallback('test:key', { foo: 1 })).resolves.toBeUndefined()
    })
  })

  describe('loadFallback', () => {
    test('调用 redis.get 并 JSON.parse', async () => {
      const data = { allPages: [{ id: 'p1' }] }
      redisCacheMock.__mockGet.mockResolvedValue(JSON.stringify(data))

      const result = await loadFallback('test:key')

      expect(redisCacheMock.__mockGet).toHaveBeenCalledWith('fallback:test:key')
      expect(result).toEqual(data)
    })

    test('无数据时返 null', async () => {
      redisCacheMock.__mockGet.mockResolvedValue(null)

      const result = await loadFallback('test:key')
      expect(result).toBeNull()
    })

    test('Redis get 抛错时返 null(降级)', async () => {
      redisCacheMock.__mockGet.mockRejectedValue(new Error('redis down'))

      const result = await loadFallback('test:key')
      expect(result).toBeNull()
    })
  })
})

describe('redis_fallback - 无 REDIS_URL 时是 no-op', () => {
  let noOpSave, noOpLoad

  beforeAll(() => {
    jest.resetModules()
    jest.doMock('@/blog.config', () => ({
      REDIS_URL: '',
      isProd: true
    }))
    jest.doMock('@/lib/cache/redis_cache', () => ({
      redisClient: {}
    }))
    noOpSave = require('@/lib/cache/redis_fallback').saveFallback
    noOpLoad = require('@/lib/cache/redis_fallback').loadFallback
  })

  afterAll(() => {
    jest.resetModules()
  })

  test('saveFallback 不抛错', async () => {
    await expect(noOpSave('k', { foo: 1 })).resolves.toBeUndefined()
  })

  test('loadFallback 返 null', async () => {
    const result = await noOpLoad('k')
    expect(result).toBeNull()
  })
})
