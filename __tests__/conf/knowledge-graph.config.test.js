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
    KNOWLEDGE_GRAPH_DEPTH: 2
  })
})

test.each([
  [undefined, false],
  ['false', false],
  ['0', false],
  ['true', true],
  ['1', true]
])('parses the public enable value %p as %p', (value, expected) => {
  if (value === undefined) delete process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE
  else process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE = value

  expect(require('@/conf/knowledge-graph.config').KNOWLEDGE_GRAPH_ENABLE).toBe(
    expected
  )
})

test('exports only browser-safe knowledge graph settings', () => {
  process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_ENABLE = '1'
  process.env.KNOWLEDGE_GRAPH_REFRESH_MINUTES = '15'
  process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_DEPTH = '1'
  process.env.KNOWLEDGE_GRAPH_STORE = 'private-store'

  expect(require('@/conf/knowledge-graph.config')).toEqual({
    KNOWLEDGE_GRAPH_ENABLE: true,
    KNOWLEDGE_GRAPH_DEPTH: 1
  })
  expect(require('@/blog.config')).not.toHaveProperty(
    'KNOWLEDGE_GRAPH_REFRESH_MINUTES'
  )
  expect(require('@/blog.config')).not.toHaveProperty('KNOWLEDGE_GRAPH_STORE')
})

test.each([
  ['', 2],
  ['0', 1],
  ['1', 1],
  ['2', 2],
  ['3', 2],
  ['invalid', 2]
])('clamps public depth %p to %i', (value, expected) => {
  process.env.NEXT_PUBLIC_KNOWLEDGE_GRAPH_DEPTH = value

  expect(require('@/conf/knowledge-graph.config').KNOWLEDGE_GRAPH_DEPTH).toBe(
    expected
  )
})
