/** @jest-environment node */

import fs from 'node:fs'
import path from 'node:path'

jest.mock('@edgeone/pages-blob', () => ({ getStore: jest.fn() }))
jest.mock('@/lib/knowledge-graph/notionFetch', () => ({
  fetchKnowledgeGraphPageBlocks: jest.fn(),
  fetchKnowledgeGraphPageValues: jest.fn()
}))
jest.mock('@/lib/knowledge-graph/notionSource', () => ({
  fetchKnowledgeGraphSiteData: jest.fn()
}))

import { getStore } from '@edgeone/pages-blob'
import BLOG from '@/blog.config'
import {
  createKnowledgeGraphHandler,
  fetchConfiguredSiteData,
  onRequestGet,
  resolveKnowledgeGraphServerConfig
} from '@/cloud-functions/api/knowledge-graph'
import {
  fetchKnowledgeGraphPageBlocks,
  fetchKnowledgeGraphPageValues
} from '@/lib/knowledge-graph/notionFetch'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'
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
    refreshError?: Error
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
  const refresh = jest.fn(async () => {
    if (options.refreshError) throw options.refreshError
    return options.refreshResult || { status: 'refreshed' as const, graph }
  })
  const logError = jest.fn()
  const handler = createKnowledgeGraphHandler({
    store,
    refresh,
    clock: () => 100_000,
    refreshAfterMs: 10_000,
    logError
  })
  const context = {
    request: new Request('https://example.com/api/knowledge-graph'),
    env: {},
    waitUntil(task: Promise<unknown>) {
      waitUntilTasks.push(task)
    }
  }

  return { context, handler, logError, refresh, store, waitUntilTasks }
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

test('refreshes through the server-only Notion source with configured fields', async () => {
  const waitUntilTasks: Promise<unknown>[] = []
  const blobStore = {
    delete: jest.fn(async () => undefined),
    get: jest.fn(async () => null),
    list: jest.fn(async () => ({ blobs: [] })),
    setJSON: jest.fn(async () => undefined)
  }
  jest.mocked(getStore).mockReturnValue(blobStore)
  jest.mocked(fetchKnowledgeGraphSiteData).mockResolvedValue({
    allPages: [],
    schema: {}
  })

  const response = await onRequestGet({
    request: new Request('https://example.com/api/knowledge-graph'),
    env: {},
    waitUntil(task: Promise<unknown>) {
      waitUntilTasks.push(task)
    }
  })

  expect(response.status).toBe(202)
  expect(waitUntilTasks).toHaveLength(1)
  await waitUntilTasks[0]
  expect(fetchKnowledgeGraphSiteData).toHaveBeenCalledWith(
    expect.objectContaining({
      pageId: expect.any(String),
      notionIndex: Number(BLOG.NOTION_INDEX),
      postUrlPrefix: BLOG.POST_URL_PREFIX,
      propertyNames: expect.objectContaining({
        title: BLOG.NOTION_PROPERTY_NAME.title,
        slug: BLOG.NOTION_PROPERTY_NAME.slug,
        type: BLOG.NOTION_PROPERTY_NAME.type,
        status: BLOG.NOTION_PROPERTY_NAME.status
      }),
      publicationLabels: {
        typePost: BLOG.NOTION_PROPERTY_NAME.type_post,
        typePage: BLOG.NOTION_PROPERTY_NAME.type_page,
        statusPublish: BLOG.NOTION_PROPERTY_NAME.status_publish
      },
      fetchDatabase: expect.any(Function),
      fetchPageValues: expect.any(Function)
    })
  )

  const sourceOptions = jest.mocked(fetchKnowledgeGraphSiteData).mock
    .calls[0]![0]
  await sourceOptions.fetchDatabase(configuredPageId, 'source-contract')
  await sourceOptions.fetchPageValues([configuredPageId])
  expect(fetchKnowledgeGraphPageBlocks).toHaveBeenCalledWith(
    configuredPageId,
    'source-contract'
  )
  expect(fetchKnowledgeGraphPageValues).toHaveBeenCalledWith([configuredPageId])
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

test('returns initializing when the EdgeOne context has no waitUntil', async () => {
  const context = setup({ storedGraph: null, refreshedAt: null })
  const edgeOneContext = {
    request: context.context.request,
    env: context.context.env
  }

  const response = await context.handler(edgeOneContext)

  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ status: 'initializing' })
  expect(context.refresh).toHaveBeenCalledTimes(1)
  expect(context.logError).not.toHaveBeenCalled()
})

test('returns a stale graph when the EdgeOne context has no waitUntil', async () => {
  const context = setup({ refreshedAt: 80_000 })
  const edgeOneContext = {
    request: context.context.request,
    env: context.context.env
  }

  const response = await context.handler(edgeOneContext)

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(graph)
  expect(context.refresh).toHaveBeenCalledTimes(1)
  expect(context.logError).not.toHaveBeenCalled()
})

test('logs one rejected refresh when the EdgeOne context has no waitUntil', async () => {
  const refreshError = new Error('detached refresh failed')
  const context = setup({
    storedGraph: null,
    refreshedAt: null,
    refreshError
  })
  const edgeOneContext = {
    request: context.context.request,
    env: context.context.env
  }

  const response = await context.handler(edgeOneContext)
  await Promise.resolve()

  expect(response.status).toBe(202)
  expect(context.refresh).toHaveBeenCalledTimes(1)
  expect(context.logError).toHaveBeenCalledTimes(1)
  expect(context.logError).toHaveBeenCalledWith(refreshError)
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

test('EdgeOne allows the knowledge graph Node function to run for 120 seconds', async () => {
  const edgeone = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'edgeone.json'), 'utf8')
  )
  expect(edgeone.cloudFunctions?.nodejs?.maxDuration).toBe(120)
  expect(edgeone.schedules).toBeUndefined()
})
