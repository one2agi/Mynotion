export const normalizeKnowledgeGraphDepth = value => {
  const depth = Number(value)
  if (!Number.isFinite(depth)) return 2
  return Math.min(2, Math.max(1, Math.trunc(depth)))
}

export const normalizeKnowledgeGraphId = value => {
  if (typeof value !== 'string') return value
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
    ? value.replaceAll('-', '')
    : value
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

    for (const edge of graph.edges) {
      const neighbor =
        edge.source === nodeId
          ? edge.target
          : edge.target === nodeId
            ? edge.source
            : null

      if (neighbor !== null && !distances.has(neighbor)) {
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
