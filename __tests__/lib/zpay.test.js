// __tests__/lib/zpay.test.js
import { signParams, verifySign, createNativeOrder, queryOrder } from '@/lib/zpay'

// Mock fetch
global.fetch = jest.fn()

describe('Z-Pay 签名', () => {
  const TEST_KEY = 'testkey123'

  beforeEach(() => {
    process.env.ZPAY_KEY = TEST_KEY
  })

  test('signParams 生成正确签名', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(typeof sign).toBe('string')
    expect(sign).toHaveLength(32) // MD5 hex length
  })

  test('verifySign 验签成功', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(verifySign({ ...params, sign })).toBe(true)
  })

  test('verifySign 验签失败（篡改数据）', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(verifySign({ ...params, money: '0.01', sign })).toBe(false)
  })
})

describe('Z-Pay fetch 错误处理', () => {
  beforeEach(() => {
    process.env.ZPAY_PID = '2026050116254529'
    process.env.ZPAY_KEY = 'testkey123'
    process.env.ZPAY_API_URL = 'https://z-pay.cn'
    jest.clearAllMocks()
  })

  test('createNativeOrder fetch 超时（AbortError）抛错', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    global.fetch.mockRejectedValueOnce(abortError)

    await expect(
      createNativeOrder({
        outTradeNo: 'TEST123',
        name: '测试商品',
        money: 1.0,
        notifyUrl: 'https://example.com/notify',
        param: '{}'
      })
    ).rejects.toThrow('aborted')
    // 验证传了 AbortSignal
    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(Object) })
    )
  })

  test('createNativeOrder HTTP 5xx 抛错', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ msg: 'server error' })
    })

    await expect(
      createNativeOrder({
        outTradeNo: 'TEST123',
        name: '测试商品',
        money: 1.0,
        notifyUrl: 'https://example.com/notify',
        param: '{}'
      })
    ).rejects.toThrow('HTTP 500')
  })

  test('queryOrder HTTP 5xx 抛错（不再静默解析 HTML）', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503
    })

    await expect(queryOrder('TEST123')).rejects.toThrow('HTTP 503')
  })

  test('queryOrder 正常返回', async () => {
    // Z-Pay 真实响应：查询 API 用 status (Int 0/1) 不是 trade_status (String)
    // code: 1 表示接口调用成功（与 create API 一致）
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1,                               // ← Z-Pay 所有成功响应都有 code:1
        status: 1,                             // ← 真实字段
        trade_no: 'ZPAY123',
        money: '1.00',
        name: '测试商品',
        type: 'wxpay2',
        addtime: '2026-06-21 08:00:00',
        endtime: '2026-06-21 08:05:00',
        buyer: '微信用户'
      })
    })

    const result = await queryOrder('TEST123')
    expect(result.tradeStatus).toBe('1')
    expect(result.endtime).toBe('2026-06-21 08:05:00')
  })

  // === 回归保护：必须用 Z-Pay 真实响应格式（status 数字 0/1，不是 trade_status 字符串）===
  // 来源：2026-06-21 生产事故 — notify.js 永远不写 Notion
  // 根因：queryOrder 读 result.trade_status（字符串）但 Z-Pay 返回 result.status（Int 0/1）
  // 参考：https://z-pay.cn/doc.html "查询单个订单" → status 字段类型 Int
  describe('Z-Pay 真实响应格式（回归保护）', () => {
    test('未支付订单 status=0 → tradeStatus="0"（不是 undefined）', async () => {
      // 这就是 2026-06-21 真实 Z-Pay 响应的格式
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 1,
          msg: '查询订单号成功！',
          status: 0,                          // ← 真实字段，Int
          name: '入门版',
          money: '0.10',
          out_trade_no: 'NN1782048893073ZV4P69',
          trade_no: null,
          type: 'wxpay2',
          param: '{"email":"e2e-test@example.com","name":"E2E测试用户","discountCode":""}',
          addtime: '2026-06-21 21:34:54',
          endtime: '2026-06-21 21:34:54',
          pid: '2026050116254529',
          buyer: null
          // 注意：没有 trade_status 字段
        })
      })

      const result = await queryOrder('NN1782048893073ZV4P69')

      // 关键断言：必须是 '0'，不能是 undefined（生产 bug 根因）
      expect(result.tradeStatus).toBe('0')
      expect(result.tradeStatus).not.toBeUndefined()
    })

    test('已支付订单 status=1 → tradeStatus="1"（被 mapTradeStatus 翻译为 "paid"）', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 1,
          status: 1,                          // ← 支付成功
          money: '0.10',
          trade_no: 'ZPAY_REAL_12345',
          endtime: '2026-06-21 21:40:00'
        })
      })

      const result = await queryOrder('TEST_PAID')

      expect(result.tradeStatus).toBe('1')
      expect(result.tradeStatus).not.toBeUndefined()
    })

    test('已关闭订单 status=2 → tradeStatus="2"', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          code: 1,
          status: 2,                          // ← 关闭（Z-Pay 文档未明说但保留兼容）
          money: '0.10'
        })
      })

      const result = await queryOrder('TEST_CLOSED')

      expect(result.tradeStatus).toBe('2')
    })
  })

  test('createNativeOrder 成功返回 qrcode（行 95-99 happy path）', async () => {
    // 覆盖 response.json() 解析 + result.code === 1 + return { qrcode }
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 1, qrcode: 'weixin://wxpay/bizpayurl?pr=xxx' })
    })

    const result = await createNativeOrder({
      outTradeNo: 'TEST123',
      name: '测试商品',
      money: 1.0,
      notifyUrl: 'https://example.com/notify',
      param: '{}'
    })
    expect(result.qrcode).toBe('weixin://wxpay/bizpayurl?pr=xxx')
  })

  test('createNativeOrder 业务失败（code !== 1）抛错', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, msg: '余额不足' })
    })

    await expect(
      createNativeOrder({
        outTradeNo: 'TEST123',
        name: '测试商品',
        money: 1.0,
        notifyUrl: 'https://example.com/notify',
        param: '{}'
      })
    ).rejects.toThrow('余额不足')
  })

  // === TDD: queryOrder 应与 createNativeOrder 保持一致 ===
  // Z-Pay 错误响应示例：{ code: 0, msg: '订单不存在' }
  // 修复前：queryOrder 会静默返回 undefined 字段（bug）
  // 修复后：应抛错，与 createNativeOrder 行为一致
  test('queryOrder 业务失败（code !== 1）抛错', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ code: 0, msg: '订单不存在' })
    })

    await expect(queryOrder('NON_EXIST')).rejects.toThrow('订单不存在')
  })
})