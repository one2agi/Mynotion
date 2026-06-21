// __tests__/lib/dead-letter.test.js
// Dead Letter Webhook 推送器单元测试
//
// 核心契约：notifyDeadLetter MUST NEVER reject / throw
// 因为它被 createOrderPage 的 catch 块调用，createOrderPage 自己就承诺
// "MUST NOT throw"（依赖此契约的 notify.js 才能正确判断是否返回 success/error）

global.fetch = jest.fn()

const { notifyDeadLetter } = require('@/lib/dead-letter')

describe('Dead Letter Webhook 推送器', () => {
  let originalEnv
  let consoleErrorSpy

  beforeEach(() => {
    jest.clearAllMocks()
    originalEnv = {
      DEAD_LETTER_WEBHOOK_URL: process.env.DEAD_LETTER_WEBHOOK_URL,
      DEAD_LETTER_WEBHOOK_TOKEN: process.env.DEAD_LETTER_WEBHOOK_TOKEN
    }
    // 默认配置：env 都设上，让测试走正常的 webhook 推送路径
    process.env.DEAD_LETTER_WEBHOOK_URL = 'https://faiz.one2agi.com/hooks/wake'
    process.env.DEAD_LETTER_WEBHOOK_TOKEN = 'test-token-abc'
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    // 恢复 env
    if (originalEnv.DEAD_LETTER_WEBHOOK_URL === undefined) {
      delete process.env.DEAD_LETTER_WEBHOOK_URL
    } else {
      process.env.DEAD_LETTER_WEBHOOK_URL = originalEnv.DEAD_LETTER_WEBHOOK_URL
    }
    if (originalEnv.DEAD_LETTER_WEBHOOK_TOKEN === undefined) {
      delete process.env.DEAD_LETTER_WEBHOOK_TOKEN
    } else {
      process.env.DEAD_LETTER_WEBHOOK_TOKEN = originalEnv.DEAD_LETTER_WEBHOOK_TOKEN
    }
    consoleErrorSpy.mockRestore()
  })

  test('成功：2xx 返回 → fetch 调用 1 次，body 与 headers 正确', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })

    const entry = {
      timestamp: '2026-06-21T10:00:00.000Z',
      outTradeNo: 'TEST_WEBHOOK_001',
      orderData: { productName: 'Starter', amount: 29.9, email: 'a@b.com' },
      error: 'Notion 5xx',
      stack: 'Error: ...\n  at ...'
    }
    await notifyDeadLetter(entry)

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://faiz.one2agi.com/hooks/wake')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer test-token-abc')
    expect(opts.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body)
    expect(body.mode).toBe('now')
    // text 字段是 entry 的 JSON 序列化
    expect(JSON.parse(body.text)).toEqual(entry)
  })

  test('重试：5xx → 共 3 次（1 初始 + 2 retry）', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    await notifyDeadLetter({ outTradeNo: 'X1' })
    expect(global.fetch).toHaveBeenCalledTimes(3)
  })

  test('不重试：401（鉴权失败）→ 只调 1 次', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('不重试：403（权限拒绝）→ 只调 1 次', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 403 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('不重试：404（URL 配错）→ 只调 1 次', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  test('重试：429（rate limit）→ 共 2 次', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 429 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('重试：网络错误 ECONNRESET → 共 2 次', async () => {
    global.fetch
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, status: 200 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('重试：AbortError（超时）→ 共 2 次', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    global.fetch
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce({ ok: true, status: 200 })

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  test('耗尽：5xx × 3 → 函数不 reject，console.error，fetch 3 次', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500 })

    await expect(notifyDeadLetter({ outTradeNo: 'X' })).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  test('耗尽：网络错误 × 3 → 函数不 reject', async () => {
    global.fetch.mockRejectedValue(new Error('ETIMEDOUT'))

    await expect(notifyDeadLetter({ outTradeNo: 'X' })).resolves.toBeUndefined()
    expect(global.fetch).toHaveBeenCalledTimes(3)
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  test('env 缺失：DEAD_LETTER_WEBHOOK_URL 未设 → 不调 fetch', async () => {
    delete process.env.DEAD_LETTER_WEBHOOK_URL

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('env 缺失：DEAD_LETTER_WEBHOOK_TOKEN 未设 → 不调 fetch', async () => {
    delete process.env.DEAD_LETTER_WEBHOOK_TOKEN

    await notifyDeadLetter({ outTradeNo: 'X' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('超时机制：传 AbortSignal 给 fetch', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    await notifyDeadLetter({ outTradeNo: 'X' })
    const opts = global.fetch.mock.calls[0][1]
    expect(opts.signal).toBeDefined()
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })
})
