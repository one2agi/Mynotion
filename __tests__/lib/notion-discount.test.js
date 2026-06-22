// __tests__/lib/notion-discount.test.js
/**
 * @jest-environment node
 */

jest.mock('@notionhq/client')

const { Client } = require('@notionhq/client')

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
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'SAVE10' }] },
          '优惠金额': { number: 10 },
          '选择': { status: { name: 'active' } }
        }
      }]
    })

    const result = await lookupDiscountCode('SAVE10')
    expect(result).toEqual({ amount: 10, name: 'SAVE10' })
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
            '选择': { status: { name: 'active' } }
          }
        }]
      })

    const result = await lookupDiscountCode('SAVE10')
    expect(result).toEqual({ amount: 10, name: 'SAVE10' })
    expect(mockQuery).toHaveBeenCalledTimes(3) // 1 initial + 2 retries
  })

  test('Notion query 持续失败 4 次后抛错（不静默吞）', async () => {
    mockQuery.mockRejectedValue(new Error('persistent failure'))

    await expect(lookupDiscountCode('SAVE10')).rejects.toThrow('persistent failure')
    expect(mockQuery).toHaveBeenCalledTimes(4) // 1 + 3 retries
  })
})