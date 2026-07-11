import { refreshKnowledgeGraph } from '@/lib/knowledge-graph/refresh'
import { EmptyData } from '@/lib/db/SiteDataFallback'
import type { PageSnapshot, PublicGraph } from '@/lib/knowledge-graph/types'

declare const jest: any
declare const test: (name: string, callback: () => Promise<void>) => void
declare const expect: any

const A = '00000000000000000000000000000001'
const B = '00000000000000000000000000000002'
const C = '00000000000000000000000000000003'
const D = '00000000000000000000000000000004'

type Snapshot = PageSnapshot & { lastEditedDate: number }

const page = (id: string, lastEditedDate: number, extra = {}) => ({
  id,
  title: `Page ${id.slice(-1)}`,
  slug: `page-${id.slice(-1)}`,
  status: 'Published',
  type: 'Post',
  lastEditedDate,
  ...extra
})

function setup(
  options: {
    pages?: unknown[]
    snapshots?: Record<string, Snapshot>
    claim?: { owner: string; windowStart: number } | null
  } = {}
) {
  const snapshots = new Map(Object.entries(options.snapshots || {}))
  const events: string[] = []
  let graph: PublicGraph | null = {
    nodes: [{ id: A, title: 'Old', slug: 'old' }],
    edges: []
  }
  const store = {
    getGraph: jest.fn(async () => graph),
    getState: jest.fn(async () => ({ status: 'success', refreshedAt: 1 })),
    putState: jest.fn(async () => {
      events.push('state')
    }),
    getPageSnapshot: jest.fn(async (id: string) => snapshots.get(id) || null),
    putPageSnapshot: jest.fn(async (id: string, snapshot: Snapshot) => {
      snapshots.set(id, snapshot)
      events.push(`snapshot:${id}`)
    }),
    deletePageSnapshot: jest.fn(async (id: string) => {
      snapshots.delete(id)
      events.push(`delete:${id}`)
    }),
    acquireRefreshClaim: jest.fn(async () =>
      options.claim === undefined
        ? { owner: 'owner', windowStart: 1_200_000 }
        : options.claim
    ),
    putGraph: jest.fn(async (next: PublicGraph) => {
      graph = next
      events.push('graph')
    }),
    cleanupPublications: jest.fn(async () => {
      events.push('cleanup')
    })
  }
  const fetchNotionPageBlocks = jest.fn(async (id: string) => ({
    block: {
      [id]: {
        value: {
          id,
          properties: {
            title: [['title']],
            relation: [['p', id === A ? B : A]]
          }
        }
      }
    },
    collection: {
      database: {
        value: { schema: { relation: { type: 'relation' } } }
      }
    }
  }))
  const fetchGlobalAllData = jest.fn(async () => ({
    allPages: options.pages || [page(A, 10), page(B, 20)]
  }))

  return {
    deps: {
      store,
      fetchGlobalAllData,
      fetchNotionPageBlocks,
      clock: () => 2_000_000,
      createId: () => 'generation-one'
    },
    store,
    snapshots,
    events,
    fetchGlobalAllData,
    fetchNotionPageBlocks
  }
}

test('reuses an unchanged snapshot without fetching its blocks', async () => {
  const context = setup({
    pages: [page(A, 10)],
    snapshots: { [A]: { links: [B], lastEditedDate: 10 } }
  })

  await refreshKnowledgeGraph(context.deps)

  expect(context.fetchNotionPageBlocks).not.toHaveBeenCalled()
  expect(context.store.putPageSnapshot).not.toHaveBeenCalled()
})

test('normalizes the global fetch ISO edit date before comparing snapshots', async () => {
  const editedAt = '2026-07-12T01:02:03.000Z'
  const context = setup({
    pages: [page(A, editedAt as unknown as number)],
    snapshots: { [A]: { links: [B], lastEditedDate: Date.parse(editedAt) } }
  })

  await refreshKnowledgeGraph(context.deps)

  expect(context.fetchNotionPageBlocks).not.toHaveBeenCalled()
})

test('fetches changed and new pages and replaces their snapshots', async () => {
  const context = setup({
    snapshots: { [A]: { links: [], lastEditedDate: 9 } }
  })

  await refreshKnowledgeGraph(context.deps)

  expect(context.fetchNotionPageBlocks).toHaveBeenCalledTimes(2)
  expect(context.store.putPageSnapshot).toHaveBeenCalledWith(A, {
    links: [B],
    lastEditedDate: 10
  })
  expect(context.store.putPageSnapshot).toHaveBeenCalledWith(B, {
    links: [A],
    lastEditedDate: 20
  })
})

test('bounds changed-page block fetching to concurrency three', async () => {
  const context = setup({
    pages: [page(A, 1), page(B, 2), page(C, 3), page(D, 4)]
  })
  let active = 0
  let maximum = 0
  context.deps.fetchNotionPageBlocks = jest.fn(async (id: string) => {
    active++
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active--
    return { block: { [id]: { value: { id, properties: {} } } } }
  })

  await refreshKnowledgeGraph(context.deps)

  expect(maximum).toBe(3)
})

test('deletes snapshots for pages that are no longer published', async () => {
  const context = setup({
    pages: [page(A, 10)],
    snapshots: {
      [A]: { links: [], lastEditedDate: 10 },
      [B]: { links: [A], lastEditedDate: 20 }
    }
  })
  context.store.getState.mockResolvedValue({
    status: 'success',
    refreshedAt: 1,
    pageIds: [A, B]
  })

  await refreshKnowledgeGraph(context.deps)

  expect(context.store.deletePageSnapshot).toHaveBeenCalledWith(B)
})

test('keeps the prior snapshot when one changed page fails', async () => {
  const context = setup({
    pages: [page(A, 10)],
    snapshots: { [A]: { links: [B], lastEditedDate: 9 } }
  })
  context.deps.fetchNotionPageBlocks = jest.fn(async () => {
    throw new Error('private notion failure token-secret')
  })

  const result = await refreshKnowledgeGraph(context.deps)

  expect(context.store.putPageSnapshot).not.toHaveBeenCalled()
  expect(result).toMatchObject({ status: 'refreshed' })
  expect(context.store.putGraph).toHaveBeenCalledWith(
    expect.objectContaining({ nodes: [expect.objectContaining({ id: A })] }),
    'generation-one',
    1_200_000
  )
})

test('rejects the real global fallback before changing stored graph data', async () => {
  const context = setup()
  context.deps.fetchGlobalAllData = jest.fn(async () =>
    EmptyData({
      pageId: 'sanitized-invalid-page-id',
      siteInfo: {},
      homeBannerImage: '/bg_image.jpg'
    })
  )

  await expect(refreshKnowledgeGraph(context.deps)).rejects.toThrow(
    'Published Notion article metadata is invalid'
  )
  expect(context.fetchNotionPageBlocks).not.toHaveBeenCalled()
  expect(context.store.getState).not.toHaveBeenCalled()
  expect(context.store.getPageSnapshot).not.toHaveBeenCalled()
  expect(context.store.putPageSnapshot).not.toHaveBeenCalled()
  expect(context.store.deletePageSnapshot).not.toHaveBeenCalled()
  expect(context.store.putGraph).not.toHaveBeenCalled()
  expect(context.store.cleanupPublications).not.toHaveBeenCalled()
  expect(context.store.putState).not.toHaveBeenCalled()
  expect(await context.store.getGraph()).toEqual({
    nodes: [{ id: A, title: 'Old', slug: 'old' }],
    edges: []
  })
})

test('leaves the current publication untouched when the claim is denied', async () => {
  const context = setup({ claim: null })

  await expect(refreshKnowledgeGraph(context.deps)).resolves.toEqual({
    status: 'skipped'
  })
  expect(context.fetchGlobalAllData).not.toHaveBeenCalled()
  expect(context.store.putGraph).not.toHaveBeenCalled()
  expect(context.store.putState).not.toHaveBeenCalled()
})

test('publishes immutable graph and marker before successful state and cleanup', async () => {
  const context = setup({
    pages: [page(A, 10)],
    snapshots: { [A]: { links: [], lastEditedDate: 10 } }
  })

  await refreshKnowledgeGraph(context.deps)

  expect(context.store.putGraph).toHaveBeenCalledWith(
    { nodes: [{ id: A, title: 'Page 1', slug: 'page-1' }], edges: [] },
    'generation-one',
    1_200_000
  )
  expect(context.events).toEqual(['graph', 'state', 'cleanup'])
  expect(context.store.putState).toHaveBeenCalledWith({
    status: 'success',
    refreshedAt: 2_000_000,
    pageIds: [A]
  })
})
