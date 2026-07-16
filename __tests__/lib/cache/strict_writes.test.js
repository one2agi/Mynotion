jest.mock('@/blog.config', () => ({
  REDIS_URL: 'redis://test',
  isProd: true,
  ENABLE_CACHE: true
}))
jest.mock('@/lib/cache/redis_cache', () => {
  const setCacheStrict = jest.fn()
  return {
    __esModule: true,
    default: { setCacheStrict },
    setCacheStrict,
    __mockSetCacheStrict: setCacheStrict
  }
})
jest.mock('@/lib/cache/redis_fallback', () => ({
  saveFallback: jest.fn(),
  loadFallback: jest.fn()
}))

import { setDataToCacheStrict } from '@/lib/cache/cache_manager'
import * as redisCacheMock from '@/lib/cache/redis_cache'

describe('strict short-cache persistence', () => {
  test('propagates the underlying Redis write failure', async () => {
    redisCacheMock.__mockSetCacheStrict.mockRejectedValueOnce(
      new Error('strict Redis failure')
    )

    await expect(
      setDataToCacheStrict('site_database', { allPages: [{ id: 'post' }] })
    ).rejects.toThrow('strict Redis failure')
  })

  test('does not fall back to the tolerant Redis writer', async () => {
    const strictWriter = redisCacheMock.default.setCacheStrict
    redisCacheMock.default.setCacheStrict = undefined
    redisCacheMock.default.setCache = jest.fn().mockResolvedValue(undefined)

    await expect(
      setDataToCacheStrict('site_database', { allPages: [{ id: 'post' }] })
    ).rejects.toThrow('No strict cache writer')

    expect(redisCacheMock.default.setCache).not.toHaveBeenCalled()
    redisCacheMock.default.setCacheStrict = strictWriter
  })
})
