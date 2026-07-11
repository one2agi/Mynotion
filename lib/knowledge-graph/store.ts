import { normalizePageId } from './extract'
import type { PageSnapshot, PublicGraph } from './types'

const GRAPH_POINTER_KEY = 'state/graph-pointer.json'
const STATE_KEY = 'state/refresh.json'
const REFRESH_CLAIM_WINDOW_MS = 10 * 60 * 1000

type JsonReadOptions = {
  consistency?: 'eventual' | 'strong'
  type: 'json'
}

type JsonWriteOptions = {
  onlyIfNew?: boolean
}

export interface GraphBlobStore {
  get(key: string, options: JsonReadOptions): Promise<unknown | null>
  setJSON(
    key: string,
    value: unknown,
    options?: JsonWriteOptions
  ): Promise<void>
  delete(key: string): Promise<void>
}

export interface RefreshClaim {
  owner: string
  windowStart: number
}

export interface GraphPointer {
  generationId: string
}

const strongJsonRead = {
  consistency: 'strong',
  type: 'json'
} as const

const jsonRead = { type: 'json' } as const

function pageSnapshotKey(id: string): string {
  const normalizedId = normalizePageId(id)
  if (!normalizedId) {
    throw new TypeError('Page snapshot id must be a valid Notion page ID')
  }

  return `pages/${normalizedId}.json`
}

function graphVersionKey(generationId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(generationId)) {
    throw new TypeError(
      'Graph generation id must contain only letters, numbers, _ or -'
    )
  }

  return `graph/versions/${generationId}.json`
}

function refreshClaimKey(windowStart: number): string {
  return `state/refresh-claims/${windowStart}.json`
}

function isGraphPointer(value: unknown): value is GraphPointer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'generationId' in value &&
    typeof (value as { generationId?: unknown }).generationId === 'string'
  )
}

function isPreconditionFailed(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'PRECONDITION_FAILED'
  )
}

export function createGraphStore(
  blobStore: GraphBlobStore,
  clock: () => number
) {
  return {
    async getGraph(): Promise<PublicGraph | null> {
      const pointer = await blobStore.get(GRAPH_POINTER_KEY, strongJsonRead)
      if (!isGraphPointer(pointer)) return null

      return (await blobStore.get(
        graphVersionKey(pointer.generationId),
        strongJsonRead
      )) as PublicGraph | null
    },

    async putGraph(graph: PublicGraph, generationId: string): Promise<void> {
      await blobStore.setJSON(graphVersionKey(generationId), graph, {
        onlyIfNew: true
      })
      await blobStore.setJSON(GRAPH_POINTER_KEY, { generationId })
    },

    async getState<T>(): Promise<T | null> {
      return (await blobStore.get(STATE_KEY, strongJsonRead)) as T | null
    },

    async putState<T>(state: T): Promise<void> {
      await blobStore.setJSON(STATE_KEY, state)
    },

    async getPageSnapshot(id: string): Promise<PageSnapshot | null> {
      return (await blobStore.get(
        pageSnapshotKey(id),
        jsonRead
      )) as PageSnapshot | null
    },

    async putPageSnapshot(id: string, snapshot: PageSnapshot): Promise<void> {
      await blobStore.setJSON(pageSnapshotKey(id), snapshot)
    },

    async deletePageSnapshot(id: string): Promise<void> {
      await blobStore.delete(pageSnapshotKey(id))
    },

    async acquireRefreshClaim(owner: string): Promise<RefreshClaim | null> {
      const windowStart =
        Math.floor(clock() / REFRESH_CLAIM_WINDOW_MS) * REFRESH_CLAIM_WINDOW_MS
      const claim: RefreshClaim = { owner, windowStart }

      try {
        await blobStore.setJSON(refreshClaimKey(windowStart), claim, {
          onlyIfNew: true
        })
        return claim
      } catch (error) {
        if (isPreconditionFailed(error)) return null
        throw error
      }
    }
  }
}
