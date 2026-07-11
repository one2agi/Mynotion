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

const createNodeLabel = node => {
  const label = document.createElement('span')
  label.textContent = node?.title || ''
  return label
}

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
        nodeCanvasObject={(node, context) => {
          const radius = node.id === currentId ? 7 : 5
          context.beginPath()
          context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
          context.fillStyle = node.id === currentId ? '#0284c7' : '#64748b'
          context.fill()
        }}
        nodeLabel={createNodeLabel}
        onNodeClick={onNodeClick}
        ref={graphRef}
        width={dimensions.width}
      />
    </div>
  )
}

export default KnowledgeGraphCanvas
