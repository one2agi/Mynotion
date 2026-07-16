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

type ListOptions = {
  consistency?: 'eventual' | 'strong'
  prefix?: string
}

const publicationPrefix = 'v6/state/graph-publications/'
const publicationKey = (windowStart: number, generationId: string): string =>
  `${publicationPrefix}${String(windowStart).padStart(16, '0')}-${generationId}.json`

class MemoryBlobStore {
  readonly values = new Map<string, unknown>()
  readonly getCalls: Array<{ key: string; options?: ReadOptions }> = []
  readonly listCalls: Array<{ options?: ListOptions }> = []
  readonly setJSONCalls: Array<{
    key: string
    value: unknown
    options?: SetOptions
  }> = []
  readonly deleteCalls: string[] = []
  failNextWrite = false
  failAfterNextMarkerWrite = false
  nextListKeys: string[] | null = null
  deleteBeforeNextGet: string | null = null

  async get(key: string, options?: ReadOptions): Promise<unknown | null> {
    this.getCalls.push(options ? { key, options } : { key })

    if (this.deleteBeforeNextGet === key) {
      this.deleteBeforeNextGet = null
      this.values.delete(key)
      return null
    }

    return this.values.get(key) ?? null
  }

  async list(
    options?: ListOptions
  ): Promise<{ blobs: Array<{ key: string }> }> {
    this.listCalls.push(options ? { options } : {})

    if (this.nextListKeys) {
      const keys = this.nextListKeys
      this.nextListKeys = null
      return { blobs: keys.map(key => ({ key })) }
    }

    return {
      blobs: Array.from(this.values.keys())
        .filter(key => !options?.prefix || key.startsWith(options.prefix))
        .map(key => ({ key }))
    }
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

    if (this.failAfterNextMarkerWrite && key.startsWith(publicationPrefix)) {
      this.failAfterNextMarkerWrite = false
      throw new Error('ambiguous marker response')
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

test('ignores legacy cache entries after the graph extraction contract changes', async () => {
  const blob = new MemoryBlobStore()
  const legacyMarker =
    'v5/state/graph-publications/0000000001200000-generation-old.json'
  blob.values.set('v5/state/refresh.json', { refreshedAt: 1_000 })
  blob.values.set('v5/pages/00000000000000000000000000000001.json', {
    links: ['00000000000000000000000000000002']
  })
  blob.values.set(legacyMarker, {
    graphKey: 'v5/graph/versions/generation-old.json',
    windowStart: 1_200_000
  })
  blob.values.set('v5/graph/versions/generation-old.json', graph)

  const store = createGraphStore(blob, () => 1_000)

  expect(await store.getGraph()).toBeNull()
  expect(await store.getState()).toBeNull()
  expect(
    await store.getPageSnapshot('00000000-0000-0000-0000-000000000001')
  ).toBeNull()
})

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
    'v6/state/refresh.json',
    'v6/pages/00000000000000000000000000000001.json'
  ])
  expect(blob.deleteCalls).toEqual([
    'v6/pages/00000000000000000000000000000001.json'
  ])
  expect(blob.getCalls).toEqual([
    {
      key: 'v6/state/refresh.json',
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'v6/pages/00000000000000000000000000000001.json',
      options: { type: 'json' }
    }
  ])
})

test('publishes a graph version before creating its immutable publication marker', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)
  const windowStart = 1_200_000
  const markerKey = publicationKey(windowStart, 'generation-one')

  await store.putGraph(graph, 'generation-one', windowStart)

  expect(await store.getGraph()).toEqual(graph)
  expect(blob.setJSONCalls).toEqual([
    {
      key: 'v6/graph/versions/generation-one.json',
      value: graph,
      options: { onlyIfNew: true }
    },
    {
      key: markerKey,
      value: {
        graphKey: 'v6/graph/versions/generation-one.json',
        windowStart
      },
      options: { onlyIfNew: true }
    }
  ])
  expect(blob.listCalls).toEqual([
    { options: { consistency: 'strong', prefix: publicationPrefix } }
  ])
  expect(blob.getCalls).toEqual([
    {
      key: markerKey,
      options: { consistency: 'strong', type: 'json' }
    },
    {
      key: 'v6/graph/versions/generation-one.json',
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
      key: 'v6/state/refresh-claims/1200000.json',
      value: { owner: 'worker-a', windowStart: 1_200_000 },
      options: { onlyIfNew: true }
    },
    {
      key: 'v6/state/refresh-claims/1200000.json',
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
    'v6/state/refresh-claims/1200000.json',
    'v6/state/refresh-claims/1800000.json'
  ])
  expect(blob.deleteCalls).toEqual([])
})

test('uses the ten-minute claim window by default and a configured one-minute dirty window', async () => {
  const blob = new MemoryBlobStore()
  let now = Date.UTC(2026, 6, 15, 12, 3, 15)
  const store = createGraphStore(blob, () => now)

  expect(await store.acquireRefreshClaim('normal')).toEqual({
    owner: 'normal',
    windowStart: Date.UTC(2026, 6, 15, 12, 0)
  })
  expect(await store.acquireRefreshClaim('dirty', 60_000)).toEqual({
    owner: 'dirty',
    windowStart: Date.UTC(2026, 6, 15, 12, 3)
  })
  expect(await store.acquireRefreshClaim('dirty-again', 60_000)).toBeNull()

  now = Date.UTC(2026, 6, 15, 12, 4)

  expect(await store.acquireRefreshClaim('dirty-next-minute', 60_000)).toEqual({
    owner: 'dirty-next-minute',
    windowStart: Date.UTC(2026, 6, 15, 12, 4)
  })
})

test('rejects invalid configured refresh claim windows', async () => {
  const store = createGraphStore(new MemoryBlobStore(), () => 1_000)

  for (const windowMs of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(store.acquireRefreshClaim('worker', windowMs)).rejects.toThrow(
      'Refresh claim window must be a positive safe integer'
    )
  }
})

test('keeps the newer publication when an older adjacent window finishes last', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(replacement, 'generation-new', 1_800_000)
  await store.putGraph(graph, 'generation-old', 1_200_000)

  expect(await store.getGraph()).toEqual(replacement)
})

test('preserves the prior publication when the next graph version write fails', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one', 1_200_000)
  blob.failNextWrite = true

  await expect(
    store.putGraph(replacement, 'generation-two', 1_800_000)
  ).rejects.toThrow('blob write failed')
  expect(await store.getGraph()).toEqual(graph)
  expect(blob.values.has(publicationKey(1_800_000, 'generation-two'))).toBe(
    false
  )
})

test('resolves an ambiguously acknowledged marker only to its completed graph version', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one', 1_200_000)
  blob.failAfterNextMarkerWrite = true

  await expect(
    store.putGraph(replacement, 'generation-two', 1_800_000)
  ).rejects.toThrow('ambiguous marker response')
  expect(blob.values.get(publicationKey(1_800_000, 'generation-two'))).toEqual({
    graphKey: 'v6/graph/versions/generation-two.json',
    windowStart: 1_800_000
  })
  expect(blob.values.get('v6/graph/versions/generation-two.json')).toEqual(
    replacement
  )
  expect(await store.getGraph()).toEqual(replacement)
})

test('retains the two newest publications and only deletes an older marker after it is replaceable', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)

  await store.putGraph(graph, 'generation-one', 1_200_000)
  await store.putGraph(replacement, 'generation-two', 1_800_000)
  await store.putGraph(graph, 'generation-three', 2_400_000)

  await store.cleanupPublications(2)

  expect(blob.values.has(publicationKey(1_200_000, 'generation-one'))).toBe(
    false
  )
  expect(blob.values.has('v6/graph/versions/generation-one.json')).toBe(false)
  expect(blob.values.has(publicationKey(2_400_000, 'generation-three'))).toBe(
    true
  )
  expect(await store.getGraph()).toEqual(graph)
})

test('retries publication discovery when cleanup removes a marker after the list read', async () => {
  const blob = new MemoryBlobStore()
  const store = createGraphStore(blob, () => 1_000)
  const oldMarker = publicationKey(1_200_000, 'generation-old')

  await store.putGraph(graph, 'generation-old', 1_200_000)
  await store.putGraph(replacement, 'generation-new', 1_800_000)
  blob.nextListKeys = [oldMarker]
  blob.deleteBeforeNextGet = oldMarker

  expect(await store.getGraph()).toEqual(replacement)
  expect(blob.listCalls).toHaveLength(2)
})
