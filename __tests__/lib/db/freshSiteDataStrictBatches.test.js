const sourceFixture = require('../../fixtures/notion/knowledge-graph-database.json')

jest.mock('@/blog.config', () => ({
  NOTION_PAGE_ID: 'database-one',
  BUNDLE_ANALYZER: false,
  THEME: 'simple',
  ENABLE_CACHE: true,
  REDIS_URL: 'redis://test',
  isProd: true,
  NEXT_REVALIDATE_SECOND: 300,
  NOTION_PROPERTY_NAME: {}
}))
jest.mock('@/lib/cache/redis_cache', () => ({
  __esModule: true,
  default: {
    getCache: jest.fn(),
    setCacheStrict: jest.fn(),
    delCache: jest.fn()
  },
  redisClient: {}
}))
jest.mock('@/lib/cache/cache_manager', () => {
  const actual = jest.requireActual('@/lib/cache/cache_manager')
  const setDataToCacheStrict = jest.fn()
  return {
    ...actual,
    getOrSetDataWithCache: jest.fn((_key, load) => load()),
    setDataToCacheStrict,
    __mockSetDataToCacheStrict: setDataToCacheStrict
  }
})
jest.mock('@/lib/cache/redis_fallback', () => {
  const saveFallbackStrict = jest.fn()
  return {
    saveFallback: jest.fn(),
    saveFallbackStrict,
    __mockSaveFallbackStrict: saveFallbackStrict
  }
})
jest.mock('@/lib/db/notion/getNotionAPI', () => {
  const getPage = jest.fn()
  const getBlocks = jest.fn()
  return {
    getPage,
    getBlocks,
    getSignedFileUrls: jest.fn(),
    __mockGetPage: getPage,
    __mockGetBlocks: getBlocks
  }
})
jest.mock('p-limit', () => () => fn => fn())
jest.mock('notion-utils', () => ({
  idToUuid: jest.fn(id => id),
  getBlockValue: jest.fn(entry => entry?.value?.value || entry?.value || entry)
}))
jest.mock('@/lib/utils/serverRuntime', () => ({
  deepClone: jest.fn(value => JSON.parse(JSON.stringify(value))),
  delay: jest.fn(() => Promise.resolve())
}))
jest.mock('@/lib/db/notion/getAllPageIds', () =>
  jest.fn(() => ['missing-post'])
)
jest.mock('@/lib/db/notion/getPageProperties', () => ({
  __esModule: true,
  default: jest.fn(),
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
  normalizeNotionMetadata: jest.fn(() => ({
    type: 'collection_view_page',
    collection_id: 'collection-one',
    view_ids: ['view-one']
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

import { fetchFreshConfiguredGlobalData } from '@/lib/db/SiteDataApi'
import { fetchInBatches } from '@/lib/db/notion/getPostBlocks'
import * as notionAPIMock from '@/lib/db/notion/getNotionAPI'
import * as cacheManagerMock from '@/lib/cache/cache_manager'
import * as fallbackMock from '@/lib/cache/redis_fallback'

const getPage = notionAPIMock.__mockGetPage
const getBlocks = notionAPIMock.__mockGetBlocks
const setDataToCacheStrict = cacheManagerMock.__mockSetDataToCacheStrict
const saveFallbackStrict = fallbackMock.__mockSaveFallbackStrict

describe('fresh metadata strict batch boundary', () => {
  beforeEach(() => {
    getPage.mockReset()
    getBlocks.mockReset()
    setDataToCacheStrict.mockReset()
    saveFallbackStrict.mockReset()

    const rootMap = sourceFixture.recordMap
    getPage.mockResolvedValue({
      ...rootMap,
      block: {
        [sourceFixture.databaseId]:
          rootMap.block['00000000000000000000000000000010']
      },
      collection_query: {},
      collection_view: {}
    })
    getBlocks.mockRejectedValue(new Error('Notion getBlocks batch unavailable'))
  })

  test('propagates a failed missing-block batch without caching a partial directory', async () => {
    await expect(fetchFreshConfiguredGlobalData()).rejects.toThrow(
      'Notion getBlocks batch unavailable'
    )

    expect(getPage).toHaveBeenCalledTimes(1)
    expect(getBlocks).toHaveBeenCalledTimes(1)
    expect(setDataToCacheStrict).not.toHaveBeenCalled()
    expect(saveFallbackStrict).not.toHaveBeenCalled()
  })

  test('preserves the normal batch helper partial-result behavior', async () => {
    await expect(fetchInBatches(['missing-post'])).resolves.toEqual({})
  })
})
