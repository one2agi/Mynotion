import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
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

interface TestPointerCanvasContext {
  arc: jest.Mock
  beginPath: jest.Mock
  fill: jest.Mock
  fillStyle?: string
}

interface TestForceGraphProps {
  autoPauseRedraw?: boolean
  cooldownTicks?: number
  d3AlphaDecay?: number
  d3VelocityDecay?: number
  graphData?: GraphData<GraphNode, GraphEdge>
  linkColor?: (edge: GraphEdge) => string
  maxZoom?: number
  minZoom?: number
  nodeCanvasObject?: (
    node: GraphNode,
    context: TestCanvasContext,
    globalScale: number
  ) => void
  nodePointerAreaPaint?: (
    node: GraphNode,
    color: string,
    context: TestPointerCanvasContext,
    globalScale: number
  ) => void
  onBackgroundClick?: () => void
  onEngineStop?: () => void
  onNodeClick?: (
    node: GraphNode,
    pointerUpEvent?: Event,
    pointerDownEvent?: Event
  ) => void
  onNodeDrag?: (node: GraphNode, translate: { x?: number; y?: number }) => void
  onNodeDragEnd?: (
    node: GraphNode,
    translate: { x?: number; y?: number }
  ) => void
  onNodeHover?: (node: GraphNode | null) => void
}

interface TestForceGraphHandle {
  centerAt: (
    x?: number,
    y?: number,
    durationMs?: number
  ) => { x: number; y: number } | void
  d3Force: (name: 'center' | 'charge' | 'link') => unknown
  d3ReheatSimulation: () => void
  pauseAnimation: () => void
  resumeAnimation: () => void
  zoom: (scale?: number, durationMs?: number) => number | void
}

interface TestForceGraphMock {
  __forces: {
    center: { strength: jest.Mock }
    charge: { strength: jest.Mock }
    link: { distance: jest.Mock; strength: jest.Mock }
  }
  __centerAt: jest.Mock
  __getPointerDownEvent: () => Event | null
  __getForceGraphProps: () => TestForceGraphProps
  __pauseAnimation: jest.Mock
  __reheatSimulation: jest.Mock
  __resumeAnimation: jest.Mock
  __setViewportCenter: (center: { x: number; y: number }) => void
  __setZoom: (scale: number) => void
  __zoom: jest.Mock
}

jest.mock('react-force-graph-2d', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  let latestProps: TestForceGraphProps = {}
  let latestPointerDownEvent: Event | null = null
  const pauseAnimation = jest.fn()
  const reheatSimulation = jest.fn()
  const resumeAnimation = jest.fn()
  let viewportCenter = { x: 0, y: 0 }
  let zoomScale = 1
  const centerAt = jest.fn((x?: number, y?: number) => {
    if (x === undefined && y === undefined) return viewportCenter

    viewportCenter = {
      x: x ?? viewportCenter.x,
      y: y ?? viewportCenter.y
    }
    return undefined
  })
  const zoom = jest.fn((scale?: number) => {
    if (typeof scale === 'number') {
      zoomScale = scale
      return undefined
    }
    return zoomScale
  })
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
      centerAt,
      d3Force: name => forces[name],
      d3ReheatSimulation: reheatSimulation,
      pauseAnimation,
      resumeAnimation,
      zoom
    }))

    return ReactModule.createElement('button', {
      'aria-label': 'Select graph node',
      'data-cooldown-ticks': props.cooldownTicks,
      onPointerDown: (event: React.PointerEvent) => {
        latestPointerDownEvent = event.nativeEvent
      },
      type: 'button'
    })
  })

  return {
    __esModule: true,
    __getForceGraphProps: () => latestProps,
    __getPointerDownEvent: () => latestPointerDownEvent,
    __centerAt: centerAt,
    __forces: forces,
    __pauseAnimation: pauseAnimation,
    __reheatSimulation: reheatSimulation,
    __resumeAnimation: resumeAnimation,
    __setViewportCenter: (center: { x: number; y: number }) => {
      viewportCenter = center
    },
    __setZoom: (scale: number) => {
      zoomScale = scale
    },
    __zoom: zoom,
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

let reducedMotionChangeListener:
  ((event: Pick<MediaQueryListEvent, 'matches'>) => void) | null = null

const setReducedMotion = (matches: boolean) => {
  reducedMotionChangeListener = null
  window.matchMedia = jest.fn().mockImplementation(() => ({
    addEventListener: jest.fn(
      (
        eventName: string,
        listener: (event: Pick<MediaQueryListEvent, 'matches'>) => void
      ) => {
        if (eventName === 'change') reducedMotionChangeListener = listener
      }
    ),
    matches,
    removeEventListener: jest.fn()
  })) as typeof window.matchMedia
}

const changeReducedMotion = (matches: boolean) => {
  if (!reducedMotionChangeListener) {
    throw new Error('Reduced-motion listener was not registered')
  }
  act(() => reducedMotionChangeListener?.({ matches }))
}

let animationFrames = new Map<number, FrameRequestCallback>()
let nextAnimationFrameId = 1

const installControlledAnimationFrames = () => {
  animationFrames = new Map()
  nextAnimationFrameId = 1
  window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    const frameId = nextAnimationFrameId++
    animationFrames.set(frameId, callback)
    return frameId
  })
  window.cancelAnimationFrame = jest.fn((frameId: number) => {
    animationFrames.delete(frameId)
  })
}

const flushAnimationFrames = () => {
  flushAnimationFramesAt(performance.now())
}

const flushAnimationFramesAt = (time: number) => {
  const pendingFrames = Array.from(animationFrames.values())
  animationFrames.clear()
  pendingFrames.forEach(callback => callback(time))
}

const firePointerEventAt = (
  target: Element,
  type: string,
  {
    clientX,
    clientY,
    pointerId = 1,
    time
  }: {
    clientX: number
    clientY: number
    pointerId?: number
    time: number
  }
) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    button: { value: 0 },
    clientX: { value: clientX },
    clientY: { value: clientY },
    isPrimary: { value: true },
    pointerId: { value: pointerId },
    timeStamp: { value: time }
  })
  fireEvent(target, event)
}

beforeEach(() => {
  jest.clearAllMocks()
  forceGraphMock.__setViewportCenter({ x: 0, y: 0 })
  forceGraphMock.__setZoom(1)
  window.requestAnimationFrame = jest.fn((callback: FrameRequestCallback) => {
    callback(performance.now())
    return 1
  })
  window.cancelAnimationFrame = jest.fn()
})

afterEach(() => {
  jest.useRealTimers()
})

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
        origins: ['00000000000000000000000000000001'],
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
  rendererGraph.links[0]!.origins!.push('renderer-mutation')
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

test('pauses the simulation while inactive', () => {
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: false,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )

  expect(forceGraphMock.__pauseAnimation).toHaveBeenCalledTimes(1)
})

test('resumes before reheating when the canvas becomes active', () => {
  jest.useFakeTimers()
  setReducedMotion(false)
  const view = render(
    React.createElement(KnowledgeGraphCanvas, {
      active: false,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )

  view.rerender(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )

  expect(forceGraphMock.__resumeAnimation).toHaveBeenCalledTimes(1)
  expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(80))
  expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
  expect(
    forceGraphMock.__resumeAnimation.mock.invocationCallOrder[0]
  ).toBeLessThan(forceGraphMock.__reheatSimulation.mock.invocationCallOrder[0]!)
})

test('keeps active pointer interaction after the simulation engine stops', () => {
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()

  expect(props.autoPauseRedraw).toBe(true)
  expect(props.onEngineStop).toBeUndefined()
  expect(forceGraphMock.__pauseAnimation).not.toHaveBeenCalled()
})

test.each(['settings', 'graph'])(
  'reheats after a %s update without pausing active interaction',
  updateType => {
    jest.useFakeTimers()
    setReducedMotion(false)
    const view = render(
      React.createElement(KnowledgeGraphCanvas, {
        active: true,
        graph,
        settings: GRAPH_SETTINGS_DEFAULTS
      })
    )
    forceGraphMock.__resumeAnimation.mockClear()
    forceGraphMock.__reheatSimulation.mockClear()

    view.rerender(
      React.createElement(KnowledgeGraphCanvas, {
        active: true,
        graph:
          updateType === 'graph'
            ? { ...graph, nodes: graph.nodes.map(node => ({ ...node })) }
            : graph,
        settings:
          updateType === 'settings'
            ? { ...GRAPH_SETTINGS_DEFAULTS, linkDistance: 90 }
            : GRAPH_SETTINGS_DEFAULTS
      })
    )

    expect(forceGraphMock.__resumeAnimation).not.toHaveBeenCalled()
    expect(forceGraphMock.__pauseAnimation).not.toHaveBeenCalled()
    expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(80))
    expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
  }
)

test('updates reduced motion without pausing active interaction', () => {
  jest.useFakeTimers()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  forceGraphMock.__resumeAnimation.mockClear()
  forceGraphMock.__reheatSimulation.mockClear()

  changeReducedMotion(true)

  expect(forceGraphMock.__resumeAnimation).not.toHaveBeenCalled()
  expect(forceGraphMock.__pauseAnimation).not.toHaveBeenCalled()
  expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(80))
  expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
})

test('centers and gently zooms when the selected node changes', () => {
  installControlledAnimationFrames()
  setReducedMotion(false)
  const view = render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      selectedNodeId: 'a',
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const rendererGraph = forceGraphMock.__getForceGraphProps().graphData
  const selectedNode = rendererGraph?.nodes.find(node => node.id === 'b')
  if (!selectedNode) throw new Error('Renderer node b was not provided')
  selectedNode.x = 42
  selectedNode.y = -18
  forceGraphMock.__centerAt.mockClear()
  forceGraphMock.__zoom.mockClear()

  view.rerender(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      selectedNodeId: 'b',
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  act(() => flushAnimationFrames())

  expect(forceGraphMock.__centerAt).toHaveBeenCalledWith(42, -18, 300)
  expect(forceGraphMock.__zoom).toHaveBeenNthCalledWith(1)
  expect(forceGraphMock.__zoom).toHaveBeenNthCalledWith(2, 1.4, 300)
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

test('uses pointer sessions to suppress a drag click after arbitrary delay and allow a later real click', () => {
  jest.useFakeTimers()
  installControlledAnimationFrames()
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
  const renderer = screen.getByRole('button', { name: 'Select graph node' })

  fireEvent.pointerDown(renderer, { pointerId: 11 })
  const dragPointerDownEvent = forceGraphMock.__getPointerDownEvent()
  expect(dragPointerDownEvent).not.toBeNull()

  act(() => {
    props.onNodeDrag?.(node, { x: 5, y: 0 })
    props.onNodeDragEnd?.(node, { x: 5, y: 0 })
    jest.advanceTimersByTime(60 * 60 * 1000)
    flushAnimationFrames()
    props.onNodeClick?.(
      node,
      new Event('pointerup'),
      dragPointerDownEvent ?? undefined
    )
  })
  expect(onNodeClick).not.toHaveBeenCalled()

  fireEvent.pointerDown(renderer, { pointerId: 12 })
  const realPointerDownEvent = forceGraphMock.__getPointerDownEvent()
  expect(realPointerDownEvent).not.toBe(dragPointerDownEvent)
  act(() => {
    props.onNodeClick?.(
      node,
      new Event('pointerup'),
      realPointerDownEvent ?? undefined
    )
  })
  expect(onNodeClick).toHaveBeenCalledTimes(1)
})

test('suppresses a delayed drag click even when hit testing resolves another node', () => {
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
  const draggedNode = graph.nodes[0]!
  const overlappedNode = graph.nodes[1]!
  const renderer = screen.getByRole('button', { name: 'Select graph node' })

  fireEvent.pointerDown(renderer, { pointerId: 13 })
  const dragPointerDownEvent = forceGraphMock.__getPointerDownEvent()

  act(() => {
    props.onNodeDrag?.(draggedNode, { x: 5, y: 0 })
    props.onNodeDragEnd?.(draggedNode, { x: 5, y: 0 })
    props.onNodeClick?.(
      overlappedNode,
      new Event('pointerup'),
      dragPointerDownEvent ?? undefined
    )
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
  const selectedFill: string[] = []
  const outboundFill: string[] = []
  const unrelatedFill: string[] = []
  const createContext = (values: number[], fills: string[]) => ({
    arc: jest.fn(),
    beginPath: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
    restore: jest.fn(),
    save: jest.fn(),
    set fillStyle(value: string) {
      fills.push(value)
    },
    set font(_value: string) {},
    set globalAlpha(value: number) {
      values.push(value)
    },
    set textAlign(_value: string) {},
    set textBaseline(_value: string) {}
  })

  props.nodeCanvasObject?.(
    graph.nodes[0]!,
    createContext(selectedAlpha, selectedFill),
    1
  )
  props.nodeCanvasObject?.(
    graph.nodes[1]!,
    createContext(outboundAlpha, outboundFill),
    1
  )
  props.nodeCanvasObject?.(
    graph.nodes[2]!,
    createContext(unrelatedAlpha, unrelatedFill),
    1
  )

  expect(selectedAlpha[0]).toBe(1)
  expect(outboundAlpha[0]).toBe(1)
  expect(unrelatedAlpha[0]).toBeLessThan(0.5)
  expect(selectedFill[0]).toBe('#0284c7')
  expect(outboundFill[0]).toBe('#0284c7')
  expect(unrelatedFill[0]).not.toBe('#0284c7')
  expect(props.linkColor?.(graph.edges[0]!)).toBe('#0284c7')
  expect(props.linkColor?.(graph.edges[1]!)).toContain('rgba')
})

test('paints selected and ordinary node hit areas from their rendered radius', () => {
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
  const createContext = (): TestCanvasContext & TestPointerCanvasContext => ({
    arc: jest.fn(),
    beginPath: jest.fn(),
    fill: jest.fn(),
    fillStyle: '',
    fillText: jest.fn(),
    restore: jest.fn(),
    save: jest.fn()
  })
  const selectedPaint = createContext()
  const selectedPointerPaint = createContext()
  const ordinaryPaint = createContext()
  const ordinaryPointerPaint = createContext()

  props.nodeCanvasObject?.(graph.nodes[0]!, selectedPaint, 2)
  props.nodePointerAreaPaint?.(
    graph.nodes[0]!,
    '#pointer-selected',
    selectedPointerPaint,
    2
  )
  props.nodeCanvasObject?.(graph.nodes[1]!, ordinaryPaint, 0.5)
  props.nodePointerAreaPaint?.(
    graph.nodes[1]!,
    '#pointer-ordinary',
    ordinaryPointerPaint,
    0.5
  )

  const getArcRadius = (context: TestCanvasContext) => {
    const radius = context.arc.mock.calls[0]?.[2]
    if (typeof radius !== 'number') throw new Error('Expected a node radius')
    return radius
  }

  expect(getArcRadius(selectedPointerPaint)).toBeCloseTo(
    getArcRadius(selectedPaint) + 4 / 2
  )
  expect(selectedPointerPaint.fillStyle).toBe('#pointer-selected')
  expect(getArcRadius(ordinaryPointerPaint)).toBeCloseTo(
    getArcRadius(ordinaryPaint) + 4 / 0.5
  )
  expect(ordinaryPointerPaint.fillStyle).toBe('#pointer-ordinary')
})

test('continues a quick background pan in the release direction', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })
  const props = forceGraphMock.__getForceGraphProps()
  forceGraphMock.__setViewportCenter({ x: 10, y: -4 })
  forceGraphMock.__setZoom(2)
  forceGraphMock.__centerAt.mockClear()

  firePointerEventAt(renderer, 'pointerdown', {
    clientX: 20,
    clientY: 30,
    time: 0
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointermove', {
    clientX: 60,
    clientY: 30,
    time: 16
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointerup', {
    clientX: 60,
    clientY: 30,
    time: 32
  })
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)
  act(() => {
    flushAnimationFramesAt(0)
    flushAnimationFramesAt(16)
  })

  const panCalls = forceGraphMock.__centerAt.mock.calls.filter(
    ([x, y]) => x !== undefined || y !== undefined
  ) as Array<[number, number]>
  expect(panCalls.length).toBeGreaterThan(0)
  expect(panCalls.at(-1)?.[0]).toBeLessThan(10)
})

test('does not start inertia after the pointer is still for 300 ms', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })

  firePointerEventAt(renderer, 'pointerdown', {
    clientX: 0,
    clientY: 0,
    time: 0
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointermove', {
    clientX: 40,
    clientY: 0,
    time: 16
  })
  act(() => jest.advanceTimersByTime(300))
  firePointerEventAt(renderer, 'pointerup', {
    clientX: 40,
    clientY: 0,
    time: 316
  })
  act(() => flushAnimationFramesAt(320))

  expect(forceGraphMock.__centerAt).not.toHaveBeenCalled()
})

test('does not start inertia when a hovered node owns a short pointer session', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })
  const props = forceGraphMock.__getForceGraphProps()

  act(() => props.onNodeHover?.(graph.nodes[0]!))

  firePointerEventAt(renderer, 'pointerdown', {
    clientX: 0,
    clientY: 0,
    time: 0
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointermove', {
    clientX: 3,
    clientY: 0,
    time: 16
  })
  firePointerEventAt(renderer, 'pointerup', {
    clientX: 3,
    clientY: 0,
    time: 17
  })
  act(() => flushAnimationFramesAt(16))

  expect(forceGraphMock.__centerAt).not.toHaveBeenCalled()
})

test('uses one smooth ease-out trajectory through the 240 ms duration', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })
  forceGraphMock.__setViewportCenter({ x: 0, y: 0 })
  forceGraphMock.__centerAt.mockClear()

  firePointerEventAt(renderer, 'pointerdown', {
    clientX: 0,
    clientY: 0,
    time: 0
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointermove', {
    clientX: 5,
    clientY: 0,
    time: 16
  })
  act(() => jest.advanceTimersByTime(16))
  firePointerEventAt(renderer, 'pointerup', {
    clientX: 5,
    clientY: 0,
    time: 32
  })
  act(() => {
    for (let time = 0; time <= 240; time += 16) {
      flushAnimationFramesAt(time)
    }
  })
  const panCalls = forceGraphMock.__centerAt.mock.calls.filter(
    ([x, y]) => x !== undefined || y !== undefined
  ) as Array<[number, number]>
  const finalCall = panCalls.at(-1)
  const callsAtDeadline = panCalls.length
  act(() => flushAnimationFramesAt(256))

  const positions = panCalls.map(([x]) => Math.abs(x))
  const frameMovements = positions.slice(1).map((position, index) => {
    const previousPosition = positions[index]
    return previousPosition === undefined ? 0 : position - previousPosition
  })

  expect(panCalls.length).toBeGreaterThan(0)
  expect(Math.abs(finalCall?.[0] ?? 0)).toBeCloseTo(50, 4)
  expect(frameMovements.every(distance => distance > 0)).toBe(true)
  expect(
    frameMovements.every((distance, index) => {
      const previousDistance = frameMovements[index - 1]
      return previousDistance === undefined || distance <= previousDistance
    })
  ).toBe(true)
  expect(
    forceGraphMock.__centerAt.mock.calls.filter(
      ([x, y]) => x !== undefined || y !== undefined
    )
  ).toHaveLength(callsAtDeadline)
})

test('caps high-speed inertia at 120 screen pixels', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })
  forceGraphMock.__setViewportCenter({ x: 0, y: 0 })
  forceGraphMock.__setZoom(2)
  forceGraphMock.__centerAt.mockClear()

  firePointerEventAt(renderer, 'pointerdown', {
    clientX: 0,
    clientY: 0,
    time: 0
  })
  act(() => jest.advanceTimersByTime(1))
  firePointerEventAt(renderer, 'pointermove', {
    clientX: 800,
    clientY: 0,
    time: 1
  })
  act(() => jest.advanceTimersByTime(1))
  firePointerEventAt(renderer, 'pointerup', {
    clientX: 800,
    clientY: 0,
    time: 2
  })
  act(() => {
    for (let time = 0; time <= 240; time += 16) {
      flushAnimationFramesAt(time)
    }
  })
  const panCalls = forceGraphMock.__centerAt.mock.calls.filter(
    ([x, y]) => x !== undefined || y !== undefined
  ) as Array<[number, number]>
  const callsAtDistanceLimit = panCalls.length
  act(() => flushAnimationFramesAt(256))

  expect(Math.abs((panCalls.at(-1)?.[0] ?? 0) * 2)).toBeCloseTo(120, 4)
  expect(
    forceGraphMock.__centerAt.mock.calls.filter(
      ([x, y]) => x !== undefined || y !== undefined
    )
  ).toHaveLength(callsAtDistanceLimit)
})

test('reduced motion and cancellation inputs stop pending inertia', () => {
  jest.useFakeTimers()
  jest.setSystemTime(0)
  installControlledAnimationFrames()
  setReducedMotion(false)
  const view = render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const renderer = screen.getByRole('button', { name: 'Select graph node' })
  const props = forceGraphMock.__getForceGraphProps()

  const startInertia = () => {
    firePointerEventAt(renderer, 'pointerdown', {
      clientX: 0,
      clientY: 0,
      time: 0
    })
    act(() => jest.advanceTimersByTime(16))
    firePointerEventAt(renderer, 'pointermove', {
      clientX: 40,
      clientY: 0,
      time: 16
    })
    act(() => jest.advanceTimersByTime(16))
    firePointerEventAt(renderer, 'pointerup', {
      clientX: 40,
      clientY: 0,
      time: 32
    })
  }
  const expectCancelled = () => {
    const callsBeforeFrame = forceGraphMock.__centerAt.mock.calls.length
    act(() => flushAnimationFramesAt(0))
    act(() => flushAnimationFramesAt(16))
    expect(forceGraphMock.__centerAt.mock.calls).toHaveLength(callsBeforeFrame)
  }

  startInertia()
  fireEvent.pointerDown(renderer, { button: 0, clientX: 40, clientY: 0 })
  expectCancelled()

  startInertia()
  fireEvent.wheel(renderer)
  expectCancelled()

  startInertia()
  act(() => props.onNodeClick?.(graph.nodes[0]!))
  expectCancelled()

  startInertia()
  view.rerender(
    React.createElement(KnowledgeGraphCanvas, {
      active: false,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  expectCancelled()

  view.rerender(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  startInertia()
  changeReducedMotion(true)
  expectCancelled()

  changeReducedMotion(false)
  startInertia()
  view.unmount()
  expectCancelled()
})
