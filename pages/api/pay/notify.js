/**
 * POST /api/pay/notify
 * Z-Pay 异步回调通知
 *
 * 注意：Pages Router 对 application/x-www-form-urlencoded 自动解析 req.body
 * 无需设置 bodyParser: false 或使用 req.formData()
 */
import { verifySign, queryOrder as queryZpayOrder } from '@/lib/zpay'
import { createOrderPage } from '@/lib/notion-order'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  try {
    // Pages Router 自动解析 application/x-www-form-urlencoded 到 req.body
    const params = req.body

    // 验签
    if (!verifySign(params)) {
      console.error('回调验签失败:', params.out_trade_no)
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }

    const outTradeNo = params.out_trade_no

    // 查询 Z-Pay 确认订单状态（防伪造）
    const zpayResult = await queryZpayOrder(outTradeNo)
    if (zpayResult.tradeStatus !== 'TRADE_SUCCESS') {
      // 非成功订单也返回 success，避免 Z-Pay 重复通知
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('success')
    }

    // 解析附加参数
    let extra = { email: '', name: '', discountCode: '' }
    try {
      extra = JSON.parse(params.param || '{}')
    } catch (e) {
      // ignore parse error
    }

    // 写入 Notion
    await createOrderPage({
      productName: params.name,
      outTradeNo,
      tradeNo: params.trade_no,
      email: extra.email || '',
      name: extra.name || '',
      discountCode: extra.discountCode || '',
      amount: parseFloat(params.money),
      status: 'paid',
      paidAt: new Date().toISOString()
    })

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(200).send('success')
  } catch (error) {
    console.error('回调处理异常:', error)
    // 注意：回调处理失败也返回 success，避免 Z-Pay 无限重试
    // 实际可通过日志告警处理
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(200).send('success')
  }
}
