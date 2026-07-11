import { pathToFileURL } from 'node:url'

const PUBLIC_GRAPH_KEYS = ['edges', 'nodes']

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isRecord = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** @param {unknown} value */
const containsDraftMarker = value => {
  if (Array.isArray(value)) return value.some(containsDraftMarker)
  if (!isRecord(value)) {
    return typeof value === 'string' && value.toLowerCase() === 'draft'
  }

  return Object.entries(value).some(
    ([key, child]) => /draft/i.test(key) || containsDraftMarker(child)
  )
}

/**
 * @param {Response} response
 * @returns {Promise<unknown>}
 */
const readJson = async response => {
  try {
    // JSON has no runtime type information; the caller validates this value.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await response.json()
  } catch {
    throw new Error('response was not valid JSON')
  }
}

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   log?: (message: string) => void,
 *   url?: string
 * }} options
 */
export async function runKnowledgeGraphSmoke({
  fetchImpl = fetch,
  log = console.log,
  url
}) {
  if (!url) throw new Error('KNOWLEDGE_GRAPH_URL is required')

  const response = await fetchImpl(url, {
    headers: { accept: 'application/json' }
  })
  const body = await readJson(response)

  if (response.status === 202) {
    if (
      !isRecord(body) ||
      body.status !== 'initializing' ||
      Object.keys(body).length !== 1
    ) {
      throw new Error('initializing response contract mismatch')
    }

    log('knowledge-graph smoke: status=202 initializing')
    return { status: 202 }
  }

  if (response.status !== 200) {
    throw new Error('endpoint did not return 200 or 202')
  }

  if (!isRecord(body)) {
    throw new Error('public graph response contract mismatch')
  }

  const keys = Object.keys(body).sort()
  const nodes = body.nodes
  const edges = body.edges
  if (
    keys.length !== PUBLIC_GRAPH_KEYS.length ||
    keys.some((key, index) => key !== PUBLIC_GRAPH_KEYS[index]) ||
    !Array.isArray(nodes) ||
    !Array.isArray(edges)
  ) {
    throw new Error('public graph response contract mismatch')
  }
  if (containsDraftMarker(body)) {
    throw new Error('public graph contains a draft marker')
  }

  const result = {
    edges: edges.length,
    nodes: nodes.length,
    status: 200
  }
  log(
    `knowledge-graph smoke: status=200 nodes=${result.nodes} edges=${result.edges}`
  )
  return result
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  runKnowledgeGraphSmoke({ url: process.env.KNOWLEDGE_GRAPH_URL }).catch(() => {
    console.error('knowledge-graph smoke: request or validation failed')
    process.exitCode = 1
  })
}
