const sourceFixture =
  require('../../fixtures/notion/knowledge-graph-database.json').recordMap

jest.mock('@/blog.config', () => ({
  NOTION_PAGE_ID: 'database-one',
  BUNDLE_ANALYZER: false,
  THEME: 'simple',
  ENABLE_CACHE: true,
  NOTION_PROPERTY_NAME: {}
}))

jest.mock('@/lib/cache/cache_manager', () => {
  const setDataToCache = jest.fn()
  return {
    getOrSetDataWithCache: jest.fn((_key, load) => load()),
    setDataToCache,
    isUsableCacheValue: jest.fn(
      data => Array.isArray(data?.allPages) && data.allPages.length > 0
    ),
    __mockSetDataToCache: setDataToCache
  }
})
jest.mock('@/lib/cache/redis_fallback', () => {
  const saveFallback = jest.fn()
  return { saveFallback, __mockSaveFallback: saveFallback }
})
jest.mock('@/lib/db/notion/getPostBlocks', () => {
  const fetchNotionPageBlocks = jest.fn()
  return {
    fetchNotionPageBlocks,
    fetchInBatches: jest.fn(() => Promise.resolve({})),
    formatNotionBlock: jest.fn(block => block),
    __mockFetchNotionPageBlocks: fetchNotionPageBlocks
  }
})
jest.mock('@/lib/db/notion/getAllPageIds', () =>
  jest.fn((_query, collectionId) => [`post-${collectionId}`])
)
jest.mock('@/lib/db/notion/getPageProperties', () => ({
  __esModule: true,
  default: jest.fn(id =>
    Promise.resolve({
      id,
      slug: id,
      title: id,
      type: 'Post',
      status: 'Published',
      tags: [],
      tagItems: [],
      category: []
    })
  ),
  adjustPageProperties: jest.fn()
}))
jest.mock('@/lib/db/notion/getNotionConfig', () => ({
  getConfigMapFromConfigPage: jest.fn(() => Promise.resolve({}))
}))
jest.mock('@/lib/db/notion/getNotionPost', () => ({
  fetchPageFromNotion: jest.fn()
}))
jest.mock('@/lib/db/notion/memberDataSource', () => ({
  fetchMembersFromOfficialAPI: jest.fn(() => Promise.resolve([]))
}))
jest.mock('@/lib/db/notion/normalizeUtil', () => ({
  normalizeNotionMetadata: jest.fn((_block, pageId) => ({
    id: pageId,
    type: 'collection_view_page',
    collection_id: `collection-${pageId}`,
    view_ids: []
  })),
  normalizeCollection: jest.fn(() => ({ schema: {} })),
  normalizeSchema: jest.fn(schema => schema),
  normalizePageBlock: jest.fn(entry => entry?.value || entry)
}))
jest.mock('@/lib/utils/notion.util', () => ({
  adapterNotionBlockMap: jest.fn(recordMap => recordMap)
}))
jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((_key, fallback) => fallback)
}))
jest.mock('notion-utils', () => ({ idToUuid: jest.fn(id => id) }))

import BLOG from '@/blog.config'
import {
  fetchGlobalAllData,
  fetchFreshConfiguredGlobalData,
  getGlobalDataCacheKey,
  getSiteDataCacheKey
} from '@/lib/db/SiteDataApi'
import * as blocksMock from '@/lib/db/notion/getPostBlocks'
import * as cacheManagerMock from '@/lib/cache/cache_manager'
import * as fallbackMock from '@/lib/cache/redis_fallback'

const fetchNotionPageBlocks = blocksMock.__mockFetchNotionPageBlocks
const setDataToCache = cacheManagerMock.__mockSetDataToCache
const saveFallback = fallbackMock.__mockSaveFallback

function sourceMapFor(pageId) {
  const collectionId = `collection-${pageId}`
  return {
    ...sourceFixture,
    block: {
      [pageId]: {
        value: {
          id: pageId,
          type: 'collection_view_page',
          collection_id: collectionId,
          view_ids: []
        }
      },
      [`post-${collectionId}`]: {
        value: {
          id: `post-${collectionId}`,
          type: 'page',
          parent_id: collectionId
        }
      }
    },
    collection: {
      [collectionId]: { value: { id: collectionId, schema: {} } }
    },
    collection_query: {},
    collection_view: {}
  }
}

describe('fetchFreshConfiguredGlobalData', () => {
  beforeEach(() => {
    BLOG.NOTION_PAGE_ID = 'database-one'
    fetchNotionPageBlocks.mockReset()
    setDataToCache.mockReset()
    saveFallback.mockReset()
    fetchNotionPageBlocks.mockImplementation(pageId =>
      Promise.resolve(sourceMapFor(pageId))
    )
  })

  test('refreshes one configured database from source and writes the normal cache layers', async () => {
    const result = await fetchFreshConfiguredGlobalData({ from: 'fresh-test' })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      pageId: 'database-one',
      data: { allPages: [{ slug: 'post-collection-database-one' }] }
    })
    expect(result[0]).not.toHaveProperty('locale')
    expect(fetchNotionPageBlocks).toHaveBeenCalledWith(
      'database-one',
      'fresh-test',
      { forceSource: true }
    )

    const siteKey = getSiteDataCacheKey('database-one')
    const globalKey = getGlobalDataCacheKey({
      pageId: BLOG.NOTION_PAGE_ID,
      locale: undefined
    })
    expect(setDataToCache).toHaveBeenCalledWith(siteKey, expect.any(Object))
    expect(setDataToCache).toHaveBeenCalledWith(globalKey, result[0].data)
    expect(saveFallback).toHaveBeenCalledWith(siteKey, expect.any(Object))
    expect(saveFallback).toHaveBeenCalledWith(globalKey, result[0].data)
  })

  test('refreshes configured locales in declaration order', async () => {
    BLOG.NOTION_PAGE_ID = 'zh:database-zh,en:database-en'

    const result = await fetchFreshConfiguredGlobalData({
      from: 'fresh-locales'
    })

    expect(result.map(item => [item.locale, item.pageId])).toEqual([
      ['zh', 'database-zh'],
      ['en', 'database-en']
    ])
    expect(fetchNotionPageBlocks.mock.calls.map(call => call[0])).toEqual([
      'database-zh',
      'database-en'
    ])
    expect(setDataToCache).toHaveBeenCalledWith(
      getGlobalDataCacheKey({ pageId: BLOG.NOTION_PAGE_ID, locale: 'zh' }),
      result[0].data
    )
    expect(setDataToCache).toHaveBeenCalledWith(
      getGlobalDataCacheKey({ pageId: BLOG.NOTION_PAGE_ID, locale: 'en' }),
      result[1].data
    )
  })

  test('leaves normal multilingual locale selection and cached block reads unchanged', async () => {
    BLOG.NOTION_PAGE_ID = 'zh:database-zh,en:database-en'

    const data = await fetchGlobalAllData({
      from: 'normal-locale',
      locale: 'en'
    })

    expect(data.allPages[0].slug).toBe('post-collection-database-en')
    expect(fetchNotionPageBlocks.mock.calls.map(call => call[0])).toEqual([
      'database-zh',
      'database-en'
    ])
    expect(
      fetchNotionPageBlocks.mock.calls.every(call => call.length === 2)
    ).toBe(true)
  })

  test('rejects the whole refresh and preserves fallback caches when any source fails', async () => {
    BLOG.NOTION_PAGE_ID = 'zh:database-zh,en:database-en'
    fetchNotionPageBlocks.mockImplementation(pageId => {
      if (pageId === 'database-en') {
        return Promise.reject(new Error('Notion source failed'))
      }
      return Promise.resolve(sourceMapFor(pageId))
    })

    await expect(
      fetchFreshConfiguredGlobalData({ from: 'fresh-failure' })
    ).rejects.toThrow('Notion source failed')

    expect(setDataToCache).not.toHaveBeenCalled()
    expect(saveFallback).not.toHaveBeenCalled()
  })

  test('fails closed for empty or unusable source data without overwriting fallbacks', async () => {
    fetchNotionPageBlocks.mockResolvedValue(null)

    await expect(fetchFreshConfiguredGlobalData()).rejects.toThrow()

    expect(setDataToCache).not.toHaveBeenCalled()
    expect(saveFallback).not.toHaveBeenCalled()
  })
})
