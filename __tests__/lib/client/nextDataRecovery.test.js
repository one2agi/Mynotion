import {
  createNextDataFetch,
  dataUrlToPageUrl
} from '@/lib/client/nextDataRecovery'

const response = status => ({ ok: status >= 200 && status < 300, status })

describe('Next page-data recovery', () => {
  test('maps locale page data back to the browser route', () => {
    expect(
      dataUrlToPageUrl(
        new URL('https://www.one2agi.com/_next/data/b1/zh-CN/article/3213.json?theme=next')
      )
    ).toBe('/zh-CN/article/3213?theme=next')
    expect(
      dataUrlToPageUrl(
        new URL('https://www.one2agi.com/_next/data/b1/index.json')
      )
    ).toBe('/')
  })

  test.each([545, 502, 503, 504])('retries status %s twice', async status => {
    const originalFetch = jest
      .fn()
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response(status))
      .mockResolvedValueOnce(response(200))
    const wait = jest.fn().mockResolvedValue(undefined)
    const recoveredFetch = createNextDataFetch({
      originalFetch,
      origin: 'https://www.one2agi.com',
      buildId: 'b1',
      storage: { getItem: jest.fn(), setItem: jest.fn() },
      hardNavigate: jest.fn(),
      wait
    })

    await expect(
      recoveredFetch('/_next/data/b1/zh-CN/archive.json')
    ).resolves.toEqual(response(200))
    expect(originalFetch).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([300, 1000])
  })

  test('retries a disconnect but never an AbortError', async () => {
    const wait = jest.fn().mockResolvedValue(undefined)
    const disconnectFetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValue(response(200))
    const recovered = createNextDataFetch({
      originalFetch: disconnectFetch,
      origin: 'https://www.one2agi.com',
      buildId: 'b1',
      storage: { getItem: jest.fn(), setItem: jest.fn() },
      hardNavigate: jest.fn(),
      wait
    })
    await recovered('/_next/data/b1/zh-CN.json')
    expect(disconnectFetch).toHaveBeenCalledTimes(2)

    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    const abortFetch = jest.fn().mockRejectedValue(abort)
    const abortRecovered = createNextDataFetch({
      originalFetch: abortFetch,
      origin: 'https://www.one2agi.com',
      buildId: 'b1',
      storage: { getItem: jest.fn(), setItem: jest.fn() },
      hardNavigate: jest.fn(),
      wait
    })
    await expect(abortRecovered('/_next/data/b1/zh-CN.json')).rejects.toBe(abort)
    expect(abortFetch).toHaveBeenCalledTimes(1)
  })

  test.each([
    ['https://api.example.com/_next/data/b1/x.json', { method: 'GET' }],
    ['/api/payment/create', { method: 'POST' }],
    ['/_next/data/b1/x.json', { method: 'POST' }]
  ])('does not retry ineligible request %s', async (url, init) => {
    const originalFetch = jest.fn().mockResolvedValue(response(545))
    const recovered = createNextDataFetch({
      originalFetch,
      origin: 'https://www.one2agi.com',
      buildId: 'b1',
      storage: { getItem: jest.fn(), setItem: jest.fn() },
      hardNavigate: jest.fn(),
      wait: jest.fn()
    })
    await recovered(url, init)
    expect(originalFetch).toHaveBeenCalledTimes(1)
  })

  test('hard-navigates only once after retries are exhausted', async () => {
    const storageValues = new Map()
    const storage = {
      getItem: key => storageValues.get(key),
      setItem: (key, value) => storageValues.set(key, value)
    }
    const hardNavigate = jest.fn()
    const originalFetch = jest.fn().mockResolvedValue(response(545))
    const recovered = createNextDataFetch({
      originalFetch,
      origin: 'https://www.one2agi.com',
      buildId: 'b1',
      storage,
      hardNavigate,
      wait: jest.fn().mockResolvedValue(undefined)
    })

    await recovered('/_next/data/b1/zh-CN/archive.json')
    await recovered('/_next/data/b1/zh-CN/archive.json')
    expect(hardNavigate).toHaveBeenCalledTimes(1)
    expect(hardNavigate).toHaveBeenCalledWith('/zh-CN/archive')
  })
})
