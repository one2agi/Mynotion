import ForceGraph2D from 'react-force-graph-2d'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useKnowledgeGraphDarkMode } from './appearance'

export const cloneGraphForRenderer = graph => ({
  nodes: graph.nodes.map(node => ({ ...node })),
  links: graph.edges.map(edge => ({ ...edge }))
})

export const getCanvasDimensions = ({ height, width }) => ({
  height: Math.max(0, Math.floor(height || 0)),
  width: Math.max(0, Math.floor(width || 0))
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
  const [hoveredNode, setHoveredNode] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState({
    left: 8,
    top: 8,
    translateX: '0%',
    translateY: '0%'
  })
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
  const handleNodeHover = node => setHoveredNode(node || null)
  const handlePointerMove = event => {
    const bounds = containerRef.current?.getBoundingClientRect()
    if (!bounds) return

    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    const horizontalPadding = 8
    const verticalPadding = 8

    setTooltipPosition({
      left: Math.min(
        Math.max(x, horizontalPadding),
        Math.max(horizontalPadding, bounds.width - horizontalPadding)
      ),
      top: Math.min(
        Math.max(y, verticalPadding),
        Math.max(verticalPadding, bounds.height - verticalPadding)
      ),
      translateX: x > bounds.width / 2 ? '-100%' : '0%',
      translateY: y > bounds.height / 2 ? '-100%' : '0%'
    })
  }

  return (
    <div
      className='relative h-full min-h-0 w-full overflow-hidden'
      onPointerLeave={() => setHoveredNode(null)}
      onMouseMove={handlePointerMove}
      ref={containerRef}
    >
      <ForceGraph2D
        backgroundColor={backgroundColor}
        cooldownTicks={120}
        enableNodeDrag={true}
        graphData={rendererGraph}
        height={dimensions.height}
        linkColor={() => (darkMode ? '#4b5563' : '#cbd5e1')}
        linkWidth={1}
        nodeCanvasObject={(node, context) => {
          const radius = node.id === currentId ? 7 : 5
          context.beginPath()
          context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
          context.fillStyle = node.id === currentId ? '#0284c7' : '#64748b'
          context.fill()
        }}
        onNodeClick={onNodeClick}
        onNodeHover={handleNodeHover}
        ref={graphRef}
        width={dimensions.width}
      />
      {hoveredNode?.title ? (
        <div
          className='pointer-events-none absolute z-10 max-w-[calc(100%-1rem)] break-all rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-gray-100 dark:text-gray-900'
          data-testid='knowledge-graph-tooltip'
          style={{
            left: tooltipPosition.left,
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
