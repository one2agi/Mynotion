import {
  PUBLIC_PAGE_CACHE_CONTROL,
  setPublicPageCache
} from '@/lib/cache/publicPageCache'

describe('setPublicPageCache', () => {
  test('sets the approved 60 second edge cache policy', () => {
    const res = { setHeader: jest.fn() }

    setPublicPageCache(res)

    expect(PUBLIC_PAGE_CACHE_CONTROL).toBe(
      'public, s-maxage=60, stale-while-revalidate=60'
    )
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      PUBLIC_PAGE_CACHE_CONTROL
    )
  })

  test('is harmless when a response object is unavailable', () => {
    expect(() => setPublicPageCache()).not.toThrow()
    expect(() => setPublicPageCache({})).not.toThrow()
  })

  test.each([
    [-1, 60],
    [60, -1],
    ['60', 60],
    [60, NaN]
  ])(
    'rejects invalid durations maxAge=%p stale=%p',
    (maxAge, staleWhileRevalidate) => {
      expect(() =>
        setPublicPageCache(
          { setHeader: jest.fn() },
          { maxAge, staleWhileRevalidate }
        )
      ).toThrow(TypeError)
    }
  )
})
