// __tests__/pages/api/pay/query-order.test.js
/**
 * @jest-environment node
 */

import handler from '@/pages/api/pay/query-order'

// Mock dependencies
jest.mock('@/lib/zpay', () => ({
  queryOrder: jest.fn()
}))

const { queryOrder } = require('@/lib/zpay')

// Factory for mock response object
function mkRes() {
  const json = jest.fn()
  const status = jest.fn(() => ({ json }))
  const setHeader = jest.fn()
  const result = { status, json, setHeader, _data: null }
  status.mockReturnThis()
  return result
}

describe('GET /api/pay/query-order', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('查询待支付订单返回 pending', async () => {
    queryOrder.mockResolvedValue({
      tradeStatus: 'WAIT_BUYER_PAY',
      tradeNo: 'ZPAY123',
      money: '39.90'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalled()
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.status).toBe('pending')
    expect(jsonData.data.outTradeNo).toBe('TEST123')
  })

  test('查询已支付订单返回 paid + 真实 endtime', async () => {
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'ZPAY123',
      money: '39.90',
      endtime: '2026-06-21 08:06:06'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.status).toBe('paid')
    // paidAt 应来自 Z-Pay endtime（不是查询时间 new Date()）
    expect(jsonData.data.paidAt).toBe('2026-06-21T08:06:06.000Z')
  })

  test('查询已关闭订单返回 closed', async () => {
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_CLOSED',
      tradeNo: '',
      money: '0'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.status).toBe('closed')
  })

  test('缺少 outTradeNo 参数返回错误', async () => {
    const req = { method: 'GET', query: {} }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
  })

  test('ZPay 接口返回未知状态返回 unknown', async () => {
    queryOrder.mockResolvedValue({
      tradeStatus: 'UNKNOWN_STATUS',
      tradeNo: 'ZPAY123',
      money: '39.90'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(true)
    expect(jsonData.data.status).toBe('unknown')
  })

  test('ZPay 接口异常返回 500', async () => {
    queryOrder.mockRejectedValue(new Error('ZPay error'))

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(500)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
  })

  test('非 GET 请求返回 405', async () => {
    const req = { method: 'POST', body: {} }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(405)
    const jsonData = res.json.mock.calls[0][0]
    expect(jsonData.success).toBe(false)
  })

  test('所有响应路径都设置 Cache-Control: no-store 防止 CDN/浏览器缓存', async () => {
    // 验证 4 条响应路径都设置了禁止缓存的 header：
    // 1) 200 成功 (paid)
    // 2) 200 成功 (pending)
    // 3) 400 参数缺失
    // 4) 405 方法不允许
    const cases = [
      {
        name: 'paid',
        req: { method: 'GET', query: { outTradeNo: 'T1' } },
        mockResult: {
          tradeStatus: 'TRADE_SUCCESS',
          tradeNo: 'X',
          money: '1',
          endtime: '2026-06-21 08:06:06'
        }
      },
      {
        name: 'pending',
        req: { method: 'GET', query: { outTradeNo: 'T2' } },
        mockResult: { tradeStatus: 'WAIT_BUYER_PAY', tradeNo: 'X', money: '1' }
      },
      {
        name: 'missing param',
        req: { method: 'GET', query: {} },
        mockResult: null
      },
      {
        name: 'wrong method',
        req: { method: 'POST', body: {} },
        mockResult: null
      }
    ]

    for (const c of cases) {
      if (c.mockResult) queryOrder.mockResolvedValueOnce(c.mockResult)
      const res = mkRes()
      await handler(c.req, res)
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    }
  })
})
