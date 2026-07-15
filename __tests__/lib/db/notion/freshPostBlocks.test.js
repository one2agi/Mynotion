const sourceRecordMap =
  require('../../../fixtures/notion/knowledge-graph-database.json').recordMap

jest.mock('@/lib/db/notion/getNotionAPI', () => {
  const getPage = jest.fn()
  return {
    getPage,
    getSignedFileUrls: jest.fn(),
    __mockGetPage: getPage
  }
})
jest.mock('@/lib/cache/cache_manager', () => {
  const getDataFromCache = jest.fn()
  const getOrSetDataWithCache = jest.fn()
  return {
    getDataFromCache,
    getOrSetDataWithCache,
    __mockGetDataFromCache: getDataFromCache,
    __mockGetOrSetDataWithCache: getOrSetDataWithCache
  }
})
jest.mock('p-limit', () => () => fn => fn())
jest.mock('notion-utils', () => ({
  getBlockValue: jest.fn(entry => entry?.value?.value || entry?.value || entry)
}))

import { fetchNotionPageBlocks } from '@/lib/db/notion/getPostBlocks'
import * as notionAPIMock from '@/lib/db/notion/getNotionAPI'
import * as cacheManagerMock from '@/lib/cache/cache_manager'

const getPage = notionAPIMock.__mockGetPage
const getDataFromCache = cacheManagerMock.__mockGetDataFromCache
const getOrSetDataWithCache = cacheManagerMock.__mockGetOrSetDataWithCache

describe('fetchNotionPageBlocks forceSource', () => {
  beforeEach(() => {
    getPage.mockReset()
    getDataFromCache.mockReset()
    getOrSetDataWithCache.mockReset()
  })

  test('leaves normal callers on the existing short-cache path', async () => {
    const cachedRecordMap = { block: { cached: { value: { id: 'cached' } } } }
    getOrSetDataWithCache.mockResolvedValue(cachedRecordMap)

    await expect(
      fetchNotionPageBlocks('database-id', 'normal-test')
    ).resolves.toBe(cachedRecordMap)

    expect(getOrSetDataWithCache).toHaveBeenCalledTimes(1)
    expect(getPage).not.toHaveBeenCalled()
  })

  test('bypasses an existing short cache and reaches the existing Notion transport', async () => {
    const cachedRecordMap = { block: { cached: { value: { id: 'cached' } } } }
    getOrSetDataWithCache.mockResolvedValue(cachedRecordMap)
    getPage.mockResolvedValue(sourceRecordMap)

    await expect(
      fetchNotionPageBlocks('database-id', 'fresh-test', {
        forceSource: true
      })
    ).resolves.toBe(sourceRecordMap)

    expect(getPage).toHaveBeenCalledWith('database-id')
    expect(getOrSetDataWithCache).not.toHaveBeenCalled()
  })

  test('rejects after source retries instead of returning a stale block fallback', async () => {
    const staleRecordMap = { block: { stale: { value: { id: 'stale' } } } }
    getOrSetDataWithCache.mockImplementation((_key, load) => load())
    getDataFromCache.mockResolvedValue(staleRecordMap)
    getPage.mockRejectedValue(new Error('Notion transport unavailable'))

    await expect(
      fetchNotionPageBlocks('database-id', 'fresh-test', {
        forceSource: true
      })
    ).rejects.toThrow('source returned no page data')

    expect(getPage).toHaveBeenCalledTimes(3)
    expect(getDataFromCache).not.toHaveBeenCalled()
  })

  test('rejects an empty source response', async () => {
    getPage.mockResolvedValue(null)

    await expect(
      fetchNotionPageBlocks('database-id', 'fresh-test', {
        forceSource: true
      })
    ).rejects.toThrow('source returned no page data')
  })
})
