const RETRYABLE_STATUSES = new Set([545, 502, 503, 504])
const RETRY_DELAYS_MS = [300, 1000]
const GUARD_PREFIX = 'notion-next:data-recovery:'

const sleep = delay => new Promise(resolve => setTimeout(resolve, delay))

function requestMethod(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase()
}

function requestUrl(input, origin) {
  const value = typeof input === 'string' || input instanceof URL ? input : input.url
  return new URL(value, origin)
}

function isEligible(input, init, origin) {
  const url = requestUrl(input, origin)
  return (
    requestMethod(input, init) === 'GET' &&
    url.origin === origin &&
    url.pathname.startsWith('/_next/data/')
  )
}

export function dataUrlToPageUrl(url) {
  const parts = url.pathname.split('/').filter(Boolean)
  const routeParts = parts.slice(3)
  const last = routeParts.length - 1
  routeParts[last] = routeParts[last].replace(/\.json$/, '')
  if (routeParts[last] === 'index') routeParts.pop()
  const pathname = `/${routeParts.join('/')}` || '/'
  return `${pathname}${url.search}`
}

function recoverOnce({ url, buildId, storage, hardNavigate }) {
  const pageUrl = dataUrlToPageUrl(url)
  const guardKey = `${GUARD_PREFIX}${buildId}:${pageUrl}`
  if (storage?.getItem(guardKey)) return
  storage?.setItem(guardKey, '1')
  hardNavigate(pageUrl)
}

export function createNextDataFetch({
  originalFetch,
  origin,
  buildId,
  storage,
  hardNavigate,
  wait = sleep
}) {
  return async function nextDataFetch(input, init) {
    if (!isEligible(input, init, origin)) return originalFetch(input, init)

    const url = requestUrl(input, origin)
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const result = await originalFetch(input, init)
        if (!RETRYABLE_STATUSES.has(result.status)) return result
        if (attempt === RETRY_DELAYS_MS.length) {
          recoverOnce({ url, buildId, storage, hardNavigate })
          return result
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error
        if (attempt === RETRY_DELAYS_MS.length) {
          recoverOnce({ url, buildId, storage, hardNavigate })
          throw error
        }
      }
      await wait(RETRY_DELAYS_MS[attempt])
    }
  }
}

function clearBuildGuards(storage, buildId) {
  const prefix = `${GUARD_PREFIX}${buildId}:`
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)
    if (key?.startsWith(prefix)) storage.removeItem(key)
  }
}

export function installNextDataRecovery({ windowObject, router }) {
  const originalWindowFetch = windowObject.fetch
  const originalFetch = (...args) => originalWindowFetch.apply(windowObject, args)
  const buildId = windowObject.__NEXT_DATA__?.buildId || 'unknown-build'
  const wrapped = createNextDataFetch({
    originalFetch,
    origin: windowObject.location.origin,
    buildId,
    storage: windowObject.sessionStorage,
    hardNavigate: url => windowObject.location.assign(url)
  })
  const clear = () => clearBuildGuards(windowObject.sessionStorage, buildId)

  windowObject.fetch = wrapped
  router.events.on('routeChangeComplete', clear)

  return () => {
    router.events.off('routeChangeComplete', clear)
    if (windowObject.fetch === wrapped) windowObject.fetch = originalWindowFetch
  }
}
