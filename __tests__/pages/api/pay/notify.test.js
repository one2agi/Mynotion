// __tests__/pages/api/pay/notify.test.js
/**
 * @jest-environment node
 */

import handler from '@/pages/api/pay/notify'

// Mock dependencies
jest.mock('@/lib/zpay', () => ({
  verifySign: jest.fn(),
  queryOrder: jest.fn()
}))
jest.mock('@/lib/notion-order', () => ({
  createOrderPage: jest.fn()
}))

const { verifySign, queryOrder } = require('@/lib/zpay')
const { createOrderPage } = require('@/lib/notion-order')

// Factory for mock response object
function mkRes() {
  const send = jest.fn()
  const end = jest.fn()
  const status = jest.fn(() => ({ send, end }))
  const type = jest.fn(() => ({ send, end }))
  const result = { status, send, end, type, _sent: null }
  status.mockReturnThis()
  type.mockReturnThis()
  return result
}

describe('POST /api/pay/notify', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('验签失败返回 error', async () => {
    verifySign.mockReturnValue(false)

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '测试商品',
        money: '39.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: '{}',
        sign_type: 'MD5',
        sign: 'invalidsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.type).toHaveBeenCalledWith('text/plain')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith('error')
  })

  test('支付成功写入 Notion 返回 success', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'TRADE_SUCCESS', tradeNo: 'ZPAY123', money: '29.90' })
    createOrderPage.mockResolvedValue('new-page-id')

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: JSON.stringify({ email: 'test@example.com', name: '张三', discountCode: 'SAVE10' }),
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.type).toHaveBeenCalledWith('text/plain')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith('success')
    expect(createOrderPage).toHaveBeenCalledWith(expect.objectContaining({
      outTradeNo: 'TEST123',
      tradeNo: 'ZPAY123',
      amount: 29.90,
      productName: '基础版',
      email: 'test@example.com',
      name: '张三',
      discountCode: 'SAVE10',
      status: 'paid'
    }))
  })

  test('Z-Pay 订单状态非成功也返回 success', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'WAIT_BUYER_PAY', tradeNo: 'ZPAY123', money: '29.90' })

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'WAIT_BUYER_PAY',
        param: '{}',
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('success')
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('回调处理异常返回 success（避免 Z-Pay 重试）', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'TRADE_SUCCESS', tradeNo: 'ZPAY123', money: '29.90' })
    createOrderPage.mockRejectedValue(new Error('Notion write failed'))

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: '{}',
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('success')
  })

  test('非法请求方法返回 405', async () => {
    const req = {
      method: 'GET',
      body: {}
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(405)
  })
})
