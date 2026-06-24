// __tests__/lib/notion-order.test.js

const mockNotionClient = {
  databases: { query: jest.fn(), create: jest.fn() },
  pages: { create: jest.fn(), update: jest.fn(), retrieve: jest.fn() }
}

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockReturnValue(mockNotionClient)
}))

// Mock fetch for dead-letter webhook
global.fetch = jest.fn()

// Clear module cache to ensure fresh import after mock setup
beforeAll(async () => {
  jest.resetModules()
  await import('@/lib/notion-order') // 触发 import 让后续 require() 拿到 mock 后的版本
})

describe('Notion 订单写入', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockNotionClient.databases.query.mockReset()
    mockNotionClient.pages.create.mockReset()
    // 配置 webhook env，避免走"env 缺失"分支
    process.env.DEAD_LETTER_WEBHOOK_URL = 'https://test.example.com/hooks/wake'
    process.env.DEAD_LETTER_WEBHOOK_TOKEN = 'test-token'
    // 默认 fetch 返回成功（重试测试可覆盖）
    global.fetch.mockResolvedValue({ ok: true, status: 200 })
  })

  test('创建订单页成功', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    mockNotionClient.pages.create.mockResolvedValue({ id: 'new-page-id-123' })
    mockNotionClient.databases.query.mockResolvedValue({ results: [] })

    const orderData = {
      productName: 'Starter 基础版',
      outTradeNo: 'TEST123456',
      email: 'test@example.com',
      name: '测试用户',
      amount: 29.9,
      discountCode: 'SAVE10',
      paidAt: '2026-06-21T10:00:00.000Z'
    }

    const pageId = await createOrderPage(orderData, mockNotionClient)
    expect(pageId).toBe('new-page-id-123')
    expect(mockNotionClient.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: expect.objectContaining({
          '创建时间': { title: [{ text: { content: '2026-06-21T10:00:00.000Z' } }] },
          '订单号': { rich_text: [{ text: { content: 'TEST123456' } }] },
          '电子邮箱': { email: 'test@example.com' },
          '姓名': { rich_text: [{ text: { content: '测试用户' } }] },
          '商品名称': { rich_text: [{ text: { content: 'Starter 基础版' } }] },
          '价格(元)': { number: 29.9 },
          '优惠码': { rich_text: [{ text: { content: 'SAVE10' } }] },
          '付款时间': { date: { start: '2026-06-21T10:00:00.000Z' } },
          '状态': { status: { name: '待发送' } }
        })
      })
    )
    // 验证：不再写 Token / 备注 / 源链接（用户手动填）
    const callArgs = mockNotionClient.pages.create.mock.calls[0][0]
    expect(callArgs.properties).not.toHaveProperty('Token')
    expect(callArgs.properties).not.toHaveProperty('备注')
    expect(callArgs.properties).not.toHaveProperty('源链接')
  })

  test('创建订单页时传入 productLink，写入发送产品链接字段', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    mockNotionClient.pages.create.mockResolvedValue({ id: 'new-page-id-456' })
    mockNotionClient.databases.query.mockResolvedValue({ results: [] })

    const productLink = 'https://faiz-world.notion.site/OS-8124f4cfc8e282e1b10381cfeadbdb86?duplicate=true&token=abcd1234'

    const pageId = await createOrderPage({
      productName: 'Starter Pro',
      outTradeNo: 'WITH_LINK_TEST',
      email: 'link@test.com',
      name: '链接测试',
      amount: 99,
      paidAt: '2026-06-22T10:00:00.000Z',
      productLink
    }, mockNotionClient)

    expect(pageId).toBe('new-page-id-456')
    expect(mockNotionClient.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          '发送产品链接': { url: productLink }
        })
      })
    )
  })

  test('productLink 为空字符串时，不写入发送产品链接字段', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    mockNotionClient.pages.create.mockResolvedValue({ id: 'new-page-id-789' })
    mockNotionClient.databases.query.mockResolvedValue({ results: [] })

    await createOrderPage({
      productName: 'Starter Basic',
      outTradeNo: 'NO_LINK_TEST',
      email: 'nolink@test.com',
      name: '无链接测试',
      amount: 29.9,
      productLink: ''
    }, mockNotionClient)

    const callArgs = mockNotionClient.pages.create.mock.calls[0][0]
    expect(callArgs.properties).not.toHaveProperty('发送产品链接')
  })

  test('幂等性：重复订单号不重复创建', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    // 模拟已存在订单
    mockNotionClient.databases.query.mockResolvedValue({
      results: [{ id: 'existing-page-id' }]
    })

    const orderData = {
      productName: 'Starter 基础版',
      outTradeNo: 'EXISTING123',
      email: 'test@example.com'
    }

    const pageId = await createOrderPage(orderData, mockNotionClient)
    // 应该返回已存在的 pageId，不调用 create
    expect(pageId).toBe('existing-page-id')
    expect(mockNotionClient.pages.create).not.toHaveBeenCalled()
  })

  // === 重试场景：上次 lookupUnusedToken 失败的订单，Z-Pay 重试时拿到 token ===
  // createOrderPage 命中幂等时必须补写 productLink，否则订单永远没链接
  // 来源：2026-06-24 NN1782277180228PZI1KW 调试发现
  test('幂等命中 + 这次带 productLink → pages.update 补写发送产品链接', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    mockNotionClient.databases.query.mockResolvedValue({
      results: [{
        id: 'existing-page-id',
        properties: {
          '发送产品链接': { url: null }  // 已存在但没链接
        }
      }]
    })

    const productLink = 'https://faiz-world.notion.site/OS-8124f4cfc8e282e1b10381cfeadbdb86?duplicate=true&token=abcd1234'

    const pageId = await createOrderPage({
      productName: 'Starter Pro',
      outTradeNo: 'IDEMPOTENT_RETRY',
      email: 'a@b.com',
      name: '张三',
      amount: 29.9,
      paidAt: '2026-06-24T13:05:00.000Z',
      productLink  // ← 这次带了
    }, mockNotionClient)

    expect(pageId).toBe('existing-page-id')
    // 关键：必须调 pages.update 把 productLink 补上
    expect(mockNotionClient.pages.update).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'existing-page-id',
        properties: expect.objectContaining({
          '发送产品链接': { url: productLink }
        })
      })
    )
    // 不能调 pages.create（订单已存在）
    expect(mockNotionClient.pages.create).not.toHaveBeenCalled()
  })

  test('幂等命中 + 这次 productLink 为空 → 不调 pages.update（保持现有行为）', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    mockNotionClient.databases.query.mockResolvedValue({
      results: [{
        id: 'existing-page-id',
        properties: { '发送产品链接': { url: null } }
      }]
    })

    const pageId = await createOrderPage({
      productName: 'Starter Pro',
      outTradeNo: 'IDEMPOTENT_NO_LINK',
      email: 'a@b.com',
      name: '张三',
      amount: 29.9,
      productLink: ''  // ← 这次没带
    }, mockNotionClient)

    expect(pageId).toBe('existing-page-id')
    // 没带 productLink 时，不调 update（避免空值覆盖）
    expect(mockNotionClient.pages.update).not.toHaveBeenCalled()
    expect(mockNotionClient.pages.create).not.toHaveBeenCalled()
  })

  // === 2026-06-24：incrementRetryCount 防 webhook 重复推送 ===
  // 来源：production log 显示 Z-Pay 重试 6 次，count=5、6 都推了 webhook（重复）
  // 解决：5 次推过之后在订单上标记 webhook_pushed=true，下次不再推
  describe('incrementRetryCount', () => {
    beforeEach(() => {
      // 不在 createOrderPage 的 beforeEach 重置（每个 describe 独立）
    })

    test('返回 { newCount, webhookPushed }', async () => {
      const { incrementRetryCount } = require('@/lib/notion-order')

      mockNotionClient.pages.retrieve.mockResolvedValue({
        properties: {
          '重试次数': { number: 4 },
          'webhook_pushed': { checkbox: false }
        }
      })
      mockNotionClient.pages.update.mockResolvedValue({ id: 'page-1' })

      const result = await incrementRetryCount('page-1', 'TEST123', mockNotionClient)

      expect(result).toEqual({ newCount: 5, webhookPushed: false })
      expect(mockNotionClient.pages.update).toHaveBeenCalledWith(
        expect.objectContaining({
          page_id: 'page-1',
          properties: expect.objectContaining({
            '重试次数': { number: 5 }
          })
        })
      )
    })

    test('webhook_pushed 已经是 true → 返回 webhookPushed: true（不重复推）', async () => {
      const { incrementRetryCount } = require('@/lib/notion-order')

      mockNotionClient.pages.retrieve.mockResolvedValue({
        properties: {
          '重试次数': { number: 5 },
          'webhook_pushed': { checkbox: true }  // ← 已经推过
        }
      })
      mockNotionClient.pages.update.mockResolvedValue({ id: 'page-1' })

      const result = await incrementRetryCount('page-1', 'TEST123', mockNotionClient)

      // 仍然增加 count（用于观察），但返回 webhookPushed: true 让调用方知道不要再推
      expect(result).toEqual({ newCount: 6, webhookPushed: true })
    })

    test('webhook_pushed 属性不存在（首次失败）→ 返回 webhookPushed: false（视为未推）', async () => {
      const { incrementRetryCount } = require('@/lib/notion-order')

      mockNotionClient.pages.retrieve.mockResolvedValue({
        properties: {
          '重试次数': { number: 2 }
          // webhook_pushed 字段不存在
        }
      })
      mockNotionClient.pages.update.mockResolvedValue({ id: 'page-1' })

      const result = await incrementRetryCount('page-1', 'TEST123', mockNotionClient)

      expect(result).toEqual({ newCount: 3, webhookPushed: false })
    })

    test('pageId 为空 → 返回 { newCount: 0, webhookPushed: false }，不调 Notion', async () => {
      const { incrementRetryCount } = require('@/lib/notion-order')

      const result = await incrementRetryCount(null, 'TEST123', mockNotionClient)

      expect(result).toEqual({ newCount: 0, webhookPushed: false })
      expect(mockNotionClient.pages.retrieve).not.toHaveBeenCalled()
      expect(mockNotionClient.pages.update).not.toHaveBeenCalled()
    })
  })

  test('retry：databases.query 失败 2 次后成功', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    // query 失败 2 次后成功
    mockNotionClient.databases.query
      .mockRejectedValueOnce(new Error('rate_limited'))
      .mockRejectedValueOnce(new Error('service_unavailable'))
      .mockResolvedValueOnce({ results: [] })
    mockNotionClient.pages.create.mockResolvedValue({ id: 'after-retry-id' })

    const pageId = await createOrderPage({
      productName: 'Starter',
      outTradeNo: 'RETRY_TEST',
      email: 'a@b.com'
    }, mockNotionClient)

    expect(pageId).toBe('after-retry-id')
    expect(mockNotionClient.databases.query).toHaveBeenCalledTimes(3)
  })

  test('retry 耗尽后推送死信 webhook，返回 null（不抛错）', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    // query 持续失败 4 次（1 初始 + 3 retry）
    mockNotionClient.databases.query.mockRejectedValue(new Error('persistent failure'))

    const pageId = await createOrderPage({
      productName: 'Starter',
      outTradeNo: 'DEAD_LETTER_TEST',
      email: 'a@b.com'
    }, mockNotionClient)

    // 返回 null 而不是抛错（notify.js 永远能拿到结果）
    expect(pageId).toBeNull()
    expect(mockNotionClient.databases.query).toHaveBeenCalledTimes(4) // 1 + 3 retries
    // 验证：调用了 webhook 推送（fetch）
    expect(global.fetch).toHaveBeenCalled()
  })

  test('API 契约：Notion 失败 + 死信 webhook 也失败时仍返回 null（永不抛错）', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    // Notion 持续失败（4 次）
    mockNotionClient.databases.query.mockRejectedValue(new Error('notion down'))

    // 死信 webhook 也失败（fetch reject）— 3 次都失败才算"完全失败"
    global.fetch.mockRejectedValue(new Error('webhook down'))

    // 永不抛错（即使两层 fallback 都失败）
    await expect(
      createOrderPage({
        productName: 'Starter',
        outTradeNo: 'CONTRACT_TEST',
        email: 'a@b.com'
      }, mockNotionClient)
    ).resolves.toBeNull()

    // 验证：fetch 确实被尝试了 3 次（重试耗尽）
    expect(global.fetch).toHaveBeenCalledTimes(3)
    // 验证：即使 webhook 失败也没冒泡到外层
    expect(mockNotionClient.databases.query).toHaveBeenCalledTimes(4)
  })

  test('catch 块调用 notifyDeadLetter（fetch 带正确 headers）', async () => {
    const { createOrderPage } = require('@/lib/notion-order')

    // Notion 持续失败触发死信
    mockNotionClient.databases.query.mockRejectedValue(new Error('persistent failure'))

    await createOrderPage({
      productName: 'Starter',
      outTradeNo: 'WEBHOOK_CALLED',
      email: 'a@b.com'
    }, mockNotionClient)

    // 验证 fetch 带了正确的 webhook URL、method、Authorization header
    expect(global.fetch).toHaveBeenCalledWith(
      'https://test.example.com/hooks/wake',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-token',
          'Content-Type': 'application/json'
        })
      })
    )
  })
})
