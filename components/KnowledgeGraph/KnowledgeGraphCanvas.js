import ForceGraph2D from 'react-force-graph-2d'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useKnowledgeGraphDarkMode } from './appearance'

const MIN_LABEL_ZOOM = 1.25
const MAX_LABEL_LENGTH = 25

export const cloneGraphForRenderer = graph => ({
  edges: graph.edges.map(edge => ({ ...edge })),
  nodes: graph.nodes.map(node => ({ ...node }))
})

export const getCanvasDimensions = ({ height, width }) => ({
  height: Math.max(0, Math.floor(height || 0)),
  width: Math.max(0, Math.floor(width || 0))
})

export const getCanvasLabel = (node, currentId, hoveredNodeId) => {
  const labelledNodeId = hoveredNodeId ?? currentId
  if (node.id !== labelledNodeId || !node.title) return ''

  return node.title.length > MAX_LABEL_LENGTH
    ? `${node.title.slice(0, MAX_LABEL_LENGTH - 3)}...`
    : node.title
}

export const clampCanvasLabelPosition = ({
  canvasHeight,
  canvasWidth,
  height,
  width,
  x,
  y
}) => ({
  x: Math.min(Math.max(x, -canvasWidth / 2), canvasWidth / 2 - width),
  y: Math.min(
    Math.max(y, -canvasHeight / 2 + height),
    canvasHeight / 2 - height
  )
})

const KnowledgeGraphCanvas = ({
  active,
  currentId,
  graph,
  isDarkMode,
  onNodeClick
}) => {
  const containerRef = useRef(null)
  const graphRef = useRef(null)
  const [dimensions, setDimensions] = useState({ height: 0, width: 0 })
  const [hoveredNodeId, setHoveredNodeId] = useState(null)
  const darkMode = useKnowledgeGraphDarkMode(isDarkMode)
  const rendererGraph = useMemo(() => cloneGraphForRenderer(graph), [graph])

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
    if (!active) graphRef.current?.pauseAnimation()
  }, [active])

  useEffect(() => {
    const forceGraph = graphRef.current
    return () => forceGraph?.pauseAnimation()
  }, [])

  const backgroundColor = darkMode ? '#030712' : '#ffffff'
  const labelColor = darkMode ? '#e5e7eb' : '#1f2937'

  return (
    <div className='h-full min-h-0 w-full overflow-hidden' ref={containerRef}>
      <ForceGraph2D
        backgroundColor={backgroundColor}
        cooldownTicks={120}
        enableNodeDrag={true}
        graphData={rendererGraph}
        height={dimensions.height}
        linkColor={() => (darkMode ? '#4b5563' : '#cbd5e1')}
        linkWidth={1}
        nodeCanvasObject={(node, context, globalScale) => {
          const radius = node.id === currentId ? 7 : 5
          context.beginPath()
          context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
          context.fillStyle = node.id === currentId ? '#0284c7' : '#64748b'
          context.fill()

          const label =
            globalScale >= MIN_LABEL_ZOOM
              ? getCanvasLabel(node, currentId, hoveredNodeId)
              : ''
          if (!label) return

          const fontSize = 12 / globalScale
          context.font = `${fontSize}px sans-serif`
          const position = clampCanvasLabelPosition({
            canvasHeight: context.canvas.height / globalScale,
            canvasWidth: context.canvas.width / globalScale,
            height: fontSize,
            width: context.measureText(label).width,
            x: node.x + radius + 2,
            y: node.y + fontSize / 3
          })
          context.fillStyle = labelColor
          context.fillText(label, position.x, position.y)
        }}
        nodeLabel='title'
        onNodeClick={onNodeClick}
        onNodeHover={node => setHoveredNodeId(node?.id ?? null)}
        ref={graphRef}
        width={dimensions.width}
      />
    </div>
  )
}

export default KnowledgeGraphCanvas
