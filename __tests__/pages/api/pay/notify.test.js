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
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
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
    queryOrder.mockResolvedValue({ tradeStatus: '0', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=0

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
      tradeStatus: '1',  // Z-Pay status=1 支付成功
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
      tradeStatus: '1',  // Z-Pay status=1 支付成功
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
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
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

  test('catch 块日志脱敏：param 字段不含 PII', async () => {
    // 模拟 createOrderPage 抛错触发 catch 块日志
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    createOrderPage.mockRejectedValue(new Error('boom'))

    // PII 三个典型字段：email / name / discountCode
    const PII_EMAIL = 'attacker@example.com'
    const PII_NAME = '真实姓名'
    const PII_CODE = 'INTERNAL-CODE-12345'
    const paramValue = JSON.stringify({ email: PII_EMAIL, name: PII_NAME, discountCode: PII_CODE })

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: paramValue,
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await handler(req, res)

      // 找到含 '[notify] 回调处理异常' 的日志
      const errCall = errorSpy.mock.calls.find(args =>
        typeof args[0] === 'string' && args[0].includes('[notify] 回调处理异常')
      )
      expect(errCall).toBeDefined()
      const logged = errCall[1]

      // param 字段必须脱敏（不能含原始 PII）
      expect(logged.param).toBe('[REDACTED]')
      // paramLength 保留供运营参考
      expect(logged.paramLength).toBe(paramValue.length)
      // PII 字符串不能以任何形式出现在整个日志对象中
      const serialized = JSON.stringify(logged)
      expect(serialized).not.toContain(PII_EMAIL)
      expect(serialized).not.toContain(PII_NAME)
      expect(serialized).not.toContain(PII_CODE)
      // 系统字段保留
      expect(logged.outTradeNo).toBe('TEST123')
      expect(logged.tradeNo).toBe('ZPAY123')
      expect(logged.amount).toBe('29.90')
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('catch 块日志脱敏：超长 param (>200 字符) 标 [REDACTED:long]', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    createOrderPage.mockRejectedValue(new Error('boom'))

    // 构造 >200 字符的 param（含 50 个 PII 重复）
    const padding = 'A'.repeat(250)
    const paramValue = JSON.stringify({ email: padding + '@x.com', name: 'x', discountCode: 'x' })

    const req = {
      method: 'POST',
      body: {
        trade_no: 'ZPAY123',
        out_trade_no: 'LONG_PARAM_TEST',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: paramValue,
        sign_type: 'MD5',
        sign: 'realsign'
      }
    }
    const res = mkRes()

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await handler(req, res)

      const errCall = errorSpy.mock.calls.find(args =>
        typeof args[0] === 'string' && args[0].includes('[notify] 回调处理异常')
      )
      expect(errCall).toBeDefined()
      const logged = errCall[1]

      // 超长 param 用 [REDACTED:long] 标记
      expect(logged.param).toBe('[REDACTED:long]')
      // paramLength 仍记录真实长度（供运营发现异常）
      expect(logged.paramLength).toBeGreaterThan(200)
      // padding 内容不能漏出
      expect(JSON.stringify(logged)).not.toContain(padding)
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('Notion 写入失败（createOrderPage 返回 null）仍返回 success（死信兜底）', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
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

  test('非法请求方法 (PUT/DELETE) 返回 405', async () => {
    // GET 和 POST 现在都支持（Z-Pay 实际用 GET），其他方法 405
    const req = {
      method: 'PUT',
      body: {}
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(405)
  })

  // ─────────────────────────────────────────────────────────────────
  // #31 param 健壮性测试（防止静默吞错导致用户付钱收不到货）
  // 契约：param 不是合法 JSON 对象、或缺 email/name 时，必须返回
  // 'error' 让 Z-Pay 重试，且绝不能调用 createOrderPage 落库。
  // ─────────────────────────────────────────────────────────────────

  function mkParamReq(paramValue, outTradeNo = 'TEST123') {
    // 注意：Pages Router 把 undefined / null body 字段视为字段缺失
    // 测试 param 完全缺失用 paramValue=undefined 时不传 param key
    const body = {
      trade_no: 'ZPAY123',
      out_trade_no: outTradeNo,
      name: '基础版',
      money: '29.90',
      type: 'wxpay',
      trade_status: 'TRADE_SUCCESS',
      sign_type: 'MD5',
      sign: 'realsign'
    }
    if (paramValue !== undefined) {
      body.param = paramValue
    }
    return { method: 'POST', body }
  }

  test('#31: param 完全缺失（Z-Pay 没传） → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq(undefined, 'TEST_NO_PARAM')
    const res = mkRes()

    await handler(req, res)

    // 必须返回 error 让 Z-Pay 重试，不能假装 success
    expect(res.send).toHaveBeenCalledWith('error')
    // 绝不能调用 createOrderPage（防止空邮箱落库）
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('#31: param 是空字符串 → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('', 'TEST_EMPTY_PARAM')
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('error')
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('#31: param 不是合法 JSON（如 "not json"） → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('not json', 'TEST_BAD_JSON')
    const res = mkRes()

    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await handler(req, res)

      expect(res.send).toHaveBeenCalledWith('error')
      expect(createOrderPage).not.toHaveBeenCalled()
      // 必须有日志记录失败原因（脱敏后）
      const logCall = errorSpy.mock.calls.find(args =>
        typeof args[0] === 'string' && args[0].includes('[notify]')
      )
      expect(logCall).toBeDefined()
    } finally {
      errorSpy.mockRestore()
    }
  })

  test('#31: param 是 "null" 字符串 → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('null', 'TEST_NULL_PARAM')
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('error')
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('#31: param 是 JSON 字符串（"hello"）而非对象 → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('"hello"', 'TEST_STRING_PARAM')
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('error')
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('#31: param 是 JSON 数组（[]）而非对象 → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('[]', 'TEST_ARRAY_PARAM')
    const res = mkRes()

    await handler(req, res)

    expect(res.send).toHaveBeenCalledWith('error')
    expect(createOrderPage).not.toHaveBeenCalled()
  })

  test('#31: param 是空对象（{}）缺 email/name → 返回 error 不落库', async () => {
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: 'ZPAY123', money: '29.90' })  // Z-Pay status=1
    const req = mkParamReq('{}', 'TEST_EMPTY_OBJ')
    const res = mkRes()

    await handler(req, res)

    // 空对象 → 解析成功但 email/name 缺失 → 视为订单数据不完整
    expect(res.send).toHaveBeenCalledWith('error')
    expect(createOrderPage).not.toHaveBeenCalled()
  })
})

// === 回归保护：Z-Pay 实际用 GET 调 notify（不是 POST） ===
// 来源：2026-06-21 EdgeOne 日志显示 Z-Pay callback 是 GET + query string
// 根因：notify.js 只接受 POST，导致所有 Z-Pay 真实回调被 405 拒绝
// 修复后：GET notify 也应该被处理（从 req.query 读参数）
describe('GET /api/pay/notify（Z-Pay 实际调用方式）', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('GET 验签失败 → 返回 error', async () => {
    verifySign.mockReturnValue(false)

    const req = {
      method: 'GET',
      query: {
        pid: '2026050116254529',
        trade_no: '4200003131202606218754328861',
        out_trade_no: 'NN1782053617349716LOY',
        type: 'wxpay',
        name: '入门版',
        money: '0.10',
        trade_status: 'TRADE_SUCCESS',
        param: '{"email":"W20L20@163.com","name":"吴题","discountCode":""}',
        sign_type: 'MD5',
        sign: 'invalidsign'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith('error')
  })

  test('GET 支付成功 → 从 req.query 读参数 → 调 createOrderPage 写 Notion', async () => {
    verifySign.mockReturnValue(true)
    // 金额必须与 req.query.money 一致（0.10），否则 amount 二次校验失败 → 'error'
    queryOrder.mockResolvedValue({ tradeStatus: '1', tradeNo: '4200003131202606218754328861', money: '0.10' })
    createOrderPage.mockResolvedValue('new-page-id')

    const req = {
      method: 'GET',
      query: {
        trade_no: '4200003131202606218754328861',
        out_trade_no: 'NN1782053617349716LOY',
        name: '入门版',
        money: '0.10',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: '{"email":"W20L20@163.com","name":"吴题","discountCode":""}',
        sign_type: 'MD5',
        sign: '5f32f3cb2e930aefa70c73449096e008'
      }
    }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.send).toHaveBeenCalledWith('success')
    expect(createOrderPage).toHaveBeenCalledWith(expect.objectContaining({
      outTradeNo: 'NN1782053617349716LOY',
      email: 'W20L20@163.com',
      name: '吴题',
      amount: 0.10,
      status: 'paid'
    }))
  })

  test('GET 非白名单 method (PUT/DELETE 等) → 405', async () => {
    const req = { method: 'PUT', query: {}, body: {} }
    const res = mkRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(405)
  })
})
