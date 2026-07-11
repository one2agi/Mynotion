import {
  buildPublicGraph
} from '@/lib/knowledge-graph/build'
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

const pages: PublishedPage[] = [
  { id: 'a', title: 'A', slug: '/a', icon: 'A-icon' },
  { id: 'b', title: 'B', slug: '/b' },
  { id: 'c', title: 'C', slug: '/c' },
  { id: 'd', title: 'D', slug: '/d' }
]

test('exposes graph contracts shared by the builder and its consumers', () => {
  const snapshot: PageSnapshot = { links: ['b'] }
  const snapshots: PageSnapshotMap = {
    a: snapshot,
    b: { links: ['a'] }
  }
  const nodes: GraphNode[] = pages.slice(0, 2)
  const edges: GraphEdge[] = [{ source: 'a', target: 'b' }]
  const expected: PublicGraph = { nodes, edges }

  expect(buildPublicGraph(nodes, snapshots)).toEqual(expected)
})

test('builds published nodes and deduplicated undirected edges', () => {
  const result = buildPublicGraph(
    [
      ...pages.slice(0, 2),
      { id: 'isolated', title: 'Isolated', slug: '/isolated' }
    ],
    {
      a: { links: ['b', 'b', 'a', 'draft', 'deleted'] },
      b: { links: ['a', 'b', 'b'] },
      isolated: { links: [] }
    }
  )

  expect(Object.keys(result)).toEqual(['nodes', 'edges'])
  expect(result).toEqual({
    nodes: [
      { id: 'a', title: 'A', slug: '/a', icon: 'A-icon' },
      { id: 'b', title: 'B', slug: '/b' },
      { id: 'isolated', title: 'Isolated', slug: '/isolated' }
    ],
    edges: [{ source: 'a', target: 'b' }]
  })
})

test('selects a depth-one local neighborhood without mutating the graph', () => {
  const graph = buildPublicGraph(pages, {
    a: { links: ['b'] },
    b: { links: ['c'] },
    c: { links: ['d'] },
    d: { links: [] }
  })
  const before = JSON.stringify(graph)

  const result = selectGraphNeighborhood(graph, 'a', 1)

  expect(result).toEqual({
    nodes: pages.slice(0, 2),
    edges: [{ source: 'a', target: 'b' }]
  })
  expect(JSON.stringify(graph)).toEqual(before)
})

test('selects all nodes through the requested breadth-first depth', () => {
  const graph = buildPublicGraph(pages, {
    a: { links: ['b'] },
    b: { links: ['c'] },
    c: { links: ['d'] },
    d: { links: [] }
  })

  expect(selectGraphNeighborhood(graph, 'a', 2)).toEqual({
    nodes: pages.slice(0, 3),
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' }
    ]
  })
})

test('returns a complete copy when the current node is missing', () => {
  const graph = buildPublicGraph(pages, {
    a: { links: ['b'] },
    b: { links: ['c'] },
    c: { links: ['d'] },
    d: { links: [] }
  })

  const result = selectGraphNeighborhood(graph, 'missing', 1)

  expect(result).toEqual(graph)
  expect(result).not.toBe(graph)
  expect(result.nodes).not.toBe(graph.nodes)
  expect(result.edges).not.toBe(graph.edges)
})
