/**
 * GET /api/pay/query-order
 * 查询订单支付状态
 */
import { queryOrder as queryZpayOrder } from '@/lib/zpay'

const STATUS_MAP = {
  'WAIT_BUYER_PAY': 'pending',
  'TRADE_SUCCESS': 'paid',
  'TRADE_CLOSED': 'closed'
}

/**
 * Z-Pay endtime ("YYYY-MM-DD HH:mm:ss") → ISO 8601 字符串
 * @param {string|null} endtime
 * @returns {string|null}
 */
function endtimeToISO(endtime) {
  if (!endtime) return null
  // Z-Pay 格式："2026-06-21 08:06:06" → "2026-06-21T08:06:06.000Z"
  // 假设是 UTC（Z-Pay 服务器时间）
  return `${endtime.replace(' ', 'T')}.000Z`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { outTradeNo } = req.query

  if (!outTradeNo) {
    return res.status(400).json({ success: false, error: '缺少订单号参数' })
  }

  try {
    const result = await queryZpayOrder(outTradeNo)
    const status = STATUS_MAP[result.tradeStatus] || 'unknown'

    return res.status(200).json({
      success: true,
      data: {
        outTradeNo,
        status,
        // 使用 Z-Pay 返回的真实支付完成时间（endtime），
        // 而不是查询时间（之前的 bug）
        paidAt: status === 'paid' ? endtimeToISO(result.endtime) : null
      }
    })
  } catch (error) {
    console.error('查询订单失败:', error)
    return res.status(500).json({ success: false, error: '查询失败' })
  }
}
