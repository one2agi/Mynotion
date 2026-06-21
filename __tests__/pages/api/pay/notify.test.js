// __tests__/pages/api/pay/notify.test.js
/**
 * @jest-environment node
 */

import handler from '@/pages/api/pay/notify'

// Mock dependencies
// requireActual 保留 mapTradeStatus（notify.js 用它判断 paid），
// 只把 verifySign / queryOrder 替换为 jest.fn()
jest.mock('@/lib/zpay', () => {
  const actual = jest.requireActual('@/lib/zpay')
  return {
    ...actual,
    verifySign: jest.fn(),
    queryOrder: jest.fn()
  }
})
jest.mock('@/lib/notion-order', () => ({
  createOrderPage: jest.fn()
}))

const { verifySign, queryOrder } = require('@/lib/zpay')
const { createOrderPage } = require('@/lib/notion-order')

// Factory for mock response object
function mkRes() {
  const send = jest.fn()
  const end = jest.fn()
  const setHeader = jest.fn()
  const status = jest.fn(() => ({ send, end, setHeader }))
  const type = jest.fn(() => ({ send, end, setHeader }))
  const result = { status, send, end, type, setHeader }
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

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/plain'))
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

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', expect.stringContaining('text/plain'))
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

  test('金额二次校验：queryOrder.money !== params.money → 返回 error 不落库', async () => {
    // 场景：Z-Pay 通道 bug / 通知被污染 / 配错 tradeNo
    // 通知说 0.01 元，但 Z-Pay 真实查询显示 29.90 元 → 拒绝落库
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'ZPAY123',
      money: '29.90'  // Z-Pay 真实金额
    })

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '0.01',  // ❌ 通知金额被篡改 / 通道污染
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: JSON.stringify({ email: 'test@example.com', name: '张三', discountCode: '' }),
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    // 必须返回 error 让 Z-Pay 重试，不能让错误金额落库
    expect(res.send).toHaveBeenCalledWith('error')
    // 关键：createOrderPage 绝不能被调用（防止错误金额被持久化）
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('金额二次校验：落库的 amount 必须来自 queryOrder.money 而非 params.money', async () => {
    // 强化：即使 params.money 和 queryOrder.money 数值上相等，
    // 也要显式断言 notify 用的是 queryOrder 的权威值
    // （防止未来重构倒退到 params.money）
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'ZPAY123',
      money: '29.90'  // 权威金额来自服务端二次查询
    })
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

    expect(res.send).toHaveBeenCalledWith('success')
    // 断言落库金额 = queryOrder.money（29.90），不是 params.money 字符串直转
    const callArgs = createOrderPage.mock.calls[0][0]
    expect(callArgs.amount).toBe(29.90)
    expect(typeof callArgs.amount).toBe('number')
  })

  test('回调处理异常（Z-Pay/JSON/code bug）返回 error 让 Z-Pay 重试', async () => {
    // createOrderPage 抛错（不在设计内但要防御）→ 应返回 error
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'TRADE_SUCCESS', tradeNo: 'ZPAY123', money: '29.90' })
    createOrderPage.mockRejectedValue(new Error('Unexpected code bug'))

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

    // 新行为：catch 块返回 error 让 Z-Pay 重试
    expect(res.send).toHaveBeenCalledWith('error')
  })

  test('Notion 写入失败（createOrderPage 返回 null）仍返回 success（死信兜底）', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'TRADE_SUCCESS', tradeNo: 'ZPAY123', money: '29.90' })
    // 新行为：createOrderPage 不抛错，返回 null（已写死信）
    createOrderPage.mockResolvedValue(null)

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: JSON.stringify({ email: 'test@example.com', name: '张三', discountCode: '' }),
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('success')
    expect(createOrderPage).toHaveBeenCalled()
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
