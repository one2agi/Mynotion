// __tests__/lib/notion-order.test.js

const mockNotionClient = {
  databases: { query: jest.fn(), create: jest.fn() },
  pages: { create: jest.fn() }
}

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockReturnValue(mockNotionClient)
}))

// Clear module cache to ensure fresh import after mock setup
beforeAll(async () => {
  jest.resetModules()
  const module = await import('@/lib/notion-order')
  // Re-mock after reset if needed
})

describe('Notion 订单写入', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockNotionClient.databases.query.mockReset()
    mockNotionClient.pages.create.mockReset()
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

  test('retry 耗尽后写入死信，返回 null（不抛错）', async () => {
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
  })

  test('API 契约：Notion 失败 + 死信文件也写失败时仍返回 null（永不抛错）', async () => {
    const { createOrderPage } = require('@/lib/notion-order')
    const fs = require('fs')

    // Notion 持续失败（4 次）
    mockNotionClient.databases.query.mockRejectedValue(new Error('notion down'))

    // 死信文件 fs.writeFileSync 也失败（Vercel 只读 FS / 磁盘满）
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue('[]')

    // 永不抛错（即使两层 fallback 都失败）
    await expect(
      createOrderPage({
        productName: 'Starter',
        outTradeNo: 'CONTRACT_TEST',
        email: 'a@b.com'
      }, mockNotionClient)
    ).resolves.toBeNull()

    // 验证：writeFileSync 确实被尝试（说明确实进入死信路径）
    expect(writeSpy).toHaveBeenCalled()
    // 验证：即使 fs 失败也没冒泡到外层
    expect(mockNotionClient.databases.query).toHaveBeenCalledTimes(4)

    writeSpy.mockRestore()
    existsSpy.mockRestore()
    readSpy.mockRestore()
  })
})

describe('getDeadLetterPath 环境适配', () => {
  let originalEnv

  beforeEach(() => {
    // 保存原始 env，每次测试后恢复
    originalEnv = {
      VERCEL: process.env.VERCEL,
      EDGEONE: process.env.EDGEONE
    }
    // 清空避免前一个测试的污染
    delete process.env.VERCEL
    delete process.env.EDGEONE
  })

  afterEach(() => {
    // 恢复 env
    if (originalEnv.VERCEL === undefined) delete process.env.VERCEL
    else process.env.VERCEL = originalEnv.VERCEL
    if (originalEnv.EDGEONE === undefined) delete process.env.EDGEONE
    else process.env.EDGEONE = originalEnv.EDGEONE
  })

  test('本地 dev: VERCEL/EDGEONE 都没设 → 返回 lib/orders-failed.json', () => {
    const { getDeadLetterPath } = require('@/lib/notion-order')
    const p = getDeadLetterPath()
    expect(p).toContain('lib/orders-failed.json')
    expect(p).not.toContain('/tmp/')
  })

  test('Vercel 环境: VERCEL=1 → 返回 /tmp/orders-failed.json', () => {
    process.env.VERCEL = '1'
    const { getDeadLetterPath } = require('@/lib/notion-order')
    expect(getDeadLetterPath()).toBe('/tmp/orders-failed.json')
  })

  test('EdgeOne 环境: EDGEONE=1 → 返回 /tmp/orders-failed.json', () => {
    process.env.EDGEONE = '1'
    const { getDeadLetterPath } = require('@/lib/notion-order')
    expect(getDeadLetterPath()).toBe('/tmp/orders-failed.json')
  })

  test('Vercel 优先: 两个都设时仍用 /tmp（顺序无关）', () => {
    process.env.VERCEL = '1'
    process.env.EDGEONE = '1'
    const { getDeadLetterPath } = require('@/lib/notion-order')
    expect(getDeadLetterPath()).toBe('/tmp/orders-failed.json')
  })
})