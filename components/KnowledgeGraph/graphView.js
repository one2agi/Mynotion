import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'

export const normalizeKnowledgeGraphDepth = value => {
  const depth = Number(value)
  if (!Number.isFinite(depth)) return 2
  return Math.min(2, Math.max(1, Math.trunc(depth)))
}

export const normalizeKnowledgeGraphId = value =>
  normalizePageId(value) ?? value

export const edgeHasOutboundOrigin = (edge, nodeId) =>
  Array.isArray(edge.origins)
    ? edge.origins.includes(nodeId)
    : edge.source === nodeId || edge.target === nodeId

export const getOutboundNeighborIds = (graph, nodeId) => {
  const neighbors = new Set()

  for (const edge of graph.edges) {
    if (!edgeHasOutboundOrigin(edge, nodeId)) continue
    if (edge.source === nodeId) neighbors.add(edge.target)
    else if (edge.target === nodeId) neighbors.add(edge.source)
  }

  return neighbors
}

export const selectGraphNeighborhood = (graph, currentId, depth) => {
  const currentNodeExists = graph.nodes.some(node => node.id === currentId)

  if (!currentNodeExists) {
    return {
      nodes: [...graph.nodes],
      edges: [...graph.edges]
    }
  }

  const distances = new Map([[currentId, 0]])
  const queue = [currentId]

  while (queue.length > 0) {
    const nodeId = queue.shift()
    const distance = distances.get(nodeId)

    if (nodeId === undefined || distance === undefined || distance >= depth) {
      continue
    }

    for (const neighbor of getOutboundNeighborIds(graph, nodeId)) {
      if (!distances.has(neighbor)) {
        distances.set(neighbor, distance + 1)
        queue.push(neighbor)
      }
    }
  }

  const included = new Set(distances.keys())

  return {
    nodes: graph.nodes.filter(node => included.has(node.id)),
    edges: graph.edges.filter(
      edge => included.has(edge.source) && included.has(edge.target)
    )
  }
}
