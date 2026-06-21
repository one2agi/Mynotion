import crypto from 'crypto'

/**
 * Z-Pay API 封装
 * 文档：https://member.z-pay.cn/member/doc.html
 */

const ZPAY_PID = process.env.ZPAY_PID
const ZPAY_KEY = process.env.ZPAY_KEY
const ZPAY_API_URL = process.env.ZPAY_API_URL || 'https://z-pay.cn'

/**
 * 创建带超时的 AbortSignal（兼容 jsdom 环境，AbortSignal.timeout 不可用）
 * @param {number} ms - 超时毫秒数
 * @returns {AbortSignal}
 */
function timeoutSignal(ms) {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), ms)
  return controller.signal
}

/**
 * 生成签名（按字典序排列后拼接 + MD5）
 * @param {Object} params - 参数对象（不含 sign）
 * @returns {string} 小写 MD5 签名
 */
export function signParams(params) {
  const sorted = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && k !== 'sign' && k !== 'sign_type')
    .sort()
  const prestr = sorted.map(k => `${k}=${params[k]}`).join('&')
  return crypto.createHash('md5').update(prestr + ZPAY_KEY).digest('hex')
}

/**
 * 验证签名
 * @param {Object} params - 包含 sign 的完整参数
 * @returns {boolean}
 */
export function verifySign(params) {
  const { sign, sign_type, ...rest } = params
  if (!sign) return false
  return signParams(rest) === sign
}

/**
 * 创建 Native 订单（微信扫码支付）
 * @param {Object} orderInfo
 * @param {string} orderInfo.outTradeNo - 商户订单号
 * @param {string} orderInfo.name - 商品名称
 * @param {number} orderInfo.money - 金额（元），最多两位小数
 * @param {string} orderInfo.notifyUrl - 回调地址
 * @param {string} orderInfo.param - 附加参数（JSON 字符串）
 * @returns {Promise<{ qrcode: string }>}
 */
export async function createNativeOrder({ outTradeNo, name, money, notifyUrl, param }) {
  const params = {
    pid: ZPAY_PID,
    type: 'wxpay',
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    name,
    money: String(money), // Z-Pay 接受字符串或数字
    param,
    sign_type: 'MD5'
  }
  params.sign = signParams(params)

  const formData = new URLSearchParams()
  Object.keys(params).forEach(k => formData.append(k, params[k]))

  const response = await fetch(`${ZPAY_API_URL}/mapi.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString(),
    // 防止 Z-Pay 服务端 hang 时整个 API route 阻塞至 Vercel 10s 强杀
    signal: timeoutSignal(5000)
  })

  if (!response.ok) {
    throw new Error(`Z-Pay createOrder HTTP ${response.status}`)
  }
  const result = await response.json()
  if (result.code !== 1) {
    throw new Error(result.msg || 'Z-Pay 创建订单失败')
  }
  return { qrcode: result.qrcode }
}

/**
 * 查询订单状态
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<{
 *   tradeStatus: string,    // 交易状态码（数字字符串: '0'=WAIT_BUYER_PAY, '1'=TRADE_SUCCESS 等）
 *   tradeNo: string|null,   // Z-Pay 平台订单号
 *   money: string,          // 订单金额
 *   name: string,           // 商品名
 *   type: string,           // 支付类型 (wxpay2/alipay)
 *   addtime: string|null,   // 订单创建时间 (YYYY-MM-DD HH:mm:ss)
 *   endtime: string|null,   // 订单完成/支付时间 (YYYY-MM-DD HH:mm:ss)
 *   buyer: string|null      // 买家信息（支付方）
 * }>}
 */
export async function queryOrder(outTradeNo) {
  const params = {
    act: 'order',
    pid: ZPAY_PID,
    key: ZPAY_KEY,
    out_trade_no: outTradeNo
  }
  const url = `${ZPAY_API_URL}/api.php?${new URLSearchParams(params).toString()}`
  const response = await fetch(url, {
    // 同上：避免 Z-Pay hang 阻塞 API route
    signal: timeoutSignal(5000)
  })
  if (!response.ok) {
    throw new Error(`Z-Pay queryOrder HTTP ${response.status}`)
  }
  const result = await response.json()
  return {
    tradeStatus: result.trade_status,
    tradeNo: result.trade_no,
    money: result.money,
    name: result.name,
    type: result.type,
    addtime: result.addtime,
    endtime: result.endtime,
    buyer: result.buyer
  }
}