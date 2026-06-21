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

// CSRF 白名单：与 process.env.NEXT_PUBLIC_SITE_URL 一致
const ALLOWED_ORIGIN = 'https://notionnext.example.com'
process.env.NEXT_PUBLIC_SITE_URL = ALLOWED_ORIGIN

// Factory for mock response object
function mkRes() {
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const result = { status, json }
  status.mockReturnThis()
  return result
}

// 默认合法的 Origin header（所有测试都要带，除非专门测 CSRF 拦截）
const VALID_ORIGIN_HEADER = { origin: ALLOWED_ORIGIN }

describe('POST /api/pay/create-order', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('无优惠码创建订单成功', async () => {
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
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
    // starter-basic maps to STARTER_PRICING_1 (入门版 ¥19.9)
    expect(jsonData.data.originalAmount).toBe(19.9)
    expect(jsonData.data.discountAmount).toBe(0)
    expect(jsonData.data.amount).toBe(19.9)
  })

  test('有效优惠码抵扣成功', async () => {
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })
    lookupDiscountCode.mockResolvedValue({ amount: 10, name: 'SAVE10' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
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
    // starter-basic ¥19.9 - SAVE10 ¥10 = 实付 ¥9.9
    expect(jsonData.data.originalAmount).toBe(19.9)
    expect(jsonData.data.discountAmount).toBe(10)
    expect(jsonData.data.amount).toBe(9.9)
  })

  test('无效优惠码返回错误', async () => {
    lookupDiscountCode.mockResolvedValue(null)

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
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
      headers: VALID_ORIGIN_HEADER,
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
      headers: VALID_ORIGIN_HEADER,
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
      headers: VALID_ORIGIN_HEADER,
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

  test('非 POST 请求返回 405', async () => {
    const req = {
      method: 'GET',
      query: {}
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(405)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.error).toBe('Method not allowed')
  })

  test('Z-Pay 内部错误 → catch 行 113-114 返回 500 INTERNAL_ERROR', async () => {
    // 模拟 createNativeOrder 抛错（Z-Pay 服务端 hang、5xx、签名失败等）
    createNativeOrder.mockRejectedValue(new Error('Z-Pay 创建订单失败: 余额不足'))

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    // 抑制 console.error 输出（catch 块会打日志）
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INTERNAL_ERROR')
    // 验证 catch 块确实记录了错误（行 113 的 console.error）
    expect(errSpy).toHaveBeenCalledWith(
      '创建订单失败:',
      expect.any(Error)
    )

    errSpy.mockRestore()
  })

  test('优惠码查询抛错 → catch 行 113-114 返回 500', async () => {
    // 模拟 lookupDiscountCode 抛错（Notion 5xx/超时/重试耗尽）
    lookupDiscountCode.mockRejectedValue(new Error('Notion query failed after retries'))

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'SAVE10',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INTERNAL_ERROR')

    errSpy.mockRestore()
  })

  // CSRF 防护：Origin/Referer 白名单（防御第三方网站诱导下单）
  test('CSRF：跨域 Origin（第三方网站 POST）→ 403 + 不调 createNativeOrder', async () => {
    const req = {
      method: 'POST',
      headers: { origin: 'https://evil.com' }, // ❌ 攻击者网站
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('CSRF_FORBIDDEN')
    // 关键：createNativeOrder 绝不能被调用（防止脚本刷 Z-Pay 配额）
    expect(createNativeOrder).not.toHaveBeenCalled()
  })

  test('CSRF：缺少 Origin header（curl/服务端脚本直连）→ 403', async () => {
    const req = {
      method: 'POST',
      // ❌ 没有 headers.origin（同源 form submit 才会带 origin）
      // curl 也不会带
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json.mock.calls[0][0].code).toBe('CSRF_FORBIDDEN')
    expect(createNativeOrder).not.toHaveBeenCalled()
  })

  test('CSRF：同源 Origin 通过校验', async () => {
    // 同源 POST 应该正常走完流程（这是合法用户）
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })

    const req = {
      method: 'POST',
      headers: { origin: ALLOWED_ORIGIN },
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
    expect(createNativeOrder).toHaveBeenCalledTimes(1)
  })

  // ---------- #27 浮点精度边界 ----------

  test('优惠码 = 原价 → 拒绝（amount = 0 → 防免费购买）', async () => {
    lookupDiscountCode.mockResolvedValue({ amount: 19.9, name: 'FULL_OFF' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'FULL_OFF',
        productId: 'starter-basic'  // ¥19.9
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
    expect(jsonData.code).toBe('INVALID_DISCOUNT_AMOUNT')
    // 关键：createNativeOrder 绝不能被调用（防止 0 元订单被创建）
    expect(createNativeOrder).not.toHaveBeenCalled()
  })

  test('优惠码 > 原价 → 拒绝（amount < 0 → 防免费购买）', async () => {
    lookupDiscountCode.mockResolvedValue({ amount: 99.9, name: 'HUGE' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'HUGE',
        productId: 'starter-basic'  // ¥19.9
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.code).toBe('INVALID_DISCOUNT_AMOUNT')
    expect(createNativeOrder).not.toHaveBeenCalled()
  })

  test('浮点临界 19.9 - 19.91 → 拒绝（rounds to 0）', async () => {
    // 防御深度：浮点精度边界，即使 round 完等于 0 也必须拒绝
    lookupDiscountCode.mockResolvedValue({ amount: 19.91, name: 'NEARLY_FREE' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'NEARLY_FREE',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_DISCOUNT_AMOUNT')
    expect(createNativeOrder).not.toHaveBeenCalled()
  })

  test('浮点 19.9 - 19.89 → 接受（amount = 0.01，最小合法金额）', async () => {
    // 反向测试：确保 0.01 元订单不被误拒
    lookupDiscountCode.mockResolvedValue({ amount: 19.89, name: 'ALMOST_FREE' })
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })

    const req = {
      method: 'POST',
      headers: VALID_ORIGIN_HEADER,
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'ALMOST_FREE',
        productId: 'starter-basic'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    // 验证 amount 准确为 0.01（不能误拒最小合法金额）
    expect(createNativeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ money: 0.01 })
    )
  })
})
