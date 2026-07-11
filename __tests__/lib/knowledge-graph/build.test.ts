import { buildPublicGraph } from '@/lib/knowledge-graph/build'
import { selectGraphNeighborhood } from '@/components/KnowledgeGraph/graphView'
import type {
  GraphEdge,
  GraphNode,
  PageSnapshot,
  PageSnapshotMap,
  PublicGraph,
  PublishedPage
} from '@/lib/knowledge-graph/types'

declare const test: (name: string, callback: () => void) => void
declare const expect: (value: unknown) => {
  toEqual(expected: unknown): void
  not: { toBe(expected: unknown): void }
}

const pageIds = {
  a: '00000000000000000000000000000001',
  b: '00000000000000000000000000000002',
  c: '00000000000000000000000000000003',
  d: '00000000000000000000000000000004',
  isolated: '00000000000000000000000000000005'
}

const pages: PublishedPage[] = [
  { id: pageIds.a, title: 'A', slug: '/a', icon: 'A-icon' },
  { id: pageIds.b, title: 'B', slug: '/b' },
  { id: pageIds.c, title: 'C', slug: '/c' },
  { id: pageIds.d, title: 'D', slug: '/d' }
]

test('exposes graph contracts shared by the builder and its consumers', () => {
  const snapshot: PageSnapshot = { links: [pageIds.b] }
  const snapshots: PageSnapshotMap = {
    [pageIds.a]: snapshot,
    [pageIds.b]: { links: [pageIds.a] }
  }
  const nodes: GraphNode[] = pages.slice(0, 2)
  const edges: GraphEdge[] = [{ source: pageIds.a, target: pageIds.b }]
  const expected: PublicGraph = { nodes, edges }

  expect(buildPublicGraph(nodes, snapshots)).toEqual(expected)
})

test('builds published nodes and deduplicated undirected edges', () => {
  const result = buildPublicGraph(
    [
      ...pages.slice(0, 2),
      { id: pageIds.isolated, title: 'Isolated', slug: '/isolated' }
    ],
    {
      [pageIds.a]: {
        links: [pageIds.b, pageIds.b, pageIds.a, 'draft', 'deleted']
      },
      [pageIds.b]: { links: [pageIds.a, pageIds.b, pageIds.b] },
      [pageIds.isolated]: { links: [] }
    }
  )

  expect(Object.keys(result)).toEqual(['nodes', 'edges'])
  expect(result).toEqual({
    nodes: [
      { id: pageIds.a, title: 'A', slug: '/a', icon: 'A-icon' },
      { id: pageIds.b, title: 'B', slug: '/b' },
      { id: pageIds.isolated, title: 'Isolated', slug: '/isolated' }
    ],
    edges: [{ source: pageIds.a, target: pageIds.b }]
  })
})

test('canonicalizes hyphenated page IDs before resolving normalized links', () => {
  const canonicalSource = '0000000000000000000000000000000a'
  const canonicalTarget = '0000000000000000000000000000000b'
  const publishedPages: PublishedPage[] = [
    {
      id: '00000000-0000-0000-0000-00000000000a',
      title: 'Source',
      slug: '/source'
    },
    {
      id: '00000000-0000-0000-0000-00000000000b',
      title: 'Target',
      slug: '/target'
    }
  ]
  const snapshots: PageSnapshotMap = {
    [canonicalSource]: { links: [canonicalTarget] }
  }
  const pagesBefore = JSON.stringify(publishedPages)
  const snapshotsBefore = JSON.stringify(snapshots)

  expect(buildPublicGraph(publishedPages, snapshots)).toEqual({
    nodes: [
      { id: canonicalSource, title: 'Source', slug: '/source' },
      { id: canonicalTarget, title: 'Target', slug: '/target' }
    ],
    edges: [{ source: canonicalSource, target: canonicalTarget }]
  })
  expect(JSON.stringify(publishedPages)).toEqual(pagesBefore)
  expect(JSON.stringify(snapshots)).toEqual(snapshotsBefore)
})

test('preserves resolved href and deterministically merges canonical node IDs', () => {
  const canonicalId = '0000000000000000000000000000000a'

  expect(
    buildPublicGraph(
      [
        {
          id: '00000000-0000-0000-0000-00000000000a',
          title: 'First configured locale',
          slug: 'first',
          href: '/en/article/first.html'
        },
        {
          id: canonicalId,
          title: 'Duplicate locale',
          slug: 'duplicate',
          href: '/zh/article/duplicate.html'
        },
        {
          id: '00000000-0000-0000-0000-00000000000b',
          title: 'Second',
          slug: 'second',
          href: '/zh/article/second.html'
        }
      ],
      {}
    )
  ).toEqual({
    nodes: [
      {
        id: canonicalId,
        title: 'First configured locale',
        slug: 'first',
        href: '/en/article/first.html'
      },
      {
        id: '0000000000000000000000000000000b',
        title: 'Second',
        slug: 'second',
        href: '/zh/article/second.html'
      }
    ],
    edges: []
  })
})

test('resolves canonical links from hyphenated snapshot keys without mutation', () => {
  const canonicalSource = '0000000000000000000000000000000c'
  const canonicalTarget = '0000000000000000000000000000000d'
  const hyphenatedSource = '00000000-0000-0000-0000-00000000000c'
  const publishedPages: PublishedPage[] = [
    { id: hyphenatedSource, title: 'Source', slug: '/source' },
    {
      id: '00000000-0000-0000-0000-00000000000d',
      title: 'Target',
      slug: '/target'
    }
  ]
  const snapshots: PageSnapshotMap = {
    [hyphenatedSource]: { links: [canonicalTarget] }
  }
  const snapshotsBefore = JSON.stringify(snapshots)

  expect(buildPublicGraph(publishedPages, snapshots)).toEqual({
    nodes: [
      { id: canonicalSource, title: 'Source', slug: '/source' },
      { id: canonicalTarget, title: 'Target', slug: '/target' }
    ],
    edges: [{ source: canonicalSource, target: canonicalTarget }]
  })
  expect(JSON.stringify(snapshots)).toEqual(snapshotsBefore)
})

test('selects a depth-one local neighborhood without mutating the graph', () => {
  const graph = buildPublicGraph(pages, {
    [pageIds.a]: { links: [pageIds.b] },
    [pageIds.b]: { links: [pageIds.c] },
    [pageIds.c]: { links: [pageIds.d] },
    [pageIds.d]: { links: [] }
  })
  const before = JSON.stringify(graph)

  const result = selectGraphNeighborhood(graph, pageIds.a, 1)

  expect(result).toEqual({
    nodes: pages.slice(0, 2),
    edges: [{ source: pageIds.a, target: pageIds.b }]
  })
  expect(JSON.stringify(graph)).toEqual(before)
})

test('selects all nodes through the requested breadth-first depth', () => {
  const graph = buildPublicGraph(pages, {
    [pageIds.a]: { links: [pageIds.b] },
    [pageIds.b]: { links: [pageIds.c] },
    [pageIds.c]: { links: [pageIds.d] },
    [pageIds.d]: { links: [] }
  })

  expect(selectGraphNeighborhood(graph, pageIds.a, 2)).toEqual({
    nodes: pages.slice(0, 3),
    edges: [
      { source: pageIds.a, target: pageIds.b },
      { source: pageIds.b, target: pageIds.c }
    ]
  })
})

test('returns a complete copy when the current node is missing', () => {
  const graph = buildPublicGraph(pages, {
    [pageIds.a]: { links: [pageIds.b] },
    [pageIds.b]: { links: [pageIds.c] },
    [pageIds.c]: { links: [pageIds.d] },
    [pageIds.d]: { links: [] }
  })

  const result = selectGraphNeighborhood(graph, 'missing', 1)

  expect(result).toEqual(graph)
  expect(result).not.toBe(graph)
  expect(result.nodes).not.toBe(graph.nodes)
  expect(result.edges).not.toBe(graph.edges)
})
