/** @jest-environment node */

declare const jest: any
declare const describe: any
declare const beforeEach: any
declare const afterEach: any
declare const test: any
declare const expect: any

jest.mock('@/lib/cache/local_file_cache', () => ({ cleanCache: jest.fn() }))
jest.mock('@/lib/notion-webhook/consumer', () => ({
  bootstrapRouteState: jest.fn(),
  consumeDirtyPages: jest.fn()
}))

import { cleanCache } from '@/lib/cache/local_file_cache'
import {
  bootstrapRouteState,
  consumeDirtyPages
} from '@/lib/notion-webhook/consumer'
import handler from '@/pages/api/revalidate'

const originalToken = process.env.REVALIDATION_TOKEN

function response() {
  let statusCode = 0
  let body: any
  return {
    revalidate: jest.fn().mockResolvedValue(undefined),
    status(code: number) {
      statusCode = code
      return this
    },
    json(value: unknown) {
      body = value
      return this
    },
    read: () => ({ statusCode, body })
  }
}

const request = (body: unknown, overrides: Record<string, unknown> = {}) => ({
  method: 'POST',
  headers: { authorization: 'Bearer test-token' },
  body,
  ...overrides
})

describe('/api/revalidate dirty compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.REVALIDATION_TOKEN = 'test-token'
    jest.mocked(consumeDirtyPages).mockResolvedValue({
      status: 'processed',
      selected: 1,
      acknowledged: 1,
      retained: 0,
      queueDepth: 0,
      paths: [{ path: '/article/a', ok: true }],
      elapsedMs: 5
    })
    jest.mocked(bootstrapRouteState).mockResolvedValue({
      bootstrapped: true,
      snapshots: 2
    })
  })

  afterEach(() => {
    if (originalToken === undefined) delete process.env.REVALIDATION_TOKEN
    else process.env.REVALIDATION_TOKEN = originalToken
  })

  test('requires POST and bearer authentication', async () => {
    const wrongMethod = response()
    await handler(request({}, { method: 'GET' }) as never, wrongMethod as never)
    expect(wrongMethod.read().statusCode).toBe(405)

    const unauthorized = response()
    await handler(
      request(
        {},
        { headers: { authorization: 'Bearer wrong-token' } }
      ) as never,
      unauthorized as never
    )
    expect(unauthorized.read()).toMatchObject({
      statusCode: 401,
      body: { ok: false, message: 'Unauthorized' }
    })
  })

  test('runs dirty mode eagerly with res.revalidate', async () => {
    const res = response()
    await handler(request({ dirty: true }) as never, res as never)

    expect(res.read()).toMatchObject({
      statusCode: 200,
      body: { ok: true, status: 'processed', acknowledged: 1 }
    })
    expect(consumeDirtyPages).toHaveBeenCalledWith({
      revalidate: expect.any(Function),
      now: expect.any(Function)
    })
    const passed = jest.mocked(consumeDirtyPages).mock.calls[0][0]
    await passed.revalidate('/article/test')
    expect(res.revalidate).toHaveBeenCalledWith('/article/test')
  })

  test('bootstraps source-confirmed route state without revalidating', async () => {
    const res = response()
    await handler(request({ bootstrap: true }) as never, res as never)

    expect(res.read()).toEqual({
      statusCode: 200,
      body: { ok: true, bootstrapped: true, snapshots: 2 }
    })
    expect(bootstrapRouteState).toHaveBeenCalledWith({
      now: expect.any(Function)
    })
    expect(res.revalidate).not.toHaveBeenCalled()
  })

  test('rejects conflicting operation fields', async () => {
    for (const body of [
      { path: '/one', dirty: true },
      { paths: ['/one'], all: true },
      { dirty: true, bootstrap: true }
    ]) {
      const res = response()
      await handler(request(body) as never, res as never)
      expect(res.read().statusCode).toBe(400)
    }
    expect(consumeDirtyPages).not.toHaveBeenCalled()
  })

  test('reports unavailable Redis/consumer work as 503', async () => {
    jest
      .mocked(consumeDirtyPages)
      .mockRejectedValue(
        new Error('redis://user:secret@example.invalid queue depth failed')
      )
    const res = response()
    await handler(request({ dirty: true }) as never, res as never)

    expect(res.read()).toEqual({
      statusCode: 503,
      body: { ok: false, message: 'Dirty revalidation unavailable' }
    })
    expect(JSON.stringify(res.read().body)).not.toContain('secret')
  })

  test('preserves existing single, multi and all response shapes', async () => {
    const single = response()
    await handler(request({ path: '/article/a/' }) as never, single as never)
    expect(single.read()).toEqual({
      statusCode: 200,
      body: {
        ok: true,
        message: 'Revalidated 1/1 paths',
        results: [{ path: '/article/a', revalidated: true }]
      }
    })

    const multi = response()
    multi.revalidate.mockRejectedValueOnce(new Error('failed'))
    await handler(request({ paths: ['/one', '/two'] }) as never, multi as never)
    expect(multi.read().body).toEqual({
      ok: true,
      message: 'Revalidated 1/2 paths',
      results: [
        { path: '/one', revalidated: false, error: 'failed' },
        { path: '/two', revalidated: true }
      ]
    })

    const all = response()
    await handler(request({ all: true }) as never, all as never)
    expect(cleanCache).toHaveBeenCalledTimes(1)
    expect(all.read().body).toEqual({
      ok: true,
      message:
        'Full site cache cleared. Homepage revalidated. Other pages will refresh on next visit.',
      results: [{ path: '/', revalidated: true }]
    })
  })
})
