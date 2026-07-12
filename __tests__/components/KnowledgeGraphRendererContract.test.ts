import { act, render, screen } from '@testing-library/react'
import { expect, jest, test } from '@jest/globals'
import React from 'react'
import type { ForwardedRef } from 'react'
import type { GraphData } from 'react-force-graph-2d'
import type {
  GraphEdge,
  GraphNode,
  PublicGraph
} from '@/lib/knowledge-graph/types'
import { GRAPH_SETTINGS_DEFAULTS } from '@/components/KnowledgeGraph/graphSettings'
import {
  createGraphFocusModel,
  shouldDrawLabel
} from '@/components/KnowledgeGraph/graphRenderModel'

interface TestCanvasContext {
  arc: jest.Mock
  beginPath: jest.Mock
  fill: jest.Mock
  fillText: jest.Mock
  fillStyle?: string
  font?: string
  globalAlpha?: number
  restore: jest.Mock
  save: jest.Mock
  textAlign?: string
  textBaseline?: string
}

interface TestForceGraphProps {
  cooldownTicks?: number
  d3AlphaDecay?: number
  d3VelocityDecay?: number
  linkColor?: (edge: GraphEdge) => string
  maxZoom?: number
  minZoom?: number
  nodeCanvasObject?: (
    node: GraphNode,
    context: TestCanvasContext,
    globalScale: number
  ) => void
  onBackgroundClick?: () => void
  onNodeClick?: (node: GraphNode) => void
  onNodeDrag?: (node: GraphNode, translate: { x?: number; y?: number }) => void
}

interface TestForceGraphHandle {
  d3Force: (name: 'center' | 'charge' | 'link') => unknown
  d3ReheatSimulation: () => void
  pauseAnimation: () => void
}

interface TestForceGraphMock {
  __forces: {
    center: { strength: jest.Mock }
    charge: { strength: jest.Mock }
    link: { distance: jest.Mock; strength: jest.Mock }
  }
  __getForceGraphProps: () => TestForceGraphProps
  __pauseAnimation: jest.Mock
  __reheatSimulation: jest.Mock
}

jest.mock('react-force-graph-2d', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  let latestProps: TestForceGraphProps = {}
  const pauseAnimation = jest.fn()
  const reheatSimulation = jest.fn()
  const forces = {
    center: { strength: jest.fn() },
    charge: { strength: jest.fn() },
    link: {
      distance: jest.fn().mockReturnThis(),
      strength: jest.fn().mockReturnThis()
    }
  }

  const ForceGraph2D = ReactModule.forwardRef<
    TestForceGraphHandle,
    TestForceGraphProps
  >(function ForceGraph2D(
    props: TestForceGraphProps,
    ref: ForwardedRef<TestForceGraphHandle>
  ) {
    latestProps = props
    ReactModule.useImperativeHandle(ref, () => ({
      d3Force: name => forces[name],
      d3ReheatSimulation: reheatSimulation,
      pauseAnimation
    }))

    return ReactModule.createElement('button', {
      'aria-label': 'Select graph node',
      'data-cooldown-ticks': props.cooldownTicks,
      type: 'button'
    })
  })

  return {
    __esModule: true,
    __getForceGraphProps: () => latestProps,
    __forces: forces,
    __pauseAnimation: pauseAnimation,
    __reheatSimulation: reheatSimulation,
    default: ForceGraph2D
  }
})

const forceGraphMock = jest.requireMock<TestForceGraphMock>(
  'react-force-graph-2d'
)

const canvasModule = jest.requireActual<
  typeof import('@/components/KnowledgeGraph/KnowledgeGraphCanvas')
>('@/components/KnowledgeGraph/KnowledgeGraphCanvas')
const { cloneGraphForRenderer } = canvasModule
const KnowledgeGraphCanvas =
  canvasModule.default as unknown as React.ComponentType<
    Record<string, unknown>
  >

const graph: PublicGraph = {
  nodes: [
    { id: 'a', slug: '/a', title: 'A' },
    { id: 'b', slug: '/b', title: 'B' },
    { id: 'c', slug: '/c', title: 'C' }
  ],
  edges: [
    { origins: ['a'], source: 'a', target: 'b' },
    { origins: ['c'], source: 'a', target: 'c' },
    { origins: ['b'], source: 'b', target: 'c' }
  ]
}

const setReducedMotion = (matches: boolean) => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(),
    matches,
    removeEventListener: jest.fn()
  })) as typeof window.matchMedia
}

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

test('focus model highlights only outbound neighbors', () => {
  const model = createGraphFocusModel(graph, 'a')

  expect(Array.from(model.focusedNodeIds)).toEqual(['a', 'b'])
  expect(model.focusedEdgeKeys).toEqual(new Set(['a:b']))
})

test('label policy supports auto, always, and hidden modes', () => {
  expect(
    shouldDrawLabel({ mode: 'auto', hovered: true, selected: false, zoom: 0.6 })
  ).toBe(true)
  expect(
    shouldDrawLabel({ mode: 'auto', hovered: false, selected: true, zoom: 0.6 })
  ).toBe(true)
  expect(
    shouldDrawLabel({ mode: 'auto', hovered: false, selected: false, zoom: 1 })
  ).toBe(false)
  expect(
    shouldDrawLabel({ mode: 'auto', hovered: false, selected: false, zoom: 2 })
  ).toBe(true)
  expect(
    shouldDrawLabel({
      mode: 'always',
      hovered: false,
      selected: false,
      zoom: 0.6
    })
  ).toBe(true)
  expect(
    shouldDrawLabel({ mode: 'never', hovered: true, selected: true, zoom: 2 })
  ).toBe(false)
})

test('uses bounded calm 2d force props and configured strengths', () => {
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )

  expect(
    screen
      .getByRole('button', { name: 'Select graph node' })
      .getAttribute('data-cooldown-ticks')
  ).toBe('80')
  expect(forceGraphMock.__getForceGraphProps().minZoom).toBe(0.6)
  expect(forceGraphMock.__getForceGraphProps().maxZoom).toBe(4)
  expect(forceGraphMock.__getForceGraphProps().d3AlphaDecay).toBe(0.04)
  expect(forceGraphMock.__getForceGraphProps().d3VelocityDecay).toBe(0.45)
  expect(forceGraphMock.__forces.charge.strength).toHaveBeenCalledWith(-80)
  expect(forceGraphMock.__forces.link.distance).toHaveBeenCalledWith(70)
  expect(forceGraphMock.__forces.link.strength).toHaveBeenCalledWith(0.25)
  expect(forceGraphMock.__forces.center.strength).toHaveBeenCalledWith(0.35)
})

test('reduces motion and debounces graph reheating', () => {
  jest.useFakeTimers()
  setReducedMotion(true)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )

  expect(forceGraphMock.__getForceGraphProps().cooldownTicks).toBe(1)
  expect(forceGraphMock.__getForceGraphProps().d3AlphaDecay).toBe(1)
  expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()

  act(() => jest.advanceTimersByTime(79))
  expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(1))
  expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
  jest.useRealTimers()
})

test('ignores node clicks caused by dragging and clears selection on background click', () => {
  setReducedMotion(false)
  const onNodeClick = jest.fn()
  const onBackgroundClick = jest.fn()
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      onBackgroundClick,
      onNodeClick,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()
  const node = graph.nodes[1]!

  act(() => {
    props.onNodeDrag?.(node, { x: 5, y: 0 })
  })
  act(() => {
    props.onNodeClick?.(node)
  })
  expect(onNodeClick).not.toHaveBeenCalled()

  act(() => {
    props.onBackgroundClick?.()
  })
  expect(onBackgroundClick).toHaveBeenCalledTimes(1)
})

test('accumulates small drag movements before suppressing navigation', () => {
  setReducedMotion(false)
  const onNodeClick = jest.fn()
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      onNodeClick,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()
  const node = graph.nodes[1]!

  act(() => {
    props.onNodeDrag?.(node, { x: 2, y: 0 })
    props.onNodeDrag?.(node, { x: 2, y: 0 })
    props.onNodeClick?.(node)
  })

  expect(onNodeClick).not.toHaveBeenCalled()
})

test('fades unrelated nodes and edges while keeping selected outbound focus visible', () => {
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      selectedNodeId: 'a',
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()
  const selectedAlpha: number[] = []
  const outboundAlpha: number[] = []
  const unrelatedAlpha: number[] = []
  const createContext = (values: number[]) => ({
    arc: jest.fn(),
    beginPath: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
    restore: jest.fn(),
    save: jest.fn(),
    set fillStyle(_value: string) {},
    set font(_value: string) {},
    set globalAlpha(value: number) {
      values.push(value)
    },
    set textAlign(_value: string) {},
    set textBaseline(_value: string) {}
  })

  props.nodeCanvasObject?.(graph.nodes[0]!, createContext(selectedAlpha), 1)
  props.nodeCanvasObject?.(graph.nodes[1]!, createContext(outboundAlpha), 1)
  props.nodeCanvasObject?.(graph.nodes[2]!, createContext(unrelatedAlpha), 1)

  expect(selectedAlpha[0]).toBe(1)
  expect(outboundAlpha[0]).toBe(1)
  expect(unrelatedAlpha[0]).toBeLessThan(0.5)
  expect(props.linkColor?.(graph.edges[0]!)).toBe('#0284c7')
  expect(props.linkColor?.(graph.edges[1]!)).toContain('rgba')
})
