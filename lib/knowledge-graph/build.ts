import type {
  GraphEdge,
  GraphNode,
  PageSnapshotMap,
  PublicGraph,
  PublishedPage
} from './types'
import { normalizePageId } from './extract'

const edgeKey = (a: string, b: string): string => [a, b].sort().join(':')

export function buildPublicGraph(
  pages: PublishedPage[],
  snapshots: PageSnapshotMap
): PublicGraph {
  const nodes: GraphNode[] = pages.flatMap(({ id, title, slug, icon }) => {
    const normalizedId = normalizePageId(id)
    if (!normalizedId) return []

    return [
      {
        id: normalizedId,
        title,
        slug,
        ...(icon ? { icon } : {})
      }
    ]
  })
  const published = new Set(nodes.map(node => node.id))
  const edges = new Map<string, GraphEdge>()

  for (const node of nodes) {
    for (const target of snapshots[node.id]?.links ?? []) {
      const normalizedTarget = normalizePageId(target)
      if (
        !normalizedTarget ||
        normalizedTarget === node.id ||
        !published.has(normalizedTarget)
      ) {
        continue
      }

      const sortedIds = [node.id, normalizedTarget].sort()
      const source = sortedIds[0]
      const targetId = sortedIds[1]
      if (source === undefined || targetId === undefined) continue

      edges.set(edgeKey(source, targetId), {
        source,
        target: targetId
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
