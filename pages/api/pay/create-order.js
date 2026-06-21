/**
 * POST /api/pay/create-order
 * 验证优惠码 → 创建订单 → 返回微信支付二维码链接
 */
import { createNativeOrder } from '@/lib/zpay'
import { lookupDiscountCode } from '@/lib/notion-discount'
import { siteConfig } from '@/lib/config'
import { Validator } from '@/lib/utils/validation'
import starterConfig from '@/themes/starter/config'

// 商品配置映射：productId → pricingIndex
// PayModal 提交时携带 productId；本表集中维护"哪个 productId 走哪个 STARTER_PRICING_N_* 配置"。
const PRODUCT_MAP = {
  'starter-basic': 1,
  'starter-pro': 2,
  'starter-premium': 3
}

/**
 * 获取商品配置
 * 注：服务端 API Route 无法访问 React Context 的 THEME_CONFIG，
 * 必须显式传入 starterConfig 作为 siteConfig 的 extendConfig 参数。
 * @param {number} index - 商品索引
 * @returns {{ name: string, price: number }}
 */
function getProductConfig(index) {
  return {
    name: siteConfig(`STARTER_PRICING_${index}_TITLE`, null, starterConfig),
    price: parseFloat(siteConfig(`STARTER_PRICING_${index}_PRICE`, '0', starterConfig))
  }
}

/**
 * 生成商户订单号
 * @returns {string}
 */
function generateOutTradeNo() {
  return `NN${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`
}

/**
 * API Handler - 创建支付订单
 * @param {Object} req - Next.js request
 * @param {Object} res - Next.js response
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  // CSRF 防护：Origin/Referer 白名单
  // 防止第三方网站诱导用户在本服务下真实订单（消耗 Z-Pay 配额 + 触发风控）
  // 缺失 Origin/Referer 一律拒绝（curl 不会带、跨域 POST 会被浏览器带不同 origin）
  const allowedOrigin = process.env.NEXT_PUBLIC_SITE_URL
  if (allowedOrigin) {
    const headers = req.headers || {}
    const requestOrigin = headers.origin || headers.referer
    if (!requestOrigin || new URL(requestOrigin).origin !== allowedOrigin) {
      console.warn('[create-order] CSRF 拦截：Origin 不匹配', {
        requestOrigin,
        allowedOrigin
      })
      return res.status(403).json({
        success: false,
        error: 'Forbidden',
        code: 'CSRF_FORBIDDEN'
      })
    }
  }

  try {
    const { name, email, discountCode, productId } = req.body

    // 验证必填字段
    if (!name || name.trim().length === 0 || name.length > 50) {
      return res.status(400).json({ success: false, error: '姓名必填，最多50字符', code: 'INVALID_INPUT' })
    }
    if (!Validator.isValidEmail(email)) {
      return res.status(400).json({ success: false, error: '请提供有效邮箱', code: 'INVALID_INPUT' })
    }
    if (!productId || !PRODUCT_MAP[productId]) {
      return res.status(400).json({ success: false, error: '商品不存在', code: 'INVALID_PRODUCT' })
    }

    // 获取商品配置
    const productIndex = PRODUCT_MAP[productId]
    const { name: productName, price: originalAmount } = getProductConfig(productIndex)

    let discountAmount = 0

    // 验证优惠码（如有）
    if (discountCode && discountCode.trim() !== '') {
      const discount = await lookupDiscountCode(discountCode.trim())
      if (!discount) {
        return res.status(400).json({ success: false, error: '优惠码不存在或已过期', code: 'INVALID_DISCOUNT' })
      }
      discountAmount = discount.amount
    }

    // 计算实付金额（保留 2 位小数，避免浮点精度问题）
    const rawAmount = originalAmount - discountAmount
    const amount = Math.round(rawAmount * 100) / 100

    // 拒绝零或负数金额（防止 discount >= original 导致 0 元 / 负数订单）
    // 之前用 Math.max(0, ...) 静默 clip 到 0，攻击者配优惠码 amount >= 商品原价
    // 就能 0 元购买。现在显式拒绝。
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        error: '优惠码抵扣金额不能大于或等于商品原价',
        code: 'INVALID_DISCOUNT_AMOUNT'
      })
    }

    // 生成订单号
    const outTradeNo = generateOutTradeNo()

    // 回调地址
    const notifyUrl = siteConfig('STARTER_PAYMENT_NOTIFY_URL', process.env.ZPAY_NOTIFY_URL, starterConfig)

    // 附加参数（回调时返回，用于写入 Notion）
    const param = JSON.stringify({ email, name, discountCode: discountCode || '' })

    // 调用 Z-Pay 创建订单
    const { qrcode } = await createNativeOrder({
      outTradeNo,
      name: productName,
      money: amount,
      notifyUrl,
      param
    })

    return res.status(200).json({
      success: true,
      data: {
        outTradeNo,
        qrcode,
        amount,
        originalAmount,
        discountAmount,
        productName
      }
    })
  } catch (error) {
    console.error('创建订单失败:', error)
    return res.status(500).json({ success: false, error: '订单创建失败', code: 'INTERNAL_ERROR' })
  }
}
