/** @jest-environment node */

declare const jest: any
declare const describe: any
declare const test: any
declare const expect: any

import { warmRevalidatedPath } from '@/lib/notion-webhook/warmPath'

describe('Notion webhook path warmer', () => {
  test('fetches the revalidated path from the configured origin', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      body: { cancel: jest.fn().mockResolvedValue(undefined) }
    })

    await expect(
      warmRevalidatedPath({
        path: '/article/a',
        origin: 'http://127.0.0.1:3000',
        fetchImpl
      })
    ).resolves.toBeUndefined()

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:3000/article/a',
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        headers: expect.objectContaining({
          'x-notionnext-cache-warm': '1'
        })
      })
    )
  })

  test('fails when the warm request returns a non-success response', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: false, status: 503 })

    await expect(
      warmRevalidatedPath({
        path: '/article/a',
        origin: 'http://127.0.0.1:3000',
        fetchImpl
      })
    ).rejects.toThrow('HTTP 503')
  })
})
