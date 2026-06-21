/**
 * POST /api/pay/notify
 * Z-Pay 异步回调通知
 *
 * 注意：Pages Router 对 application/x-www-form-urlencoded 自动解析 req.body
 * 无需设置 bodyParser: false 或使用 req.formData()
 *
 * 依赖契约（lib/notion-order.js createOrderPage）：
 * --------------------------------------------------
 * createOrderPage 承诺 MUST NOT throw，失败时返回 null。
 * 因此本 handler catch 块捕获的**只会是以下错误**：
 *   1. verifySign 失败：已在 try 内显式处理（line 21-25）
 *   2. queryZpayOrder 失败：Z-Pay API hang/5xx
 *   3. JSON.parse 失败：已 inner try/catch 静默（line 39-43）
 *   4. 任何 code bug：应该修复而不是吞
 *
 * catch 行为：返回 'error' 给 Z-Pay，触发重试（Z-Pay 重试有上限）。
 * ⚠️ 如果 createOrderPage 未来重构开始抛错，此 catch 会让 Z-Pay
 * 重复通知 + 重复消耗 Notion API 配额，且最终订单永久丢失（Z-Pay
 * 重试耗尽）。重构 createOrderPage 时必须同步 review 本文件。
 * --------------------------------------------------
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
    // 增强日志：包含订单上下文，便于运营定位失败原因
    console.error('[notify] 回调处理异常', {
      outTradeNo: req?.body?.out_trade_no,
      tradeNo: req?.body?.trade_no,
      amount: req?.body?.money,
      param: req?.body?.param,
      error: error.message,
      stack: error.stack
    })
    // 非 Notion 错误（Z-Pay 查询失败、JSON 解析、code bug）：
    // 返回 error 让 Z-Pay 重试（Z-Pay 重试有上限，不会无限循环）
    // Notion 写入失败由 createOrderPage 内部捕获并写死信，此处不会出现
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(200).send('error')
  }
}
