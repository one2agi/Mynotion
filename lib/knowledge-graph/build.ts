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
  const normalizedSnapshots = normalizeSnapshotMap(snapshots)
  const nodesById = new Map<string, GraphNode>()

  for (const { id, title, slug, href, icon } of pages) {
    const normalizedId = normalizePageId(id)
    if (!normalizedId || nodesById.has(normalizedId)) continue

    nodesById.set(normalizedId, {
      id: normalizedId,
      title,
      slug,
      ...(href ? { href } : {}),
      ...(icon ? { icon } : {})
    })
  }

  const nodes = Array.from(nodesById.values())
  const published = new Set(nodes.map(node => node.id))
  const edges = new Map<string, GraphEdge>()

  for (const node of nodes) {
    for (const target of normalizedSnapshots.get(node.id) ?? []) {
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

function normalizeSnapshotMap(
  snapshots: PageSnapshotMap
): Map<string, string[]> {
  const normalizedSnapshots = new Map<string, string[]>()

  for (const [id, snapshot] of Object.entries(snapshots)) {
    const normalizedId = normalizePageId(id)
    if (!normalizedId) continue

    const links = normalizedSnapshots.get(normalizedId) ?? []
    links.push(...(snapshot?.links ?? []))
    normalizedSnapshots.set(normalizedId, links)
  }

  return normalizedSnapshots
}
