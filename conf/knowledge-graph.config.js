const parseBoolean = value => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  return normalized === 'true' || normalized === '1'
}

const parseDepth = value => {
  const normalized = String(value ?? '').trim()
  if (!normalized) return 2
  const depth = Number(normalized)
  if (!Number.isFinite(depth)) return 2
  return Math.min(2, Math.max(1, Math.trunc(depth)))
}

module.exports = {
  KNOWLEDGE_GRAPH_ENABLE: parseBoolean(
    process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE
  ),
  KNOWLEDGE_GRAPH_DEPTH: parseDepth(
    process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_DEPTH
  )
}
