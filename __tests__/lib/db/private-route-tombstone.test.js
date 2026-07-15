const publishedPageId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
let listedStatus = 'Published'

const staleSiteData = () => ({
  allPages: [
    {
      id: publishedPageId,
      slug: 'article/stale-post',
      href: '/article/stale-post',
      title: 'Stale published post',
      type: 'Post',
      status: listedStatus,
      tags: [],
      tagItems: [],
      category: [],
      lastEditedDate: 100
    }
  ],
  latestPosts: [],
  notice: null,
  tagOptions: [],
  NOTION_CONFIG: {}
})

jest.mock('@/blog.config', () => ({
  NOTION_PAGE_ID: 'database-id',
  BUNDLE_ANALYZER: false,
  ENABLE_CACHE: true,
  LANG: 'zh-CN',
  NOTION_PROPERTY_NAME: {}
}))

jest.mock('@/lib/cache/cache_manager', () => ({
  getOrSetDataWithCache: jest.fn(() => Promise.resolve(staleSiteData())),
  isUsableCacheValue: jest.fn(value => Boolean(value)),
  setDataToCacheStrict: jest.fn()
}))

jest.mock('@/lib/cache/redis_fallback', () => ({
  saveFallbackStrict: jest.fn()
}))

jest.mock('@/lib/db/notion/getPostBlocks', () => ({
  fetchInBatches: jest.fn(),
  fetchNotionPageBlocks: jest.fn(() => Promise.resolve({ block: {} })),
  formatNotionBlock: jest.fn(block => block)
}))

jest.mock('@/lib/db/notion/getNotionPost', () => ({
  fetchPageFromNotion: jest.fn()
}))

jest.mock('@/lib/db/notion/getAllPageIds', () => jest.fn(() => []))

jest.mock('@/lib/db/notion/getPageProperties', () => ({
  __esModule: true,
  default: jest.fn(),
  adjustPageProperties: jest.fn()
}))

jest.mock('@/lib/db/notion/getNotionConfig', () => ({
  getConfigMapFromConfigPage: jest.fn(() => Promise.resolve({}))
}))

jest.mock('@/lib/db/notion/memberDataSource', () => ({
  fetchMembersFromOfficialAPI: jest.fn(() => Promise.resolve([]))
}))

jest.mock('@/lib/db/notion/normalizeUtil', () => ({
  normalizeNotionMetadata: jest.fn(),
  normalizeCollection: jest.fn(),
  normalizeSchema: jest.fn(),
  normalizePageBlock: jest.fn()
}))

jest.mock('@/lib/utils/notion.util', () => ({
  adapterNotionBlockMap: jest.fn(recordMap => recordMap)
}))

jest.mock('notion-utils', () => ({ idToUuid: jest.fn(id => id) }))

jest.mock('@/lib/notion-webhook/routeState', () => ({
  isExplicitlyPrivate: jest.fn()
}))

import { resolvePostProps } from '@/lib/db/SiteDataApi'
import { fetchNotionPageBlocks } from '@/lib/db/notion/getPostBlocks'
import { fetchPageFromNotion } from '@/lib/db/notion/getNotionPost'
import { isExplicitlyPrivate } from '@/lib/notion-webhook/routeState'

describe('private route tombstone enforcement', () => {
  beforeEach(() => {
    listedStatus = 'Published'
    isExplicitlyPrivate.mockReset()
    fetchNotionPageBlocks.mockClear()
    fetchPageFromNotion.mockClear()
  })

  test('rejects a stale published article when its route snapshot is private', async () => {
    isExplicitlyPrivate.mockResolvedValue(true)

    const props = await resolvePostProps({
      prefix: 'article',
      slug: 'stale-post',
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate
    })

    expect(props.post).toBeNull()
    expect(isExplicitlyPrivate).toHaveBeenCalledWith(publishedPageId)
    expect(fetchNotionPageBlocks).not.toHaveBeenCalled()
  })

  test('keeps a missing route snapshot backward-compatible', async () => {
    isExplicitlyPrivate.mockResolvedValue(false)

    const props = await resolvePostProps({
      prefix: 'article',
      slug: 'stale-post',
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate
    })

    expect(props.post).toMatchObject({ id: publishedPageId })
    expect(fetchNotionPageBlocks).toHaveBeenCalledWith(
      publishedPageId,
      expect.stringContaining('article/stale-post'),
      { cacheVersion: 100 }
    )
  })

  test('fails closed before body fetch when route state is unavailable', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    isExplicitlyPrivate.mockRejectedValue(new Error('redis unavailable'))

    const props = await resolvePostProps({
      prefix: 'article',
      slug: 'stale-post',
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate
    })

    expect(props.post).toBeNull()
    expect(fetchNotionPageBlocks).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('route state unavailable'),
      publishedPageId,
      expect.any(Error)
    )
  })

  test('allows a source-listed public article only during the initial build', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    isExplicitlyPrivate.mockRejectedValue(new Error('redis unavailable'))

    const props = await resolvePostProps({
      prefix: 'article',
      slug: 'stale-post',
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate,
      allowSourceConfirmedWithoutRouteState: true
    })

    expect(props.post).toMatchObject({ id: publishedPageId })
    expect(fetchNotionPageBlocks).toHaveBeenCalledWith(
      publishedPageId,
      expect.stringContaining('article/stale-post'),
      { cacheVersion: 100 }
    )
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('published build fallback')
    )
  })

  test('does not publish a source-listed invisible article during the initial build', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    listedStatus = 'Invisible'
    isExplicitlyPrivate.mockRejectedValue(new Error('redis unavailable'))

    const props = await resolvePostProps({
      prefix: 'article',
      slug: 'stale-post',
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate,
      allowSourceConfirmedWithoutRouteState: true
    })

    expect(props.post).toBeNull()
    expect(fetchNotionPageBlocks).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('route state unavailable'),
      publishedPageId,
      expect.any(Error)
    )
  })

  test('keeps a UUID body fallback closed during a build without route state', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    isExplicitlyPrivate.mockRejectedValue(new Error('redis unavailable'))

    const props = await resolvePostProps({
      prefix: 'article',
      slug: publishedPageId,
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate,
      allowSourceConfirmedWithoutRouteState: true
    })

    expect(props.post).toBeNull()
    expect(fetchPageFromNotion).not.toHaveBeenCalled()
    expect(fetchNotionPageBlocks).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('route state unavailable'),
      publishedPageId,
      expect.any(Error)
    )
  })

  test('checks a UUID tombstone before the direct Notion body fallback', async () => {
    isExplicitlyPrivate.mockResolvedValue(true)

    const props = await resolvePostProps({
      prefix: 'article',
      slug: publishedPageId,
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate
    })

    expect(props.post).toBeNull()
    expect(isExplicitlyPrivate).toHaveBeenCalledWith(publishedPageId)
    expect(fetchPageFromNotion).not.toHaveBeenCalled()
    expect(fetchNotionPageBlocks).not.toHaveBeenCalled()
  })

  test('keeps an active UUID compatibility route readable', async () => {
    isExplicitlyPrivate.mockResolvedValue(false)
    fetchPageFromNotion.mockResolvedValue({
      id: publishedPageId,
      title: 'Active direct page',
      blockMap: { block: {} }
    })

    const props = await resolvePostProps({
      prefix: 'article',
      slug: publishedPageId,
      locale: 'zh-CN',
      isPageExplicitlyPrivate: isExplicitlyPrivate
    })

    expect(props.post).toMatchObject({ id: publishedPageId })
    expect(fetchPageFromNotion).toHaveBeenCalledWith(publishedPageId)
    expect(isExplicitlyPrivate).toHaveBeenCalledTimes(1)
  })
})
