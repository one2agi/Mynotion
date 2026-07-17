/** @jest-environment node */

import type { DirtyConsumerLease } from '@/lib/notion-webhook/queue'
import type {
  RoutePageMetadata,
  RoutePlanInput
} from '@/lib/notion-webhook/routePlan'
import type { RouteSnapshot } from '@/lib/notion-webhook/routeState'

declare const jest: any
declare const describe: any
declare const beforeEach: any
declare const test: any
declare const expect: any

jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchFreshConfiguredGlobalData: jest.fn()
}))
jest.mock('@/lib/cache/cache_manager', () => ({
  getDataFromCache: jest.fn()
}))
jest.mock('@/lib/notion-webhook/queue', () => ({
  ackDirtyPage: jest.fn(),
  getDirtyQueueDepth: jest.fn(),
  listQuietDirtyPages: jest.fn(),
  withDirtyConsumerLock: jest.fn()
}))
jest.mock('@/lib/notion-webhook/routeState', () => ({
  bootstrapRouteSnapshots: jest.fn(),
  getRouteSnapshot: jest.fn(),
  putRouteSnapshot: jest.fn(),
  saveFlattenedRedirect: jest.fn()
}))
jest.mock('@/lib/notion-webhook/routePlan', () => ({
  planRouteRevalidation: jest.fn()
}))
jest.mock('@/lib/knowledge-graph/serverRefresh', () => ({
  createServerKnowledgeGraphStore: jest.fn(),
  refreshServerKnowledgeGraph: jest.fn()
}))

import BLOG from '@/blog.config'
import { getDataFromCache } from '@/lib/cache/cache_manager'
import { fetchFreshConfiguredGlobalData } from '@/lib/db/SiteDataApi'
import {
  createServerKnowledgeGraphStore,
  refreshServerKnowledgeGraph
} from '@/lib/knowledge-graph/serverRefresh'
import {
  ackDirtyPage,
  getDirtyQueueDepth,
  listQuietDirtyPages,
  withDirtyConsumerLock
} from '@/lib/notion-webhook/queue'
import { planRouteRevalidation } from '@/lib/notion-webhook/routePlan'
import {
  bootstrapRouteSnapshots,
  getRouteSnapshot,
  putRouteSnapshot,
  saveFlattenedRedirect
} from '@/lib/notion-webhook/routeState'
import {
  bootstrapRouteState,
  consumeDirtyPages
} from '@/lib/notion-webhook/consumer'

const pageA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const pageB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const metadata = (
  pageId: string,
  overrides: Partial<RoutePageMetadata> = {}
): RoutePageMetadata => ({
  pageId,
  locale: 'zh-CN',
  href: `/article/${pageId[0]}`,
  slug: `article/${pageId[0]}`,
  public: true,
  type: 'Post',
  status: 'Published',
  title: `Title ${pageId[0]}`,
  summary: 'Summary',
  categories: [],
  tags: [],
  lastEditedDate: 100,
  ...overrides
})

const snapshot = (
  pageId: string,
  overrides: Partial<RouteSnapshot> = {}
): RouteSnapshot => ({
  ...metadata(pageId),
  processedEventAt: 50,
  ...overrides
})

const sourcePage = (
  pageId: string,
  overrides: Record<string, unknown> = {}
) => ({
  id: pageId,
  href: `/article/${pageId[0]}`,
  slug: `article/${pageId[0]}`,
  type: 'Post',
  status: 'Published',
  title: `Title ${pageId[0]}`,
  summary: 'Summary',
  category: [],
  tags: [],
  lastEditedDate: 100,
  ...overrides
})

const freshDirectory = (pages = [sourcePage(pageA), sourcePage(pageB)]) => [
  {
    locale: 'zh-CN',
    pageId: 'database',
    data: {
      allPages: pages,
      NOTION_CONFIG: { POSTS_PER_PAGE: 12 }
    }
  }
]

const lease = { assertOwned: jest.fn() }

describe('Notion webhook dirty consumer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest
      .mocked(withDirtyConsumerLock)
      .mockImplementation(
        async (task: (lease: DirtyConsumerLease) => Promise<unknown>) => ({
          status: 'acquired',
          result: await task(lease)
        })
      )
    jest
      .mocked(listQuietDirtyPages)
      .mockResolvedValue([{ pageId: pageA, score: 100 }])
    jest.mocked(getDirtyQueueDepth).mockResolvedValue(0)
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(freshDirectory())
    jest
      .mocked(getRouteSnapshot)
      .mockImplementation(async (pageId: string) =>
        pageId === pageA ? snapshot(pageA) : snapshot(pageB)
      )
    jest
      .mocked(planRouteRevalidation)
      .mockImplementation((input: RoutePlanInput) => ({
        paths: [`/article/${input.oldSnapshot?.pageId[0]}`],
        nextSnapshot: {
          ...(input.newPage || input.oldSnapshot),
          processedEventAt: input.selectedQueueScore
        },
        redirect: null,
        refreshGraph: false,
        becamePrivate: false
      }))
    jest.mocked(ackDirtyPage).mockResolvedValue(true)
    jest.mocked(putRouteSnapshot).mockResolvedValue(undefined)
    jest.mocked(getDataFromCache).mockResolvedValue({ block: {} })
    jest.mocked(saveFlattenedRedirect).mockResolvedValue('/target')
    jest.mocked(refreshServerKnowledgeGraph).mockResolvedValue({
      status: 'refreshed',
      graph: { nodes: [], edges: [] }
    })
    jest.mocked(createServerKnowledgeGraphStore).mockReturnValue({
      getState: jest.fn().mockResolvedValue(null)
    } as never)
  })

  test('locks before selection and returns empty without reading Notion', async () => {
    const order: string[] = []
    jest
      .mocked(withDirtyConsumerLock)
      .mockImplementation(
        async (task: (lease: DirtyConsumerLease) => Promise<unknown>) => {
          order.push('lock')
          return { status: 'acquired', result: await task(lease) }
        }
      )
    jest.mocked(listQuietDirtyPages).mockImplementation(async () => {
      order.push('select')
      return []
    })

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toEqual({
      status: 'empty',
      selected: 0,
      acknowledged: 0,
      retained: 0,
      queueDepth: 0,
      paths: [],
      elapsedMs: 0
    })

    expect(order).toEqual(['lock', 'select'])
    expect(listQuietDirtyPages).toHaveBeenCalledWith(1_000, 50)
    expect(fetchFreshConfiguredGlobalData).not.toHaveBeenCalled()
  })

  test('returns busy with the real constant-time queue depth without reading Notion', async () => {
    jest.mocked(withDirtyConsumerLock).mockResolvedValue({ status: 'busy' })
    jest.mocked(getDirtyQueueDepth).mockResolvedValue(7)

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({
      status: 'busy',
      selected: 0,
      queueDepth: 7
    })
    expect(getDirtyQueueDepth).toHaveBeenCalledTimes(1)
    expect(listQuietDirtyPages).not.toHaveBeenCalled()
    expect(fetchFreshConfiguredGlobalData).not.toHaveBeenCalled()
  })

  test('fails closed when busy queue depth cannot be read', async () => {
    jest.mocked(withDirtyConsumerLock).mockResolvedValue({ status: 'busy' })
    jest
      .mocked(getDirtyQueueDepth)
      .mockRejectedValue(new Error('redis://user:secret@example.invalid'))

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).rejects.toThrow('secret')
    expect(getDirtyQueueDepth).toHaveBeenCalledTimes(1)
    expect(listQuietDirtyPages).not.toHaveBeenCalled()
    expect(fetchFreshConfiguredGlobalData).not.toHaveBeenCalled()
  })

  test('performs one fresh pass, deduplicates paths, then commits and acknowledges dependencies', async () => {
    jest.mocked(listQuietDirtyPages).mockResolvedValue([
      { pageId: pageA, score: 100 },
      { pageId: pageB, score: 101 }
    ])
    jest
      .mocked(planRouteRevalidation)
      .mockImplementation((input: RoutePlanInput) => ({
        paths: ['/shared', `/article/${input.oldSnapshot?.pageId[0]}`],
        nextSnapshot: {
          ...(input.newPage || input.oldSnapshot),
          processedEventAt: input.selectedQueueScore
        },
        redirect: null,
        refreshGraph: false,
        becamePrivate: false
      }))
    const revalidate = jest.fn().mockResolvedValue(undefined)

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({
      status: 'processed',
      selected: 2,
      acknowledged: 2,
      retained: 0,
      paths: [
        { path: '/article/a', ok: true },
        { path: '/article/b', ok: true },
        { path: '/shared', ok: true }
      ]
    })

    expect(fetchFreshConfiguredGlobalData).toHaveBeenCalledTimes(1)
    expect(
      revalidate.mock.calls.map((call: string[]) => call[0]).sort()
    ).toEqual(['/article/a', '/article/b', '/shared'])
    expect(putRouteSnapshot).toHaveBeenCalledTimes(2)
    expect(ackDirtyPage).toHaveBeenCalledWith(pageA, 100)
    expect(ackDirtyPage).toHaveBeenCalledWith(pageB, 101)
  })

  test('retains a dirty page when Notion directory has not caught up to the webhook event', async () => {
    jest
      .mocked(listQuietDirtyPages)
      .mockResolvedValue([{ pageId: pageA, score: 120_000 }])
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(
        freshDirectory([sourcePage(pageA, { lastEditedDate: 1_000 })])
      )
    jest.mocked(getDirtyQueueDepth).mockResolvedValue(1)
    const revalidate = jest.fn()

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({
      status: 'processed',
      selected: 1,
      acknowledged: 0,
      retained: 1,
      queueDepth: 1,
      paths: []
    })

    expect(planRouteRevalidation).not.toHaveBeenCalled()
    expect(revalidate).not.toHaveBeenCalled()
    expect(putRouteSnapshot).not.toHaveBeenCalled()
    expect(ackDirtyPage).not.toHaveBeenCalled()
  })

  test('retains a public page when revalidation did not render the expected page-block version', async () => {
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/article/a'],
      nextSnapshot: {
        ...snapshot(pageA),
        lastEditedDate: 150,
        processedEventAt: 100
      },
      redirect: null,
      refreshGraph: false,
      becamePrivate: false
    })
    jest.mocked(getDataFromCache).mockResolvedValue(null)
    jest.mocked(getDirtyQueueDepth).mockResolvedValue(1)
    const revalidate = jest.fn().mockResolvedValue(undefined)

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({
      status: 'processed',
      selected: 1,
      acknowledged: 0,
      retained: 1,
      queueDepth: 1,
      paths: [{ path: '/article/a', ok: true }]
    })

    expect(getDataFromCache).toHaveBeenCalledWith(
      'page_block_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_150',
      true
    )
    expect(putRouteSnapshot).not.toHaveBeenCalled()
    expect(ackDirtyPage).not.toHaveBeenCalled()
  })

  test('retains only pages whose required shared or private path failed', async () => {
    jest.mocked(listQuietDirtyPages).mockResolvedValue([
      { pageId: pageA, score: 100 },
      { pageId: pageB, score: 101 }
    ])
    jest
      .mocked(planRouteRevalidation)
      .mockImplementation((input: RoutePlanInput) => ({
        paths:
          input.oldSnapshot?.pageId === pageA
            ? ['/shared', '/fails']
            : ['/shared'],
        nextSnapshot: {
          ...(input.newPage || input.oldSnapshot),
          processedEventAt: input.selectedQueueScore
        },
        redirect: null,
        refreshGraph: false,
        becamePrivate: false
      }))
    const revalidate = jest.fn(async (path: string) => {
      if (path === '/fails') throw new Error('ISR unavailable')
    })

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 1, retained: 1 })
    expect(putRouteSnapshot).toHaveBeenCalledTimes(1)
    expect(putRouteSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: pageB, processedEventAt: 101 })
    )
    expect(ackDirtyPage).toHaveBeenCalledTimes(1)
    expect(ackDirtyPage).toHaveBeenCalledWith(pageB, 101)
  })

  test('writes redirect and protective tombstone before ISR, but finalizes only after success', async () => {
    const old = snapshot(pageA, { href: '/article/old', slug: 'article/old' })
    jest.mocked(getRouteSnapshot).mockResolvedValue(old)
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(freshDirectory([]))
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/article/old'],
      nextSnapshot: {
        ...old,
        public: false,
        processedEventAt: 50,
        pendingEventAt: 100
      },
      redirect: {
        from: '/article/older',
        to: '/article/old',
        permanent: true
      },
      refreshGraph: false,
      becamePrivate: true
    })
    const order: string[] = []
    jest.mocked(saveFlattenedRedirect).mockImplementation(async () => {
      order.push('redirect')
      return '/article/old'
    })
    jest
      .mocked(putRouteSnapshot)
      .mockImplementation(async (value: RouteSnapshot) => {
        order.push(value.pendingEventAt ? 'tombstone' : 'final')
      })
    const revalidate = jest.fn(async () => order.push('revalidate'))
    jest.mocked(ackDirtyPage).mockImplementation(async () => {
      order.push('ack')
      return true
    })

    await consumeDirtyPages({ revalidate, now: () => 1_000 })

    expect(order).toEqual([
      'redirect',
      'tombstone',
      'revalidate',
      'final',
      'ack'
    ])
    const finalSnapshot = jest.mocked(putRouteSnapshot).mock.calls.at(-1)?.[0]
    expect(finalSnapshot).toEqual(
      expect.objectContaining({ public: false, processedEventAt: 100 })
    )
    expect(finalSnapshot).not.toHaveProperty('pendingEventAt')
  })

  test('never regenerates an unpublished route when its protective tombstone write fails', async () => {
    const old = snapshot(pageA, { href: '/article/old', slug: 'article/old' })
    jest.mocked(getRouteSnapshot).mockResolvedValue(old)
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(freshDirectory([]))
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/article/old'],
      nextSnapshot: {
        ...old,
        public: false,
        processedEventAt: 50,
        pendingEventAt: 100
      },
      redirect: null,
      refreshGraph: true,
      becamePrivate: true
    })
    jest.mocked(putRouteSnapshot).mockRejectedValue(new Error('Redis down'))
    const revalidate = jest.fn()

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 0, retained: 1, paths: [] })
    expect(revalidate).not.toHaveBeenCalled()
    expect(refreshServerKnowledgeGraph).not.toHaveBeenCalled()
    expect(ackDirtyPage).not.toHaveBeenCalled()
  })

  test('calls graph once and retains graph-dependent pages on failure', async () => {
    jest.mocked(listQuietDirtyPages).mockResolvedValue([
      { pageId: pageA, score: 100 },
      { pageId: pageB, score: 101 }
    ])
    jest
      .mocked(planRouteRevalidation)
      .mockImplementation((input: RoutePlanInput) => ({
        paths: [`/article/${input.oldSnapshot?.pageId[0]}`],
        nextSnapshot: {
          ...(input.newPage || input.oldSnapshot),
          processedEventAt: input.selectedQueueScore
        },
        redirect: null,
        refreshGraph: input.oldSnapshot?.pageId === pageA,
        becamePrivate: false
      }))
    jest
      .mocked(refreshServerKnowledgeGraph)
      .mockRejectedValue(new Error('graph failed'))

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 1, retained: 1 })
    expect(refreshServerKnowledgeGraph).toHaveBeenCalledTimes(1)
    expect(refreshServerKnowledgeGraph).toHaveBeenCalledWith({
      claimWindowMs: 60_000
    })
    expect(ackDirtyPage).toHaveBeenCalledWith(pageB, 101)
  })

  test('retains graph-dependent pages when refresh reports stale page fallback', async () => {
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/article/a'],
      nextSnapshot: { ...snapshot(pageA), processedEventAt: 100 },
      redirect: null,
      refreshGraph: true,
      becamePrivate: false
    })
    jest.mocked(refreshServerKnowledgeGraph).mockResolvedValue({
      status: 'refreshed',
      graph: { nodes: [], edges: [] },
      incomplete: true
    } as never)
    jest.mocked(createServerKnowledgeGraphStore).mockReturnValue({
      getState: jest.fn().mockResolvedValue({
        status: 'success',
        refreshedAt: 1_000,
        pageIds: [pageA]
      })
    } as never)

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 0, retained: 1 })
    expect(putRouteSnapshot).not.toHaveBeenCalled()
    expect(ackDirtyPage).not.toHaveBeenCalled()
  })

  test('accepts a skipped graph only when persisted graph state covers each event score', async () => {
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/article/a'],
      nextSnapshot: { ...snapshot(pageA), processedEventAt: 100 },
      redirect: null,
      refreshGraph: true,
      becamePrivate: false
    })
    jest.mocked(refreshServerKnowledgeGraph).mockResolvedValue({
      status: 'skipped'
    })
    const getState = jest
      .fn()
      .mockResolvedValueOnce({
        status: 'success',
        refreshedAt: 99,
        pageIds: []
      })
      .mockResolvedValueOnce({
        status: 'success',
        refreshedAt: 100,
        pageIds: []
      })
    jest.mocked(createServerKnowledgeGraphStore).mockReturnValue({
      getState
    } as never)

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 0, retained: 1 })
    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 1, retained: 0 })
  })

  test('retains a newer event when compare-delete refuses the selected score', async () => {
    jest.mocked(ackDirtyPage).mockResolvedValue(false)
    jest.mocked(getDirtyQueueDepth).mockResolvedValue(1)

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).resolves.toMatchObject({
      acknowledged: 0,
      retained: 1,
      queueDepth: 1
    })
    expect(putRouteSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ processedEventAt: 100 })
    )
  })

  test('acknowledges a freshly confirmed irrelevant page without ISR or graph work', async () => {
    jest.mocked(getRouteSnapshot).mockResolvedValue(null)
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(freshDirectory([]))
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: [],
      nextSnapshot: null,
      redirect: null,
      refreshGraph: false,
      becamePrivate: false
    })
    const revalidate = jest.fn()

    await expect(
      consumeDirtyPages({ revalidate, now: () => 1_000 })
    ).resolves.toMatchObject({ acknowledged: 1, retained: 0 })
    expect(revalidate).not.toHaveBeenCalled()
    expect(putRouteSnapshot).not.toHaveBeenCalled()
    expect(refreshServerKnowledgeGraph).not.toHaveBeenCalled()
  })

  test('Notion failure retains queue work and never acknowledges', async () => {
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockRejectedValue(new Error('Notion unavailable'))

    await expect(
      consumeDirtyPages({ revalidate: jest.fn(), now: () => 1_000 })
    ).rejects.toThrow('Notion unavailable')
    expect(ackDirtyPage).not.toHaveBeenCalled()
  })

  test('stops starting paths when the batch work-start budget is exhausted', async () => {
    jest.mocked(planRouteRevalidation).mockReturnValue({
      paths: ['/one', '/two'],
      nextSnapshot: { ...snapshot(pageA), processedEventAt: 100 },
      redirect: null,
      refreshGraph: false,
      becamePrivate: false
    })
    let currentTime = 0
    const now = jest.fn(() => currentTime)
    const revalidate = jest.fn().mockImplementation(async () => {
      currentTime = 211_000
    })

    await expect(consumeDirtyPages({ revalidate, now })).resolves.toMatchObject(
      {
        acknowledged: 0,
        retained: 1,
        paths: expect.arrayContaining([
          expect.objectContaining({ path: '/two', ok: false })
        ])
      }
    )
    expect(revalidate).toHaveBeenCalledTimes(1)
  })

  test('bootstraps current public snapshots idempotently without revalidation', async () => {
    jest
      .mocked(fetchFreshConfiguredGlobalData)
      .mockResolvedValue(
        freshDirectory([
          sourcePage(pageA),
          sourcePage(pageB, { status: 'Invisible' })
        ])
      )
    jest.mocked(bootstrapRouteSnapshots).mockResolvedValue(true)

    await expect(bootstrapRouteState({ now: () => 500 })).resolves.toEqual({
      bootstrapped: true,
      snapshots: 1
    })
    expect(bootstrapRouteSnapshots).toHaveBeenCalledWith({
      snapshots: [expect.objectContaining({ pageId: pageA, public: true })],
      sourceConfirmed: true,
      bootstrappedAt: 500
    })
    expect(BLOG.LANG).toBeTruthy()
  })
})
