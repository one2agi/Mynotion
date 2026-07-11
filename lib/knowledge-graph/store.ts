import { normalizePageId } from './extract'
import type { PageSnapshot, PublicGraph } from './types'

const GRAPH_KEY = 'graph/current.json'
const STATE_KEY = 'state/refresh.json'
const LEASE_KEY = 'state/refresh-lock.json'

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

export interface RefreshLease {
  owner: string
  acquiredAt: number
  expiresAt: number
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

function isRefreshLease(value: unknown): value is RefreshLease {
  if (!value || typeof value !== 'object') return false

  const lease = value as Record<string, unknown>
  return (
    typeof lease.owner === 'string' &&
    typeof lease.acquiredAt === 'number' &&
    Number.isFinite(lease.acquiredAt) &&
    typeof lease.expiresAt === 'number' &&
    Number.isFinite(lease.expiresAt)
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
  const getLease = async (): Promise<RefreshLease | null> => {
    const lease = await blobStore.get(LEASE_KEY, strongJsonRead)
    return isRefreshLease(lease) ? lease : null
  }

  const createLease = async (
    owner: string,
    acquiredAt: number,
    expiresAt: number
  ): Promise<RefreshLease | null> => {
    const lease: RefreshLease = { owner, acquiredAt, expiresAt }

    try {
      await blobStore.setJSON(LEASE_KEY, lease, { onlyIfNew: true })
    } catch (error) {
      if (isPreconditionFailed(error)) return null
      throw error
    }

    const confirmed = await getLease()
    return confirmed?.owner === owner &&
      confirmed.acquiredAt === acquiredAt &&
      confirmed.expiresAt === expiresAt
      ? confirmed
      : null
  }

  return {
    async getGraph(): Promise<PublicGraph | null> {
      return (await blobStore.get(GRAPH_KEY, jsonRead)) as PublicGraph | null
    },

    async putGraph(graph: PublicGraph): Promise<void> {
      await blobStore.setJSON(GRAPH_KEY, graph)
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

    async acquireLease(
      owner: string,
      durationMs: number
    ): Promise<RefreshLease | null> {
      const acquiredAt = clock()
      const expiresAt = acquiredAt + durationMs
      const existing = await getLease()

      if (existing && existing.expiresAt > acquiredAt) return null

      if (existing) {
        await blobStore.delete(LEASE_KEY)
      }

      return createLease(owner, acquiredAt, expiresAt)
    },

    async releaseLease(owner: string): Promise<boolean> {
      const lease = await getLease()
      if (!lease || lease.owner !== owner) return false

      await blobStore.delete(LEASE_KEY)
      return true
    }
  }
}
