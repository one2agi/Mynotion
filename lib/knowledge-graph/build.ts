import type {
  GraphEdge,
  PageSnapshotMap,
  PublicGraph,
  PublishedPage
} from './types'

const edgeKey = (a: string, b: string): string => [a, b].sort().join(':')

export function buildPublicGraph(
  pages: PublishedPage[],
  snapshots: PageSnapshotMap
): PublicGraph {
  const nodes = pages.map(({ id, title, slug, icon }) => ({
    id,
    title,
    slug,
    ...(icon ? { icon } : {})
  }))
  const published = new Set(nodes.map(node => node.id))
  const edges = new Map<string, GraphEdge>()

  for (const node of nodes) {
    for (const target of snapshots[node.id]?.links ?? []) {
      if (target === node.id || !published.has(target)) continue

      const sortedIds = [node.id, target].sort()
      const source = sortedIds[0]
      const normalizedTarget = sortedIds[1]
      if (source === undefined || normalizedTarget === undefined) continue

      edges.set(edgeKey(source, normalizedTarget), {
        source,
        target: normalizedTarget
      })
    }
  }

  return {
    nodes,
    edges: Array.from(edges.values()).sort((a, b) =>
      edgeKey(a.source, a.target).localeCompare(edgeKey(b.source, b.target))
    )
  }
}
