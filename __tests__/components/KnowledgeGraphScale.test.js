import { act, render, screen } from '@testing-library/react'
import React from 'react'
import KnowledgeGraphCanvas, {
  cloneGraphForRenderer
} from '@/components/KnowledgeGraph/KnowledgeGraphCanvas'
import { GRAPH_SETTINGS_DEFAULTS } from '@/components/KnowledgeGraph/graphSettings'
import { createGraphFocusModel } from '@/components/KnowledgeGraph/graphRenderModel'
import { selectGraphNeighborhood } from '@/components/KnowledgeGraph/graphView'

jest.mock('react-force-graph-2d', () => {
  const ReactModule = jest.requireActual('react')
  let latestProps = {}
  let drawStats = {}
  const pauseAnimation = jest.fn()
  const reheatSimulation = jest.fn()
  const resumeAnimation = jest.fn()
  const forces = {
    center: { strength: jest.fn() },
    charge: { strength: jest.fn() },
    link: {
      distance: jest.fn().mockReturnThis(),
      strength: jest.fn().mockReturnThis()
    }
  }

  const ForceGraph2D = ReactModule.forwardRef(
    function ForceGraph2D(props, ref) {
      latestProps = props
      drawStats = {
        finiteCoordinates: true,
        linkColorCallbacks: 0,
        linkWidthCallbacks: 0,
        nodeArcs: 0,
        nodeFills: 0
      }
      ReactModule.useImperativeHandle(ref, () => ({
        d3Force: name => forces[name],
        d3ReheatSimulation: reheatSimulation,
        pauseAnimation,
        resumeAnimation
      }))

      const context = {
        arc: () => {
          drawStats.nodeArcs += 1
        },
        beginPath: jest.fn(),
        fill: () => {
          drawStats.nodeFills += 1
        },
        fillText: jest.fn(),
        restore: jest.fn(),
        save: jest.fn(),
        set fillStyle(_value) {},
        set font(_value) {},
        set globalAlpha(_value) {},
        set textAlign(_value) {},
        set textBaseline(_value) {}
      }

      props.graphData.nodes.forEach((node, index) => {
        node.x = (index % 50) * 12
        node.y = Math.floor(index / 50) * 12
        drawStats.finiteCoordinates =
          drawStats.finiteCoordinates &&
          Number.isFinite(node.x) &&
          Number.isFinite(node.y)
        props.nodeCanvasObject?.(node, context, 1)
      })
      props.graphData.links.forEach(link => {
        if (typeof props.linkColor === 'function') {
          props.linkColor(link)
          drawStats.linkColorCallbacks += 1
        }
        if (typeof props.linkWidth === 'function') {
          props.linkWidth(link)
          drawStats.linkWidthCallbacks += 1
        }
      })

      return ReactModule.createElement('div', {
        'aria-label': 'Knowledge graph scale renderer',
        'data-max-zoom': props.maxZoom,
        'data-min-zoom': props.minZoom,
        'data-rendered': 'true',
        role: 'img'
      })
    }
  )

  return {
    __esModule: true,
    __getDrawStats: () => drawStats,
    __getForceGraphProps: () => latestProps,
    __pauseAnimation: pauseAnimation,
    default: ForceGraph2D
  }
})

const forceGraphMock = jest.requireMock('react-force-graph-2d')

const MAX_1000_NODE_PAYLOAD_BYTES = 250 * 1024
const MAX_1000_NODE_OPERATION_MS = 1000

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

let animationFrames
let nextAnimationFrameId

const installControlledAnimationFrames = () => {
  animationFrames = new Map()
  nextAnimationFrameId = 1
  window.requestAnimationFrame = jest.fn(callback => {
    const frameId = nextAnimationFrameId++
    animationFrames.set(frameId, callback)
    return frameId
  })
  window.cancelAnimationFrame = jest.fn(frameId => {
    animationFrames.delete(frameId)
  })
}

const flushAnimationFrames = () => {
  const pendingFrames = Array.from(animationFrames.values())
  animationFrames.clear()
  pendingFrames.forEach(callback => callback(performance.now()))
}

beforeEach(() => {
  jest.clearAllMocks()
  installControlledAnimationFrames()
})

test.each([50, 500, 1000])(
  'paints and keeps a %i-node graph fixture mounted and stable',
  size => {
    const graph = createGraph(size)
    const payloadBytes = Buffer.byteLength(JSON.stringify(graph), 'utf8')

    const operationStartedAt = performance.now()
    const rendererGraph = cloneGraphForRenderer(graph)
    const neighborhood = selectGraphNeighborhood(graph, 'node-0', 2)
    const focus = createGraphFocusModel(graph, 'node-0')
    const repeatedFocus = createGraphFocusModel(graph, 'node-0')
    const view = render(
      <KnowledgeGraphCanvas
        active={true}
        currentId='node-0'
        graph={graph}
        selectedNodeId='node-0'
        settings={GRAPH_SETTINGS_DEFAULTS}
      />
    )
    const operationMs = performance.now() - operationStartedAt

    expect(rendererGraph).toEqual({
      nodes: graph.nodes,
      links: graph.edges
    })
    expect(rendererGraph.nodes[0]).not.toBe(graph.nodes[0])
    expect(rendererGraph.links[0]).not.toBe(graph.edges[0])
    expect(neighborhood.nodes).toHaveLength(3)
    expect(neighborhood.edges).toHaveLength(2)
    expect(Array.from(focus.focusedNodeIds)).toEqual(['node-0', 'node-1'])
    expect(Array.from(focus.focusedNodeIds)).toEqual(
      Array.from(repeatedFocus.focusedNodeIds)
    )
    expect(focus.focusedEdgeKeys).toEqual(new Set(['node-0:node-1']))
    expect(graph.nodes).toHaveLength(size)

    const drawStats = forceGraphMock.__getDrawStats()
    expect(drawStats.finiteCoordinates).toBe(true)
    expect(drawStats.nodeArcs).toBe(size)
    expect(drawStats.nodeFills).toBe(size)
    expect(drawStats.linkColorCallbacks).toBe(size - 1)
    expect(drawStats.linkWidthCallbacks).toBe(size - 1)

    const renderer = screen.getByRole('img', {
      name: 'Knowledge graph scale renderer'
    })
    expect(renderer).toHaveAttribute('data-rendered', 'true')
    expect(renderer).toHaveAttribute('data-min-zoom', '0.6')
    expect(renderer).toHaveAttribute('data-max-zoom', '4')

    const initialPauseCalls = forceGraphMock.__pauseAnimation.mock.calls.length
    expect(forceGraphMock.__getForceGraphProps().autoPauseRedraw).toBe(true)
    expect(forceGraphMock.__getForceGraphProps().onEngineStop).toBeUndefined()
    expect(forceGraphMock.__pauseAnimation).toHaveBeenCalledTimes(
      initialPauseCalls
    )
    expect(renderer).toBeInTheDocument()

    if (size === 1000) {
      expect(payloadBytes).toBeLessThan(MAX_1000_NODE_PAYLOAD_BYTES)
      expect(operationMs).toBeLessThan(MAX_1000_NODE_OPERATION_MS)
    }

    console.info(
      `[knowledge-graph-scale] nodes=${size} bytes=${payloadBytes} operationMs=${operationMs.toFixed(3)} nodePaints=${drawStats.nodeFills} linkColorCallbacks=${drawStats.linkColorCallbacks} linkWidthCallbacks=${drawStats.linkWidthCallbacks}`
    )
    view.unmount()
  }
)
