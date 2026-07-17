import BLOG from '@/blog.config'
import {
  getOrSetDataWithCache,
  isUsableCacheValue,
  setDataToCacheStrict
} from '../cache/cache_manager'
import { saveFallbackStrict } from '../cache/redis_fallback'
import { getAllCategories } from '@/lib/db/notion/getAllCategories'
import getAllPageIds from '@/lib/db/notion/getAllPageIds'
import { getAllTags } from '@/lib/db/notion/getAllTags'
import { getConfigMapFromConfigPage } from '@/lib/db/notion/getNotionConfig'
import getPageProperties, {
  adjustPageProperties
} from '@/lib/db/notion/getPageProperties'
import {
  fetchInBatches,
  fetchNotionPageBlocks,
  formatNotionBlock
} from '@/lib/db/notion/getPostBlocks'
import { compressImage, mapImgUrl } from '@/lib/db/notion/mapImage'
import { deepClone } from '@/lib/utils'
import { withRetry } from '@/lib/with-retry'
import { idToUuid } from 'notion-utils'
import { siteConfig } from '../config'
import { normalizeNotice } from './notice'
import { extractLangId, extractLangPrefix, getShortId } from '../utils/pageId'
import {
  normalizeNotionMetadata,
  normalizeCollection,
  normalizeSchema,
  normalizePageBlock
} from './notion/normalizeUtil'
import { filterCollectionViewData } from './notion/filterCollectionViewData'
import { fetchPageFromNotion } from './notion/getNotionPost'
import { processPostData } from '../utils/post'
import { adapterNotionBlockMap } from '../utils/notion.util'
import { sortPinnedPostsByLatestUpdate } from '@/lib/utils/pinnedPosts'
import { fetchMembersFromOfficialAPI } from './notion/memberDataSource'
import { EmptyData } from './SiteDataFallback'
import {
  getPublishedTypedPages,
  sortTypedPagesByPublishDate
} from '@/lib/site/typedCollections'
// import pLimit from 'p-limit'

export { getAllTags } from './notion/getAllTags'
export { fetchPageFromNotion as getPost } from './notion/getNotionPost'
export { fetchNotionPageBlocks as getPostBlocks } from './notion/getPostBlocks'
export { EmptyData } from './SiteDataFallback'

/**
 * 获取全站数据；基于 Notion 实现
 * 支持多站点（pageId 逗号分隔）和多语言（locale 前缀）
 */
export async function fetchGlobalAllData({
  pageId = BLOG.NOTION_PAGE_ID,
  from,
  locale
}) {
  if (BLOG.BUNDLE_ANALYZER) {
    return getEmptyData(pageId)
  }

  const cacheKey = getGlobalDataCacheKey({ pageId, locale })
  const cachedData = await getOrSetDataWithCache(cacheKey, async () => {
    const siteIds = pageId?.split(',') || []
    // 关键修复:初始为 null(不是 getEmptyData),失败时 throw 而不是 catch 吞
    // 让上层 cache_manager 走 stale fallback,而不是把空 data 当成功存
    let data = null

    for (let index = 0; index < siteIds.length; index++) {
      const siteId = siteIds[index]
      const id = extractLangId(siteId)
      const prefix = extractLangPrefix(siteId)

      if (index === 0 || locale === prefix) {
        // 用 withRetry 包,3 次重试 + 指数退避(200/400/800ms)
        // 全部失败才 throw,throw 给 cache_manager 走 stale fallback
        data = await fetchSiteDataWithRetry({ pageId: id, from })
      }
    }

    if (!data) {
      throw new Error(
        `[fetchGlobalAllData] All Notion fetch attempts failed for pageId=${pageId}`
      )
    }

    return handleDataBeforeReturn(deepClone(data))
  })

  const data = deepClone(cachedData)
  data.latestPosts = cleanPostSummaries(data.latestPosts)
  data.notice = cleanNoticeForClient(data.notice)
  return data
}

export function getGlobalDataCacheKey({ pageId, locale }) {
  const safePageId = String(pageId || BLOG.NOTION_PAGE_ID).replace(
    /[^a-z0-9,_:-]/gi,
    '_'
  )
  const safeLocale = String(locale || 'default').replace(/[^a-z0-9_-]/gi, '_')
  return `global_data_${safeLocale}_${safePageId}`
}

export function getSiteDataCacheKey(pageId) {
  return `site_${pageId}`
}

async function fetchSiteDataFromSource({ pageId, from, forceSource = false }) {
  const pageRecordMap = forceSource
    ? await fetchNotionPageBlocks(pageId, from, { forceSource: true })
    : await fetchNotionPageBlocks(pageId, from)
  return convertNotionToSiteData(pageId, from, pageRecordMap, {
    strictSource: forceSource
  })
}

function fetchSiteDataWithRetry({ pageId, from, forceSource = false }) {
  if (forceSource) {
    return fetchSiteDataFromSource({ pageId, from, forceSource: true })
  }
  return withRetry(
    () => getSiteDataByPageId({ pageId, from }),
    { retries: 3, baseMs: 200 }
  )
}

async function writeFreshCache(cacheKey, data) {
  if (!isUsableCacheValue(data)) {
    throw new Error(
      `[fetchFreshConfiguredGlobalData] source returned unusable data for key=${cacheKey}`
    )
  }
  await setDataToCacheStrict(cacheKey, data)
  await saveFallbackStrict(cacheKey, data)
}

/**
 * Fetch each configured database through Notion, then update existing caches.
 * No cache is written unless every configured source fetch succeeds.
 * @param {{ from?: string }} options
 * @returns {Promise<Array<{locale?: string, pageId: string, data: Record<string, unknown>}>>}
 */
export async function fetchFreshConfiguredGlobalData({
  from = 'notion-webhook-consumer'
} = {}) {
  const configuredPageId = BLOG.NOTION_PAGE_ID
  const configuredSites = String(configuredPageId || '')
    .split(',')
    .map(siteId => siteId.trim())
    .filter(Boolean)
  if (!configuredSites.length) {
    throw new Error('[fetchFreshConfiguredGlobalData] no database configured')
  }
  const unprefixedCount = configuredSites.filter(
    siteId => !extractLangPrefix(siteId)
  ).length
  if (unprefixedCount > 1) {
    throw new Error(
      '[fetchFreshConfiguredGlobalData] multiple unprefixed databases are ambiguous'
    )
  }

  const fresh = []
  for (const siteId of configuredSites) {
    const pageId = extractLangId(siteId)
    const locale = extractLangPrefix(siteId) || undefined
    const siteData = await fetchSiteDataWithRetry({
      pageId,
      from,
      forceSource: true
    })
    if (!isUsableCacheValue(siteData)) {
      throw new Error(
        `[fetchFreshConfiguredGlobalData] source returned unusable site data for pageId=${pageId}`
      )
    }
    const data = handleDataBeforeReturn(deepClone(siteData))
    if (!isUsableCacheValue(data)) {
      throw new Error(
        `[fetchFreshConfiguredGlobalData] source returned unusable global data for pageId=${pageId}`
      )
    }
    fresh.push({ locale, pageId, siteData, data })
  }

  for (let index = 0; index < fresh.length; index++) {
    const item = fresh[index]
    await writeFreshCache(getSiteDataCacheKey(item.pageId), item.siteData)
    if (item.locale) {
      await writeFreshCache(
        getGlobalDataCacheKey({
          pageId: configuredPageId,
          locale: item.locale
        }),
        item.data
      )
    } else if (BLOG.LANG) {
      await writeFreshCache(
        getGlobalDataCacheKey({
          pageId: configuredPageId,
          locale: BLOG.LANG
        }),
        item.data
      )
    }

    // A locale-less normal read always resolves the first declaration.
    if (index === 0) {
      const defaultKey = getGlobalDataCacheKey({
        pageId: configuredPageId,
        locale: undefined
      })
      await writeFreshCache(defaultKey, item.data)
    }
  }

  return fresh.map(({ locale, pageId, data }) => ({
    ...(locale ? { locale } : {}),
    pageId,
    data
  }))
}

/**
 * 获取指定 Notion collection 数据
 * 带防击穿缓存：同一 pageId 并发时只发一次 API 请求
 */
export async function getSiteDataByPageId({ pageId, from }) {
  // const siteStart = Date.now()

  const cacheKey = getSiteDataCacheKey(pageId)

  const data = await getOrSetDataWithCache(cacheKey,
    async () => {
      return fetchSiteDataFromSource({ pageId, from })
    }

  )
  if (process.env.NODE_ENV === 'development') {
    console.log(
      '[ThemeResolver][site-data]',
      JSON.stringify({
        from,
        pageId,
        notionTheme: data?.NOTION_CONFIG?.THEME || null,
        configTheme: BLOG.THEME,
        cacheEnabled: BLOG.ENABLE_CACHE
      })
    )
  }
  return data

  // const originalPageRecordMap = await promise
  // const siteEnd = Date.now()
  // return convertNotionToSiteData(pageId, from, deepClone(originalPageRecordMap))


}

/**
 * 获取公告 block
 * 拉取后必须经过 adapter + format，否则新格式双层嵌套导致 type undefined
 */
async function getNotice(post) {
  if (!post) return null

  try {
    const rawBlockMap = await fetchNotionPageBlocks(post.id, 'data-notice', {
      cacheVersion: post.lastEditedDate
    })
    const adapted = adapterNotionBlockMap(rawBlockMap)
    post.blockMap = {
      ...adapted,
      block: formatNotionBlock(adapted.block)
    }
  } catch (e) {
    console.warn('[getNotice] fetchNotionPageBlocks failed:', post.id, e)
    post.blockMap = null
  }

  return post
}

const CLIENT_POST_SUMMARY_FIELDS = [
  'id',
  'short_id',
  'title',
  'name',
  'slug',
  'href',
  'target',
  'pageIcon',
  'icon',
  'pageCover',
  'pageCoverThumbnail',
  'date',
  'publishDate',
  'publishDay',
  'lastEditedDate',
  'lastEditedDay',
  'category',
  'tags',
  'tagItems',
  'summary',
  'description',
  'type',
  'status',
  'password',
  'readTime',
  'wordCount',
  'ext'
]

export function cleanPostSummary(post) {
  if (!post || typeof post !== 'object') return post

  const result = {}
  CLIENT_POST_SUMMARY_FIELDS.forEach(field => {
    if (post[field] !== undefined) result[field] = post[field]
  })
  return result
}

export function cleanPostSummaries(posts) {
  if (!Array.isArray(posts)) return posts
  return posts.map(cleanPostSummary)
}

function cleanPostForClient(post) {
  if (!post?.blockMap) return post
  const cleanedPost = cleanBlock(post)
  delete cleanedPost.content
  cleanRecordMapMetadata(cleanedPost.blockMap)
  filterCollectionViewData(cleanedPost.blockMap)
  pruneUnusedCollectionRecords(cleanedPost.blockMap)
  return cleanedPost
}

function cleanNoticeForClient(notice) {
  if (!notice?.blockMap) return notice
  const cleanedNotice = cleanBlock(notice)
  pruneBlockMapToRootPage(cleanedNotice.blockMap, cleanedNotice.id)
  cleanRecordMapMetadata(cleanedNotice.blockMap)
  filterCollectionViewData(cleanedNotice.blockMap)
  pruneUnusedCollectionRecords(cleanedNotice.blockMap)
  return cleanedNotice
}

function pruneBlockMapToRootPage(blockMap, rootId) {
  if (!blockMap?.block) return

  const rootBlockId = rootId || findRootPageBlockId(blockMap.block)
  if (!rootBlockId) return

  const keepIds = new Set([rootBlockId])
  let changed = true
  while (changed) {
    changed = false
    Object.entries(blockMap.block).forEach(([id, entry]) => {
      const block = entry?.value || entry
      if (!keepIds.has(id) && keepIds.has(block?.parent_id)) {
        keepIds.add(id)
        changed = true
      }
    })
  }

  Object.keys(blockMap.block).forEach(id => {
    if (!keepIds.has(id)) delete blockMap.block[id]
  })
}

function findRootPageBlockId(blockRecord) {
  return Object.values(blockRecord)
    .map(entry => entry?.value || entry)
    .find(block => block?.type === 'page' && Array.isArray(block.content))
    ?.id
}

function cleanRecordMapMetadata(blockMap) {
  if (!blockMap) return

  delete blockMap.__version__
  if (blockMap.notion_user && Object.keys(blockMap.notion_user).length === 0) {
    delete blockMap.notion_user
  }

  cleanRecordEntries(blockMap.collection)
  cleanRecordEntries(blockMap.collection_view)
}

function pruneUnusedCollectionRecords(blockMap) {
  if (!blockMap?.block) return

  const collectionIds = new Set()
  const viewIds = new Set()
  Object.values(blockMap.block).forEach(entry => {
    const block = entry?.value || entry
    if (!block || typeof block !== 'object') return
    if (block.collection_id) collectionIds.add(block.collection_id)
    block.view_ids?.forEach(viewId => viewIds.add(viewId))
  })

  pruneRecordByIds(blockMap.collection, collectionIds)
  pruneRecordByIds(blockMap.collection_view, viewIds)
  pruneRecordByIds(blockMap.collection_query, collectionIds)
}

function pruneRecordByIds(record, ids) {
  if (!record || typeof record !== 'object') return
  Object.keys(record).forEach(id => {
    if (!ids.has(id)) delete record[id]
  })
}

function cleanRecordEntries(record) {
  if (!record || typeof record !== 'object') return

  Object.values(record).forEach(entry => {
    const value = entry?.value || entry
    if (!value || typeof value !== 'object') return

    delete value.version
    delete value.created_by_table
    delete value.created_by_id
    delete value.last_edited_by_table
    delete value.last_edited_by_id
    delete value.space_id
    delete value.parent_table
    delete value.permissions
    delete value.alive
    delete value.role
    delete value.copied_from_pointer
    delete value.copied_from
    delete value.created_time
    delete value.last_edited_time
  })
}

function getEmptyData(pageId) {
  return EmptyData({
    pageId,
    siteInfo: getSiteInfo({}),
    homeBannerImage: BLOG.HOME_BANNER_IMAGE
  })
}

/**
 * 在服务端解析单篇文章的 props
 * 兼容 prefix / slug / suffix 任意组合
 * 只能在 getStaticProps / getServerSideProps 中使用
 */
export async function resolvePostProps({
  prefix,
  slug,
  suffix,
  locale,
  from,
  isPageExplicitlyPrivate,
  allowSourceConfirmedWithoutRouteState = false
}) {
  const segments = [prefix, slug].filter(Boolean)
  if (Array.isArray(suffix)) segments.push(...suffix)
  const fullSlug = segments.join('/')
  const lastSegment = segments.at(-1)
  const source = from || `slug-props-${fullSlug}`
  const taskId = `${fullSlug || lastSegment}-${Date.now()}` // 当前任务唯一标识

  const startTime = Date.now()

  // 拉全站数据
  const step1Start = Date.now()
  const props = await fetchGlobalAllData({ from: source, locale })
  const step1End = Date.now()

  // 工具函数：查找文章
  const findPost = () => {
    if (!props?.allPages) return null
    return (
      // 1. 完整 slug 匹配
      props.allPages.find(p => p && !p.type?.includes('Menu') && p.slug === fullSlug) ||
      // 2. UUID 匹配
      props.allPages.find(p => p?.id === fullSlug) ||
      null
    )
  }

  let post
  let routeStateChecked = false
  // const step2Start = Date.now()
  post = findPost()
  // const step2End = Date.now()

  const isRouteReadable = async (pageId, sourceListsAsPublic = false) => {
    try {
      if (typeof isPageExplicitlyPrivate !== 'function') {
        throw new TypeError('route-state privacy reader is required')
      }
      return !(await isPageExplicitlyPrivate(pageId))
    } catch (e) {
      if (allowSourceConfirmedWithoutRouteState && sourceListsAsPublic) {
        console.warn(
          `[${taskId}] [resolvePostProps] published build fallback without route state`
        )
        return true
      }
      // An unreadable authority cannot safely prove that stale content is
      // still public. Prefer a temporary 404 over exposing a private page.
      console.error(
        `[${taskId}] [resolvePostProps] route state unavailable; failing closed:`,
        pageId,
        e
      )
      return false
    }
  }

  // 3. 最后一段是 UUID，直接拉 Notion
  if (!post && typeof lastSegment === 'string' && /^[a-f0-9-]{32,36}$/i.test(lastSegment)) {
    // fetchPageFromNotion reads the full block map, so consult the publication
    // authority before invoking this UUID compatibility fallback.
    routeStateChecked = true
    if (await isRouteReadable(lastSegment, false)) {
      const step3Start = Date.now()
      try {
        post = await fetchPageFromNotion(lastSegment)
      } catch (e) {
        console.warn(`[${taskId}] [resolvePostProps] fetchPageFromNotion failed:`, lastSegment, e)
      }
      const step3End = Date.now()
    }
  }

  // Route state is the publication authority after a source-confirmed
  // unpublish. Do not let a long-lived metadata/body fallback resurrect it.
  if (post?.id && !routeStateChecked) {
    if (!(await isRouteReadable(post.id, post.status === 'Published'))) {
      post = null
    }
  }

  // 封装 block 拉取 + 适配逻辑
  const ensureBlockMap = async (post) => {
    if (!post?.id || post?.blockMap) return post
    const step4Start = Date.now()
    try {
      const rawBlockMap = await fetchNotionPageBlocks(post.id, source, {
        cacheVersion: post.lastEditedDate
      })
      if (!rawBlockMap?.block || typeof rawBlockMap.block !== 'object') {
        throw new Error('Notion page block map is empty or malformed')
      }
      const adapted = adapterNotionBlockMap(rawBlockMap)
      if (!adapted?.block || typeof adapted.block !== 'object') {
        throw new Error('Adapted Notion page block map is empty or malformed')
      }
      post.blockMap = {
        ...adapted,
        block: formatNotionBlock(adapted.block)
      }
    } catch (e) {
      console.warn(`[${taskId}] [resolvePostProps] fetchNotionPageBlocks failed:`, post.id, e)
      throw new Error(`Unable to load Notion page blocks for ${post.id}`, {
        cause: e
      })
    }
    const step4End = Date.now()
    return post
  }

  if (post) {
    post = await ensureBlockMap(post)
    props.post = post
    // const step5Start = Date.now()
    try {
      await processPostData(props, source)
    } catch (e) {
      console.warn(`[${taskId}] [resolvePostProps] processPostData failed`, e)
    }
    // const step5End = Date.now()
    props.post = cleanPostForClient(props.post)
    props.prev = cleanPostSummary(props.prev)
    props.next = cleanPostSummary(props.next)
    props.recommendPosts = cleanPostSummaries(props.recommendPosts)
  } else {
    props.post = null
  }

  props.latestPosts = cleanPostSummaries(props.latestPosts)
  delete props.allPages
  const endTime = Date.now()

  return props
}
async function convertNotionToSiteData(
  SITE_DATABASE_PAGE_ID,
  from,
  pageRecordMap,
  { strictSource = false } = {}
) {
  const traceId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const overallStart = Date.now()

  if (!pageRecordMap) {
    console.error(`[${traceId}] can't get Notion Data ; pageId:`, SITE_DATABASE_PAGE_ID)
    return {}
  }

  // const stepStart1 = Date.now()
  SITE_DATABASE_PAGE_ID = idToUuid(SITE_DATABASE_PAGE_ID)
  // const stepEnd1 = Date.now()

  // ── 原始 block，格式统一 ──
  const stepStart2 = Date.now()
  let block = adapterNotionBlockMap({ block: pageRecordMap.block || {} }).block
  const stepEnd2 = Date.now()

  // const stepStart3 = Date.now()
  const rawMetadata = normalizeNotionMetadata(block, SITE_DATABASE_PAGE_ID)
  // const stepEnd3 = Date.now()

  if (rawMetadata?.type !== 'collection_view_page' && rawMetadata?.type !== 'collection_view') {
    console.error(`[${traceId}] pageId "${SITE_DATABASE_PAGE_ID}" is not a database`)
    return EmptyData(SITE_DATABASE_PAGE_ID)
  }

  const stepStart4 = Date.now()
  const collectionMap = pageRecordMap.collection || {}
  const inferredCollectionId =
    Object.keys(collectionMap).length === 1 ? Object.keys(collectionMap)[0] : null
  const collectionId = rawMetadata?.collection_id || inferredCollectionId
  const rawCollection =
    collectionMap?.[collectionId] ||
    collectionMap?.[idToUuid(collectionId)] ||
    {}
  const collection = normalizeCollection(rawCollection)
  const collectionQuery = pageRecordMap.collection_query
  const collectionView = pageRecordMap.collection_view
  const schema = normalizeSchema(collection?.schema || {})
  const viewIds = rawMetadata?.view_ids
  const collectionData = []
  const stepEnd4 = Date.now()

  // ── 获取 pageIds ──
  // const stepStart5 = Date.now()
  const pageIds = getAllPageIds(collectionQuery, collectionId, collectionView, viewIds, block)
  // const stepEnd5 = Date.now()

  // ── 找出需要补拉的 block ──
  // const stepStart6 = Date.now()
  const blockIdsNeedFetch = pageIds.filter(id => !normalizePageBlock(block[id]))
  // const limit = pLimit(10)
  // const idsNeedFetch = (
  //   await Promise.all(
  //     blockIdsNeedFetch.map(id =>
  //       limit(async () => {
  //         const cache = await getDataFromCache(`page_block_${id}`)
  //         return cache ? null : id
  //       })
  //     )
  //   )
  // ).filter(Boolean)
  // const stepEnd6 = Date.now()

  // ── 批量补拉 block ──
  const stepStart7 = Date.now()
  if (blockIdsNeedFetch.length > 0) {
    const fetchedBlocks = await fetchInBatches(blockIdsNeedFetch, 30, {
      strict: strictSource
    })
    const adaptedFetchedBlocks = adapterNotionBlockMap({ block: fetchedBlocks }).block
    block = { ...block, ...adaptedFetchedBlocks }
  }
  const stepEnd7 = Date.now()

  // ── 生成 collectionData ──
  const stepStart8 = Date.now()
  for (const id of pageIds) {
    const pageBlock = normalizePageBlock(block[id])
    if (!pageBlock) continue
    // Notion升级后数据发生乱窜，意外读取到其它数据库的列表，这里筛选
    if (pageBlock.parent_id !== collectionId) continue
    const properties = (await getPageProperties(id, pageBlock, schema, null, getTagOptions(schema))) || null
    if (properties) collectionData.push(properties)
  }
  const stepEnd8 = Date.now()

  // ── 站点配置 ──
  const stepStart9 = Date.now()
  const NOTION_CONFIG = (await getConfigMapFromConfigPage(collectionData)) || {}
  if (process.env.NODE_ENV === 'development') {
    console.log(
      '[ThemeResolver][notion-config]',
      JSON.stringify({
        from,
        pageId: SITE_DATABASE_PAGE_ID,
        notionTheme: NOTION_CONFIG?.THEME || null,
        configTheme: BLOG.THEME,
        note: 'If notionTheme exists, it will override configTheme unless URL ?theme is provided.'
      })
    )
  }
  collectionData.forEach(element => adjustPageProperties(element, NOTION_CONFIG))

  const officialMembers = await fetchMembersFromOfficialAPI({
    typeProperty: BLOG.NOTION_PROPERTY_NAME.type,
    statusProperty: BLOG.NOTION_PROPERTY_NAME.status,
    typeValue: BLOG.NOTION_PROPERTY_NAME.type_member,
    statusValue: BLOG.NOTION_PROPERTY_NAME.status_publish
  })
  if (officialMembers.length > 0) {
    const existingMembers = new Set(
      collectionData
        .filter(item => item?.type === 'Member')
        .flatMap(item => [item.id, item.slug].filter(Boolean))
    )
    officialMembers.forEach(member => {
      if (!existingMembers.has(member.id) && !existingMembers.has(member.slug)) {
        collectionData.push(member)
      }
    })
  }

  const siteInfo = getSiteInfo({ collection, block, rawMetadata, NOTION_CONFIG })
  const stepEnd9 = Date.now()

  // ── 筛选有效页面、排序 ──
  // const stepStart10 = Date.now()
  let postCount = 0
  let allPages = collectionData.filter(post => {
    if (post?.type === 'Post' && post.status === 'Published') postCount++
    return post?.slug && (post?.status === 'Invisible' || post?.status === 'Published')
  })
  const sortBy = siteConfig('POSTS_SORT_BY', null, NOTION_CONFIG)
  if (sortBy === 'date') {
    allPages.sort((a, b) => (b?.publishDate ?? 0) - (a?.publishDate ?? 0))
  }

  // 全局置顶：仅当开启 TOP_TAG 时，才对置顶子集做“最新更新时间倒序”重排。
  // 非置顶文章的相对顺序尽量不改变（匹配你确认的 A 行为）。
  const topTag = siteConfig('TOP_TAG', '', NOTION_CONFIG)
  if (topTag) {
    allPages = sortPinnedPostsByLatestUpdate(allPages, topTag)
  }
  // const stepEnd10 = Date.now()

  // ── 其他数据生成 ──
  const stepStart11 = Date.now()
  const notice = await getNotice(collectionData.find(post => post?.type === 'Notice' && post.status === 'Published'))
  const categoryOptions = getAllCategories({ allPages, categoryOptions: getCategoryOptions(schema) })
  const tagSchemaOptions = getTagOptions(schema)
  const tagOptions = getAllTags({ allPages, tagOptions: tagSchemaOptions ?? [], NOTION_CONFIG }) ?? null
  const customNav = getCustomNav({ allPages: collectionData.filter(post => post?.type === 'Page' && post.status === 'Published') })
  const customMenu = getCustomMenu({ collectionData, NOTION_CONFIG })
  const latestPosts = getLatestPosts({
    allPages,
    from,
    latestPostCount: siteConfig('LATEST_POST_COUNT', 6, NOTION_CONFIG)
  })
  const allNavPages = getNavPages({ allPages })
  const allLinkPages = getLinkPages({ allPages })

  // ── 社区数据：Member / Event ──
  const allMembers = getAllMembers({ allPages })
  const allEvents = getAllEvents({ allPages })

  const stepEnd11 = Date.now()
  const overallEnd = Date.now()

  return {
    NOTION_CONFIG,
    notice,
    siteInfo,
    allPages,
    allMembers,
    allEvents,
    allNavPages,
    allLinkPages,
    collection,
    collectionQuery,
    collectionId,
    collectionView,
    viewIds,
    block,
    schema,
    tagOptions,
    categoryOptions,
    rawMetadata,
    customNav,
    customMenu,
    postCount,
    pageIds,
    latestPosts
  }
}

/**
 * 返回给浏览器前端前的数据清理
 * 脱敏、减体积、定时发布处理
 */
function handleDataBeforeReturn(db) {
  delete db.block
  delete db.schema
  delete db.rawMetadata
  delete db.pageIds
  delete db.viewIds
  delete db.collection
  delete db.collectionQuery
  delete db.collectionId
  delete db.collectionView

  if (db?.notice) {
    db.notice = cleanNoticeForClient(db?.notice)
    delete db.notice?.id
  } else {
    // Defensive normalization: prevent `notice: undefined` from breaking
    // Next.js static serialization (Vercel deploys hit this when Notion
    // API failures leave the data shape incomplete).
    db.notice = null
  }
  db.notice = normalizeNotice(db.notice)

  db.categoryOptions = cleanIds(db?.categoryOptions)
  db.customMenu = cleanIds(db?.customMenu)
  db.allNavPages = shortenIds(db?.allNavPages)
  db.allLinkPages = shortenIds(db?.allLinkPages)

  // 先清理 tagOptions，再用清理后的标签集合过滤页面的 tagItems，
  // 避免页面保留对「已被 cleanTagOptions 删除的标签」的引用，导致点击 404
  db.tagOptions = cleanTagOptions(db?.tagOptions)
  db.allNavPages = cleanPages(db?.allNavPages, db.tagOptions)
  db.allLinkPages = cleanPages(db?.allLinkPages, db.tagOptions)
  db.allPages = cleanPages(db.allPages, db.tagOptions)
  db.allMembers = cleanPages(db.allMembers, db.tagOptions)
  db.allEvents = cleanPages(db.allEvents, db.tagOptions)
  db.latestPosts = cleanPostSummaries(cleanPages(db.latestPosts, db.tagOptions))

  // 定时发布：检查发布时间窗口，超出范围的隐藏
  // 仅对 Post/Page 生效，Event 和 Member 不受此限制
  const POST_SCHEDULE_PUBLISH = siteConfig(
    'POST_SCHEDULE_PUBLISH',
    null,
    db.NOTION_CONFIG
  )
  if (POST_SCHEDULE_PUBLISH) {
    db.allPages?.forEach(p => {
      if (p.type === 'Event' || p.type === 'Member') return
      if (!isInRange(p.title, p.date)) {
        p.status = 'Invisible'
      }
    })
  }

  return db
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function cleanPages(allPages, tagOptions) {
  if (!Array.isArray(allPages) || !Array.isArray(tagOptions)) {
    console.warn('Invalid input: allPages and tagOptions should be arrays.')
    return allPages || []
  }
  const validTags = new Set(
    tagOptions
      .map(tag => (typeof tag.name === 'string' ? tag.name : null))
      .filter(Boolean)
  )
  allPages.forEach(page => {
    if (Array.isArray(page.tagItems)) {
      page.tagItems = page.tagItems.filter(
        tagItem => validTags.has(tagItem?.name) && typeof tagItem.name === 'string'
      )
    }
  })
  return allPages
}

function shortenIds(items) {
  if (items && Array.isArray(items)) {
    return items.map(item => {
      const { id, ...rest } = item
      return {
        ...rest,
        short_id: getShortId(id)
      }
    })
  }
  return items
}

function cleanIds(items) {
  if (items && Array.isArray(items)) {
    return items.map(({ id, ...rest }) => rest)
  }
  return items
}

function cleanTagOptions(tagOptions) {
  if (tagOptions && Array.isArray(tagOptions)) {
    return tagOptions
      .filter(tagOption => tagOption.source === 'Published')
      .map(({ id, source, ...rest }) => rest)
  }
  return tagOptions
}

function cleanBlock(item) {
  const post = deepClone(item)
  const pageBlock = post?.blockMap?.block
  if (pageBlock) {
    for (const i in pageBlock) {
      pageBlock[i] = cleanBlock(pageBlock[i])
      delete pageBlock[i]?.role
      delete pageBlock[i]?.value?.version
      delete pageBlock[i]?.value?.created_by_table
      delete pageBlock[i]?.value?.created_by_id
      delete pageBlock[i]?.value?.last_edited_by_table
      delete pageBlock[i]?.value?.last_edited_by_id
      delete pageBlock[i]?.value?.space_id
      delete pageBlock[i]?.value?.created_time
      delete pageBlock[i]?.value?.last_edited_time
      delete pageBlock[i]?.value?.format?.copied_from_pointer
      delete pageBlock[i]?.value?.format?.block_locked_by
      delete pageBlock[i]?.value?.parent_table
      delete pageBlock[i]?.value?.copied_from_pointer
      delete pageBlock[i]?.value?.copied_from
      delete pageBlock[i]?.value?.permissions
      delete pageBlock[i]?.value?.alive
    }
  }
  return post
}

/**
 * 获取最新文章，按最后修改时间倒序
 * 修复：原代码用 Object.create(allPosts) 不是真正的数组副本，改为展开运算符
 */
function getLatestPosts({ allPages, from, latestPostCount }) {
  const allPosts = allPages?.filter(
    page => page.type === 'Post' && page.status === 'Published'
  )
  return [...(allPosts ?? [])]
    .sort((a, b) => {
      const dateA = new Date(a?.lastEditedDate || a?.publishDate)
      const dateB = new Date(b?.lastEditedDate || b?.publishDate)
      return dateB - dateA
    })
    .slice(0, latestPostCount)
}

function getCustomNav({ allPages }) {
  const customNav = []
  if (allPages && allPages.length > 0) {
    allPages.forEach(p => {
      p.to = p.slug
      customNav.push({
        icon: p.icon || null,
        name: p.title || p.name || '',
        href: p.href,
        target: p.target,
        show: true
      })
    })
  }
  return customNav
}

function getCustomMenu({ collectionData, NOTION_CONFIG }) {
  const menuPages = collectionData.filter(
    post =>
      post.status === 'Published' &&
      (post?.type === 'Menu' || post?.type === 'SubMenu')
  )
  const menus = []
  if (menuPages && menuPages.length > 0) {
    menuPages.forEach(e => {
      e.show = true
      if (e.type === 'Menu') {
        menus.push(e)
      } else if (e.type === 'SubMenu') {
        const parentMenu = menus[menus.length - 1]
        if (parentMenu) {
          if (parentMenu.subMenus) {
            parentMenu.subMenus.push(e)
          } else {
            parentMenu.subMenus = [e]
          }
        }
      }
    })
  }
  return menus
}

function getTagOptions(schema) {
  if (!schema) return {}
  const tagSchema = Object.values(schema).find(
    e => e.name === BLOG.NOTION_PROPERTY_NAME.tags
  )
  return tagSchema?.options || []
}

function getCategoryOptions(schema) {
  if (!schema) return {}
  const categorySchema = Object.values(schema).find(
    e => e.name === BLOG.NOTION_PROPERTY_NAME.category
  )
  return categorySchema?.options || []
}

/**
 * 站点信息
 * @param notionPageData
 * @param from
 * @returns {Promise<{title,description,pageCover,icon}>}
 */
function getSiteInfo({ collection, block, rawMetadata, NOTION_CONFIG }) {
  const defaultTitle = NOTION_CONFIG?.TITLE || 'NotionNext BLOG'
  const defaultDescription =
    NOTION_CONFIG?.DESCRIPTION || '这是一个由NotionNext生成的站点'
  const defaultPageCover = NOTION_CONFIG?.HOME_BANNER_IMAGE || '/bg_image.jpg'
  const defaultIcon = NOTION_CONFIG?.AVATAR || '/avatar.svg'
  const defaultLink = NOTION_CONFIG?.LINK || BLOG.LINK

  if (!collection && !block) {
    return {
      title: defaultTitle,
      description: defaultDescription,
      pageCover: defaultPageCover,
      icon: defaultIcon,
      link: defaultLink
    }
  }

  const title = collection?.name?.[0][0] || defaultTitle
  const description = collection?.description
    ? Object.assign(collection).description[0][0]
    : defaultDescription
  // 站点封面优先级：
  // 1. 数据库 collection.cover
  // 2. 数据库页面（collection_view_page）自身的 page_cover
  // 3. HOME_BANNER_IMAGE / 默认兜底图
  const pageCover = collection?.cover
    ? mapImgUrl(collection?.cover, collection, 'collection')
    : rawMetadata?.format?.page_cover
      ? mapImgUrl(rawMetadata?.format?.page_cover, rawMetadata, 'block')
      : defaultPageCover

  let icon = compressImage(
    collection?.icon
      ? mapImgUrl(collection?.icon, collection, 'collection')
      : defaultIcon
  )
  const link = NOTION_CONFIG?.LINK || defaultLink
  const emojiPattern = /\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDE4F]/g
  if (!icon || emojiPattern.test(icon)) icon = defaultIcon

  return { title, description, pageCover, icon, link }
}

function isInRange(title, date = {}) {
  const {
    start_date,
    start_time = '00:00',
    end_date,
    end_time = '23:59',
    time_zone = 'Asia/Shanghai'
  } = date

  const currentTimestamp = Date.now()
  const startTimestamp = getTimestamp(start_date, start_time, time_zone)
  const endTimestamp = getTimestamp(end_date, end_time, time_zone)

  if (startTimestamp && currentTimestamp < startTimestamp) return false
  if (endTimestamp && currentTimestamp > endTimestamp) return false
  return true
}

function convertToUTC(dateStr, timeZone = 'Asia/Shanghai') {
  const timeZoneOffsets = {
    UTC: 0, 'Etc/GMT': 0, 'Etc/GMT+0': 0,
    'Asia/Shanghai': 8, 'Asia/Taipei': 8, 'Asia/Tokyo': 9, 'Asia/Seoul': 9,
    'Asia/Kolkata': 5.5, 'Asia/Jakarta': 7, 'Asia/Singapore': 8,
    'Asia/Hong_Kong': 8, 'Asia/Bangkok': 7, 'Asia/Dubai': 4,
    'Asia/Tehran': 3.5, 'Asia/Riyadh': 3,
    'Europe/London': 0, 'Europe/Paris': 1, 'Europe/Berlin': 1,
    'Europe/Moscow': 3, 'Europe/Amsterdam': 1,
    'America/New_York': -5, 'America/Chicago': -6, 'America/Denver': -7,
    'America/Los_Angeles': -8, 'America/Sao_Paulo': -3,
    'America/Argentina/Buenos_Aires': -3,
    'Africa/Johannesburg': 2, 'Africa/Cairo': 2, 'Africa/Nairobi': 3,
    'Australia/Sydney': 10, 'Australia/Perth': 8,
    'Pacific/Auckland': 13, 'Pacific/Fiji': 12,
    'Antarctica/Palmer': -3, 'Antarctica/McMurdo': 13
  }
  const continentDefaults = {
    Asia: 'Asia/Shanghai', Europe: 'Europe/London', America: 'America/New_York',
    Africa: 'Africa/Cairo', Australia: 'Australia/Sydney',
    Pacific: 'Pacific/Auckland', Antarctica: 'Antarctica/Palmer', UTC: 'UTC'
  }

  let offsetHours = timeZoneOffsets[timeZone]
  if (offsetHours === undefined) {
    const continent = timeZone.split('/')[0]
    const fallbackZone = continentDefaults[continent] || 'UTC'
    offsetHours = timeZoneOffsets[fallbackZone]
    console.warn(
      `Warning: Unsupported time zone "${timeZone}". Using default "${fallbackZone}".`
    )
  }

  const localDate = new Date(`${dateStr.replace(' ', 'T')}Z`)
  if (isNaN(localDate.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`)
  }
  return new Date(localDate.getTime() - offsetHours * 3600 * 1000)
}

function getTimestamp(date, time = '00:00', time_zone) {
  if (!date) return null
  return convertToUTC(`${date} ${time}:00`, time_zone).getTime()
}

export function getNavPages({ allPages }) {
  const allNavPages = allPages?.filter(
    post =>
      post &&
      post?.slug &&
      post?.type === 'Post' &&
      post?.status === 'Published'
  )
  return allNavPages.map(item => ({
    id: item.id,
    title: item.title || '',
    pageCoverThumbnail: item.pageCoverThumbnail || '',
    category: item.category || null,
    tags: item.tags || null,
    summary: item.summary || null,
    slug: item.slug,
    href: item.href,
    pageIcon: item.pageIcon || '',
    lastEditedDate: item.lastEditedDate,
    publishDate: item.publishDate,
    ext: item.ext || {}
  }))
}

/**
 * Notion content links can target both posts and standalone pages. Keep this
 * list separate from allNavPages because themes use allNavPages as a post list.
 */
export function getLinkPages({ allPages }) {
  const allLinkPages = (allPages || []).filter(
    post =>
      post &&
      post?.slug &&
      (post?.type === 'Post' || post?.type === 'Page') &&
      post?.status === 'Published'
  )
  return allLinkPages.map(item => ({
    id: item.id,
    title: item.title || '',
    type: item.type,
    slug: item.slug,
    href: item.href,
    short_id: item.short_id
  }))
}

/**
 * 获取所有已发布的社区成员
 * 从 allPages 中筛选 type=Member && status=Published 的条目
 */
export function getAllMembers({ allPages }) {
  const published = getPublishedTypedPages({ allPages, type: 'Member' })

  // 精简成员数据，只保留前端需要的字段，减少 pageProps 体积
  const slim = published.map(m => ({
    id: m.id || '',
    title: m.title || '',
    type: m.type || 'Member',
    status: m.status || 'Published',
    slug: m.slug || '',
    summary: m.summary || '',
    avatar: m.avatar || '',
    quote: m.quote || '',
    role: m.role || '',
    bio: m.bio || '',
    featured: m.featured || '',
    verified: m.verified || '',
    sortOrder: m.sortOrder ?? null,
    joinedAtText: m.joinedAtText || '',
    pageIcon: m.pageIcon || '',
    pageCoverThumbnail: m.pageCoverThumbnail || '',
    pageCover: m.pageCover || '',
    publishDate: m.publishDate ?? null
  }))

  return slim.sort((a, b) => {
    // Featured 优先
    const aFeatured = Boolean(a.featured)
    const bFeatured = Boolean(b.featured)
    if (aFeatured !== bFeatured) return bFeatured ? 1 : -1
    // Verified 优先
    const aVerified = Boolean(a.verified)
    const bVerified = Boolean(b.verified)
    if (aVerified !== bVerified) return bVerified ? 1 : -1
    // sortOrder 升序
    if (a.sortOrder != null && b.sortOrder != null) return a.sortOrder - b.sortOrder
    // 发布时间倒序
    return (b?.publishDate ?? 0) - (a?.publishDate ?? 0)
  })
}

/**
 * 获取所有已发布的社区活动
 * 从 allPages 中筛选 type=Event && status=Published 的条目
 */
export function getAllEvents({ allPages }) {
  return sortTypedPagesByPublishDate(
    getPublishedTypedPages({ allPages, type: 'Event' })
  )
}
