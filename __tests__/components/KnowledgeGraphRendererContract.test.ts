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
}

interface TestForceGraphHandle {
  d3Force: (name: 'center' | 'charge' | 'link') => unknown
  d3ReheatSimulation: () => void
  pauseAnimation: () => void
  resumeAnimation: () => void
}

interface TestForceGraphMock {
  __forces: {
    center: { strength: jest.Mock }
    charge: { strength: jest.Mock }
    link: { distance: jest.Mock; strength: jest.Mock }
  }
  __getPointerDownEvent: () => Event | null
  __getForceGraphProps: () => TestForceGraphProps
  __pauseAnimation: jest.Mock
  __reheatSimulation: jest.Mock
  __resumeAnimation: jest.Mock
}

jest.mock('react-force-graph-2d', () => {
  const ReactModule = jest.requireActual<typeof import('react')>('react')
  let latestProps: TestForceGraphProps = {}
  let latestPointerDownEvent: Event | null = null
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
      pauseAnimation,
      resumeAnimation
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
    __forces: forces,
    __pauseAnimation: pauseAnimation,
    __reheatSimulation: reheatSimulation,
    __resumeAnimation: resumeAnimation,
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
  const pendingFrames = Array.from(animationFrames.values())
  animationFrames.clear()
  pendingFrames.forEach(callback => callback(performance.now()))
}

beforeEach(() => {
  jest.clearAllMocks()
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

test('defers stable pause by one frame and cancels pending frames on unmount', () => {
  installControlledAnimationFrames()
  setReducedMotion(false)
  const view = render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()
  const initialPauseCalls = forceGraphMock.__pauseAnimation.mock.calls.length

  act(() => {
    props.onEngineStop?.()
  })
  expect(forceGraphMock.__pauseAnimation).toHaveBeenCalledTimes(
    initialPauseCalls
  )

  act(() => flushAnimationFrames())
  expect(forceGraphMock.__pauseAnimation).toHaveBeenCalledTimes(
    initialPauseCalls + 1
  )

  act(() => {
    props.onEngineStop?.()
  })
  view.unmount()
  expect(window.cancelAnimationFrame).toHaveBeenCalled()
  const pauseCallsAfterUnmount =
    forceGraphMock.__pauseAnimation.mock.calls.length
  act(() => flushAnimationFrames())
  expect(forceGraphMock.__pauseAnimation).toHaveBeenCalledTimes(
    pauseCallsAfterUnmount
  )
})

test.each(['settings', 'graph'])(
  'resumes a stably paused simulation before %s update reheating',
  updateType => {
    jest.useFakeTimers()
    installControlledAnimationFrames()
    setReducedMotion(false)
    const view = render(
      React.createElement(KnowledgeGraphCanvas, {
        active: true,
        graph,
        settings: GRAPH_SETTINGS_DEFAULTS
      })
    )
    const props = forceGraphMock.__getForceGraphProps()

    act(() => {
      props.onEngineStop?.()
      flushAnimationFrames()
    })
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

    expect(forceGraphMock.__resumeAnimation).toHaveBeenCalledTimes(1)
    expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
    act(() => jest.advanceTimersByTime(80))
    expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
    expect(
      forceGraphMock.__resumeAnimation.mock.invocationCallOrder[0]
    ).toBeLessThan(
      forceGraphMock.__reheatSimulation.mock.invocationCallOrder[0]!
    )
  }
)

test('resumes a stably paused simulation before reduced-motion reheating', () => {
  jest.useFakeTimers()
  installControlledAnimationFrames()
  setReducedMotion(false)
  render(
    React.createElement(KnowledgeGraphCanvas, {
      active: true,
      graph,
      settings: GRAPH_SETTINGS_DEFAULTS
    })
  )
  const props = forceGraphMock.__getForceGraphProps()

  act(() => {
    props.onEngineStop?.()
    flushAnimationFrames()
  })
  forceGraphMock.__resumeAnimation.mockClear()
  forceGraphMock.__reheatSimulation.mockClear()

  changeReducedMotion(true)

  expect(forceGraphMock.__resumeAnimation).toHaveBeenCalledTimes(1)
  expect(forceGraphMock.__reheatSimulation).not.toHaveBeenCalled()
  act(() => jest.advanceTimersByTime(80))
  expect(forceGraphMock.__reheatSimulation).toHaveBeenCalledTimes(1)
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
