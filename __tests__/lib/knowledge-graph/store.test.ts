import { createGraphStore } from '@/lib/knowledge-graph/store'
import type { PageSnapshot, PublicGraph } from '@/lib/knowledge-graph/types'

declare const test: (name: string, callback: () => Promise<void>) => void
declare const expect: any

type ReadOptions = {
  consistency?: 'eventual' | 'strong'
  type?: 'json'
}

type SetOptions = {
  onlyIfNew?: boolean
}

class MemoryBlobStore {
  readonly values = new Map<string, unknown>()
  readonly getCalls: Array<{ key: string; options?: ReadOptions }> = []
  readonly setJSONCalls: Array<{
    key: string
    value: unknown
    options?: SetOptions
  }> = []
  readonly deleteCalls: string[] = []
  failNextWrite = false

  async get(key: string, options?: ReadOptions): Promise<unknown | null> {
    this.getCalls.push(options ? { key, options } : { key })
    return this.values.get(key) ?? null
  }

  async setJSON(
    key: string,
    value: unknown,
    options?: SetOptions
  ): Promise<void> {
    this.setJSONCalls.push(options ? { key, value, options } : { key, value })

    if (this.failNextWrite) {
      this.failNextWrite = false
      throw new Error('blob write failed')
    }

    if (options?.onlyIfNew && this.values.has(key)) {
      throw { code: 'PRECONDITION_FAILED' }
    }

    this.values.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.deleteCalls.push(key)
    this.values.delete(key)
  }
}

const graph: PublicGraph = {
  nodes: [
    { id: '00000000000000000000000000000001', title: 'One', slug: '/one' }
  ],
  edges: []
}

test('stores graph, refresh state, and normalized page snapshots under stable keys', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)
  const snapshot: PageSnapshot = {
    links: ['00000000000000000000000000000002']
  }
  const state = { refreshedAt: 1_000 }

  await store.putGraph(graph)
  await store.putState(state)
  await store.putPageSnapshot('00000000-0000-0000-0000-000000000001', snapshot)

  expect(await store.getGraph()).toEqual(graph)
  expect(await store.getState()).toEqual(state)
  expect(
    await store.getPageSnapshot('00000000-0000-0000-0000-000000000001')
  ).toEqual(snapshot)

  await store.deletePageSnapshot('00000000-0000-0000-0000-000000000001')

  expect(blob.setJSONCalls.map(call => call.key)).toEqual([
    'graph/current.json',
    'state/refresh.json',
    'pages/00000000000000000000000000000001.json'
  ])
  expect(blob.deleteCalls).toEqual([
    'pages/00000000000000000000000000000001.json'
  ])
})

test('uses strongly consistent JSON reads for refresh state and leases', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.getState()
  await store.acquireLease('worker-a', 5_000)
  await store.releaseLease('worker-a')

  expect(blob.getCalls).toEqual([
    {
      key: 'state/refresh.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'state/refresh-lock.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'state/refresh-lock.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'state/refresh-lock.json',
      options: { consistency: 'strong', type: 'json' }
    }
  ])
})

test('creates a lease conditionally and confirms its ownership', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  expect(await store.acquireLease('worker-a', 5_000)).toEqual({
    owner: 'worker-a',
    acquiredAt: 1_000,
    expiresAt: 6_000
  })
  expect(blob.setJSONCalls).toEqual([
    {
      key: 'state/refresh-lock.json',
      value: { owner: 'worker-a', acquiredAt: 1_000, expiresAt: 6_000 },
      options: { onlyIfNew: true }
    }
  ])
})

test('does not let a different owner release an active lease', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.acquireLease('worker-a', 5_000)

  expect(await store.releaseLease('worker-b')).toBe(false)
  expect(blob.deleteCalls).toEqual([])
  expect(await store.releaseLease('worker-a')).toBe(true)
  expect(blob.deleteCalls).toEqual(['state/refresh-lock.json'])
})

test('does not acquire a lease that another active owner holds', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.acquireLease('worker-a', 5_000)

  expect(await store.acquireLease('worker-b', 5_000)).toBeNull()
  expect(blob.deleteCalls).toEqual([])
  expect(blob.setJSONCalls).toHaveLength(1)
})

test('recovers an expired lease by deleting it and retrying one conditional create', async () => {
  const blob = new MemoryBlobStore()
  blob.values.set('state/refresh-lock.json', {
    owner: 'stalled-worker',
    acquiredAt: 0,
    expiresAt: 999
  })
  const store = createGraphStore(blob, () => 1_000)

  expect(await store.acquireLease('worker-a', 5_000)).toEqual({
    owner: 'worker-a',
    acquiredAt: 1_000,
    expiresAt: 6_000
  })
  expect(blob.deleteCalls).toEqual(['state/refresh-lock.json'])
  expect(blob.setJSONCalls).toEqual([
    {
      key: 'state/refresh-lock.json',
      value: { owner: 'worker-a', acquiredAt: 1_000, expiresAt: 6_000 },
      options: { onlyIfNew: true }
    }
  ])
})

test('leaves the last public graph intact when a replacement write fails', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)
  const replacement: PublicGraph = {
    nodes: [
      { id: '00000000000000000000000000000002', title: 'Two', slug: '/two' }
    ],
    edges: []
  }

  await store.putGraph(graph)
  blob.failNextWrite = true

  await expect(store.putGraph(replacement)).rejects.toThrow('blob write failed')
  expect(await store.getGraph()).toEqual(graph)
})
