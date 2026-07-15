export const PROXY_TOKEN_HEADER = 'x-notion-proxy-token'
export const UPSTREAM_HEADER = 'x-notion-proxy-upstream'
export const CHANNEL_ERROR_HEADER = 'x-notion-proxy-channel-error'

const NOTION_ORIGIN = 'https://www.notion.so'
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
}

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders }
  })
}

function isAuthorized(request, env) {
  const configuredToken = env?.NOTION_PROXY_TOKEN
  const suppliedToken = request.headers.get(PROXY_TOKEN_HEADER)
  return Boolean(
    configuredToken &&
      suppliedToken &&
      suppliedToken.length === configuredToken.length &&
      suppliedToken === configuredToken
  )
}

async function createUpstreamRequest(request, url) {
  const headers = new Headers(request.headers)
  for (const name of [
    'host',
    'cf-connecting-ip',
    'cf-ray',
    'cf-visitor',
    PROXY_TOKEN_HEADER
  ]) {
    headers.delete(name)
  }

  return new Request(`${NOTION_ORIGIN}${url.pathname}${url.search}`, {
    method: 'POST',
    headers,
    body: await request.arrayBuffer(),
    redirect: 'manual'
  })
}

export async function handleRequest(
  request,
  env,
  executionCtx,
  fetchImpl = fetch
) {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/health') {
    return jsonResponse({ ok: true }, 200)
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, {
      allow: 'POST'
    })
  }

  if (!url.pathname.startsWith('/api/v3/')) {
    return jsonResponse({ error: 'not_found' }, 404)
  }

  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  try {
    const upstreamRequest = await createUpstreamRequest(request, url)
    const upstream = await fetchImpl(upstreamRequest)
    const headers = new Headers(upstream.headers)
    headers.set('cache-control', 'no-store')
    headers.set(UPSTREAM_HEADER, 'notion')
    headers.delete(CHANNEL_ERROR_HEADER)

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    })
  } catch {
    return jsonResponse({ error: 'upstream_unavailable' }, 502, {
      [CHANNEL_ERROR_HEADER]: '1'
    })
  }
}

const worker = {
  fetch(request, env, executionCtx) {
    return handleRequest(request, env, executionCtx)
  }
}

export default worker
