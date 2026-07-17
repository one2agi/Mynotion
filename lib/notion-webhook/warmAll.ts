import BLOG from '@/blog.config'
import { fetchFreshConfiguredGlobalData } from '@/lib/db/SiteDataApi'

type PathOperation = (path: string) => Promise<void>

type WarmAllContentPathsOptions = {
  revalidate: PathOperation
  warmPath: PathOperation
  concurrency?: number
}

type WarmAllPathResult = {
  path: string
  ok: boolean
  error?: string
}

export type WarmAllContentPathsResult = {
  selected: number
  warmed: number
  failed: number
  paths: WarmAllPathResult[]
}

export async function warmAllContentPaths({
  revalidate,
  warmPath,
  concurrency = 3
}: WarmAllContentPathsOptions): Promise<WarmAllContentPathsResult> {
  const fresh = await fetchFreshConfiguredGlobalData({
    from: 'revalidate-warm-all'
  })
  const paths = Array.from(
    new Set(
      fresh.flatMap(item =>
        getPublishedContentPaths({
          pages: item.data?.allPages,
          locale: item.locale,
          defaultLocale: BLOG.LANG
        })
      )
    )
  ).sort()

  const results = await mapWithConcurrency(
    paths,
    Math.max(1, Math.trunc(concurrency)),
    async path => {
      try {
        await revalidate(path)
        await warmPath(path)
        return { path, ok: true }
      } catch (error) {
        return { path, ok: false, error: errorMessage(error) }
      }
    }
  )

  return {
    selected: paths.length,
    warmed: results.filter(result => result.ok).length,
    failed: results.filter(result => !result.ok).length,
    paths: results
  }
}

function getPublishedContentPaths({
  pages,
  locale,
  defaultLocale
}: {
  pages: unknown
  locale?: string | undefined
  defaultLocale: string
}): string[] {
  if (!Array.isArray(pages)) return []

  return pages
    .filter(isPublishedContentPage)
    .map(page =>
      withLocale(`/${encodedSegments(page.slug)}`, locale, defaultLocale)
    )
}

function isPublishedContentPage(
  value: unknown
): value is { slug: string; type: string; status: string } {
  if (typeof value !== 'object' || value === null) return false
  const page = value as Partial<{ slug: unknown; type: unknown; status: unknown }>
  return (
    typeof page.slug === 'string' &&
    page.slug.length > 0 &&
    (page.type === 'Post' || page.type === 'Page') &&
    page.status === 'Published'
  )
}

function encodedSegments(value: string): string {
  return value
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')
}

function withLocale(
  path: string,
  locale: string | undefined,
  defaultLocale: string
): string {
  const prefix = locale && locale !== defaultLocale ? `/${encodeURIComponent(locale)}` : ''
  return normalizePath(`${prefix}${path}`)
}

function normalizePath(path: string): string {
  const collapsed = path.replace(/\/{2,}/g, '/')
  if (collapsed === '/') return collapsed
  return collapsed.replace(/\/+$/, '') || '/'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await mapper(item)
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
