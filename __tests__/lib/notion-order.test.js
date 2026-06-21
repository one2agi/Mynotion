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
      tradeNo: 'ZPAY123456'
    }

    const pageId = await createOrderPage(orderData, mockNotionClient)
    expect(pageId).toBe('new-page-id-123')
    expect(mockNotionClient.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: expect.objectContaining({
          '客户名': { title: [{ text: { content: '测试用户' } }] },
          '订单号': { rich_text: [{ text: { content: 'TEST123456' } }] },
          '客户邮箱': { email: 'test@example.com' },
          '商品名': { rich_text: [{ text: { content: 'Starter 基础版' } }] },
          '金额': { number: 29.9 },
          '备注': { rich_text: [{ text: { content: '优惠码: SAVE10' } }] },
          '状态': { status: { name: '待发送' } },
          'Token': { rich_text: [{ text: { content: 'ZPAY123456' } }] }
        })
      })
    )
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
})