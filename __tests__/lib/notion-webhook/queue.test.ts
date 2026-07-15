/** @jest-environment node */

declare const jest: any
declare const describe: any
declare const beforeEach: any
declare const test: any
declare const expect: any

const zsets = new Map<string, Map<string, number>>()
const strings = new Map<string, string>()

jest.mock('@/lib/cache/redis_cache', () => ({
  redisClient: {
    zadd: jest.fn(),
    zrangebyscore: jest.fn(),
    zcard: jest.fn(),
    eval: jest.fn(),
    set: jest.fn()
  }
}))

import { redisClient } from '@/lib/cache/redis_cache'
import {
  ackDirtyPage,
  enqueueDirtyPage,
  getDirtyQueueDepth,
  listQuietDirtyPages,
  withDirtyConsumerLock
} from '@/lib/notion-webhook/queue'

const redis = redisClient as any
const DIRTY_KEY = 'notion:refresh:dirty'
const LOCK_KEY = 'notion:refresh:consumer-lock'
const pageA = '0123456789abcdef0123456789abcdef'
const pageB = 'abcdef0123456789abcdef0123456789'

describe('Notion webhook dirty queue', () => {
  beforeEach(() => {
    zsets.clear()
    strings.clear()
    jest.clearAllMocks()
    redis.zcard.mockImplementation(async (key: string) => {
      return (zsets.get(key) ?? new Map()).size
    })

    redis.zadd.mockImplementation(
      async (key: string, mode: string, score: number, member: string) => {
        const zset = zsets.get(key) ?? new Map<string, number>()
        const current = zset.get(member)
        if (mode !== 'GT') throw new Error('test mock requires GT')
        if (current === undefined || score > current) zset.set(member, score)
        zsets.set(key, zset)
        return current === undefined ? 1 : 0
      }
    )
    redis.zrangebyscore.mockImplementation(
      async (
        key: string,
        _min: string,
        max: number,
        withScores: string,
        limit: string,
        offset: number,
        count: number
      ) => {
        if (withScores !== 'WITHSCORES' || limit !== 'LIMIT' || offset !== 0) {
          throw new Error('unexpected range arguments')
        }
        const entries = zsets.get(key) ?? new Map<string, number>()
        return Array.from(entries.entries())
          .filter(([, score]) => score <= max)
          .sort(
            ([leftId, leftScore], [rightId, rightScore]) =>
              leftScore - rightScore || leftId.localeCompare(rightId)
          )
          .slice(0, count)
          .flatMap(([id, score]) => [id, String(score)])
      }
    )
    redis.set.mockImplementation(
      async (
        key: string,
        token: string,
        nx: string,
        ex: string,
        ttl: number
      ) => {
        if (
          nx !== 'NX' ||
          ex !== 'EX' ||
          !Number.isSafeInteger(ttl) ||
          ttl < 1
        ) {
          throw new Error('unexpected lock arguments')
        }
        if (strings.has(key)) return null
        strings.set(key, token)
        return 'OK'
      }
    )
    redis.eval.mockImplementation(
      async (
        _script: string,
        keyCount: number,
        key: string,
        ...args: string[]
      ) => {
        if (keyCount !== 1) throw new Error('unexpected key count')
        if (key === DIRTY_KEY) {
          const [member, expectedScore] = args
          const zset = zsets.get(key) ?? new Map<string, number>()
          if (zset.get(member!) === Number(expectedScore)) {
            zset.delete(member!)
            return 1
          }
          return 0
        }

        const [ownerToken, ttl] = args
        if (strings.get(key) === ownerToken) {
          if (ttl !== undefined) return 1
          strings.delete(key)
          return 1
        }
        return 0
      }
    )
  })

  test('normalizes page IDs and retains only the newest event timestamp', async () => {
    const hyphenated = '01234567-89AB-CDEF-0123-456789ABCDEF'

    await enqueueDirtyPage({ pageId: hyphenated, eventTimestampMs: 1_000 })
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 2_000 })
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 1_500 })

    expect(redis.zadd).toHaveBeenNthCalledWith(1, DIRTY_KEY, 'GT', 1_000, pageA)
    expect(zsets.get(DIRTY_KEY)?.get(pageA)).toBe(2_000)
  })

  test('lists quiet pages at the exact boundary in stable score order', async () => {
    zsets.set(
      DIRTY_KEY,
      new Map([
        [pageB, 39_000],
        [pageA, 39_000],
        ['11111111111111111111111111111111', 40_000],
        ['22222222222222222222222222222222', 40_001]
      ])
    )

    await expect(listQuietDirtyPages(100_000)).resolves.toEqual([
      { pageId: pageA, score: 39_000 },
      { pageId: pageB, score: 39_000 },
      { pageId: '11111111111111111111111111111111', score: 40_000 }
    ])
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      DIRTY_KEY,
      '-inf',
      40_000,
      'WITHSCORES',
      'LIMIT',
      0,
      50
    )
  })

  test('caps a requested quiet-page limit at the consumer batch size', async () => {
    await listQuietDirtyPages(60_000, 500)
    expect(redis.zrangebyscore).toHaveBeenCalledWith(
      DIRTY_KEY,
      '-inf',
      0,
      'WITHSCORES',
      'LIMIT',
      0,
      50
    )

    await listQuietDirtyPages(60_000, 2)
    expect(redis.zrangebyscore).toHaveBeenLastCalledWith(
      DIRTY_KEY,
      '-inf',
      0,
      'WITHSCORES',
      'LIMIT',
      0,
      2
    )
  })

  test('rejects unsafe inputs and malformed Redis score pairs', async () => {
    await expect(
      enqueueDirtyPage({ pageId: 'invalid', eventTimestampMs: 1 })
    ).rejects.toThrow('Invalid Notion page ID')
    await expect(
      enqueueDirtyPage({ pageId: pageA, eventTimestampMs: -1 })
    ).rejects.toThrow('timestamp')
    await expect(
      listQuietDirtyPages(Number.MAX_SAFE_INTEGER + 1)
    ).rejects.toThrow('timestamp')
    await expect(listQuietDirtyPages(100_000, -1)).rejects.toThrow('limit')
    await expect(ackDirtyPage(pageA, 1.5)).rejects.toThrow('score')

    redis.zrangebyscore.mockResolvedValueOnce([pageA, 'not-a-score'])
    await expect(listQuietDirtyPages(100_000)).rejects.toThrow(
      'Invalid dirty queue result'
    )
  })

  test('acknowledges only the exact processed score and retains newer events', async () => {
    zsets.set(DIRTY_KEY, new Map([[pageA, 1_000]]))
    await expect(ackDirtyPage(pageA, 1_000)).resolves.toBe(true)
    expect(zsets.get(DIRTY_KEY)?.has(pageA)).toBe(false)

    zsets.set(DIRTY_KEY, new Map([[pageA, 2_000]]))
    await expect(ackDirtyPage(pageA, 1_000)).resolves.toBe(false)
    expect(zsets.get(DIRTY_KEY)?.get(pageA)).toBe(2_000)
    expect(redis.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("redis.call('ZSCORE'"),
      1,
      DIRTY_KEY,
      pageA,
      '1000'
    )
  })

  test('reports the strict Redis dirty queue depth', async () => {
    redis.zcard.mockResolvedValueOnce(3)
    await expect(getDirtyQueueDepth()).resolves.toBe(3)
    expect(redis.zcard).toHaveBeenCalledWith(DIRTY_KEY)
  })

  test('returns busy without running the consumer when the lock is held', async () => {
    strings.set(LOCK_KEY, 'other-owner')
    const task = jest.fn(async () => 'not-run')

    await expect(withDirtyConsumerLock(task)).resolves.toEqual({
      status: 'busy'
    })
    expect(task).not.toHaveBeenCalled()
    expect(redis.set).toHaveBeenCalledWith(
      LOCK_KEY,
      expect.any(String),
      'NX',
      'EX',
      240
    )
    expect(redis.eval).not.toHaveBeenCalled()
  })

  test('returns the task result and rejects if ownership changed before release', async () => {
    await expect(
      withDirtyConsumerLock(async () => ({ consumed: 2 }))
    ).resolves.toEqual({ status: 'acquired', result: { consumed: 2 } })
    expect(strings.has(LOCK_KEY)).toBe(false)

    redis.eval.mockImplementationOnce(
      async (_script: string, _keyCount: number, key: string) => {
        strings.set(key, 'replacement-owner')
        return 0
      }
    )
    await expect(withDirtyConsumerLock(async () => 'done')).rejects.toThrow(
      'consumer lock lease'
    )
    expect(strings.get(LOCK_KEY)).toBe('replacement-owner')
  })

  test('renews only its own lock while work remains active', async () => {
    jest.useFakeTimers()
    let finish!: () => void
    const pending = new Promise<void>(resolve => {
      finish = resolve
    })

    const result = withDirtyConsumerLock(
      async lease => {
        await pending
        lease.assertOwned()
        return 'done'
      },
      { lockSeconds: 2, renewEveryMs: 500 }
    )
    await jest.advanceTimersByTimeAsync(500)

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('EXPIRE'"),
      1,
      LOCK_KEY,
      expect.any(String),
      '2'
    )
    finish()
    await expect(result).resolves.toEqual({
      status: 'acquired',
      result: 'done'
    })
    jest.useRealTimers()
  })

  test('fails safely after lease renewal loses ownership', async () => {
    jest.useFakeTimers()
    let continueWork!: () => void
    const checkpoint = new Promise<void>(resolve => {
      continueWork = resolve
    })
    const result = withDirtyConsumerLock(
      async lease => {
        await checkpoint
        lease.assertOwned()
        return 'must-not-complete'
      },
      { lockSeconds: 2, renewEveryMs: 500 }
    )
    const assertion = expect(result).rejects.toThrow('consumer lock lease')
    strings.set(LOCK_KEY, 'replacement-owner')
    await jest.advanceTimersByTimeAsync(500)
    continueWork()

    await assertion
    expect(strings.get(LOCK_KEY)).toBe('replacement-owner')
    jest.useRealTimers()
  })

  test('propagates task errors and does not let release errors mask them', async () => {
    const taskError = new Error('consumer failed')
    const releaseError = new Error('release failed')
    redis.eval.mockRejectedValueOnce(releaseError)

    await expect(
      withDirtyConsumerLock(async () => {
        throw taskError
      })
    ).rejects.toBe(taskError)
    expect((taskError as Error & { releaseError?: unknown }).releaseError).toBe(
      releaseError
    )
  })

  test('rejects when release fails after a successful task', async () => {
    redis.eval.mockRejectedValueOnce(new Error('release failed'))

    await expect(withDirtyConsumerLock(async () => 'done')).rejects.toThrow(
      'release failed'
    )
  })

  test('throws when strict Redis methods are unavailable', async () => {
    const original = redis.zadd
    redis.zadd = undefined
    await expect(
      enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 1_000 })
    ).rejects.toThrow('initialized ioredis client')
    redis.zadd = original
  })
})
