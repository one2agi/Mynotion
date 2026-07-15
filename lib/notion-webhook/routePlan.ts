import type { RouteSnapshot } from './routeState'

export type RoutePageMetadata = Omit<
  RouteSnapshot,
  'processedEventAt' | 'pendingEventAt'
>

export type RoutePlanInput = {
  selectedQueueScore: number
  oldSnapshot: RouteSnapshot | null
  newPage: RoutePageMetadata | null
  publicDirectory: RoutePageMetadata[]
  postsPerPage: number
  defaultLocale: string
  configuredLocales: string[]
}

export type RouteRedirect = {
  from: string
  to: string
  permanent: true
  locale?: string
}

export type RoutePlan = {
  paths: string[]
  nextSnapshot: RouteSnapshot | null
  redirect: RouteRedirect | null
  refreshGraph: boolean
  becamePrivate: boolean
}

type RouteRecord = RoutePageMetadata | RouteSnapshot
type TaxonomyKind = 'category' | 'tag'
type PlannerContext = {
  paths: Set<string>
  locale: string
  defaultLocale: string
  postsPerPage: number
  publicPosts: RoutePageMetadata[]
}

const emptyPlan = (nextSnapshot: RouteSnapshot | null): RoutePlan => ({
  paths: [],
  nextSnapshot,
  redirect: null,
  refreshGraph: false,
  becamePrivate: false
})

const uniqueValues = (values: string[]): string[] =>
  Array.from(new Set(values)).sort()

const sameValues = (left: string[], right: string[]): boolean => {
  const normalizedLeft = uniqueValues(left)
  const normalizedRight = uniqueValues(right)
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  )
}

const recordLocale = (record: RouteRecord, defaultLocale: string): string =>
  record.locale || defaultLocale

const assertLocale = (
  locale: string,
  defaultLocale: string,
  configuredLocales: Set<string>
): void => {
  if (locale !== defaultLocale && !configuredLocales.has(locale)) {
    throw new Error(`Page locale is not a configured locale: ${locale}`)
  }
}

const localePrefix = (locale: string, defaultLocale: string): string =>
  locale === defaultLocale ? '' : `/${encodeURIComponent(locale)}`

const normalizePath = (path: string): string => {
  const collapsed = path.replace(/\/{2,}/g, '/')
  if (collapsed === '/') return collapsed
  return collapsed.replace(/\/+$/, '') || '/'
}

const withLocale = (
  path: string,
  locale: string,
  defaultLocale: string
): string => normalizePath(`${localePrefix(locale, defaultLocale)}${path}`)

const encodedSegments = (value: string): string =>
  value
    .split('/')
    .map(segment => segment.trim())
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/')

const articlePath = (record: RouteRecord, defaultLocale: string): string => {
  const locale = recordLocale(record, defaultLocale)
  return withLocale(`/${encodedSegments(record.slug)}`, locale, defaultLocale)
}

const canonicalHrefPath = (
  record: RouteRecord,
  defaultLocale: string
): string => {
  const locale = recordLocale(record, defaultLocale)
  return withLocale(`/${encodedSegments(record.href)}`, locale, defaultLocale)
}

const addHomePaths = (context: PlannerContext, postCount: number): void => {
  const { paths, locale, defaultLocale, postsPerPage } = context
  paths.add(withLocale('/', locale, defaultLocale))
  const totalPages = Math.ceil(postCount / postsPerPage)
  for (let page = 2; page <= totalPages; page += 1) {
    paths.add(withLocale(`/page/${page}`, locale, defaultLocale))
  }
}

const addListPaths = (context: PlannerContext, postCount: number): void => {
  const { paths, locale, defaultLocale } = context
  addHomePaths(context, postCount)
  paths.add(withLocale('/archive', locale, defaultLocale))
  paths.add(withLocale('/search', locale, defaultLocale))
}

const addTaxonomyPaths = (
  context: PlannerContext,
  kind: TaxonomyKind,
  value: string,
  postCount: number
): void => {
  const { paths, locale, defaultLocale, postsPerPage } = context
  const base = `/${kind}/${encodeURIComponent(value)}`
  paths.add(withLocale(base, locale, defaultLocale))
  const totalPages = Math.ceil(postCount / postsPerPage)
  if (totalPages > 1) {
    for (let page = 1; page <= totalPages; page += 1) {
      paths.add(withLocale(`${base}/page/${page}`, locale, defaultLocale))
    }
  }
}

const directoryPosts = (
  directory: RoutePageMetadata[],
  locale: string,
  defaultLocale: string
): RoutePageMetadata[] => {
  const unique = new Map<string, RoutePageMetadata>()
  for (const record of directory) {
    if (
      record.public &&
      record.type === 'Post' &&
      recordLocale(record, defaultLocale) === locale
    ) {
      unique.set(record.pageId, record)
    }
  }
  return Array.from(unique.values())
}

const createContext = (
  input: RoutePlanInput,
  paths: Set<string>,
  locale: string
): PlannerContext => ({
  paths,
  locale,
  defaultLocale: input.defaultLocale,
  postsPerPage: input.postsPerPage,
  publicPosts: directoryPosts(
    input.publicDirectory,
    locale,
    input.defaultLocale
  )
})

const knownCount = (
  freshCount: number,
  oldContains: boolean,
  newContains: boolean
): number =>
  Math.max(freshCount, freshCount + Number(oldContains) - Number(newContains))

const taxonomyCount = (
  context: PlannerContext,
  kind: TaxonomyKind,
  value: string,
  oldContains: boolean,
  newContains: boolean
): number => {
  const field = kind === 'category' ? 'categories' : 'tags'
  const freshCount = context.publicPosts.filter(record =>
    new Set(record[field]).has(value)
  ).length
  return knownCount(freshCount, oldContains, newContains)
}

const addAffectedTaxonomies = ({
  context,
  oldRecord,
  newRecord,
  oldWasPublic,
  newIsPublic
}: {
  context: PlannerContext
  oldRecord: RouteSnapshot | null
  newRecord: RoutePageMetadata | null
  oldWasPublic: boolean
  newIsPublic: boolean
}): void => {
  const taxonomies: Array<{
    kind: TaxonomyKind
    oldValues: string[]
    newValues: string[]
  }> = [
    {
      kind: 'category',
      oldValues: oldWasPublic ? oldRecord?.categories || [] : [],
      newValues: newIsPublic ? newRecord?.categories || [] : []
    },
    {
      kind: 'tag',
      oldValues: oldWasPublic ? oldRecord?.tags || [] : [],
      newValues: newIsPublic ? newRecord?.tags || [] : []
    }
  ]

  for (const { kind, oldValues, newValues } of taxonomies) {
    const oldSet = new Set(oldValues)
    const newSet = new Set(newValues)
    for (const value of uniqueValues([
      ...Array.from(oldSet),
      ...Array.from(newSet)
    ])) {
      addTaxonomyPaths(
        context,
        kind,
        value,
        taxonomyCount(
          context,
          kind,
          value,
          oldSet.has(value),
          newSet.has(value)
        )
      )
    }
  }
}

export function planRouteRevalidation(input: RoutePlanInput): RoutePlan {
  if (!Number.isInteger(input.postsPerPage) || input.postsPerPage <= 0) {
    throw new Error('postsPerPage must be a positive integer')
  }
  if (
    !Number.isSafeInteger(input.selectedQueueScore) ||
    input.selectedQueueScore < 0
  ) {
    throw new Error('selectedQueueScore must be a non-negative integer')
  }

  const configuredLocales = new Set(input.configuredLocales)
  configuredLocales.add(input.defaultLocale)
  for (const record of [
    input.oldSnapshot,
    input.newPage,
    ...input.publicDirectory
  ]) {
    if (record) {
      assertLocale(
        recordLocale(record, input.defaultLocale),
        input.defaultLocale,
        configuredLocales
      )
    }
  }

  const pendingPrivate = Boolean(
    input.oldSnapshot &&
    !input.oldSnapshot.public &&
    input.oldSnapshot.pendingEventAt !== undefined &&
    input.oldSnapshot.pendingEventAt <= input.selectedQueueScore &&
    input.oldSnapshot.processedEventAt < input.selectedQueueScore
  )
  if (
    input.oldSnapshot &&
    input.oldSnapshot.processedEventAt >= input.selectedQueueScore &&
    !pendingPrivate
  ) {
    return emptyPlan(input.oldSnapshot)
  }

  const oldWasPublic = Boolean(input.oldSnapshot?.public || pendingPrivate)
  const newIsPublic = Boolean(input.newPage?.public)
  if (!oldWasPublic && !newIsPublic) return emptyPlan(null)

  const oldLocale = input.oldSnapshot
    ? recordLocale(input.oldSnapshot, input.defaultLocale)
    : null
  const newLocale = input.newPage
    ? recordLocale(input.newPage, input.defaultLocale)
    : null
  const locale = newLocale || oldLocale!
  const paths = new Set<string>()
  const context = createContext(input, paths, locale)
  const becamePrivate = oldWasPublic && !newIsPublic
  const becamePublic = !input.oldSnapshot?.public && newIsPublic
  const localeChanged = Boolean(
    oldWasPublic && newIsPublic && oldLocale !== newLocale
  )

  if (oldWasPublic && input.oldSnapshot) {
    paths.add(articlePath(input.oldSnapshot, input.defaultLocale))
  }
  if (newIsPublic && input.newPage) {
    paths.add(articlePath(input.newPage, input.defaultLocale))
  }

  if (localeChanged) {
    const oldContext = createContext(input, paths, oldLocale!)
    const newContext = createContext(input, paths, newLocale!)
    addListPaths(oldContext, oldContext.publicPosts.length + 1)
    addAffectedTaxonomies({
      context: oldContext,
      oldRecord: input.oldSnapshot,
      newRecord: null,
      oldWasPublic: true,
      newIsPublic: false
    })
    addListPaths(newContext, newContext.publicPosts.length)
    addAffectedTaxonomies({
      context: newContext,
      oldRecord: null,
      newRecord: input.newPage,
      oldWasPublic: false,
      newIsPublic: true
    })
  } else if (becamePublic || becamePrivate) {
    const freshCount = context.publicPosts.length
    const oldCount = freshCount + Number(becamePrivate) - Number(becamePublic)
    addListPaths(context, Math.max(freshCount, oldCount))
    addAffectedTaxonomies({
      context,
      oldRecord: input.oldSnapshot,
      newRecord: input.newPage,
      oldWasPublic,
      newIsPublic
    })
  }

  let redirect: RouteRedirect | null = null
  let refreshGraph = becamePublic || becamePrivate

  if (input.oldSnapshot?.public && newIsPublic && input.newPage) {
    const oldArticlePath = articlePath(input.oldSnapshot, input.defaultLocale)
    const newArticlePath = articlePath(input.newPage, input.defaultLocale)
    const slugChanged = oldArticlePath !== newArticlePath
    const titleOrSummaryChanged =
      input.oldSnapshot.title !== input.newPage.title ||
      input.oldSnapshot.summary !== input.newPage.summary
    const taxonomyChanged =
      !sameValues(input.oldSnapshot.categories, input.newPage.categories) ||
      !sameValues(input.oldSnapshot.tags, input.newPage.tags)

    if (!localeChanged && (titleOrSummaryChanged || slugChanged)) {
      addListPaths(context, context.publicPosts.length)
    }
    if (!localeChanged && taxonomyChanged) {
      addAffectedTaxonomies({
        context,
        oldRecord: input.oldSnapshot,
        newRecord: input.newPage,
        oldWasPublic,
        newIsPublic
      })
    }
    if (slugChanged) {
      const oldLocale = recordLocale(input.oldSnapshot, input.defaultLocale)
      redirect = {
        from: canonicalHrefPath(input.oldSnapshot, input.defaultLocale),
        to: canonicalHrefPath(input.newPage, input.defaultLocale),
        permanent: true,
        ...(oldLocale === input.defaultLocale ? {} : { locale: oldLocale })
      }
      refreshGraph = true
    } else if (!titleOrSummaryChanged && !taxonomyChanged) {
      refreshGraph = true
    }
  }

  let nextSnapshot: RouteSnapshot
  if (becamePrivate) {
    nextSnapshot = {
      ...input.oldSnapshot!,
      public: false,
      processedEventAt: input.oldSnapshot!.processedEventAt,
      pendingEventAt: input.selectedQueueScore
    }
  } else {
    nextSnapshot = {
      ...input.newPage!,
      processedEventAt: input.selectedQueueScore
    }
  }

  return {
    paths: Array.from(paths).map(normalizePath).sort(),
    nextSnapshot,
    redirect,
    refreshGraph,
    becamePrivate
  }
}
