// __tests__/pages/api/pay/create-order.test.js
/**
 * @jest-environment node
 */

import handler from '@/pages/api/pay/create-order'

// Mock dependencies
jest.mock('@/lib/zpay', () => ({
  createNativeOrder: jest.fn()
}))
jest.mock('@/lib/notion-discount', () => ({
  lookupDiscountCode: jest.fn()
}))
jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((key, defaultVal) => {
    const config = {
      'STARTER_PRICING_1_TITLE': '入门版',
      'STARTER_PRICING_1_PRICE': '19.9',
      'STARTER_PRICING_2_TITLE': '基础版',
      'STARTER_PRICING_2_PRICE': '39.9',
      'STARTER_PRICING_3_TITLE': '高级版',
      'STARTER_PRICING_3_PRICE': '59.9',
      'STARTER_PAYMENT_NOTIFY_URL': 'https://test.com/api/pay/notify'
    }
    return config[key] !== undefined ? config[key] : defaultVal
  })
}))

const { createNativeOrder } = require('@/lib/zpay')
const { lookupDiscountCode } = require('@/lib/notion-discount')
const { siteConfig } = require('@/lib/config')

// Factory for mock response object
function mkRes() {
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const result = { status, json, _data: null }
  status.mockReturnThis()
  return result
}

describe('POST /api/pay/create-order', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('无优惠码创建订单成功', async () => {
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalled()
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.qrcode).toBe('weixin://wxpay/xxx')
    expect(jsonData.data.originalAmount).toBe(39.9)
    expect(jsonData.data.discountAmount).toBe(0)
    expect(jsonData.data.amount).toBe(39.9)
  })

  test('有效优惠码抵扣成功', async () => {
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })
    lookupDiscountCode.mockResolvedValue({ amount: 10, name: 'SAVE10' })

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'SAVE10',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.originalAmount).toBe(39.9)
    expect(jsonData.data.discountAmount).toBe(10)
    expect(jsonData.data.amount).toBe(29.9)
  })

  test('无效优惠码返回错误', async () => {
    lookupDiscountCode.mockResolvedValue(null)

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'INVALID',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INVALID_DISCOUNT')
  })

  test('无效商品 ID 返回错误', async () => {
    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'invalid-product'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INVALID_PRODUCT')
  })

  test('缺少必填字段返回错误', async () => {
    const req = {
      method: 'POST',
      body: {
        name: '',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INVALID_INPUT')
  })

  test('无效邮箱格式返回错误', async () => {
    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'invalid-email',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INVALID_INPUT')
  })
})
