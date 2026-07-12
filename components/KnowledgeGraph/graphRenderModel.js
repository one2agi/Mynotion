import { edgeHasOutboundOrigin, getOutboundNeighborIds } from './graphView'

const AUTO_LABEL_ZOOM_THRESHOLD = 1.5

const getEndpointId = endpoint =>
  endpoint && typeof endpoint === 'object' ? endpoint.id : endpoint

export const getGraphEdgeKey = edge =>
  [getEndpointId(edge.source), getEndpointId(edge.target)].sort().join(':')

export const createGraphFocusModel = (graph, selectedNodeId) => {
  const outbound = selectedNodeId
    ? getOutboundNeighborIds(graph, selectedNodeId)
    : new Set()
  const focusedNodeIds = new Set(
    selectedNodeId ? [selectedNodeId, ...outbound] : []
  )
  const focusedEdgeKeys = new Set(
    graph.edges
      .filter(
        edge =>
          selectedNodeId &&
          edgeHasOutboundOrigin(edge, selectedNodeId) &&
          (edge.source === selectedNodeId || edge.target === selectedNodeId)
      )
      .map(getGraphEdgeKey)
  )

  return { focusedEdgeKeys, focusedNodeIds }
}

export const shouldDrawLabel = ({ mode, hovered, selected, zoom }) => {
  if (mode === 'never' || mode === 'hidden') return false
  if (mode === 'always') return true
  if (hovered || selected) return true
  return Number(zoom) >= AUTO_LABEL_ZOOM_THRESHOLD
}
