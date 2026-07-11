import { expect, jest, test } from '@jest/globals'
import type { GraphData } from 'react-force-graph-2d'
import type {
  GraphEdge,
  GraphNode,
  PublicGraph
} from '@/lib/knowledge-graph/types'

jest.mock('react-force-graph-2d', () => () => null)

const { cloneGraphForRenderer } =
  require('@/components/KnowledgeGraph/KnowledgeGraphCanvas') as typeof import('@/components/KnowledgeGraph/KnowledgeGraphCanvas')

test('adapts public edges to the renderer links contract without sharing mutable data', () => {
  const publicGraph: PublicGraph = {
    nodes: [
      {
        id: '00000000000000000000000000000001',
        title: 'Source',
        slug: 'source'
      },
      {
        id: '00000000000000000000000000000002',
        title: 'Target',
        slug: 'target'
      }
    ],
    edges: [
      {
        source: '00000000000000000000000000000001',
        target: '00000000000000000000000000000002'
      }
    ]
  }
  const before = JSON.stringify(publicGraph)

  const rendererGraph: GraphData<GraphNode, GraphEdge> =
    cloneGraphForRenderer(publicGraph)

  expect(Object.keys(rendererGraph)).toEqual(['nodes', 'links'])
  expect(rendererGraph.links).toEqual(publicGraph.edges)
  expect('edges' in rendererGraph).toBe(false)

  rendererGraph.nodes[0]!.title = 'Renderer mutation'
  rendererGraph.links[0]!.source = 'renderer-mutation'
  rendererGraph.links.pop()

  expect(JSON.stringify(publicGraph)).toBe(before)
})
