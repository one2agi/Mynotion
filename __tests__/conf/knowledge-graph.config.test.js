const ENV_KEYS = [
  'NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE',
  'KNOWLEDGE_GRAPH_REFRESH_MINUTES',
  'NEXT_PUBLIC_KNOWLEDGE_GRAPH_DEPTH',
  'KNOWLEDGE_GRAPH_STORE'
]

const originalEnv = Object.fromEntries(
  ENV_KEYS.map(key => [key, process.env[key]])
)

afterEach(() => {
  jest.resetModules()
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

test('exports secure knowledge graph defaults', () => {
  for (const key of ENV_KEYS) delete process.env[key]

  expect(require('@/conf/knowledge-graph.config')).toEqual({
    KNOWLEDGE_GRAPH_ENABLE: false,
    KNOWLEDGE_GRAPH_REFRESH_MINUTES: 10,
    KNOWLEDGE_GRAPH_DEPTH: 2,
    KNOWLEDGE_GRAPH_STORE: 'notionnext-knowledge-graph'
  })
})

test('uses public environment variables only for browser-safe settings', () => {
  process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE = 'true'
  process.env.KNOWLEDGE_GRAPH_REFRESH_MINUTES = '15'
  process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_DEPTH = '3'
  process.env.KNOWLEDGE_GRAPH_STORE = 'private-store'

  expect(require('@/conf/knowledge-graph.config')).toEqual({
    KNOWLEDGE_GRAPH_ENABLE: 'true',
    KNOWLEDGE_GRAPH_REFRESH_MINUTES: '15',
    KNOWLEDGE_GRAPH_DEPTH: '3',
    KNOWLEDGE_GRAPH_STORE: 'private-store'
  })
})
