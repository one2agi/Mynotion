const DEFAULT_WARM_ORIGIN = 'http://127.0.0.1:3000'
const DEFAULT_WARM_TIMEOUT_MS = 30_000

type WarmRevalidatedPathOptions = {
  path: string
  origin?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export async function warmRevalidatedPath({
  path,
  origin = process.env.NOTION_REFRESH_WARM_ORIGIN || DEFAULT_WARM_ORIGIN,
  timeoutMs = positiveInteger(
    process.env.NOTION_REFRESH_WARM_TIMEOUT_MS,
    DEFAULT_WARM_TIMEOUT_MS
  ),
  fetchImpl = fetch
}: WarmRevalidatedPathOptions): Promise<void> {
  if (!path.startsWith('/')) throw new Error('Warm path must be absolute')

  const endpoint = new URL(path, ensureTrailingSlash(origin))
  if (!/^https?:$/.test(endpoint.protocol)) {
    throw new Error('Warm origin must be HTTP(S)')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(endpoint.toString(), {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'cache-control': 'no-cache',
        'x-notionnext-cache-warm': '1'
      }
    })
    if (!response.ok) {
      throw new Error(`Warm request failed: HTTP ${response.status}`)
    }
    await response.body?.cancel()
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Warm request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function ensureTrailingSlash(origin: string): string {
  return origin.endsWith('/') ? origin : `${origin}/`
}

function positiveInteger(value: unknown, fallback: number): number {
  const numeric =
    typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.includes('aborted'))
  )
}
