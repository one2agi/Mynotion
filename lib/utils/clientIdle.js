export const runWhenIdle = (callback, timeout = 1500) => {
  if (typeof window === 'undefined') return undefined

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(callback, { timeout })
    return () => window.cancelIdleCallback?.(id)
  }

  const id = window.setTimeout(() => {
    callback()
  }, Math.min(timeout, 1000))
  return () => window.clearTimeout(id)
}
