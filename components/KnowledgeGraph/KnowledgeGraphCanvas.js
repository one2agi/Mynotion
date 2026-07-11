import ForceGraph2D from 'react-force-graph-2d'
import { useEffect, useRef, useState } from 'react'

const MIN_LABEL_ZOOM = 1.25

const documentIsDark = () =>
  typeof document !== 'undefined' &&
  document.documentElement.classList.contains('dark')

const KnowledgeGraphCanvas = ({
  active,
  currentId,
  graph,
  isDarkMode,
  onNodeClick
}) => {
  const graphRef = useRef(null)
  const [dimensions, setDimensions] = useState({ height: 480, width: 420 })
  const [documentDarkMode, setDocumentDarkMode] = useState(documentIsDark)

  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return

    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setDocumentDarkMode(root.classList.contains('dark'))
    })

    observer.observe(root, { attributeFilter: ['class'], attributes: true })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const updateDimensions = () => {
      setDimensions({
        height: Math.max(320, Math.min(window.innerHeight - 104, 720)),
        width: Math.min(420, window.innerWidth)
      })
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  useEffect(() => {
    if (!active) graphRef.current?.pauseAnimation()
  }, [active])

  useEffect(() => {
    const forceGraph = graphRef.current
    return () => forceGraph?.pauseAnimation()
  }, [])

  const darkMode = isDarkMode ?? documentDarkMode
  const backgroundColor = darkMode ? '#030712' : '#ffffff'
  const labelColor = darkMode ? '#e5e7eb' : '#1f2937'

  return (
    <ForceGraph2D
      backgroundColor={backgroundColor}
      cooldownTicks={120}
      enableNodeDrag={true}
      graphData={graph}
      height={dimensions.height}
      linkColor={() => (darkMode ? '#4b5563' : '#cbd5e1')}
      linkWidth={1}
      nodeCanvasObject={(node, context, globalScale) => {
        const label = globalScale >= MIN_LABEL_ZOOM ? node.title : ''
        const radius = node.id === currentId ? 7 : 5
        context.beginPath()
        context.arc(node.x, node.y, radius, 0, 2 * Math.PI)
        context.fillStyle = node.id === currentId ? '#0284c7' : '#64748b'
        context.fill()

        if (label) {
          context.font = `${12 / globalScale}px sans-serif`
          context.fillStyle = labelColor
          context.fillText(label, node.x + radius + 2, node.y + 3)
        }
      }}
      nodeLabel='title'
      onNodeClick={onNodeClick}
      ref={graphRef}
      width={dimensions.width}
    />
  )
}

export default KnowledgeGraphCanvas
