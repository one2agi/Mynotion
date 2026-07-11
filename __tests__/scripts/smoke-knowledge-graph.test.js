const response = (body, status) => ({
  json: () => Promise.resolve(body),
  status
})

test('accepts public graph and initializing responses while logging counts only', async () => {
  const { runKnowledgeGraphSmoke } =
    await import('@/scripts/smoke-knowledge-graph.mjs')
  const log = jest.fn()

  await expect(
    runKnowledgeGraphSmoke({
      fetchImpl: () =>
        Promise.resolve(
          response(
            {
              nodes: [{ id: 'a', title: 'A', slug: '/a' }],
              edges: []
            },
            200
          )
        ),
      log,
      url: 'https://secret.example/api/knowledge-graph'
    })
  ).resolves.toEqual({ edges: 0, nodes: 1, status: 200 })
  expect(log).toHaveBeenCalledWith(
    'knowledge-graph smoke: status=200 nodes=1 edges=0'
  )
  expect(log.mock.calls.flat().join(' ')).not.toContain('secret.example')

  await expect(
    runKnowledgeGraphSmoke({
      fetchImpl: () =>
        Promise.resolve(response({ status: 'initializing' }, 202)),
      log,
      url: 'https://secret.example/api/knowledge-graph'
    })
  ).resolves.toEqual({ status: 202 })
  expect(log).toHaveBeenLastCalledWith(
    'knowledge-graph smoke: status=202 initializing'
  )
})

test.each([
  ['unexpected top-level data', { nodes: [], edges: [], state: {} }],
  [
    'draft marker',
    { nodes: [{ id: 'a', title: 'A', slug: '/a', draft: true }], edges: [] }
  ]
])('rejects %s without logging response data', async (_, body) => {
  const { runKnowledgeGraphSmoke } =
    await import('@/scripts/smoke-knowledge-graph.mjs')
  const log = jest.fn()

  await expect(
    runKnowledgeGraphSmoke({
      fetchImpl: () => Promise.resolve(response(body, 200)),
      log,
      url: 'https://secret.example/api/knowledge-graph'
    })
  ).rejects.toThrow()
  expect(log).not.toHaveBeenCalled()
})
