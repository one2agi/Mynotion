/** @jest-environment node */

import { redisClient } from '@/lib/cache/redis_cache'
import {
  bootstrapRouteSnapshots,
  getRouteSnapshot,
  getStoredRedirect,
  putRouteSnapshot,
  saveFlattenedRedirect,
  type RouteSnapshot
} from '@/lib/notion-webhook/routeState'

declare const describe: any
declare const beforeEach: any
declare const afterAll: any
declare const test: any
declare const expect: any

const redis = redisClient as any
const runIntegration =
  process.env.RUN_ROUTE_STATE_REDIS_INTEGRATION === '1'
    ? describe
    : describe.skip

const pageA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const pageB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const snapshot = (
  pageId: string,
  overrides: Partial<RouteSnapshot> = {}
): RouteSnapshot => ({
  pageId,
  href: `/article/${pageId.slice(0, 4)}`,
  slug: pageId.slice(0, 4),
  public: true,
  type: 'Post',
  status: 'Published',
  title: 'Directory title',
  summary: 'Summary',
  categories: [],
  tags: [],
  lastEditedDate: 100,
  processedEventAt: 90,
  ...overrides
})

runIntegration('route-state Lua scripts on Redis 7', () => {
  beforeEach(async () => {
    await redis.flushdb()
  })

  afterAll(async () => {
    await redis.quit()
  })

  test('atomic bootstrap preserves a preexisting dirty snapshot', async () => {
    await putRouteSnapshot(snapshot(pageA, { title: 'Dirty title' }))

    await expect(
      bootstrapRouteSnapshots({
        snapshots: [snapshot(pageA), snapshot(pageB)],
        sourceConfirmed: true,
        bootstrappedAt: 1_000
      })
    ).resolves.toBe(true)

    await expect(getRouteSnapshot(pageA)).resolves.toEqual(
      expect.objectContaining({ title: 'Dirty title' })
    )
    await expect(getRouteSnapshot(pageB)).resolves.toEqual(
      expect.objectContaining({ title: 'Directory title' })
    )
    await expect(redis.get('notion:refresh:bootstrapped-at')).resolves.toBe(
      '1000'
    )
  })

  test('atomically flattens redirect chains and rejects cycles', async () => {
    await saveFlattenedRedirect(undefined, '/a', '/b')
    await saveFlattenedRedirect(undefined, '/b', '/c')

    await expect(getStoredRedirect(undefined, '/a')).resolves.toBe('/c')
    await expect(getStoredRedirect(undefined, '/b')).resolves.toBe('/c')
    await expect(saveFlattenedRedirect(undefined, '/c', '/a')).rejects.toThrow(
      'Redirect cycle detected'
    )
    await expect(getStoredRedirect(undefined, '/a')).resolves.toBe('/c')
  })

  test('fails closed on malformed persisted route and redirect state', async () => {
    await redis.hset(
      'notion:refresh:routes',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '{broken-json'
    )
    await expect(getRouteSnapshot(pageA)).rejects.toThrow(
      'Invalid route snapshot'
    )

    await redis.hset(
      'notion:refresh:redirects',
      'default:/legacy',
      'not-an-internal-path'
    )
    await expect(
      saveFlattenedRedirect(undefined, '/new', '/target')
    ).rejects.toThrow('Invalid stored redirect path')
  })
})
