/**
 * POST /api/pay/create-order
 * 验证优惠码 → 创建订单 → 返回微信支付二维码链接
 */
import { createNativeOrder } from '@/lib/zpay'
import { lookupDiscountCode } from '@/lib/notion-discount'
import { siteConfig } from '@/lib/config'
import starterConfig from '@/themes/starter/config'

// 商品配置映射
// pricingIndex 1 → starter-basic → STARTER_PRICING_1 (入门版)
// pricingIndex 2 → starter-pro → STARTER_PRICING_2 (基础版)
// pricingIndex 3 → starter-premium → STARTER_PRICING_3 (高级版)
// PayModal 通过 pricingIndex 1|2|3 生成 productId 'basic'|'pro'|'premium'
const PRODUCT_MAP = {
  'starter-basic': { index: 1 },
  'starter-pro': { index: 2 },
  'starter-premium': { index: 3 }
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

  try {
    const { name, email, discountCode, productId } = req.body

    // 验证必填字段
    if (!name || name.trim().length === 0 || name.length > 50) {
      return res.status(400).json({ success: false, error: '姓名必填，最多50字符', code: 'INVALID_INPUT' })
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: '请提供有效邮箱', code: 'INVALID_INPUT' })
    }
    if (!productId || !PRODUCT_MAP[productId]) {
      return res.status(400).json({ success: false, error: '商品不存在', code: 'INVALID_PRODUCT' })
    }

    // 获取商品配置
    const productIndex = PRODUCT_MAP[productId].index
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
    const amount = Math.round(Math.max(0, originalAmount - discountAmount) * 100) / 100

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
