/** @jest-environment node */

jest.mock('@edgeone/pages-blob', () => ({ getStore: jest.fn() }))
jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchGlobalAllData: jest.fn()
}))
jest.mock('@/lib/db/notion/getPostBlocks', () => ({
  fetchNotionPageBlocks: jest.fn()
}))

import {
  createKnowledgeGraphHandler,
  fetchConfiguredSiteData,
  resolveKnowledgeGraphServerConfig
} from '@/cloud-functions/api/knowledge-graph'
import type { PublicGraph } from '@/lib/knowledge-graph/types'

declare const jest: any
declare const test: (name: string, callback: () => Promise<void>) => void
declare const expect: any

const graph: PublicGraph = {
  nodes: [
    {
      id: '00000000000000000000000000000001',
      title: 'Published article',
      slug: 'published-article'
    }
  ],
  edges: []
}
const configuredPageId = graph.nodes[0]!.id

function setup(
  options: {
    storedGraph?: PublicGraph | null
    refreshedAt?: number | null
    graphError?: Error
    refreshResult?:
      { status: 'refreshed'; graph: PublicGraph } | { status: 'skipped' }
  } = {}
) {
  const waitUntilTasks: Promise<unknown>[] = []
  const store = {
    getGraph: jest.fn(async () => {
      if (options.graphError) throw options.graphError
      return options.storedGraph === undefined ? graph : options.storedGraph
    }),
    getState: jest.fn(async () =>
      options.refreshedAt === null
        ? null
        : { status: 'success', refreshedAt: options.refreshedAt ?? 95_000 }
    )
  }
  const refresh = jest.fn(
    async () => options.refreshResult || { status: 'refreshed' as const, graph }
  )
  const handler = createKnowledgeGraphHandler({
    store,
    refresh,
    clock: () => 100_000,
    refreshAfterMs: 10_000,
    logError: jest.fn()
  })
  const context = {
    request: new Request('https://example.com/api/knowledge-graph'),
    env: {},
    waitUntil(task: Promise<unknown>) {
      waitUntilTasks.push(task)
    }
  }

  return { context, handler, refresh, store, waitUntilTasks }
}

function expectGraphHeaders(response: Response) {
  expect(response.headers.get('content-type')).toBe(
    'application/json; charset=utf-8'
  )
  expect(response.headers.get('cache-control')).toBe(
    'public, max-age=60, stale-while-revalidate=600'
  )
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

function expectInitializingHeaders(response: Response) {
  expect(response.headers.get('content-type')).toBe(
    'application/json; charset=utf-8'
  )
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
}

test('validates server-only knowledge graph settings with private defaults', async () => {
  expect(resolveKnowledgeGraphServerConfig({})).toEqual({
    refreshMinutes: 10,
    storeName: 'notionnext-knowledge-graph'
  })
  expect(
    resolveKnowledgeGraphServerConfig({
      KNOWLEDGE_GRAPH_REFRESH_MINUTES: 'invalid'
    })
  ).toMatchObject({ refreshMinutes: 10 })
  expect(
    resolveKnowledgeGraphServerConfig({
      KNOWLEDGE_GRAPH_REFRESH_MINUTES: '0'
    })
  ).toMatchObject({ refreshMinutes: 10 })
  expect(
    resolveKnowledgeGraphServerConfig({
      KNOWLEDGE_GRAPH_REFRESH_MINUTES: '2'
    })
  ).toMatchObject({ refreshMinutes: 10 })
  expect(
    resolveKnowledgeGraphServerConfig({
      KNOWLEDGE_GRAPH_REFRESH_MINUTES: '15',
      KNOWLEDGE_GRAPH_STORE: ' private-store '
    })
  ).toEqual({ refreshMinutes: 15, storeName: 'private-store' })
  expect(
    resolveKnowledgeGraphServerConfig({
      KNOWLEDGE_GRAPH_REFRESH_MINUTES: '0',
      KNOWLEDGE_GRAPH_STORE: '   '
    })
  ).toEqual({
    refreshMinutes: 10,
    storeName: 'notionnext-knowledge-graph'
  })
})

test('fetches every configured language database in configuration order', async () => {
  const fetchSiteData = jest.fn(
    async ({
      pageId,
      locale
    }: {
      pageId: string
      locale: string | undefined
    }) => ({ allPages: [{ id: pageId, locale }] })
  )

  const result = await fetchConfiguredSiteData({
    notionPageId: `en:${configuredPageId},zh:${configuredPageId.slice(0, -1)}2`,
    fetchSiteData
  })

  expect(fetchSiteData.mock.calls).toEqual([
    [
      {
        pageId: configuredPageId,
        from: 'knowledge-graph',
        locale: 'en'
      }
    ],
    [
      {
        pageId: `${configuredPageId.slice(0, -1)}2`,
        from: 'knowledge-graph',
        locale: 'zh'
      }
    ]
  ])
  expect(result).toEqual([
    { allPages: [{ id: configuredPageId, locale: 'en' }] },
    {
      allPages: [{ id: `${configuredPageId.slice(0, -1)}2`, locale: 'zh' }]
    }
  ])
})

test('keeps the single-database fetch contract unchanged', async () => {
  const fetchSiteData = jest.fn(async () => ({ allPages: [] }))

  await fetchConfiguredSiteData({
    notionPageId: configuredPageId,
    fetchSiteData
  })

  expect(fetchSiteData).toHaveBeenCalledWith({
    pageId: configuredPageId,
    from: 'knowledge-graph',
    locale: undefined
  })
})

test('reports a configured locale failure instead of returning partial site data', async () => {
  const fetchSiteData = jest
    .fn()
    .mockResolvedValueOnce({ allPages: [{ id: configuredPageId }] })
    .mockRejectedValueOnce(new Error('zh locale fetch failed'))

  await expect(
    fetchConfiguredSiteData({
      notionPageId: `en:${configuredPageId},zh:${configuredPageId.slice(0, -1)}2`,
      fetchSiteData
    })
  ).rejects.toThrow('zh locale fetch failed')
  expect(fetchSiteData).toHaveBeenCalledTimes(2)
})

test('returns a fresh graph without starting refresh work', async () => {
  const context = setup()

  const response = await context.handler(context.context)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(graph)
  expect(context.refresh).not.toHaveBeenCalled()
  expect(context.waitUntilTasks).toHaveLength(0)
  expectGraphHeaders(response)
})

test('returns a stale graph immediately and registers one background refresh', async () => {
  const context = setup({ refreshedAt: 80_000 })

  const response = await context.handler(context.context)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(graph)
  expect(context.refresh).toHaveBeenCalledTimes(1)
  expect(context.waitUntilTasks).toHaveLength(1)
  await context.waitUntilTasks[0]
})

test('keeps the publication selected by the immutable marker when a concurrent claim is denied', async () => {
  const selectedGraph: PublicGraph = {
    nodes: [
      {
        id: '00000000000000000000000000000002',
        title: 'Newest marker publication',
        slug: 'newest'
      }
    ],
    edges: []
  }
  const context = setup({
    storedGraph: selectedGraph,
    refreshedAt: 80_000,
    refreshResult: { status: 'skipped' }
  })

  const response = await context.handler(context.context)

  expect(await response.json()).toEqual(selectedGraph)
  expect(context.waitUntilTasks).toHaveLength(1)
  await context.waitUntilTasks[0]
  expect(context.store.getGraph).toHaveBeenCalledTimes(1)
})

test('returns initializing and starts generation when no publication exists', async () => {
  const context = setup({ storedGraph: null, refreshedAt: null })

  const response = await context.handler(context.context)

  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ status: 'initializing' })
  expect(context.store.getState).not.toHaveBeenCalled()
  expect(context.waitUntilTasks).toHaveLength(1)
  expectInitializingHeaders(response)
  await context.waitUntilTasks[0]
})

test('returns an empty 503 response when Blob reading fails', async () => {
  const context = setup({
    graphError: new Error('blob failed with private-token-value')
  })

  const response = await context.handler(context.context)
  const body = await response.text()

  expect(response.status).toBe(503)
  expect(body).toBe('')
  expect(body).not.toContain('private-token-value')
  expect(context.refresh).not.toHaveBeenCalled()
  expect(context.waitUntilTasks).toHaveLength(0)
  expectGraphHeaders(response)
})

test('never appends private refresh state to a public graph payload', async () => {
  const context = setup({ refreshedAt: 99_999 })

  const response = await context.handler(context.context)
  const payload = await response.json()

  expect(Object.keys(payload)).toEqual(['nodes', 'edges'])
  expect(JSON.stringify(payload)).not.toContain('refreshedAt')
})
