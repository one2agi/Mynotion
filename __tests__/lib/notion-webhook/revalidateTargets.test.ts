/** @jest-environment node */

declare const describe: any
declare const expect: any
declare const jest: any
declare const test: any

import { revalidateContentPath } from '@/lib/notion-webhook/revalidateTargets'

describe('dual-site revalidation target', () => {
  test('revalidates every content path locally without remote fan-out', async () => {
    const revalidateLocal = jest.fn().mockResolvedValue(undefined)
    const fetchImpl = jest.fn()
    await revalidateContentPath({
      path: '/article/3213',
      siteRole: 'content',
      revalidateLocal,
      fetchImpl,
      landingUrl: 'http://app:3000/api/revalidate',
      token: 'secret'
    })
    expect(revalidateLocal).toHaveBeenCalledWith('/article/3213')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  test('fans homepage revalidation from content to landing with bearer auth', async () => {
    const revalidateLocal = jest.fn().mockResolvedValue(undefined)
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        results: [{ path: '/', revalidated: true }]
      })
    })
    await revalidateContentPath({
      path: '/',
      siteRole: 'content',
      revalidateLocal,
      fetchImpl,
      landingUrl: 'http://app:3000/api/revalidate',
      token: 'secret'
    })
    expect(revalidateLocal).toHaveBeenCalledWith('/')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://app:3000/api/revalidate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ path: '/' })
      })
    )
  })

  test.each([
    ['missing endpoint', '', 'secret', undefined],
    ['missing token', 'http://app:3000/api/revalidate', '', undefined],
    [
      'non-2xx response',
      'http://app:3000/api/revalidate',
      'secret',
      { ok: false, json: async () => ({ ok: false }) }
    ],
    [
      'negative result',
      'http://app:3000/api/revalidate',
      'secret',
      {
        ok: true,
        json: async () => ({
          ok: true,
          results: [{ path: '/', revalidated: false }]
        })
      }
    ]
  ])(
    'rejects %s so the queue item is retained',
    async (_name: string, url: string, token: string, reply: any) => {
      const fetchImpl = jest.fn()
      if (reply) fetchImpl.mockResolvedValue(reply)
      await expect(
        revalidateContentPath({
          path: '/',
          siteRole: 'content',
          revalidateLocal: jest.fn().mockResolvedValue(undefined),
          fetchImpl,
          landingUrl: url,
          token
        })
      ).rejects.toThrow('Landing homepage revalidation failed')
    }
  )

  test('landing and standalone roles never call another container', async () => {
    for (const siteRole of ['landing', 'standalone']) {
      const fetchImpl = jest.fn()
      await revalidateContentPath({
        path: '/',
        siteRole,
        revalidateLocal: jest.fn().mockResolvedValue(undefined),
        fetchImpl,
        landingUrl: 'http://app:3000/api/revalidate',
        token: 'secret'
      })
      expect(fetchImpl).not.toHaveBeenCalled()
    }
  })
})
