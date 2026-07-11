import { getStore } from '@edgeone/pages-blob'
import { randomUUID } from 'node:crypto'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'
import { fetchNotionPageBlocks } from '@/lib/db/notion/getPostBlocks'
import {
  refreshKnowledgeGraph,
  type RefreshResult,
  type RefreshState
} from '@/lib/knowledge-graph/refresh'
import { createGraphStore } from '@/lib/knowledge-graph/store'
import type { PublicGraph } from '@/lib/knowledge-graph/types'

const DEFAULT_REFRESH_MINUTES = 10
const DEFAULT_STORE_NAME = 'notionnext-knowledge-graph'
const RESPONSE_HEADERS = {
  'cache-control': 'public, max-age=60, stale-while-revalidate=600',
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff'
}
const INITIALIZING_HEADERS = {
  ...RESPONSE_HEADERS,
  'cache-control': 'no-store'
}

type FunctionEnv = {
  KNOWLEDGE_GRAPH_REFRESH_MINUTES?: string
  KNOWLEDGE_GRAPH_STORE?: string
}

type FunctionContext = {
  request: Request
  env: FunctionEnv
  waitUntil(task: Promise<unknown>): void
}

type EndpointStore = {
  getGraph(): Promise<PublicGraph | null>
  getState<T>(): Promise<T | null>
}

type HandlerDependencies = {
  store: EndpointStore
  refresh(): Promise<RefreshResult>
  clock(): number
  refreshAfterMs: number
  logError(error: unknown): void
}

const json = (body: unknown, status = 200, headers = RESPONSE_HEADERS) =>
  new Response(JSON.stringify(body), {
    status,
    headers
  })

export function createKnowledgeGraphHandler(deps: HandlerDependencies) {
  return async (context: FunctionContext): Promise<Response> => {
    try {
      const graph = await deps.store.getGraph()
      if (!graph) {
        scheduleRefresh(context, deps)
        return json({ status: 'initializing' }, 202, INITIALIZING_HEADERS)
      }

      const state = await deps.store.getState<RefreshState>()
      if (isStale(state, deps.clock(), deps.refreshAfterMs)) {
        scheduleRefresh(context, deps)
      }

      return json(graph)
    } catch (error) {
      deps.logError(error)
      return new Response(null, { status: 503, headers: RESPONSE_HEADERS })
    }
  }
}

export const onRequestGet = async (context: FunctionContext) => {
  const clock = () => Date.now()
  const serverConfig = resolveKnowledgeGraphServerConfig(context.env)
  const store = createGraphStore(getStore(serverConfig.storeName), clock)
  const handler = createKnowledgeGraphHandler({
    store,
    clock,
    refreshAfterMs: serverConfig.refreshMinutes * 60_000,
    refresh: () =>
      refreshKnowledgeGraph({
        store,
        fetchGlobalAllData: () =>
          fetchGlobalAllData({ from: 'knowledge-graph', locale: undefined }),
        fetchNotionPageBlocks,
        clock,
        createId: randomUUID,
        logError: logServerError
      }),
    logError: logServerError
  })

  return handler(context)
}

export function resolveKnowledgeGraphServerConfig(env: FunctionEnv) {
  const storeName = env.KNOWLEDGE_GRAPH_STORE?.trim()

  return {
    refreshMinutes: refreshMinutes(env.KNOWLEDGE_GRAPH_REFRESH_MINUTES),
    storeName: storeName || DEFAULT_STORE_NAME
  }
}

function scheduleRefresh(
  context: FunctionContext,
  deps: HandlerDependencies
): void {
  context.waitUntil(
    deps.refresh().catch(error => {
      deps.logError(error)
    })
  )
}

function isStale(
  state: RefreshState | null,
  now: number,
  refreshAfterMs: number
): boolean {
  return (
    !state ||
    !Number.isFinite(state.refreshedAt) ||
    now - state.refreshedAt >= refreshAfterMs
  )
}

function refreshMinutes(value: string | undefined): number {
  const minutes = Number(value)
  return Number.isFinite(minutes) && minutes > 0
    ? minutes
    : DEFAULT_REFRESH_MINUTES
}

function logServerError(error: unknown): void {
  console.error('[knowledge-graph] server operation failed', error)
}
