export const DEFAULT_PROXY_CIRCUIT_MS = 60_000

function getHeader(error, name) {
  try {
    return error?.response?.headers?.get?.(name) || null
  } catch {
    return null
  }
}

function getStatus(error) {
  const status = Number(error?.response?.status)
  return Number.isFinite(status) ? status : null
}

export function isProxyChannelError(error) {
  if (getHeader(error, 'x-notion-proxy-upstream') === 'notion') {
    return false
  }

  if (getHeader(error, 'x-notion-proxy-channel-error') === '1') {
    return true
  }

  // Every response successfully returned by our Worker carries the upstream
  // marker. No response, or an unmarked response, means the proxy channel,
  // routing, deployment, or authentication failed before Notion replied.
  return true
}

function describeStatus(error) {
  const status = getStatus(error)
  return status == null ? 'network' : `${Math.floor(status / 100)}xx`
}

function invoke(client, methodName, args) {
  const method = client?.[methodName]
  if (typeof method !== 'function') {
    throw new Error(`${methodName} is not a function`)
  }
  return method.apply(client, args)
}

function log(logger, level, message) {
  const writer = logger?.[level]
  if (typeof writer === 'function') {
    writer.call(logger, message)
  }
}

export function createNotionTransport({
  proxyClient,
  directClient,
  proxyEnabled,
  circuitMs = DEFAULT_PROXY_CIRCUIT_MS,
  now = Date.now,
  logger = console
}) {
  let openUntil = 0

  async function callDirect(methodName, args, channel) {
    const startedAt = now()
    try {
      const result = await invoke(directClient, methodName, args)
      log(
        logger,
        'info',
        `[NotionTransport] method=${methodName} channel=${channel} status=ok durationMs=${Math.max(0, now() - startedAt)}`
      )
      return result
    } catch (error) {
      log(
        logger,
        'warn',
        `[NotionTransport] method=${methodName} channel=${channel} status=${describeStatus(error)} durationMs=${Math.max(0, now() - startedAt)}`
      )
      throw error
    }
  }

  async function call(methodName, ...args) {
    if (!proxyEnabled) {
      return callDirect(methodName, args, 'direct')
    }

    if (openUntil > now()) {
      return callDirect(methodName, args, 'direct-circuit-open')
    }

    const startedAt = now()
    try {
      const result = await invoke(proxyClient, methodName, args)
      openUntil = 0
      log(
        logger,
        'info',
        `[NotionTransport] method=${methodName} channel=worker status=ok durationMs=${Math.max(0, now() - startedAt)}`
      )
      return result
    } catch (error) {
      const status = describeStatus(error)
      if (!isProxyChannelError(error)) {
        log(
          logger,
          'warn',
          `[NotionTransport] method=${methodName} channel=worker-upstream status=${status} durationMs=${Math.max(0, now() - startedAt)}`
        )
        throw error
      }

      openUntil = now() + circuitMs
      log(
        logger,
        'warn',
        `[NotionTransport] method=${methodName} channel=worker status=${status} action=direct-fallback circuitMs=${circuitMs}`
      )
      return callDirect(methodName, args, 'direct-fallback')
    }
  }

  function getState() {
    return {
      open: Boolean(proxyEnabled && openUntil > now()),
      openUntil
    }
  }

  return { call, getState }
}
