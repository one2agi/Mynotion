/** @jest-environment node */

import {
  CHANNEL_ERROR_HEADER,
  PROXY_TOKEN_HEADER,
  UPSTREAM_HEADER,
  handleRequest
} from '@/cloudflare/notion-api-proxy/src/worker'

const TOKEN = 'test-proxy-token'
const ENV = { NOTION_PROXY_TOKEN: TOKEN }

function proxyRequest(path = '/api/v3/loadPageChunk', init = {}) {
  return new Request(`https://proxy.example.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: 'token_v2=test-notion-token',
      'x-notion-active-user-header': 'user-id',
      [PROXY_TOKEN_HEADER]: TOKEN,
      ...(init.headers || {})
    },
    body: init.body || JSON.stringify({ pageId: 'fixture-page-id' })
  })
}

describe('Cloudflare Notion API proxy', () => {
  test('reports health without exposing configuration', async () => {
    const response = await handleRequest(
      new Request('https://proxy.example.com/health'),
      ENV,
      {},
      jest.fn()
    )

    const body = await response.text()
    expect(response.status).toBe(200)
    expect(JSON.parse(body)).toEqual({ ok: true })
    expect(body).not.toContain(TOKEN)
  })

  test('rejects a missing proxy credential without calling upstream', async () => {
    const fetchImpl = jest.fn()
    const request = proxyRequest('/api/v3/loadPageChunk', {
      headers: { [PROXY_TOKEN_HEADER]: '' }
    })

    const response = await handleRequest(request, ENV, {}, fetchImpl)

    expect(response.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test.each([
    ['GET', '/api/v3/loadPageChunk', 405],
    ['POST', '/not-allowed', 404]
  ])('rejects %s %s', async (method, path, status) => {
    const request = new Request(`https://proxy.example.com${path}`, {
      method,
      headers: { [PROXY_TOKEN_HEADER]: TOKEN },
      body: method === 'POST' ? '{}' : undefined
    })
    const fetchImpl = jest.fn()

    const response = await handleRequest(request, ENV, {}, fetchImpl)

    expect(response.status).toBe(status)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('forwards a real API transport fixture and removes proxy metadata', async () => {
    const upstreamFixture = {
      recordMap: {
        block: {
          'fixture-page-id': { value: { id: 'fixture-page-id', type: 'page' } }
        }
      }
    }
    let forwardedRequest
    const fetchImpl = jest.fn(async request => {
      forwardedRequest = request
      return new Response(JSON.stringify(upstreamFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    })
    const request = proxyRequest('/api/v3/loadPageChunk?src=initial_load')

    const response = await handleRequest(request, ENV, {}, fetchImpl)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(forwardedRequest.url).toBe(
      'https://www.notion.so/api/v3/loadPageChunk?src=initial_load'
    )
    expect(forwardedRequest.method).toBe('POST')
    expect(forwardedRequest.headers.get(PROXY_TOKEN_HEADER)).toBeNull()
    expect(forwardedRequest.headers.get('cookie')).toBe(
      'token_v2=test-notion-token'
    )
    expect(forwardedRequest.headers.get('x-notion-active-user-header')).toBe(
      'user-id'
    )
    expect(await forwardedRequest.json()).toEqual({
      pageId: 'fixture-page-id'
    })
    expect(response.headers.get(UPSTREAM_HEADER)).toBe('notion')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual(upstreamFixture)
  })

  test('marks an upstream network exception as a generic channel failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('sensitive upstream detail')
    })

    const response = await handleRequest(proxyRequest(), ENV, {}, fetchImpl)
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(response.headers.get(CHANNEL_ERROR_HEADER)).toBe('1')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).not.toContain('sensitive upstream detail')
    expect(body).not.toContain(TOKEN)
  })
})
