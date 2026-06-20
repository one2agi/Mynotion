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
          '状态': { status: { name: 'active' } }
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
})