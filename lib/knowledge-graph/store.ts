import { normalizePageId } from './extract'
import type { PageSnapshot, PublicGraph } from './types'

const CACHE_PREFIX = 'v5/'
const STATE_KEY = `${CACHE_PREFIX}state/refresh.json`
const REFRESH_CLAIM_WINDOW_MS = 10 * 60 * 1000
const PUBLICATION_PREFIX = `${CACHE_PREFIX}state/graph-publications/`
const WINDOW_KEY_WIDTH = 16

type JsonReadOptions = {
  consistency?: 'eventual' | 'strong'
  type: 'json'
}

type JsonWriteOptions = {
  onlyIfNew?: boolean
}

type ListOptions = {
  consistency?: 'eventual' | 'strong'
  prefix?: string
}

export interface GraphBlobStore {
  get(key: string, options: JsonReadOptions): Promise<unknown>
  list(options?: ListOptions): Promise<{ blobs: Array<{ key: string }> }>
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

export interface GraphPublication {
  graphKey: string
  windowStart: number
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

  return `${CACHE_PREFIX}pages/${normalizedId}.json`
}

function validateGenerationId(generationId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(generationId)) {
    throw new TypeError(
      'Graph generation id must contain only letters, numbers, _ or -'
    )
  }
}

function graphVersionKey(generationId: string): string {
  validateGenerationId(generationId)
  return `${CACHE_PREFIX}graph/versions/${generationId}.json`
}

function formatWindowStart(windowStart: number): string {
  if (!Number.isSafeInteger(windowStart) || windowStart < 0) {
    throw new TypeError(
      'Refresh window start must be a non-negative safe integer'
    )
  }

  return String(windowStart).padStart(WINDOW_KEY_WIDTH, '0')
}

function publicationMarkerKey(
  windowStart: number,
  generationId: string
): string {
  validateGenerationId(generationId)
  return `${PUBLICATION_PREFIX}${formatWindowStart(windowStart)}-${generationId}.json`
}

function refreshClaimKey(windowStart: number): string {
  return `${CACHE_PREFIX}state/refresh-claims/${windowStart}.json`
}

function isPublicationMarkerKey(key: string): boolean {
  return new RegExp(
    `^${PUBLICATION_PREFIX}\\d{${WINDOW_KEY_WIDTH}}-[A-Za-z0-9][A-Za-z0-9_-]*\\.json$`
  ).test(key)
}

function isGraphVersionKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    /^v5\/graph\/versions\/[A-Za-z0-9][A-Za-z0-9_-]*\.json$/.test(key)
  )
}

function isGraphPublication(value: unknown): value is GraphPublication {
  if (!value || typeof value !== 'object') return false

  const publication = value as Record<string, unknown>
  return (
    isGraphVersionKey(publication.graphKey) &&
    typeof publication.windowStart === 'number' &&
    Number.isSafeInteger(publication.windowStart) &&
    publication.windowStart >= 0
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
  const listPublicationMarkers = async (): Promise<string[]> => {
    const { blobs } = await blobStore.list({
      consistency: 'strong',
      prefix: PUBLICATION_PREFIX
    })

    return blobs
      .map(blob => blob.key)
      .filter(isPublicationMarkerKey)
      .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
  }

  return {
    async getGraph(): Promise<PublicGraph | null> {
      for (let attempt = 0; attempt < 2; attempt++) {
        const markerKey = (await listPublicationMarkers())[0]
        if (!markerKey) return null

        const publication = await blobStore.get(markerKey, strongJsonRead)
        if (!isGraphPublication(publication)) continue

        const graph = await blobStore.get(publication.graphKey, strongJsonRead)
        if (graph !== null) return graph as PublicGraph
      }

      return null
    },

    async putGraph(
      graph: PublicGraph,
      generationId: string,
      windowStart: number
    ): Promise<void> {
      const graphKey = graphVersionKey(generationId)

      await blobStore.setJSON(graphKey, graph, { onlyIfNew: true })
      await blobStore.setJSON(
        publicationMarkerKey(windowStart, generationId),
        { graphKey, windowStart },
        { onlyIfNew: true }
      )
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
    },

    async cleanupPublications(retain = 2): Promise<void> {
      if (!Number.isSafeInteger(retain) || retain < 1) {
        throw new TypeError(
          'Publication retention must be a positive safe integer'
        )
      }

      const staleMarkerKeys = (await listPublicationMarkers()).slice(retain)

      for (const markerKey of staleMarkerKeys) {
        const publication = await blobStore.get(markerKey, strongJsonRead)
        if (!isGraphPublication(publication)) continue

        await blobStore.delete(markerKey)
        await blobStore.delete(publication.graphKey)
      }
    }
  }
}
