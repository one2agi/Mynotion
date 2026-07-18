// __tests__/lib/notion-discount.test.js
/**
 * @jest-environment node
 */

jest.mock('@notionhq/client')
jest.mock('@/lib/cache/redis_cache', () => ({
  redisClient: {
    set: jest.fn(),
    del: jest.fn()
  }
}))

const { Client } = require('@notionhq/client')
const { redisClient } = require('@/lib/cache/redis_cache')

const mockQuery = jest.fn()
Client.mockImplementation(() => ({
  databases: {
    query: mockQuery
  }
}))

const { lookupDiscountCode } = require('@/lib/notion-discount')

describe('优惠码查询', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('查询有效优惠码返回金额', async () => {
    mockQuery.mockResolvedValue({
      results: [{
        id: 'mock-page-id',
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'SAVE10' }] },
          '优惠金额': { number: 10 },
          '状态': { status: { name: '启用' } }
        }
      }]
    })

    const result = await lookupDiscountCode('SAVE10')
    // 用 toMatchObject 而不是 toEqual — return 多了 isOneTime/code/pageId/used 字段
    expect(result).toMatchObject({ amount: 10, name: 'SAVE10' })
  })

  test('查询无效优惠码返回 null', async () => {
    mockQuery.mockResolvedValue({ results: [] })

    const result = await lookupDiscountCode('INVALID')
    expect(result).toBeNull()
  })

  test('查询空优惠码返回 null', async () => {
    const result = await lookupDiscountCode('')
    expect(result).toBeNull()
  })

  test('查询仅空格优惠码返回 null', async () => {
    const result = await lookupDiscountCode('   ')
    expect(result).toBeNull()
  })

  test('Notion query 失败 2 次后第 3 次成功（retry 生效）', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('rate_limited'))
      .mockRejectedValueOnce(new Error('service_unavailable'))
      .mockResolvedValueOnce({
        results: [{
          properties: {
            '优惠码': { rich_text: [{ plain_text: 'SAVE10' }] },
            '优惠金额': { number: 10 },
            '状态': { status: { name: '启用' } }
          }
        }]
      })

    const result = await lookupDiscountCode('SAVE10')
    expect(result).toMatchObject({ amount: 10, name: 'SAVE10' })
    expect(mockQuery).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  test('Notion query 持续失败 4 次后抛错（不静默吞）', async () => {
    mockQuery.mockRejectedValue(new Error('persistent failure'))

    await expect(lookupDiscountCode('SAVE10')).rejects.toThrow('persistent failure')
    expect(mockQuery).toHaveBeenCalledTimes(4) // 1 + 3 retries
  })

  // ─── 一次性优惠码支持（2026-07-18）───

  test('一次性码行: 返回 isOneTime:true / used:false + pageId + code', async () => {
    mockQuery.mockResolvedValue({
      results: [{
        id: 'page-uuid-one-time',
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'ONE2AGI25' }] },
          '优惠金额': { number: 30 },
          '状态': { status: { name: '启用' } },
          '一次/永久': { select: { name: '一次性' } },
          '已使用(一次性)': { checkbox: false }
        }
      }]
    })

    const result = await lookupDiscountCode('ONE2AGI25')

    expect(result).toEqual({
      amount: 30,
      name: 'ONE2AGI25',
      isOneTime: true,
      code: 'ONE2AGI25',
      pageId: 'page-uuid-one-time',
      used: false
    })
  })

  test('一次性码已使用: 返回 used:true', async () => {
    mockQuery.mockResolvedValue({
      results: [{
        id: 'page-uuid-used',
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'USED' }] },
          '优惠金额': { number: 30 },
          '状态': { status: { name: '启用' } },
          '一次/永久': { select: { name: '一次性' } },
          '已使用(一次性)': { checkbox: true }
        }
      }]
    })

    const result = await lookupDiscountCode('USED')

    expect(result.used).toBe(true)
  })

  test('永久码: 即使数据里有"已使用(一次性)"勾, 也返回 used:false', async () => {
    // 回归保护: 永久码不读 checkbox 字段
    mockQuery.mockResolvedValue({
      results: [{
        id: 'page-uuid-permanent',
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'PERM' }] },
          '优惠金额': { number: 10 },
          '状态': { status: { name: '启用' } },
          '一次/永久': { select: { name: '永久优惠码' } },
          // 即使被运营手抖勾上了也无视
          '已使用(一次性)': { checkbox: true }
        }
      }]
    })

    const result = await lookupDiscountCode('PERM')

    expect(result.isOneTime).toBe(false)
    expect(result.used).toBe(false)
  })
})

describe('一次性码待支付占用', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('reserveDiscountCode 用 Redis NX + EX 占用同一个优惠码 pageId', async () => {
    redisClient.set.mockResolvedValue('OK')
    const { reserveDiscountCode } = require('@/lib/notion-discount')

    const reserved = await reserveDiscountCode('discount-page-id', 'NN123')

    expect(reserved).toBe(true)
    expect(redisClient.set).toHaveBeenCalledWith(
      'notionnext:discount-reservation:discount-page-id',
      'NN123',
      'EX',
      1800,
      'NX'
    )
  })

  test('reserveDiscountCode 返回 false 表示优惠码已被其他待支付订单占用', async () => {
    redisClient.set.mockResolvedValue(null)
    const { reserveDiscountCode } = require('@/lib/notion-discount')

    await expect(reserveDiscountCode('discount-page-id', 'NN123')).resolves.toBe(false)
  })

  test('releaseDiscountReservation 删除对应占用 key', async () => {
    redisClient.del.mockResolvedValue(1)
    const { releaseDiscountReservation } = require('@/lib/notion-discount')

    await releaseDiscountReservation('discount-page-id')

    expect(redisClient.del).toHaveBeenCalledWith('notionnext:discount-reservation:discount-page-id')
  })
})

// ─── markDiscountCodeUsed ───
describe('markDiscountCodeUsed', () => {
  // 用同一组 Client/databases mock — 重新拿一次
  let mockPagesUpdate

  beforeEach(() => {
    jest.clearAllMocks()
    mockPagesUpdate = jest.fn().mockResolvedValue({})
    Client.mockImplementation(() => ({
      databases: { query: jest.fn() },
      pages: { update: mockPagesUpdate }
    }))
  })

  test('调 Notion pages.update 并把 checkbox 设为 true', async () => {
    const { markDiscountCodeUsed } = require('@/lib/notion-discount')

    await markDiscountCodeUsed('page-uuid-to-mark')

    expect(mockPagesUpdate).toHaveBeenCalledTimes(1)
    // 必须用 object 形式 { page_id, properties } — 不能 positional
    // 参照 markTokenAsUsed (lib/notion-token.js:91-102) 工作写法
    expect(mockPagesUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        page_id: 'page-uuid-to-mark',
        properties: expect.objectContaining({
          '已使用(一次性)': { checkbox: true }
        })
      })
    )
  })

  test('markDiscountCodeUsed 失败抛错（不静默吞）', async () => {
    mockPagesUpdate.mockRejectedValue(new Error('Notion 5xx'))
    const { markDiscountCodeUsed } = require('@/lib/notion-discount')

    await expect(markDiscountCodeUsed('bad-id')).rejects.toThrow('Notion 5xx')
  })
})
