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
 * @returns {{ signal: AbortSignal, cancel: () => void }} signal + cancel 函数
 *   调用方必须在请求返回（成功或失败）后调用 cancel()，否则 setTimeout 会泄漏
 *   到超时时间点才回收。
 */
function timeoutSignal(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer)
  }
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

  const timeout = timeoutSignal(5000)
  let response
  try {
    response = await fetch(`${ZPAY_API_URL}/mapi.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      // 防止 Z-Pay 服务端 hang 时整个 API route 阻塞至 Vercel 10s 强杀
      signal: timeout.signal
    })
  } finally {
    timeout.cancel()
  }

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
  const timeout = timeoutSignal(5000)
  let response
  try {
    response = await fetch(url, {
      // 同上：避免 Z-Pay hang 阻塞 API route
      signal: timeout.signal
    })
  } finally {
    timeout.cancel()
  }
  if (!response.ok) {
    throw new Error(`Z-Pay queryOrder HTTP ${response.status}`)
  }
  const result = await response.json()
  return {
    // Z-Pay 查询 API 返回 `status`（Int：0=未支付, 1=支付成功, 2=关闭）。
    // 历史 bug：曾读 result.trade_status（字符串字段名），但 Z-Pay 该接口
    // 不返回此字段，导致 tradeStatus 永远 undefined → notify.js 误判未支付
    // → 永远不写 Notion（2026-06-21 生产事故）。
    // notify POST 接口用 trade_status 字符串，与查询 API 字段名不同。
    // String() 防御性：万一 Z-Pay 改类型为字符串也不会炸。
    tradeStatus: String(result.status),
    tradeNo: result.trade_no,
    money: result.money,
    name: result.name,
    type: result.type,
    addtime: result.addtime,
    endtime: result.endtime,
    buyer: result.buyer
  }
}

/**
 * Z-Pay 交易状态 → 内部状态。
 * 单一来源：query-order.js 与 notify.js 都用此映射，避免重复硬编码。
 * 内部 const：仅 mapTradeStatus() 使用，不导出（避免外部代码绕过封装直接读表）
 */
// Z-Pay 查询 API 返回数字 status（字符串形式）：0=未支付, 1=支付成功, 2=关闭
// 键用字符串与 String(result.status) 对齐
const STATUS_MAP = {
  '0': 'pending',
  '1': 'paid',
  '2': 'closed'
}

/**
 * 把 Z-Pay tradeStatus 翻译成内部状态字符串。
 * 未知状态返回 'unknown'。
 * @param {string} tradeStatus
 * @returns {'pending'|'paid'|'closed'|'unknown'}
 */
export function mapTradeStatus(tradeStatus) {
  return STATUS_MAP[tradeStatus] || 'unknown'
}

/**
 * Z-Pay endtime ("YYYY-MM-DD HH:mm:ss") → ISO 8601 字符串。
 * 假设是 UTC（Z-Pay 服务器时间）。集中放在 lib/zpay.js，让 API 路由
 * 拿到的就是干净的 ISO，不再各自解析供应商时间格式。
 * @param {string|null} endtime
 * @returns {string|null}
 */
export function paidAtToISO(endtime) {
  if (!endtime) return null
  return `${endtime.replace(' ', 'T')}.000Z`
}