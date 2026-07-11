import { buildPublicGraph } from './build'
import { extractPageLinks, normalizePageId } from './extract'
import type { RefreshClaim } from './store'
import type {
  NotionPageValue,
  NotionRecordMap,
  NotionSchema,
  PageSnapshot,
  PageSnapshotMap,
  PublicGraph,
  PublishedPage
} from './types'

const MAX_BLOCK_FETCH_CONCURRENCY = 3

type RefreshSnapshot = PageSnapshot & { lastEditedDate: number }

export interface RefreshState {
  status: 'success'
  refreshedAt: number
  pageIds: string[]
}

interface RefreshStore {
  getState<T>(): Promise<T | null>
  putState<T>(state: T): Promise<void>
  getPageSnapshot(id: string): Promise<PageSnapshot | null>
  putPageSnapshot(id: string, snapshot: PageSnapshot): Promise<void>
  deletePageSnapshot(id: string): Promise<void>
  acquireRefreshClaim(owner: string): Promise<RefreshClaim | null>
  putGraph(
    graph: PublicGraph,
    generationId: string,
    windowStart: number
  ): Promise<void>
  cleanupPublications(retain?: number): Promise<void>
}

interface GlobalPage {
  id?: unknown
  title?: unknown
  slug?: unknown
  icon?: unknown
  pageIcon?: unknown
  type?: unknown
  status?: unknown
  lastEditedDate?: unknown
  properties?: unknown
}

interface GlobalData {
  allPages?: unknown
  schema?: NotionSchema
}

type PageRecordMap = NotionRecordMap & {
  collection?: Record<string, unknown>
}

export interface RefreshDependencies {
  store: RefreshStore
  fetchGlobalAllData(): Promise<GlobalData>
  fetchNotionPageBlocks(
    id: string,
    from?: string,
    options?: { cacheVersion?: string | number | Date }
  ): Promise<PageRecordMap | null>
  clock(): number
  createId(): string
  logError?: (error: unknown) => void
}

export type RefreshResult =
  { status: 'refreshed'; graph: PublicGraph } | { status: 'skipped' }

type RefreshPage = PublishedPage & {
  lastEditedDate: number
  pageValue?: NotionPageValue
}

export async function refreshKnowledgeGraph(
  deps: RefreshDependencies
): Promise<RefreshResult> {
  const claim = await deps.store.acquireRefreshClaim(deps.createId())
  if (!claim) return { status: 'skipped' }

  const globalData = await deps.fetchGlobalAllData()
  const pages = publishedArticles(globalData)
  const priorState = await deps.store.getState<RefreshState>()
  const snapshots: PageSnapshotMap = {}

  await mapWithConcurrency(pages, MAX_BLOCK_FETCH_CONCURRENCY, async page => {
    const prior = asRefreshSnapshot(await deps.store.getPageSnapshot(page.id))

    if (prior?.lastEditedDate === page.lastEditedDate) {
      snapshots[page.id] = prior
      return
    }

    try {
      const recordMap = await deps.fetchNotionPageBlocks(
        page.id,
        'knowledge-graph',
        { cacheVersion: page.lastEditedDate }
      )
      if (!recordMap) throw new Error('Notion returned an empty page')

      const snapshot: RefreshSnapshot = {
        links: extractPageLinks({
          pageValue:
            page.pageValue || pageValueFromRecordMap(recordMap, page.id),
          schema: globalData.schema || schemaFromRecordMap(recordMap),
          recordMap
        }),
        lastEditedDate: page.lastEditedDate
      }
      await deps.store.putPageSnapshot(page.id, snapshot)
      snapshots[page.id] = snapshot
    } catch (error) {
      deps.logError?.(error)
      if (prior) snapshots[page.id] = prior
    }
  })

  const currentIds = new Set(pages.map(page => page.id))
  for (const id of priorState?.pageIds || []) {
    if (!currentIds.has(id)) await deps.store.deletePageSnapshot(id)
  }

  const graph = buildPublicGraph(pages, snapshots)
  await deps.store.putGraph(graph, deps.createId(), claim.windowStart)
  await deps.store.putState<RefreshState>({
    status: 'success',
    refreshedAt: deps.clock(),
    pageIds: pages.map(page => page.id)
  })

  try {
    await deps.store.cleanupPublications(2)
  } catch (error) {
    deps.logError?.(error)
  }

  return { status: 'refreshed', graph }
}

function publishedArticles(data: GlobalData): RefreshPage[] {
  if (!Array.isArray(data.allPages)) {
    throw new TypeError('Global Notion page list is unavailable')
  }

  return data.allPages.flatMap(value => {
    const page = value as GlobalPage
    if (
      page?.status !== 'Published' ||
      page?.type !== 'Post' ||
      typeof page.slug !== 'string' ||
      !page.slug
    ) {
      return []
    }

    const id = normalizePageId(page.id)
    const lastEditedDate = numericDate(page.lastEditedDate)
    if (!id || lastEditedDate === null) {
      throw new TypeError('Published Notion article metadata is invalid')
    }

    const icon = page.pageIcon || page.icon
    return [
      {
        id,
        title: typeof page.title === 'string' ? page.title : '',
        slug: page.slug,
        ...(typeof icon === 'string' && icon ? { icon } : {}),
        lastEditedDate,
        ...(isRecord(page.properties)
          ? { pageValue: { properties: page.properties } }
          : {})
      }
    ]
  })
}

function numericDate(value: unknown): number | null {
  if (value instanceof Date) {
    const timestamp = value.getTime()
    return Number.isFinite(timestamp) ? timestamp : null
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null

  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function asRefreshSnapshot(
  snapshot: PageSnapshot | null
): RefreshSnapshot | null {
  if (!snapshot || !isRecord(snapshot)) return null
  const lastEditedDate = numericDate(
    (snapshot as Record<string, unknown>).lastEditedDate
  )
  return lastEditedDate === null
    ? null
    : { links: snapshot.links || [], lastEditedDate }
}

function pageValueFromRecordMap(
  recordMap: PageRecordMap,
  pageId: string
): NotionPageValue {
  const entry = recordMap.block?.[pageId]
  return (unwrapValue(entry) || {}) as NotionPageValue
}

function schemaFromRecordMap(recordMap: PageRecordMap): NotionSchema {
  for (const entry of Object.values(recordMap.collection || {})) {
    const value = unwrapValue(entry)
    if (isRecord(value?.schema)) return value.schema as NotionSchema
  }
  return {}
}

function unwrapValue(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  let current = value
  while (isRecord(current.value)) current = current.value
  return current
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function mapWithConcurrency<T>(
  values: T[],
  concurrency: number,
  task: (value: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex++]
      if (value !== undefined) await task(value)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker)
  )
}
