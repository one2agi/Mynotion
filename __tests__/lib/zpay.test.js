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
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        trade_status: 'TRADE_SUCCESS',
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
    expect(result.tradeStatus).toBe('TRADE_SUCCESS')
    expect(result.endtime).toBe('2026-06-21 08:05:00')
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
})