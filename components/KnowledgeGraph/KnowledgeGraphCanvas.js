import ForceGraph2D from 'react-force-graph-2d'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useKnowledgeGraphDarkMode } from './appearance'
import {
  createGraphFocusModel,
  getGraphEdgeKey,
  shouldDrawLabel
} from './graphRenderModel'
import { normalizeGraphSettings } from './graphSettings'

const DRAG_THRESHOLD = 4
const FOCUS_FADE_ALPHA = 0.16
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const POINTER_HIT_TOLERANCE_PX = 4
const PAN_IDLE_CUTOFF_MS = 500
const PAN_INERTIA_DURATION_MS = 240
const PAN_INERTIA_MAX_DISTANCE_PX = 120
const PAN_INERTIA_PROJECTION_MS = 160

const getPointerSample = event => ({
  time: Number.isFinite(event.timeStamp) ? event.timeStamp : performance.now(),
  x: event.clientX,
  y: event.clientY
})

export const cloneGraphForRenderer = graph => ({
  nodes: graph.nodes.map(node => ({ ...node })),
  links: graph.edges.map(edge => ({
    ...edge,
    ...(Array.isArray(edge.origins) ? { origins: [...edge.origins] } : {})
  }))
})

export const getCanvasDimensions = ({ height, width }) => ({
  height: Math.max(0, Math.floor(height || 0)),
  width: Math.max(0, Math.floor(width || 0))
})

const usePrefersReducedMotion = () => {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      Boolean(window.matchMedia?.(REDUCED_MOTION_QUERY).matches)
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia?.(REDUCED_MOTION_QUERY)
    if (!mediaQuery) return

    const updatePreference = event => setReducedMotion(event.matches)
    setReducedMotion(mediaQuery.matches)

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', updatePreference)
      return () => mediaQuery.removeEventListener('change', updatePreference)
    }

    mediaQuery.addListener?.(updatePreference)
    return () => mediaQuery.removeListener?.(updatePreference)
  }, [])

  return reducedMotion
}

const KnowledgeGraphCanvas = ({
  active,
  currentId,
  graph,
  isDarkMode,
  onBackgroundClick,
  onNodeClick,
  selectedNodeId,
  settings
}) => {
  const containerRef = useRef(null)
  const graphRef = useRef(null)
  const dragDistanceRef = useRef({ nodeId: null, x: 0, y: 0 })
  const pointerEventSessionsRef = useRef(new WeakMap())
  const pointerSessionRef = useRef(0)
  const hoveredNodeRef = useRef(null)
  const panPointerRef = useRef(null)
  const panInertiaFrameRef = useRef(null)
  const panInertiaTokenRef = useRef(0)
  const simulationPausedRef = useRef(!active)
  const suppressedClickRef = useRef(null)
  const [dimensions, setDimensions] = useState({ height: 0, width: 0 })
  const [hoveredNode, setHoveredNode] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState({
    left: 8,
    maxHeight: 0,
    top: 8,
    translateX: '0%',
    translateY: '0%'
  })
  const darkMode = useKnowledgeGraphDarkMode(isDarkMode)
  const reducedMotion = usePrefersReducedMotion()
  const normalizedSettings = useMemo(
    () => normalizeGraphSettings(settings),
    [settings]
  )
  const rendererGraph = useMemo(() => cloneGraphForRenderer(graph), [graph])
  const focusModel = useMemo(
    () => createGraphFocusModel(graph, selectedNodeId),
    [graph, selectedNodeId]
  )
  const hasFocus = Boolean(selectedNodeId)

  const clearHoveredNode = useCallback(() => {
    hoveredNodeRef.current = null
    setHoveredNode(null)
  }, [])

  const cancelPanInertia = useCallback(() => {
    panInertiaTokenRef.current += 1
    if (panInertiaFrameRef.current !== null) {
      window.cancelAnimationFrame(panInertiaFrameRef.current)
      panInertiaFrameRef.current = null
    }
  }, [])

  const startPanInertia = useCallback(
    velocity => {
      if (!active || reducedMotion) return

      const forceGraph = graphRef.current
      const viewportCenter = forceGraph?.centerAt?.()
      const zoom = Number(forceGraph?.zoom?.())
      if (
        !Number.isFinite(viewportCenter?.x) ||
        !Number.isFinite(viewportCenter?.y) ||
        !Number.isFinite(zoom) ||
        zoom <= 0
      ) {
        return
      }

      const screenSpeed = Math.hypot(velocity.x, velocity.y)
      if (screenSpeed <= 0) return

      const projectedDistance = Math.min(
        screenSpeed * PAN_INERTIA_PROJECTION_MS,
        PAN_INERTIA_MAX_DISTANCE_PX
      )
      const targetCenter = {
        x:
          viewportCenter.x -
          (velocity.x / screenSpeed) * (projectedDistance / zoom),
        y:
          viewportCenter.y -
          (velocity.y / screenSpeed) * (projectedDistance / zoom)
      }
      const token = panInertiaTokenRef.current + 1
      panInertiaTokenRef.current = token
      let startTime = null

      const frame = frameTime => {
        if (token !== panInertiaTokenRef.current) return

        if (startTime === null) startTime = frameTime
        const progress = Math.min(
          Math.max(0, frameTime - startTime) / PAN_INERTIA_DURATION_MS,
          1
        )
        const easedProgress = 1 - Math.pow(1 - progress, 3)
        forceGraph.centerAt(
          viewportCenter.x +
            (targetCenter.x - viewportCenter.x) * easedProgress,
          viewportCenter.y + (targetCenter.y - viewportCenter.y) * easedProgress
        )

        if (progress >= 1) {
          panInertiaFrameRef.current = null
          return
        }
        panInertiaFrameRef.current = window.requestAnimationFrame(frame)
      }

      panInertiaFrameRef.current = window.requestAnimationFrame(frame)
    },
    [active, reducedMotion]
  )

  useEffect(() => {
    if (!active || reducedMotion) cancelPanInertia()
    return cancelPanInertia
  }, [active, cancelPanInertia, reducedMotion])

  useEffect(() => {
    const measure = () => {
      const bounds = containerRef.current?.getBoundingClientRect()
      setDimensions(getCanvasDimensions(bounds ?? {}))
    }

    measure()
    if (typeof ResizeObserver === 'undefined' || !containerRef.current) return

    const observer = new ResizeObserver(measure)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const forceGraph = graphRef.current
    const chargeForce = forceGraph?.d3Force?.('charge')
    const linkForce = forceGraph?.d3Force?.('link')
    const centerForce = forceGraph?.d3Force?.('center')

    chargeForce?.strength?.(-normalizedSettings.repelStrength)
    linkForce?.distance?.(normalizedSettings.linkDistance)
    linkForce?.strength?.(normalizedSettings.linkStrength)
    centerForce?.strength?.(normalizedSettings.centerStrength)

    if (!active) {
      forceGraph?.pauseAnimation?.()
      simulationPausedRef.current = true
      return
    }

    if (simulationPausedRef.current) {
      forceGraph?.resumeAnimation?.()
      simulationPausedRef.current = false
    }
    const reheatTimer = window.setTimeout(() => {
      if (simulationPausedRef.current) {
        forceGraph?.resumeAnimation?.()
        simulationPausedRef.current = false
      }
      forceGraph?.d3ReheatSimulation?.()
    }, 80)
    return () => window.clearTimeout(reheatTimer)
  }, [active, normalizedSettings, reducedMotion, rendererGraph])

  useEffect(() => {
    const forceGraph = graphRef.current
    return () => {
      cancelPanInertia()
      forceGraph?.pauseAnimation?.()
    }
  }, [cancelPanInertia])

  useEffect(() => {
    if (!active || !selectedNodeId) return

    const frame = window.requestAnimationFrame(() => {
      const node = rendererGraph.nodes.find(node => node.id === selectedNodeId)
      if (!Number.isFinite(node?.x) || !Number.isFinite(node?.y)) return

      const forceGraph = graphRef.current
      forceGraph?.centerAt?.(node.x, node.y, 300)
      const currentZoom = Number(forceGraph?.zoom?.())
      if (Number.isFinite(currentZoom) && currentZoom < 1.4) {
        forceGraph?.zoom?.(1.4, 300)
      }
    })

    return () => window.cancelAnimationFrame(frame)
  }, [active, rendererGraph, selectedNodeId])

  const handleNodeDrag = useCallback(
    (node, translate = {}) => {
      if (panPointerRef.current) {
        panPointerRef.current.nodeDriven = true
        cancelPanInertia()
      }
      if (dragDistanceRef.current.nodeId !== node.id) {
        dragDistanceRef.current = { nodeId: node.id, x: 0, y: 0 }
      }

      dragDistanceRef.current.x += translate.x || 0
      dragDistanceRef.current.y += translate.y || 0
      const distance = Math.hypot(
        dragDistanceRef.current.x,
        dragDistanceRef.current.y
      )
      if (distance >= DRAG_THRESHOLD) {
        suppressedClickRef.current = {
          pointerSession: pointerSessionRef.current
        }
      }
    },
    [cancelPanInertia]
  )

  const handleNodeDragEnd = useCallback(
    (_node, translate = {}) => {
      if (panPointerRef.current) {
        panPointerRef.current.nodeDriven = true
        cancelPanInertia()
      }
      if (Math.hypot(translate.x || 0, translate.y || 0) >= DRAG_THRESHOLD) {
        suppressedClickRef.current = {
          pointerSession: pointerSessionRef.current
        }
      }
      dragDistanceRef.current = { nodeId: null, x: 0, y: 0 }
    },
    [cancelPanInertia]
  )

  const handleNodeClick = useCallback(
    (node, _pointerUpEvent, pointerDownEvent) => {
      panPointerRef.current = null
      cancelPanInertia()
      dragDistanceRef.current = { nodeId: null, x: 0, y: 0 }
      const pointerSession =
        pointerDownEvent && typeof pointerDownEvent === 'object'
          ? pointerEventSessionsRef.current.get(pointerDownEvent)
          : undefined
      const clickSession = pointerSession ?? pointerSessionRef.current
      if (suppressedClickRef.current?.pointerSession === clickSession) {
        suppressedClickRef.current = null
        return
      }
      onNodeClick?.(node)
    },
    [cancelPanInertia, onNodeClick]
  )

  const handlePointerDownCapture = useCallback(
    event => {
      cancelPanInertia()
      const pointerSession = pointerSessionRef.current + 1
      pointerSessionRef.current = pointerSession
      if (event.nativeEvent && typeof event.nativeEvent === 'object') {
        pointerEventSessionsRef.current.set(event.nativeEvent, pointerSession)
      }
      if (event.button !== 0 || event.isPrimary === false) {
        panPointerRef.current = null
        return
      }
      panPointerRef.current = {
        lastSample: getPointerSample(event),
        nodeDriven: Boolean(hoveredNodeRef.current),
        pointerId: event.pointerId,
        previousSample: null
      }
    },
    [cancelPanInertia]
  )

  const handlePointerMoveCapture = useCallback(event => {
    const pointerSession = panPointerRef.current
    if (!pointerSession || pointerSession.pointerId !== event.pointerId) return

    pointerSession.previousSample = pointerSession.lastSample
    pointerSession.lastSample = getPointerSample(event)
  }, [])

  const handlePointerUpCapture = useCallback(
    event => {
      const pointerSession = panPointerRef.current
      panPointerRef.current = null
      if (
        !pointerSession ||
        pointerSession.pointerId !== event.pointerId ||
        pointerSession.nodeDriven ||
        !pointerSession.previousSample ||
        !active ||
        reducedMotion
      ) {
        return
      }

      const releaseTime = getPointerSample(event).time
      if (releaseTime - pointerSession.lastSample.time >= PAN_IDLE_CUTOFF_MS) {
        return
      }

      const duration =
        pointerSession.lastSample.time - pointerSession.previousSample.time
      if (duration <= 0) return

      const velocity = {
        x:
          (pointerSession.lastSample.x - pointerSession.previousSample.x) /
          duration,
        y:
          (pointerSession.lastSample.y - pointerSession.previousSample.y) /
          duration
      }
      startPanInertia(velocity)
    },
    [active, reducedMotion, startPanInertia]
  )

  const handlePointerCancelCapture = useCallback(() => {
    panPointerRef.current = null
    clearHoveredNode()
    cancelPanInertia()
  }, [cancelPanInertia, clearHoveredNode])

  const handleWheelCapture = useCallback(() => {
    panPointerRef.current = null
    cancelPanInertia()
  }, [cancelPanInertia])

  const backgroundColor = darkMode ? '#030712' : '#ffffff'
  const accentColor = darkMode ? '#38bdf8' : '#0284c7'
  const defaultLinkColor = darkMode ? '#4b5563' : '#cbd5e1'
  const defaultNodeColor = darkMode ? '#94a3b8' : '#64748b'
  const labelColor = darkMode ? '#e5e7eb' : '#1f2937'
  const handleNodeHover = useCallback(node => {
    const hoveredNode = node || null
    hoveredNodeRef.current = hoveredNode
    setHoveredNode(hoveredNode)
  }, [])
  const handlePointerMove = event => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) return

    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const horizontalPadding = 8
    const verticalPadding = 8
    const top = Math.min(
      Math.max(y, verticalPadding),
      Math.max(verticalPadding, bounds.height - verticalPadding)
    )
    const showBelowPointer = y <= bounds.height / 2

    setTooltipPosition({
      left: Math.min(
        Math.max(x, horizontalPadding),
        Math.max(horizontalPadding, bounds.width - horizontalPadding)
      ),
      maxHeight: Math.max(
        0,
        showBelowPointer
          ? bounds.height - top - verticalPadding
          : top - verticalPadding
      ),
      top,
      translateX: x > bounds.width / 2 ? '-100%' : '0%',
      translateY: showBelowPointer ? '0%' : '-100%'
    })
  }

  const getRenderedNodeRadius = node =>
    normalizedSettings.nodeSize +
    (node.id === selectedNodeId ? 2 : node.id === currentId ? 1 : 0)

  return (
    <div
      className='relative h-full min-h-0 w-full overflow-hidden'
      onPointerLeave={clearHoveredNode}
      onPointerCancelCapture={handlePointerCancelCapture}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onWheelCapture={handleWheelCapture}
      onMouseMove={handlePointerMove}
      ref={containerRef}
    >
      <ForceGraph2D
        autoPauseRedraw={true}
        backgroundColor={backgroundColor}
        cooldownTicks={reducedMotion ? 1 : 80}
        d3AlphaDecay={reducedMotion ? 1 : 0.04}
        d3VelocityDecay={0.45}
        enableNodeDrag={true}
        graphData={rendererGraph}
        height={dimensions.height}
        linkColor={link => {
          if (!hasFocus) return defaultLinkColor
          return focusModel.focusedEdgeKeys.has(getGraphEdgeKey(link))
            ? accentColor
            : darkMode
              ? 'rgba(75, 85, 99, 0.16)'
              : 'rgba(148, 163, 184, 0.16)'
        }}
        linkWidth={link =>
          hasFocus && focusModel.focusedEdgeKeys.has(getGraphEdgeKey(link))
            ? normalizedSettings.linkWidth * 1.5
            : normalizedSettings.linkWidth
        }
        maxZoom={4}
        minZoom={0.6}
        nodeCanvasObject={(node, context, globalScale) => {
          const selected = node.id === selectedNodeId
          const current = node.id === currentId
          const focused = !hasFocus || focusModel.focusedNodeIds.has(node.id)
          const nodeAlpha = focused ? 1 : FOCUS_FADE_ALPHA
          const radius = getRenderedNodeRadius(node)

          context.save?.()
          context.globalAlpha = nodeAlpha
          context.beginPath()
          context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
          context.fillStyle =
            selected || current || (hasFocus && focused)
              ? accentColor
              : defaultNodeColor
          context.fill()

          if (
            node.title &&
            shouldDrawLabel({
              hovered: hoveredNode?.id === node.id,
              mode: normalizedSettings.labelMode,
              selected,
              zoom: globalScale
            })
          ) {
            const zoom = Math.max(0.1, Number(globalScale) || 1)
            context.globalAlpha = nodeAlpha * normalizedSettings.labelOpacity
            context.fillStyle = labelColor
            context.font = `${12 / zoom}px sans-serif`
            context.textAlign = 'center'
            context.textBaseline = 'top'
            context.fillText?.(node.title, node.x, node.y + radius + 3 / zoom)
          }
          context.restore?.()
        }}
        nodePointerAreaPaint={(node, color, context, globalScale) => {
          const zoom = Math.max(0.1, Number(globalScale) || 1)
          context.beginPath()
          context.arc(
            node.x,
            node.y,
            getRenderedNodeRadius(node) + POINTER_HIT_TOLERANCE_PX / zoom,
            0,
            2 * Math.PI
          )
          context.fillStyle = color
          context.fill()
        }}
        onBackgroundClick={onBackgroundClick}
        onNodeClick={handleNodeClick}
        onNodeDrag={handleNodeDrag}
        onNodeDragEnd={handleNodeDragEnd}
        onNodeHover={handleNodeHover}
        ref={graphRef}
        width={dimensions.width}
      />
      {hoveredNode?.title ? (
        <div
          className='pointer-events-none absolute z-10 max-w-[calc(100%-1rem)] overflow-auto break-all rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900'
          data-testid='knowledge-graph-tooltip'
          style={{
            left: tooltipPosition.left,
            maxHeight: tooltipPosition.maxHeight,
            top: tooltipPosition.top,
            transform: `translate(${tooltipPosition.translateX}, ${tooltipPosition.translateY})`
          }}
        >
          {hoveredNode.title}
        </div>
      ) : null}
    </div>
  )
}

export default KnowledgeGraphCanvas
