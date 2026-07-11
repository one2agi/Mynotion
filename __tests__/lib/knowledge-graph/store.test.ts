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
  failAfterNextPointerWrite = false

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

    if (this.failAfterNextPointerWrite && key === 'state/graph-pointer.json') {
      this.failAfterNextPointerWrite = false
      throw new Error('ambiguous pointer response')
    }
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

const replacement: PublicGraph = {
  nodes: [
    { id: '00000000000000000000000000000002', title: 'Two', slug: '/two' }
  ],
  edges: []
}

test('stores refresh state and normalized page snapshots under stable private keys', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)
  const snapshot: PageSnapshot = {
    links: ['00000000000000000000000000000002']
  }
  const state = { refreshedAt: 1_000 }

  await store.putState(state)
  await store.putPageSnapshot('00000000-0000-0000-0000-000000000001', snapshot)

  expect(await store.getState()).toEqual(state)
  expect(
    await store.getPageSnapshot('00000000-0000-0000-0000-000000000001')
  ).toEqual(snapshot)

  await store.deletePageSnapshot('00000000-0000-0000-0000-000000000001')

  expect(blob.setJSONCalls.map(call => call.key)).toEqual([
    'state/refresh.json',
    'pages/00000000000000000000000000000001.json'
  ])
  expect(blob.deleteCalls).toEqual([
    'pages/00000000000000000000000000000001.json'
  ])
  expect(blob.getCalls).toEqual([
    {
      key: 'state/refresh.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'pages/00000000000000000000000000000001.json',
      options: { type: 'json' }
    }
  ])
})

test('publishes an immutable graph version before advancing a strong pointer', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one')

  expect(await store.getGraph()).toEqual(graph)
  expect(blob.setJSONCalls).toEqual([
    {
      key: 'graph/versions/generation-one.json',
      value: graph,
      options: { onlyIfNew: true }
    },
    {
      key: 'state/graph-pointer.json',
      value: { generationId: 'generation-one' }
    }
  ])
  expect(blob.getCalls).toEqual([
    {
      key: 'state/graph-pointer.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'graph/versions/generation-one.json',
      options: { consistency: 'strong', type: 'json' }
    }
  ])
})

test('uses strong JSON reads for refresh state and the graph pointer', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.getState()
  await store.getGraph()

  expect(blob.getCalls).toEqual([
    {
      key: 'state/refresh.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'state/graph-pointer.json',
      options: { consistency: 'strong', type: 'json' }
    }
  ])
})

test('allows one immutable refresh claim for concurrent callers in the same window', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_234_567)

  const claims = await Promise.all([
    store.acquireRefreshClaim('worker-a'),
    store.acquireRefreshClaim('worker-b')
  ])

  expect(claims).toEqual([{ owner: 'worker-a', windowStart: 1_200_000 }, null])
  expect(blob.setJSONCalls).toEqual([
    {
      key: 'state/refresh-claims/1200000.json',
      value: { owner: 'worker-a', windowStart: 1_200_000 },
      options: { onlyIfNew: true }
    },
    {
      key: 'state/refresh-claims/1200000.json',
      value: { owner: 'worker-b', windowStart: 1_200_000 },
      options: { onlyIfNew: true }
    }
  ])
  expect(blob.deleteCalls).toEqual([])
})

test('allows a new immutable refresh claim in an adjacent window', async () => {
  const blob = new MemoryBlobStore()
  let now = 1_200_000
  const store = createGraphStore(blob, () => now)

  expect(await store.acquireRefreshClaim('worker-a')).toEqual({
    owner: 'worker-a',
    windowStart: 1_200_000
  })

  now = 1_800_000

  expect(await store.acquireRefreshClaim('worker-b')).toEqual({
    owner: 'worker-b',
    windowStart: 1_800_000
  })
  expect(blob.setJSONCalls.map(call => call.key)).toEqual([
    'state/refresh-claims/1200000.json',
    'state/refresh-claims/1800000.json'
  ])
  expect(blob.deleteCalls).toEqual([])
})

test('preserves the prior graph pointer when the next immutable graph write fails', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one')
  blob.failNextWrite = true

  await expect(store.putGraph(replacement, 'generation-two')).rejects.toThrow(
    'blob write failed'
  )
  expect(await store.getGraph()).toEqual(graph)
  expect(blob.values.get('state/graph-pointer.json')).toEqual({
    generationId: 'generation-one'
  })
  expect(blob.values.has('graph/versions/generation-two.json')).toBe(false)
})

test('resolves an ambiguously acknowledged pointer only to its completed graph version', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one')
  blob.failAfterNextPointerWrite = true

  await expect(store.putGraph(replacement, 'generation-two')).rejects.toThrow(
    'ambiguous pointer response'
  )
  expect(blob.values.get('state/graph-pointer.json')).toEqual({
    generationId: 'generation-two'
  })
  expect(blob.values.get('graph/versions/generation-two.json')).toEqual(
    replacement
  )
  expect(await store.getGraph()).toEqual(replacement)
})
