import {
  createNotionTransport,
  isProxyChannelError
} from '@/lib/db/notion/notionTransport'

function client(method) {
  return { getPage: jest.fn(method) }
}

function responseError(status, headers = {}) {
  const error = new Error(`HTTP ${status}`)
  error.response = {
    status,
    headers: new Headers(headers)
  }
  return error
}

describe('Notion Worker/direct transport', () => {
  test('uses direct mode when proxy configuration is disabled', async () => {
    const proxyClient = client(() => Promise.resolve({ source: 'worker' }))
    const directClient = client(() => Promise.resolve({ source: 'direct' }))
    const transport = createNotionTransport({
      proxyClient,
      directClient,
      proxyEnabled: false,
      logger: { info: jest.fn(), warn: jest.fn() }
    })

    await expect(transport.call('getPage', 'page-id')).resolves.toEqual({
      source: 'direct'
    })
    expect(proxyClient.getPage).not.toHaveBeenCalled()
    expect(directClient.getPage).toHaveBeenCalledWith('page-id')
  })

  test('returns Worker success without touching direct Notion', async () => {
    const proxyClient = client(() => Promise.resolve({ source: 'worker' }))
    const directClient = client(() => Promise.resolve({ source: 'direct' }))
    const transport = createNotionTransport({
      proxyClient,
      directClient,
      proxyEnabled: true,
      logger: { info: jest.fn(), warn: jest.fn() }
    })

    await expect(transport.call('getPage', 'page-id')).resolves.toEqual({
      source: 'worker'
    })
    expect(proxyClient.getPage).toHaveBeenCalledTimes(1)
    expect(directClient.getPage).not.toHaveBeenCalled()
    expect(transport.getState().open).toBe(false)
  })

  test('falls back once and opens the circuit after a network failure', async () => {
    let now = 1_000
    const proxyClient = client(() =>
      Promise.reject(new TypeError('fetch failed'))
    )
    const directClient = client(() =>
      Promise.resolve({ source: 'direct-fallback' })
    )
    const transport = createNotionTransport({
      proxyClient,
      directClient,
      proxyEnabled: true,
      circuitMs: 60_000,
      now: () => now,
      logger: { info: jest.fn(), warn: jest.fn() }
    })

    await expect(transport.call('getPage', 'page-id')).resolves.toEqual({
      source: 'direct-fallback'
    })
    expect(transport.getState()).toEqual({
      open: true,
      openUntil: 61_000
    })

    now = 20_000
    await transport.call('getPage', 'second-page')
    expect(proxyClient.getPage).toHaveBeenCalledTimes(1)
    expect(directClient.getPage).toHaveBeenCalledTimes(2)
  })

  test('probes Worker after the circuit expires and closes on success', async () => {
    let now = 10_000
    let shouldFail = true
    const proxyClient = client(() => {
      if (shouldFail) return Promise.reject(responseError(502))
      return Promise.resolve({ source: 'worker-recovered' })
    })
    const directClient = client(() => Promise.resolve({ source: 'direct' }))
    const transport = createNotionTransport({
      proxyClient,
      directClient,
      proxyEnabled: true,
      circuitMs: 1_000,
      now: () => now,
      logger: { info: jest.fn(), warn: jest.fn() }
    })

    await transport.call('getPage', 'page-id')
    now = 11_001
    shouldFail = false

    await expect(transport.call('getPage', 'page-id')).resolves.toEqual({
      source: 'worker-recovered'
    })
    expect(proxyClient.getPage).toHaveBeenCalledTimes(2)
    expect(transport.getState()).toEqual({ open: false, openUntil: 0 })
  })

  test.each([400, 401, 403, 404, 429])(
    'does not use direct fallback for a forwarded Notion %s response',
    async status => {
      const upstreamError = responseError(status, {
        'x-notion-proxy-upstream': 'notion'
      })
      const proxyClient = client(() => Promise.reject(upstreamError))
      const directClient = client(() => Promise.resolve({ source: 'direct' }))
      const transport = createNotionTransport({
        proxyClient,
        directClient,
        proxyEnabled: true,
        logger: { info: jest.fn(), warn: jest.fn() }
      })

      await expect(transport.call('getPage', 'page-id')).rejects.toBe(
        upstreamError
      )
      expect(directClient.getPage).not.toHaveBeenCalled()
      expect(transport.getState().open).toBe(false)
    }
  )

  test.each([
    responseError(401),
    responseError(404),
    responseError(502, { 'x-notion-proxy-channel-error': '1' })
  ])('treats an unmarked Worker response as a channel error', error => {
    expect(isProxyChannelError(error)).toBe(true)
  })

  test('recognizes a forwarded Notion error as an upstream response', () => {
    expect(
      isProxyChannelError(
        responseError(503, { 'x-notion-proxy-upstream': 'notion' })
      )
    ).toBe(false)
  })
})
