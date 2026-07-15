const notionClientFactory = jest.fn()
const enqueue = jest.fn((key, execute) => execute())

jest.mock('notion-client', () => ({
  NotionAPI: jest.fn(options => notionClientFactory(options))
}))

jest.mock('@/blog.config', () => ({
  __esModule: true,
  default: {
    API_BASE_URL: 'https://www.notion.so/api/v3',
    NOTION_ACTIVE_USER: null,
    NOTION_TOKEN_V2: 'fixture-notion-token'
  }
}))

jest.mock('@/lib/db/notion/RateLimiter', () => ({
  RateLimiter: jest.fn(() => ({ enqueue }))
}))

jest.mock('@/lib/build/buildEnv', () => ({
  getNotionBuildRateMaxPerMinute: jest.fn(() => 30),
  getNotionBuildRateMinIntervalMs: jest.fn(() => 100),
  logBuildEnvSummary: jest.fn()
}))

const PROXY_ENV_KEYS = [
  'NOTION_API_PROXY_URL',
  'NOTION_API_PROXY_TOKEN',
  'NOTION_API_PROXY_TIMEOUT_MS',
  'NOTION_API_PROXY_CIRCUIT_MS'
]

function clearProxyEnv() {
  for (const key of PROXY_ENV_KEYS) delete process.env[key]
}

function loadApi() {
  let module
  jest.isolateModules(() => {
    module = require('@/lib/db/notion/getNotionAPI')
  })
  return module.default
}

describe('getNotionAPI Worker integration', () => {
  beforeEach(() => {
    clearProxyEnv()
    notionClientFactory.mockReset()
    enqueue.mockClear()
  })

  afterAll(() => {
    clearProxyEnv()
  })

  test('uses the direct Notion client when proxy configuration is absent', async () => {
    const getPage = jest.fn(async () => ({ source: 'direct' }))
    notionClientFactory.mockImplementation(options => ({ getPage, options }))

    const api = loadApi()
    await expect(api.getPage('page-id')).resolves.toEqual({ source: 'direct' })

    expect(notionClientFactory).toHaveBeenCalledTimes(1)
    const directOptions = notionClientFactory.mock.calls[0][0]
    expect(directOptions.apiBaseUrl).toBe('https://www.notion.so/api/v3')
    expect(
      directOptions.ofetchOptions?.headers?.['x-notion-proxy-token']
    ).toBeUndefined()
    expect(directOptions).not.toHaveProperty('kyOptions')
  })

  test('constructs a bounded Worker client and keeps direct free of proxy headers', async () => {
    process.env.NOTION_API_PROXY_URL = 'https://worker.example.com/api/v3/'
    process.env.NOTION_API_PROXY_TOKEN = 'fixture-proxy-token'
    process.env.NOTION_API_PROXY_TIMEOUT_MS = '7000'
    process.env.NOTION_API_PROXY_CIRCUIT_MS = '90000'

    notionClientFactory.mockImplementation(options => ({
      getPage: jest.fn(async () => ({ source: options.apiBaseUrl }))
    }))

    const api = loadApi()
    await expect(api.getPage('page-id')).resolves.toEqual({
      source: 'https://worker.example.com/api/v3'
    })

    expect(notionClientFactory).toHaveBeenCalledTimes(2)
    const options = notionClientFactory.mock.calls.map(call => call[0])
    const worker = options.find(item => item.apiBaseUrl.includes('worker'))
    const direct = options.find(
      item => item.apiBaseUrl === 'https://www.notion.so/api/v3'
    )

    expect(worker.ofetchOptions).toMatchObject({
      timeout: 7000,
      headers: { 'x-notion-proxy-token': 'fixture-proxy-token' }
    })
    expect(
      direct.ofetchOptions?.headers?.['x-notion-proxy-token']
    ).toBeUndefined()
    expect(worker).not.toHaveProperty('kyOptions')
    expect(direct).not.toHaveProperty('kyOptions')
  })

  test('uses direct fallback when the Worker client has no response', async () => {
    process.env.NOTION_API_PROXY_URL = 'https://worker.example.com/api/v3'
    process.env.NOTION_API_PROXY_TOKEN = 'fixture-proxy-token'

    notionClientFactory.mockImplementation(options => ({
      getPage: jest.fn(async () => {
        if (options.apiBaseUrl.includes('worker')) {
          throw new TypeError('fetch failed')
        }
        return { source: 'direct-fallback' }
      })
    }))

    const api = loadApi()
    await expect(api.getPage('page-id')).resolves.toEqual({
      source: 'direct-fallback'
    })
  })

  test('retains in-flight de-duplication for identical calls', async () => {
    let resolvePage
    const getPage = jest.fn(
      () =>
        new Promise(resolve => {
          resolvePage = resolve
        })
    )
    notionClientFactory.mockImplementation(() => ({ getPage }))

    const api = loadApi()
    const first = api.getPage('same-page')
    const second = api.getPage('same-page')
    await Promise.resolve()
    resolvePage({ ok: true })

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true },
      { ok: true }
    ])
    expect(getPage).toHaveBeenCalledTimes(1)
  })
})
