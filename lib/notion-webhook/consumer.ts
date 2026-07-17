import BLOG from '@/blog.config'
import { getDataFromCache } from '@/lib/cache/cache_manager'
import { siteConfig } from '@/lib/config'
import { fetchFreshConfiguredGlobalData } from '@/lib/db/SiteDataApi'
import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'
import {
  createServerKnowledgeGraphStore,
  refreshServerKnowledgeGraph
} from '@/lib/knowledge-graph/serverRefresh'
import type { RefreshState } from '@/lib/knowledge-graph/refresh'
import {
  ackDirtyPage,
  getDirtyQueueDepth,
  listQuietDirtyPages,
  withDirtyConsumerLock,
  type DirtyConsumerLease
} from './queue'
import {
  planRouteRevalidation,
  type RoutePageMetadata,
  type RoutePlan
} from './routePlan'
import {
  bootstrapRouteSnapshots,
  getRouteSnapshot,
  putRouteSnapshot,
  saveFlattenedRedirect,
  type RouteSnapshot
} from './routeState'

const CONSUMER_BATCH_SIZE = 50
const GRAPH_CLAIM_WINDOW_MS = 60_000
// Notion collection reads can lag behind the webhook event briefly. If the
// source directory is still older than the event, retain the dirty page so the
// next timer run regenerates from a caught-up source instead of caching stale
// HTML again.
const SOURCE_FRESHNESS_TOLERANCE_MS = 30_000
// Leave thirty seconds inside the 240-second lease for final writes and release.
const WORK_START_BUDGET_MS = 210_000

type Clock = () => number

export type ConsumeResult = {
  status: 'empty' | 'busy' | 'processed'
  selected: number
  acknowledged: number
  retained: number
  queueDepth: number
  paths: Array<{ path: string; ok: boolean; error?: string }>
  elapsedMs: number
}

type FreshConfiguredData = Awaited<
  ReturnType<typeof fetchFreshConfiguredGlobalData>
>

type PlannedPage = {
  pageId: string
  score: number
  plan: RoutePlan
  preliminaryOk: boolean
}

type PathOperation = (path: string) => Promise<void>

export async function consumeDirtyPages({
  revalidate,
  warmPath = () => Promise.resolve(),
  now = () => Date.now()
}: {
  revalidate: PathOperation
  warmPath?: PathOperation
  now?: Clock
}): Promise<ConsumeResult> {
  const startedAt = now()
  const lockResult = await withDirtyConsumerLock(async lease => {
    lease.assertOwned()
    const selected = await listQuietDirtyPages(startedAt, CONSUMER_BATCH_SIZE)
    lease.assertOwned()

    if (selected.length === 0) {
      return result({
        status: 'empty',
        selected: 0,
        acknowledged: 0,
        queueDepth: await getDirtyQueueDepth(),
        paths: [],
        startedAt,
        now
      })
    }

    ensureBudget(startedAt, now, lease)
    const fresh = await fetchFreshConfiguredGlobalData()
    lease.assertOwned()
    const directory = buildDirectory(fresh)
    const planned: PlannedPage[] = []

    for (const dirty of selected) {
      if (!canStartWork(startedAt, now, lease)) break
      const oldSnapshot = await getRouteSnapshot(dirty.pageId)
      lease.assertOwned()
      const newPage = directory.byId.get(dirty.pageId) || null
      if (!isSourceFreshForDirtyEvent(newPage, dirty.score)) {
        console.warn('[notion-webhook] source directory is stale; retaining dirty page', {
          pageId: dirty.pageId,
          eventAt: dirty.score,
          sourceLastEditedAt: newPage?.lastEditedDate
        })
        continue
      }
      const routeLocale = newPage?.locale || oldSnapshot?.locale || BLOG.LANG
      const plan = planRouteRevalidation({
        selectedQueueScore: dirty.score,
        oldSnapshot,
        newPage,
        publicDirectory: directory.pages,
        postsPerPage:
          directory.postsPerPageByLocale.get(routeLocale) ||
          positiveInteger(BLOG.POSTS_PER_PAGE, 12),
        defaultLocale: BLOG.LANG,
        configuredLocales: directory.locales
      })
      planned.push({
        pageId: dirty.pageId,
        score: dirty.score,
        plan,
        preliminaryOk: true
      })
    }

    for (const item of planned) {
      if (!canStartWork(startedAt, now, lease)) {
        item.preliminaryOk = false
        continue
      }
      try {
        if (item.plan.redirect) {
          await saveFlattenedRedirect(
            item.plan.redirect.locale,
            item.plan.redirect.from,
            item.plan.redirect.to
          )
          lease.assertOwned()
        }
        if (item.plan.becamePrivate && item.plan.nextSnapshot) {
          await putRouteSnapshot(item.plan.nextSnapshot)
          lease.assertOwned()
        }
      } catch {
        item.preliminaryOk = false
      }
    }

    const allPaths = Array.from(
      new Set(
        planned
          .filter(item => item.preliminaryOk)
          .flatMap(item => item.plan.paths)
      )
    ).sort()
    const pathResults = new Map<
      string,
      { path: string; ok: boolean; error?: string }
    >()
    for (const path of allPaths) {
      if (!canStartWork(startedAt, now, lease)) {
        pathResults.set(path, {
          path,
          ok: false,
          error: 'batch work-start budget exhausted'
        })
        continue
      }
      try {
        await revalidate(path)
        lease.assertOwned()
        await warmPath(path)
        lease.assertOwned()
        pathResults.set(path, { path, ok: true })
      } catch (error) {
        pathResults.set(path, { path, ok: false, error: errorMessage(error) })
      }
    }

    const graphPages = planned.filter(
      item => item.preliminaryOk && item.plan.refreshGraph
    )
    let graphCompleted = graphPages.length === 0
    if (graphPages.length > 0 && canStartWork(startedAt, now, lease)) {
      try {
        const graphResult = await refreshServerKnowledgeGraph({
          claimWindowMs: GRAPH_CLAIM_WINDOW_MS
        })
        lease.assertOwned()
        if (graphResult.status === 'refreshed') {
          graphCompleted = graphResult.incomplete !== true
        } else {
          const state =
            await createServerKnowledgeGraphStore().getState<RefreshState>()
          lease.assertOwned()
          graphCompleted =
            state?.status === 'success' &&
            graphPages.every(item => state.refreshedAt >= item.score)
        }
      } catch {
        graphCompleted = false
      }
    }

    let acknowledged = 0
    for (const item of planned) {
      const pathsCompleted = item.plan.paths.every(
        path => pathResults.get(path)?.ok === true
      )
      const renderedVersionAvailable =
        pathsCompleted && (await hasRenderedPublicPageVersion(item))
      const pageCompleted =
        item.preliminaryOk &&
        pathsCompleted &&
        renderedVersionAvailable &&
        (!item.plan.refreshGraph || graphCompleted)
      if (!pageCompleted || !canStartWork(startedAt, now, lease)) continue

      try {
        const finalSnapshot = successfulSnapshot(item)
        if (finalSnapshot) {
          await putRouteSnapshot(finalSnapshot)
          lease.assertOwned()
        }
        if (await ackDirtyPage(item.pageId, item.score)) acknowledged++
        lease.assertOwned()
      } catch {
        // Strict writes and compare-delete failures retain the queue member.
      }
    }

    lease.assertOwned()
    return result({
      status: 'processed',
      selected: selected.length,
      acknowledged,
      queueDepth: await getDirtyQueueDepth(),
      paths: Array.from(pathResults.values()),
      startedAt,
      now
    })
  })

  if (lockResult.status === 'busy') {
    // ZCARD is O(1); keep the operational response accurate without scanning
    // or selecting queue members while another consumer owns the lease.
    const queueDepth = await getDirtyQueueDepth()
    return result({
      status: 'busy',
      selected: 0,
      acknowledged: 0,
      queueDepth,
      paths: [],
      startedAt,
      now
    })
  }
  return lockResult.result
}

export async function bootstrapRouteState({
  now = () => Date.now()
}: {
  now?: Clock
} = {}): Promise<{ bootstrapped: boolean; snapshots: number }> {
  const bootstrappedAt = now()
  const fresh = await fetchFreshConfiguredGlobalData({
    from: 'notion-webhook-bootstrap'
  })
  const directory = buildDirectory(fresh)
  const snapshots: RouteSnapshot[] = directory.pages
    .filter(page => page.public)
    .map(page => ({ ...page, processedEventAt: bootstrappedAt }))

  const bootstrapped = await bootstrapRouteSnapshots({
    snapshots,
    sourceConfirmed: true,
    bootstrappedAt
  })
  return { bootstrapped, snapshots: snapshots.length }
}

function result({
  status,
  selected,
  acknowledged,
  queueDepth,
  paths,
  startedAt,
  now
}: {
  status: ConsumeResult['status']
  selected: number
  acknowledged: number
  queueDepth: number
  paths: ConsumeResult['paths']
  startedAt: number
  now: Clock
}): ConsumeResult {
  return {
    status,
    selected,
    acknowledged,
    retained: selected - acknowledged,
    queueDepth,
    paths,
    elapsedMs: Math.max(0, now() - startedAt)
  }
}

function canStartWork(
  startedAt: number,
  now: Clock,
  lease: DirtyConsumerLease
): boolean {
  lease.assertOwned()
  return now() - startedAt < WORK_START_BUDGET_MS
}

function ensureBudget(
  startedAt: number,
  now: Clock,
  lease: DirtyConsumerLease
): void {
  if (!canStartWork(startedAt, now, lease)) {
    throw new Error('Notion dirty consumer work-start budget exhausted')
  }
}

function successfulSnapshot(item: PlannedPage): RouteSnapshot | null {
  const next = item.plan.nextSnapshot
  if (!next) return null
  if (!item.plan.becamePrivate) return next

  const final = { ...next, processedEventAt: item.score }
  delete final.pendingEventAt
  return final
}

async function hasRenderedPublicPageVersion(
  item: PlannedPage
): Promise<boolean> {
  const snapshot = successfulSnapshot(item)
  if (!snapshot?.public) return true
  if (snapshot.type !== 'Post' && snapshot.type !== 'Page') return true

  const cacheKey = getPageBlockCacheKey(
    normalizePageId(snapshot.pageId) || snapshot.pageId,
    snapshot.lastEditedDate
  )
  const renderedBlock: unknown = await getDataFromCache(cacheKey, true)
  if (renderedBlock) return true

  console.warn('[notion-webhook] rendered page block is missing; retaining dirty page', {
    pageId: item.pageId,
    eventAt: item.score,
    cacheKey
  })
  return false
}

function getPageBlockCacheKey(id: string, cacheVersion: number): string {
  return `page_block_${id}_${cacheVersion}`
}

function isSourceFreshForDirtyEvent(
  newPage: RoutePageMetadata | null,
  eventScore: number
): boolean {
  if (!newPage) return true
  return newPage.lastEditedDate + SOURCE_FRESHNESS_TOLERANCE_MS >= eventScore
}

function buildDirectory(fresh: FreshConfiguredData): {
  pages: RoutePageMetadata[]
  byId: Map<string, RoutePageMetadata>
  locales: string[]
  postsPerPageByLocale: Map<string, number>
} {
  const pages: RoutePageMetadata[] = []
  const byId = new Map<string, RoutePageMetadata>()
  const locales = new Set<string>([BLOG.LANG])
  const postsPerPageByLocale = new Map<string, number>()

  for (const configured of fresh) {
    const locale = configured.locale || BLOG.LANG
    locales.add(locale)
    postsPerPageByLocale.set(
      locale,
      positiveInteger(
        siteConfig('POSTS_PER_PAGE', 12, configured.data?.NOTION_CONFIG),
        12
      )
    )
    const sourcePages = Array.isArray(configured.data?.allPages)
      ? configured.data.allPages
      : []
    for (const sourcePage of sourcePages) {
      if (
        typeof sourcePage !== 'object' ||
        sourcePage === null ||
        Array.isArray(sourcePage)
      ) {
        continue
      }
      const page = routeMetadata(sourcePage as Record<string, unknown>, locale)
      if (!page) continue
      byId.set(page.pageId, page)
      pages.push(page)
    }
  }

  return {
    pages,
    byId,
    locales: Array.from(locales),
    postsPerPageByLocale
  }
}

function routeMetadata(
  source: Record<string, unknown>,
  locale: string
): RoutePageMetadata | null {
  const pageId = normalizePageId(source?.id)
  if (!pageId || typeof source.slug !== 'string' || !source.slug) return null
  if (source.type !== 'Post' && source.type !== 'Page') return null

  const href =
    typeof source.href === 'string' && source.href.startsWith('/')
      ? source.href
      : source.slug.startsWith('/')
        ? source.slug
        : `/${source.slug}`
  const lastEditedDate = timestamp(source.lastEditedDate)
  if (lastEditedDate === null) return null

  return {
    pageId,
    ...(locale === BLOG.LANG ? {} : { locale }),
    href,
    slug: source.slug,
    public: source.status === 'Published',
    type: source.type,
    status: typeof source.status === 'string' ? source.status : '',
    title: typeof source.title === 'string' ? source.title : '',
    summary:
      typeof source.summary === 'string'
        ? source.summary
        : typeof source.description === 'string'
          ? source.description
          : '',
    categories: strings(source.category ?? source.categories),
    tags: strings(source.tags),
    lastEditedDate
  }
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value.flatMap(item => {
        if (typeof item === 'string') return item ? [item] : []
        if (
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { name?: unknown }).name === 'string'
        ) {
          return [(item as { name: string }).name]
        }
        return []
      })
    )
  )
}

function timestamp(value: unknown): number | null {
  if (value instanceof Date) return finiteTimestamp(value.getTime())
  if (typeof value === 'number') return finiteTimestamp(value)
  if (typeof value !== 'string' || !value.trim()) return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return finiteTimestamp(numeric)
  return finiteTimestamp(Date.parse(value))
}

function finiteTimestamp(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : fallback
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'revalidation failed'
}
