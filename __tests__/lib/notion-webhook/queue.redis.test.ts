/** @jest-environment node */

import { redisClient } from '@/lib/cache/redis_cache'
import {
  ackDirtyPage,
  enqueueDirtyPage,
  listQuietDirtyPages,
  withDirtyConsumerLock
} from '@/lib/notion-webhook/queue'

declare const describe: any
declare const beforeEach: any
declare const afterAll: any
declare const test: any
declare const expect: any

const redis = redisClient as any
const runIntegration =
  process.env.RUN_NOTION_QUEUE_REDIS_INTEGRATION === '1'
    ? describe
    : describe.skip

const DIRTY_KEY = 'notion:refresh:dirty'
const LOCK_KEY = 'notion:refresh:consumer-lock'
const pageA = '0123456789abcdef0123456789abcdef'
const pageB = 'abcdef0123456789abcdef0123456789'

runIntegration('Notion webhook queue on Redis 7', () => {
  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  test('ZADD GT retains newer events and quiet reads use Redis score order', async () => {
    await enqueueDirtyPage({ pageId: pageB, eventTimestampMs: 40_000 })
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 39_000 })
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 38_000 })
    await enqueueDirtyPage({ pageId: pageB, eventTimestampMs: 41_000 })

    await expect(listQuietDirtyPages(101_000)).resolves.toEqual([
      { pageId: pageA, score: 39_000 },
      { pageId: pageB, score: 41_000 }
    ])
    await expect(redis.zscore(DIRTY_KEY, pageA)).resolves.toBe('39000')
  })

  test('compare-delete acknowledgement preserves a newer event', async () => {
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 1_000 })
    const [selected] = await listQuietDirtyPages(61_000)
    if (selected === undefined) throw new Error('expected one selected page')
    await enqueueDirtyPage({ pageId: pageA, eventTimestampMs: 2_000 })

    await expect(ackDirtyPage(selected.pageId, selected.score)).resolves.toBe(
      false
    )
    await expect(redis.zscore(DIRTY_KEY, pageA)).resolves.toBe('2000')
    await expect(ackDirtyPage(pageA, 2_000)).resolves.toBe(true)
    await expect(redis.zscore(DIRTY_KEY, pageA)).resolves.toBeNull()
  })

  test('consumer locking is exclusive and rejects after ownership replacement', async () => {
    await redis.set(LOCK_KEY, 'existing-owner', 'EX', 240)
    await expect(withDirtyConsumerLock(async () => 'not-run')).resolves.toEqual(
      {
        status: 'busy'
      }
    )

    await redis.del(LOCK_KEY)
    await expect(
      withDirtyConsumerLock(async () => {
        await redis.set(LOCK_KEY, 'replacement-owner', 'EX', 240)
        return 'processed'
      })
    ).rejects.toThrow('consumer lock lease')
    await expect(redis.get(LOCK_KEY)).resolves.toBe('replacement-owner')

    await redis.del(LOCK_KEY)
    await expect(
      withDirtyConsumerLock(async () => 'released')
    ).resolves.toEqual({ status: 'acquired', result: 'released' })
    await expect(redis.get(LOCK_KEY)).resolves.toBeNull()
  })

  test('renews the owner lease on Redis 7 and cannot renew a replacement owner', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const held = withDirtyConsumerLock(
      async lease => {
        await pending
        lease.assertOwned()
        return 'renewed'
      },
      { lockSeconds: 2, renewEveryMs: 500 }
    )

    await new Promise(resolve => setTimeout(resolve, 700))
    await expect(redis.pttl(LOCK_KEY)).resolves.toBeGreaterThan(1_500)

    await redis.set(LOCK_KEY, 'replacement-owner', 'EX', 20)
    await new Promise(resolve => setTimeout(resolve, 700))
    release()
    await expect(held).rejects.toThrow('consumer lock lease')
    await expect(redis.get(LOCK_KEY)).resolves.toBe('replacement-owner')
  })
})
