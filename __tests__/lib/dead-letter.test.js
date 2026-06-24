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
    process.env.DEAD_LETTER_WEBHOOK_URL = 'https://faiz.one2agi.com/hooks/agent'
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
    expect(url).toBe('https://faiz.one2agi.com/hooks/agent')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer test-token-abc')
    expect(opts.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body)
    expect(body.message).toContain('TEST_WEBHOOK_001')
    expect(body.name).toBe('notion-payment-dead-letter')
    expect(body.accountId).toBe('xingchen')
    expect(body.target).toBe('qqbot:c2c:c6366d4f6511a4538de7abdf67c8483b')
  })

  // === 2026-06-24：webhook 消息加订单时间（运营需要） ===
  // 原因：运营收到 webhook 时想知道"这单是几点下的"，方便查日志/对账
  test('orderData.paidAt 存在 → message 包含格式化后的北京时间', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })

    const entry = {
      timestamp: '2026-06-24T13:00:00.000+08:00',
      outTradeNo: 'TIME_TEST',
      orderData: {
        productName: 'Starter',
        amount: 29.9,
        email: 'a@b.com',
        paidAt: '2026-06-24T13:00:00.000+08:00'  // 北京时间
      },
      error: 'Token 查询失败 5 次',
      stack: ''
    }
    await notifyDeadLetter(entry)

    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    // 期望：消息里包含 "订单时间: 2026-06-24 13:00:00 (北京时间)"
    expect(body.message).toContain('订单时间: 2026-06-24 13:00:00')
    expect(body.message).toContain('北京时间')
  })

  test('orderData.paidAt 缺失 → message 优雅显示 N/A（不阻断）', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })

    const entry = {
      timestamp: '2026-06-24T13:00:00.000+08:00',
      outTradeNo: 'NO_TIME_TEST',
      orderData: {
        productName: 'Starter',
        amount: 29.9,
        email: 'a@b.com'
        // 没有 paidAt
      },
      error: 'Notion 5xx',
      stack: ''
    }
    await notifyDeadLetter(entry)

    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.message).toContain('订单时间: N/A')
  })

  test('重试：5xx → 共 3 次（1 初始 + 2 retry），backoff ≥ 200+400ms', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValueOnce({ ok: true, status: 200 })

    const t0 = Date.now()
    await notifyDeadLetter({ outTradeNo: 'X1' })
    const elapsed = Date.now() - t0

    expect(global.fetch).toHaveBeenCalledTimes(3)
    // 至少等 200+400=600ms（防止有人误删 await sleep，把 3 次 fetch 并行）
    expect(elapsed).toBeGreaterThanOrEqual(550)
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

  test('循环引用 entry：JSON.stringify 抛错 → 降级发送（不 reject）', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 200 })
    // 构造循环引用：entry.orderData.self = entry
    const entry = { outTradeNo: 'CIRCULAR', orderData: {}, error: 'x', stack: 's' }
    entry.orderData.self = entry

    // 必须不 reject（保持 MUST NEVER reject 契约）
    await expect(notifyDeadLetter(entry)).resolves.toBeUndefined()
    // 降级路径仍调了一次 fetch
    expect(global.fetch).toHaveBeenCalledTimes(1)
    // 降级 body 应只含安全字段
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.message).toContain('CIRCULAR')
    expect(body.name).toBe('notion-payment-dead-letter')
    expect(body.accountId).toBe('xingchen')
    expect(body.target).toBe('qqbot:c2c:c6366d4f6511a4538de7abdf67c8483b')
  })
})
