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
        paidAt: status === 'paid' ? new Date().toISOString() : undefined
      }
    })
  } catch (error) {
    console.error('查询订单失败:', error)
    return res.status(500).json({ success: false, error: '查询失败' })
  }
}
