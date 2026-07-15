const mockHashes = new Map<string, Map<string, string>>()
const mockStrings = new Map<string, string>()

declare const jest: any
declare const describe: any
declare const beforeEach: any
declare const test: any
declare const expect: any

jest.mock('@/lib/cache/redis_cache', () => ({
  redisClient: {
    hget: jest.fn(),
    hset: jest.fn(),
    hgetall: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    eval: jest.fn()
  }
}))

import { redisClient } from '@/lib/cache/redis_cache'

import {
  bootstrapRouteSnapshots,
  getRouteSnapshot,
  getStoredRedirect,
  isExplicitlyPrivate,
  putRouteSnapshot,
  saveFlattenedRedirect,
  type RouteSnapshot
} from '@/lib/notion-webhook/routeState'

const ROUTE_HASH = 'notion:refresh:routes'
const REDIRECT_HASH = 'notion:refresh:redirects'

const mockRedis = redisClient as any

const pageA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const pageB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const snapshot = (overrides: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  pageId: pageA,
  locale: 'zh-CN',
  href: '/article/old-route',
  slug: 'old-route',
  public: true,
  type: 'Post',
  status: 'Published',
  title: 'Old title',
  summary: 'Old summary',
  categories: ['产品'],
  tags: ['Notion'],
  lastEditedDate: 100,
  processedEventAt: 90,
  ...overrides
})

describe('persistent Notion route state', () => {
  beforeEach(() => {
    mockHashes.clear()
    mockStrings.clear()
    jest.clearAllMocks()
    mockRedis.hget.mockImplementation(async (key: string, field: string) => {
      return mockHashes.get(key)?.get(field) ?? null
    })
    mockRedis.hset.mockImplementation(
      async (key: string, ...entries: string[]) => {
        const hash = mockHashes.get(key) ?? new Map<string, string>()
        for (let index = 0; index < entries.length; index += 2) {
          hash.set(entries[index]!, entries[index + 1]!)
        }
        mockHashes.set(key, hash)
        return entries.length / 2
      }
    )
    mockRedis.hgetall.mockImplementation(async (key: string) => {
      return Object.fromEntries(mockHashes.get(key) ?? [])
    })
    mockRedis.get.mockImplementation(async (key: string) => {
      return mockStrings.get(key) ?? null
    })
    mockRedis.set.mockImplementation(async (key: string, value: string) => {
      mockStrings.set(key, value)
      return 'OK' as const
    })
    mockRedis.eval.mockImplementation(
      async (_script: string, keyCount: number, ...args: string[]) => {
        if (keyCount === 2) {
          const [markerKey, routeHash, bootstrappedAt, ...entries] = args
          const existingMarker = mockStrings.get(markerKey!)
          if (existingMarker !== undefined) return [0, existingMarker]

          const hash = mockHashes.get(routeHash!) ?? new Map<string, string>()
          for (let index = 0; index < entries.length; index += 2) {
            if (!hash.has(entries[index]!)) {
              hash.set(entries[index]!, entries[index + 1]!)
            }
          }
          mockHashes.set(routeHash!, hash)
          mockStrings.set(markerKey!, bootstrappedAt!)
          return [1, bootstrappedAt]
        }

        const [redirectHash, prefix, source, target] = args
        const hash = mockHashes.get(redirectHash!) ?? new Map<string, string>()
        const redirects = new Map<string, string>()
        hash.forEach((value, field) => {
          if (field.startsWith(prefix!)) {
            redirects.set(field.slice(prefix!.length), value)
          }
        })
        redirects.set(source!, target!)

        const resolve = (start: string) => {
          const visited = new Set<string>()
          let current = start
          while (redirects.has(current)) {
            if (visited.has(current)) throw new Error('Redirect cycle detected')
            visited.add(current)
            current = redirects.get(current)!
          }
          return current
        }
        redirects.forEach((_value, redirectSource) => {
          hash.set(`${prefix}${redirectSource}`, resolve(redirectSource))
        })
        mockHashes.set(redirectHash!, hash)
        return resolve(source!)
      }
    )
  })

  test('bootstraps only from a source-confirmed non-empty directory', async () => {
    await expect(
      bootstrapRouteSnapshots({
        snapshots: [snapshot()],
        sourceConfirmed: false,
        bootstrappedAt: 1_000
      })
    ).rejects.toThrow('source-confirmed')

    await expect(
      bootstrapRouteSnapshots({
        snapshots: [],
        sourceConfirmed: true,
        bootstrappedAt: 1_000
      })
    ).rejects.toThrow('non-empty')

    await expect(
      bootstrapRouteSnapshots({
        snapshots: [snapshot(), snapshot({ pageId: pageB })],
        sourceConfirmed: true,
        bootstrappedAt: 1_000
      })
    ).resolves.toBe(true)

    expect(mockHashes.get(ROUTE_HASH)?.size).toBe(2)
    expect(mockStrings.get('notion:refresh:bootstrapped-at')).toBe('1000')
    expect(mockRedis.eval).toHaveBeenCalledTimes(1)
    expect(mockRedis.get).not.toHaveBeenCalled()
    expect(mockRedis.hset).not.toHaveBeenCalled()
    expect(mockRedis.set).not.toHaveBeenCalled()
  })

  test('fails closed when the bootstrap marker is corrupt', async () => {
    mockStrings.set('notion:refresh:bootstrapped-at', 'not-a-timestamp')

    await expect(
      bootstrapRouteSnapshots({
        snapshots: [snapshot()],
        sourceConfirmed: true,
        bootstrappedAt: 1_000
      })
    ).rejects.toThrow('Invalid route bootstrap marker')
  })

  test('normal consumption writes only the dirty page snapshot', async () => {
    await putRouteSnapshot(snapshot({ pageId: pageB, title: 'Dirty page' }))

    expect(mockRedis.hset).toHaveBeenCalledTimes(1)
    expect(mockRedis.hset).toHaveBeenCalledWith(
      ROUTE_HASH,
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      expect.any(String)
    )
    expect(mockHashes.get(ROUTE_HASH)?.size).toBe(1)
  })

  test('persists an unpublish tombstone before the event is acknowledged', async () => {
    await putRouteSnapshot(snapshot())
    await putRouteSnapshot(
      snapshot({
        public: false,
        status: 'Draft',
        processedEventAt: 90,
        pendingEventAt: 120
      })
    )

    await expect(getRouteSnapshot(pageA)).resolves.toEqual(
      expect.objectContaining({
        public: false,
        href: '/article/old-route',
        processedEventAt: 90,
        pendingEventAt: 120
      })
    )
  })

  test('flattens an existing redirect chain when a new hop is saved', async () => {
    await saveFlattenedRedirect(undefined, '/a', '/b')
    await saveFlattenedRedirect(undefined, '/b', '/c')

    await expect(getStoredRedirect(undefined, '/a')).resolves.toBe('/c')
    expect(mockHashes.get(REDIRECT_HASH)?.get('default:/a')).toBe('/c')
    expect(mockHashes.get(REDIRECT_HASH)?.get('default:/b')).toBe('/c')
    expect(mockRedis.eval).toHaveBeenCalledTimes(2)
    expect(mockRedis.hgetall).not.toHaveBeenCalled()
    expect(mockRedis.hset).not.toHaveBeenCalled()
  })

  test('does not treat a missing snapshot as explicitly private', async () => {
    await expect(isExplicitlyPrivate(pageA)).resolves.toBe(false)
  })

  test('throws when persisted route state cannot be decoded or validated', async () => {
    mockHashes.set(
      ROUTE_HASH,
      new Map([
        ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{not valid json'],
        ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', JSON.stringify({ public: false })]
      ])
    )

    await expect(getRouteSnapshot(pageA)).rejects.toThrow(
      'Invalid route snapshot'
    )
    await expect(isExplicitlyPrivate(pageB)).rejects.toThrow(
      'Invalid route snapshot'
    )
  })

  test('propagates Redis operation errors', async () => {
    mockRedis.hget.mockRejectedValueOnce(new Error('redis unavailable'))

    await expect(getRouteSnapshot(pageA)).rejects.toThrow('redis unavailable')
  })
})
