import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'node:crypto'
import BLOG from '@/blog.config'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'
import {
  fetchKnowledgeGraphPageBlocks,
  fetchKnowledgeGraphPageValues
} from '@/lib/knowledge-graph/notionFetch'
import {
  refreshKnowledgeGraph,
  type RefreshState
} from '@/lib/knowledge-graph/refresh'
import { createGraphStore } from '@/lib/knowledge-graph/store'
import { createRedisGraphStore } from '@/lib/knowledge-graph/redisStore'

const DEFAULT_REFRESH_MINUTES = 10

const RESPONSE_HEADERS = {
  'cache-control': 'public, max-age=60, stale-while-revalidate=600',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff'
}
const INITIALIZING_HEADERS = {
  ...RESPONSE_HEADERS,
  'cache-control': 'no-store'
}

const isStale = (
  state: RefreshState | null,
  now: number,
  refreshAfterMs: number
): boolean => {
  if (!state) return true
  return now - state.refreshedAt > refreshAfterMs
}

const logServerError = (error: unknown) => {
  // 不要打印 secrets,只记 message + stack
  const err = error as { message?: string; stack?: string }
  console.error(
    `[knowledge-graph] ${err?.message || 'unknown error'}`,
    err?.stack ? `\n${err.stack}` : ''
  )
}

/**
 * Next.js 标准 API route,用于自建 Docker / Node 部署。
 *
 * EdgeOne 部署仍走 cloud-functions/api/knowledge-graph.ts(不变)。
 *
 * 行为对齐:
 * - 200 + graph:有 graph 且未过期
 * - 202 + initializing:首次启动,无 graph,正在 refresh
 * - 503:Notion 失败 / Redis 失败
 * - 405:非 GET
 *
 * 与 cloud-functions 区别:
 * - 不用 createKnowledgeGraphHandler(它用 Web Request/Response + waitUntil)
 * - refresh fire-and-forget 用 Promise,不是 context.waitUntil
 * - 存储用 Redis(createRedisGraphStore)而不是 EdgeOne Blob
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res
      .status(405)
      .json({ error: 'Method Not Allowed. Use GET.' })
  }

  if (!BLOG.REDIS_URL) {
    return res.status(503).json({
      error:
        'REDIS_URL not configured. Knowledge graph storage requires Redis in self-hosted deployments.'
    })
  }

  let store
  try {
    const blobStore = createRedisGraphStore()
    store = createGraphStore(blobStore, () => Date.now())
  } catch (e) {
    logServerError(e)
    return res.status(503).json({
      error: 'Knowledge graph storage unavailable',
      detail: (e as Error).message
    })
  }

  const refreshAfterMs = DEFAULT_REFRESH_MINUTES * 60_000
  const lang = (() => {
    const raw = req.query.lang
    if (typeof raw === 'string' && raw) return raw
    return 'zh-CN'
  })()

  const buildRefreshDeps = () => ({
    store,
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
        locale: lang
      }),
    fetchNotionPageBlocks: (
      id: string,
      from?: string,
      options?: { cacheVersion?: string | number | Date }
    ) => fetchKnowledgeGraphPageBlocks(id, from, options),
    clock: () => Date.now(),
    createId: () => randomUUID(),
    logError: logServerError
  })

  try {
    // 1) 尝试拿最新发布版本
    const graph = await store.getGraph()

    // 2) state 检查,看是否需要后台刷新
    const state = await store.getState<RefreshState>()
    const stale = isStale(state, Date.now(), refreshAfterMs)

    if (stale) {
      // fire-and-forget 后台刷新(Node 进程长期运行,可接受)
      // 错误由 logError 捕获,不影响当前响应
      refreshKnowledgeGraph(buildRefreshDeps()).catch(logServerError)
    }

    if (!graph) {
      // 首次启动,无 graph,等待一次同步 refresh
      // 这次可能要 10-60s,设 no-store 避免 CDN 缓存
      try {
        const result = await refreshKnowledgeGraph(buildRefreshDeps())
        if (result.status === 'refreshed') {
          for (const [k, v] of Object.entries(RESPONSE_HEADERS)) {
            res.setHeader(k, v)
          }
          return res.status(200).json(result.graph)
        }
      } catch (e) {
        logServerError(e)
        // 即使 refresh 失败,可能 1) 有部分 graph 2) 仅个别页面失败
        const fallback = await store.getGraph()
        if (fallback) {
          for (const [k, v] of Object.entries(RESPONSE_HEADERS)) {
            res.setHeader(k, v)
          }
          return res.status(200).json(fallback)
        }
        return res.status(503).json({
          initializing: true,
          error: 'Knowledge graph is being built, please retry in a few seconds'
        })
      }

      // refresh 跳过但无 graph — 真的还没建好
      for (const [k, v] of Object.entries(INITIALIZING_HEADERS)) {
        res.setHeader(k, v)
      }
      return res.status(202).json({
        status: 'initializing',
        message: 'Knowledge graph is being built, please retry in a few seconds'
      })
    }

    for (const [k, v] of Object.entries(RESPONSE_HEADERS)) {
      res.setHeader(k, v)
    }
    return res.status(200).json(graph)
  } catch (error) {
    logServerError(error)
    return res.status(503).json({
      error: 'Knowledge graph temporarily unavailable'
    })
  }
}
