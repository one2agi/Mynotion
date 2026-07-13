const DEFAULT_MAX_AGE = 60
const DEFAULT_STALE_WHILE_REVALIDATE = 60

function assertDuration(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }
}

export const PUBLIC_PAGE_CACHE_CONTROL =
  'public, s-maxage=60, stale-while-revalidate=60'

export function setPublicPageCache(
  res,
  {
    maxAge = DEFAULT_MAX_AGE,
    staleWhileRevalidate = DEFAULT_STALE_WHILE_REVALIDATE
  } = {}
) {
  assertDuration('maxAge', maxAge)
  assertDuration('staleWhileRevalidate', staleWhileRevalidate)
  if (typeof res?.setHeader !== 'function') return

  const value =
    maxAge === DEFAULT_MAX_AGE &&
    staleWhileRevalidate === DEFAULT_STALE_WHILE_REVALIDATE
      ? PUBLIC_PAGE_CACHE_CONTROL
      : `public, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
  res.setHeader('Cache-Control', value)
}
