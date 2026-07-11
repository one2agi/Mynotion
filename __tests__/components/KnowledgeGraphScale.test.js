import { cloneGraphForRenderer } from '@/components/KnowledgeGraph/KnowledgeGraphCanvas'
import { selectGraphNeighborhood } from '@/components/KnowledgeGraph/graphView'

jest.mock('react-force-graph-2d', () => () => null)

const createGraph = size => ({
  nodes: Array.from({ length: size }, (_, index) => ({
    id: `node-${index}`,
    slug: `/node-${index}`,
    title: `Node ${index}`
  })),
  edges: Array.from({ length: size - 1 }, (_, index) => ({
    source: `node-${index}`,
    target: `node-${index + 1}`
  }))
})

test.each([50, 500, 1000])(
  'clones and filters a %i-node graph fixture without mutation',
  size => {
    const graph = createGraph(size)
    const payloadBytes = Buffer.byteLength(JSON.stringify(graph), 'utf8')

    const cloneStartedAt = performance.now()
    const rendererGraph = cloneGraphForRenderer(graph)
    const cloneMs = performance.now() - cloneStartedAt

    const neighborhoodStartedAt = performance.now()
    const neighborhood = selectGraphNeighborhood(graph, 'node-0', 2)
    const neighborhoodMs = performance.now() - neighborhoodStartedAt

    expect(rendererGraph).toEqual(graph)
    expect(rendererGraph).not.toBe(graph)
    expect(rendererGraph.nodes[0]).not.toBe(graph.nodes[0])
    expect(neighborhood.nodes).toHaveLength(3)
    expect(neighborhood.edges).toHaveLength(2)
    expect(graph.nodes).toHaveLength(size)

    console.info(
      `[knowledge-graph-scale] nodes=${size} bytes=${payloadBytes} cloneMs=${cloneMs.toFixed(3)} neighborhoodMs=${neighborhoodMs.toFixed(3)}`
    )
  }
)
