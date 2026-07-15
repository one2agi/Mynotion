jest.mock('@/blog.config', () => ({
  REDIS_URL: 'redis://test',
  NEXT_REVALIDATE_SECOND: 300
}))
jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((_key, fallback) => fallback)
}))
jest.mock('ioredis', () => {
  const set = jest.fn()
  const Redis = jest.fn(() => ({ set }))
  Redis.__mockSet = set
  return Redis
})

import Redis from 'ioredis'
import { setCacheStrict } from '@/lib/cache/redis_cache'

const redisSet = Redis.__mockSet

describe('redis_cache strict persistence', () => {
  beforeEach(() => {
    redisSet.mockReset()
  })

  test('accepts an acknowledged Redis SET', async () => {
    redisSet.mockResolvedValueOnce('OK')

    await expect(
      setCacheStrict('site_db', { value: 1 })
    ).resolves.toBeUndefined()
  })

  test('rejects a non-acknowledged Redis SET', async () => {
    redisSet.mockResolvedValueOnce(null)

    await expect(setCacheStrict('site_db', { value: 1 })).rejects.toThrow(
      'was not acknowledged'
    )
  })

  test('propagates Redis SET rejection', async () => {
    redisSet.mockRejectedValueOnce(new Error('Redis unavailable'))

    await expect(setCacheStrict('site_db', { value: 1 })).rejects.toThrow(
      'Redis unavailable'
    )
  })
})
