/** @jest-environment node */

declare const jest: any
declare const beforeEach: (callback: () => void) => void
declare const test: (name: string, callback: () => Promise<void>) => void
declare const expect: any

jest.mock('@/lib/knowledge-graph/notionFetch', () => ({
  fetchKnowledgeGraphPageBlocks: jest.fn(),
  fetchKnowledgeGraphPageValues: jest.fn()
}))
jest.mock('@/lib/knowledge-graph/notionSource', () => ({
  fetchKnowledgeGraphSiteData: jest.fn()
}))
jest.mock('@/lib/knowledge-graph/redisStore', () => ({
  createRedisGraphStore: jest.fn()
}))

import BLOG from '@/blog.config'
import {
  fetchKnowledgeGraphPageBlocks,
  fetchKnowledgeGraphPageValues
} from '@/lib/knowledge-graph/notionFetch'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'
import { createRedisGraphStore } from '@/lib/knowledge-graph/redisStore'
import { refreshServerKnowledgeGraph } from '@/lib/knowledge-graph/serverRefresh'
import handler from '@/pages/api/knowledge-graph'

class MemoryBlobStore {
  readonly values = new Map<string, unknown>()

  async get(key: string): Promise<unknown> {
    return this.values.get(key) ?? null
  }

  async list(options?: { prefix?: string }) {
    return {
      blobs: Array.from(this.values.keys())
        .filter(key => !options?.prefix || key.startsWith(options.prefix))
        .map(key => ({ key }))
    }
  }

  async setJSON(
    key: string,
    value: unknown,
    options?: { onlyIfNew?: boolean }
  ): Promise<void> {
    if (options?.onlyIfNew && this.values.has(key)) {
      const error = new Error('already exists')
      ;(error as { code?: string }).code = 'PRECONDITION_FAILED'
      throw error
    }
    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key)
  }
}

let blobStore: MemoryBlobStore

beforeEach(() => {
  blobStore = new MemoryBlobStore()
  jest.mocked(createRedisGraphStore).mockReturnValue(blobStore)
  jest.mocked(fetchKnowledgeGraphSiteData).mockResolvedValue({
    allPages: [],
    schema: {}
  })
})

test('uses the real refresh and graph store dependencies for one-minute dirty claims', async () => {
  const now = jest
    .spyOn(Date, 'now')
    .mockReturnValue(Date.UTC(2026, 6, 15, 12, 3, 15))

  await expect(
    refreshServerKnowledgeGraph({ locale: 'zh-CN', claimWindowMs: 60_000 })
  ).resolves.toMatchObject({ status: 'refreshed' })
  await expect(
    refreshServerKnowledgeGraph({ locale: 'zh-CN', claimWindowMs: 60_000 })
  ).resolves.toEqual({ status: 'skipped' })

  now.mockReturnValue(Date.UTC(2026, 6, 15, 12, 4))
  await expect(
    refreshServerKnowledgeGraph({ locale: 'zh-CN', claimWindowMs: 60_000 })
  ).resolves.toMatchObject({ status: 'refreshed' })

  expect(Array.from(blobStore.values.keys())).toEqual(
    expect.arrayContaining([
      `v6/state/refresh-claims/${Date.UTC(2026, 6, 15, 12, 3)}.json`,
      `v6/state/refresh-claims/${Date.UTC(2026, 6, 15, 12, 4)}.json`
    ])
  )
  expect(fetchKnowledgeGraphSiteData).toHaveBeenCalledWith(
    expect.objectContaining({
      pageId: BLOG.NOTION_PAGE_ID,
      notionIndex: Number(BLOG.NOTION_INDEX) || undefined,
      postUrlPrefix: BLOG.POST_URL_PREFIX,
      locale: 'zh-CN',
      fetchDatabase: expect.any(Function),
      fetchPageValues: fetchKnowledgeGraphPageValues
    })
  )

  const sourceOptions = jest.mocked(fetchKnowledgeGraphSiteData).mock
    .calls[0]![0]
  await sourceOptions.fetchDatabase('page-id', 'source-contract')
  expect(fetchKnowledgeGraphPageBlocks).toHaveBeenCalledWith(
    'page-id',
    'source-contract'
  )
})

test('keeps the normal server API on the default ten-minute claim window', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 6, 15, 12, 3, 15))
  const originalRedisUrl = BLOG.REDIS_URL
  BLOG.REDIS_URL = 'redis://test.invalid'
  const headers: Record<string, string> = {}
  let statusCode = 0
  let body: unknown
  const response = {
    setHeader(name: string, value: string) {
      headers[name] = value
    },
    status(code: number) {
      statusCode = code
      return this
    },
    json(value: unknown) {
      body = value
      return this
    }
  }

  try {
    await handler(
      { method: 'GET', query: { lang: 'en' } } as never,
      response as never
    )
  } finally {
    BLOG.REDIS_URL = originalRedisUrl
  }

  expect(statusCode).toBe(202)
  expect(body).toEqual({
    status: 'initializing',
    message: 'Knowledge graph is being built, please retry in a few seconds'
  })
  expect(headers['cache-control']).toBe('no-store')
  expect(
    blobStore.values.has(
      `v6/state/refresh-claims/${Date.UTC(2026, 6, 15, 12, 0)}.json`
    )
  ).toBe(true)
  expect(fetchKnowledgeGraphSiteData).toHaveBeenCalledWith(
    expect.objectContaining({ locale: 'en' })
  )
})
