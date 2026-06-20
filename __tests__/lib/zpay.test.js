// __tests__/lib/zpay.test.js
import { signParams, verifySign } from '@/lib/zpay'

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