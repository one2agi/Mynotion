/**
 * GET /api/pay/query-order
 * 查询订单支付状态
 */
import { queryOrder as queryZpayOrder, mapTradeStatus, paidAtToISO } from '@/lib/zpay'

export default async function handler(req, res) {
  // 状态查询接口禁止任何层缓存：避免 CDN/浏览器把 pending 状态缓存数十秒，
  // 导致用户付款后前端仍看到"待支付"，必须强制每次回源
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { outTradeNo } = req.query

  if (!outTradeNo) {
    return res.status(400).json({ success: false, error: '缺少订单号参数' })
  }

  try {
    const result = await queryZpayOrder(outTradeNo)
    const status = mapTradeStatus(result.tradeStatus)

    return res.status(200).json({
      success: true,
      data: {
        outTradeNo,
        status,
        // 使用 Z-Pay 返回的真实支付完成时间（endtime），
        // 而不是查询时间（之前的 bug）。ISO 转换由 lib/zpay.js 集中处理。
        paidAt: status === 'paid' ? paidAtToISO(result.endtime) : null
      }
    })
  } catch (error) {
    console.error('查询订单失败:', error)
    return res.status(500).json({ success: false, error: '查询失败' })
  }
}