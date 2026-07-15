import { randomUUID } from 'node:crypto'
import BLOG from '@/blog.config'
import {
  fetchKnowledgeGraphPageBlocks,
  fetchKnowledgeGraphPageValues
} from './notionFetch'
import { fetchKnowledgeGraphSiteData } from './notionSource'
import { createRedisGraphStore } from './redisStore'
import {
  refreshKnowledgeGraph,
  type RefreshDependencies,
  type RefreshResult
} from './refresh'
import { createGraphStore } from './store'

export type ServerRefreshOptions = {
  locale?: string
  claimWindowMs?: number
}

export function logServerKnowledgeGraphError(_error: unknown): void {
  // External errors can contain request data or credentials. Keep this static.
  console.error('[knowledge-graph] refresh failed')
}

export function createServerKnowledgeGraphStore() {
  return createGraphStore(createRedisGraphStore(), () => Date.now())
}

export function refreshServerKnowledgeGraph(
  options: ServerRefreshOptions
): Promise<RefreshResult> {
  const deps: RefreshDependencies = {
    store: createServerKnowledgeGraphStore(),
    fetchGlobalAllData: () =>
      fetchKnowledgeGraphSiteData({
        pageId: BLOG.NOTION_PAGE_ID,
        notionIndex: Number(BLOG.NOTION_INDEX) || undefined,
        postUrlPrefix: BLOG.POST_URL_PREFIX,
        propertyNames: {
          title: BLOG.NOTION_PROPERTY_NAME?.title,
          slug: BLOG.NOTION_PROPERTY_NAME?.slug,
          type: BLOG.NOTION_PROPERTY_NAME?.type,
          status: BLOG.NOTION_PROPERTY_NAME?.status
        },
        publicationLabels: {
          typePost: BLOG.NOTION_PROPERTY_NAME?.type_post,
          typePage: BLOG.NOTION_PROPERTY_NAME?.type_page,
          statusPublish: BLOG.NOTION_PROPERTY_NAME?.status_publish
        },
        fetchDatabase: (id: string, from: string) =>
          fetchKnowledgeGraphPageBlocks(id, from),
        fetchPageValues: fetchKnowledgeGraphPageValues,
        ...(options.locale === undefined ? {} : { locale: options.locale })
      }),
    fetchNotionPageBlocks: (
      id: string,
      from?: string,
      fetchOptions?: { cacheVersion?: string | number | Date }
    ) => fetchKnowledgeGraphPageBlocks(id, from, fetchOptions),
    clock: () => Date.now(),
    createId: () => randomUUID(),
    logError: logServerKnowledgeGraphError,
    ...(options.claimWindowMs === undefined
      ? {}
      : { claimWindowMs: options.claimWindowMs })
  }

  return refreshKnowledgeGraph(deps)
}
