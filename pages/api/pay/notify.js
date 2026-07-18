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
 *   1. verifySign 失败：已在 try 内显式处理（return 'error'）
 *   2. 金额二次校验失败：已在 try 内显式处理（return 'error'）
 *   3. queryZpayOrder 失败：Z-Pay API hang/5xx
 *   4. JSON.parse 失败：已 inner try/catch 静默
 *   5. 任何 code bug：应该修复而不是吞
 *
 * catch 行为：返回 'error' 给 Z-Pay，触发重试（Z-Pay 重试有上限）。
 * ⚠️ 如果 createOrderPage 未来重构开始抛错，此 catch 会让 Z-Pay
 * 重复通知 + 重复消耗 Notion API 配额，且最终订单永久丢失（Z-Pay
 * 重试耗尽）。重构 createOrderPage 时必须同步 review 本文件。
 * --------------------------------------------------
 */
import { verifySign, queryOrder as queryZpayOrder, mapTradeStatus } from '@/lib/zpay'
import { createOrderPage, incrementRetryCount } from '@/lib/notion-order'
import { lookupUnusedToken, markTokenAsUsed } from '@/lib/notion-token'
import { notifyDeadLetter } from '@/lib/dead-letter'
import { lookupDiscountCode, markDiscountCodeUsed } from '@/lib/notion-discount'
import { Client } from '@notionhq/client'

/**
 * Token 查询失败时累计重试次数的阈值
 * 达到此值时推死信 webhook 给运营（避免 Z-Pay 永久重试时订单永远卡在"无链接"状态）
 * 来源：2026-06-24 NN1782277180228PZI1KW 缺链接事故
 */
const TOKEN_RETRY_THRESHOLD = 5

/**
 * 在订单上标记"webhook 已推送"，防止 Z-Pay 后续重试时重复推送
 * 设计：如果 mark 失败，下次重试还会推一次（webhook 端应该幂等 / 去重）
 *
 * @param {string} pageId - 订单的 Notion page ID
 * @param {string} outTradeNo - 商户订单号（用于日志）
 */
async function markWebhookPushed(pageId, outTradeNo) {
  if (!pageId) return
  const notion = new Client({ auth: process.env.NOTION_TOKEN })
  try {
    await notion.pages.update({
      page_id: pageId,
      properties: { 'webhook_pushed': { checkbox: true } }
    })
  } catch (e) {
    console.error('[notify] 标记 webhook_pushed 失败', { outTradeNo, error: e.message })
  }
}

export default async function handler(req, res) {
  // Z-Pay 实际用 GET 调 notify（所有参数在 query string），不是 POST
  // 兼容 POST 以防其他支付服务或前端测试用
  // 来源：2026-06-21 EdgeOne 日志显示 Z-Pay callback 是 GET → notify.js 永远 405
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).end()
  }

  try {
    // GET: 参数在 req.query（Next.js 自动 URL-decode）
    // POST: Pages Router 自动解析 application/x-www-form-urlencoded 到 req.body
    const params = req.method === 'GET' ? req.query : req.body

    // 验签
    if (!verifySign(params)) {
      console.error('回调验签失败:', params.out_trade_no)
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }

    const outTradeNo = params.out_trade_no

    // 查询 Z-Pay 确认订单状态（防伪造）
    const zpayResult = await queryZpayOrder(outTradeNo)
    if (mapTradeStatus(zpayResult.tradeStatus) !== 'paid') {
      // 非成功订单也返回 success，避免 Z-Pay 重复通知
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('success')
    }

    // 金额二次校验：以服务端二次查询的 money 为权威值
    // 通知 params.money 可能被通道污染 / 系统 bug / 极端配错
    // 不一致则返回 error 让 Z-Pay 重试，防止错误金额落库
    if (parseFloat(zpayResult.money) !== parseFloat(params.money)) {
      console.error('[notify] 金额不一致', {
        outTradeNo,
        zpayMoney: zpayResult.money,
        notifyMoney: params.money
      })
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }
    const paidAmount = parseFloat(zpayResult.money)

    // 解析附加参数（含 #31 健壮性：拒绝静默吞错）
    // 契约：param 必须是非空 JSON 对象且含 email/name，否则视为订单数据不完整，
    // 返回 'error' 让 Z-Pay 重试。绝不允许空邮箱/空姓名落库。
    let extra
    try {
      extra = JSON.parse(params.param || '{}')
    } catch (e) {
      console.error('[notify] param JSON 解析失败', {
        outTradeNo: params.out_trade_no,
        paramLength: typeof params.param === 'string' ? params.param.length : 0,
        parseError: e.message
        // ⚠️ 不记 params.param 内容（可能含 PII）
      })
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }

    // 边界：JSON.parse('null') → null，JSON.parse('"hi"') → string，
    // JSON.parse('[]') → array。这些都不是合法的"附加参数对象"。
    if (typeof extra !== 'object' || extra === null || Array.isArray(extra)) {
      console.error('[notify] param 不是合法对象', {
        outTradeNo: params.out_trade_no,
        actualType: extra === null ? 'null' : typeof extra
      })
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }

    // 边界：合法 JSON 对象但 email/name 缺失（正常不会发生，
    // 但防攻击者伪造回调或 create-order 未来重构改了 param 结构）
    if (!extra.email || !extra.name) {
      console.error('[notify] param 对象缺 email/name', {
        outTradeNo: params.out_trade_no,
        keys: Object.keys(extra)
      })
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send('error')
    }

    // 从 Token 数据库取出一个未使用的 token
    const tokenInfo = await lookupUnusedToken()
    const deliveryLinkBase = process.env.STARTER_DELIVERY_LINK_BASE || 'https://faiz-world.notion.site/OS-8124f4cfc8e282e1b10381cfeadbdb86?duplicate=true&token='
    const productLink = tokenInfo ? deliveryLinkBase + tokenInfo.token : ''

    // 订单创建时间（同时传给 createOrderPage 和 retry webhook，运营在 QQ 通知里能直接看到下单时间）
    // 格式：Beijing 时间 'YYYY-MM-DD HH:mm:ss'（无时区）— 2026-06-24 用户需求
    // 之前：new Date().toISOString() 输出 ISO 8601 UTC，肉眼看不出 Beijing 时间
    const now = new Date()
    const paidAtISO = new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')

    // 写入 Notion
    const pageId = await createOrderPage({
      productName: params.name,
      outTradeNo,
      tradeNo: params.trade_no,
      email: extra.email || '',
      name: extra.name || '',
      discountCode: extra.discountCode || '',
      amount: paidAmount, // 来自服务端二次查询的权威金额（zpayResult.money）
      status: 'paid',
      paidAt: paidAtISO,
      productLink
    })

    // 订单写入成功后，将 Token 标为已使用（失败不影响业务，只多消耗一个 token）
    if (pageId && tokenInfo) {
      await markTokenAsUsed(tokenInfo.pageId)
    }

    // === 严格模式（2026-06-24）：任何 token 失败都视为可重试错误 ===
    // 来源：NN1782277180228PZI1KW 缺链接事故
    // 行为：返 'error' 让 Z-Pay 重试；累计 5 次失败后推死信 webhook（仅推一次，防重复）
    if (!tokenInfo) {
      const { newCount, webhookPushed } = await incrementRetryCount(pageId, outTradeNo)
      console.warn('[notify] Token 查询失败', { outTradeNo, newCount, webhookPushed })
      if (newCount >= TOKEN_RETRY_THRESHOLD && !webhookPushed) {
        // 推死信 webhook（用 lib/dead-letter 的相同模板，含 QQ ID）
        await notifyDeadLetter({
          timestamp: new Date().toISOString(),
          outTradeNo,
          orderData: {
            email: extra.email || '',
            name: extra.name || '',
            productName: params.name,
            amount: paidAmount,
            paidAt: paidAtISO  // 运营需要知道订单下单时间（2026-06-24 需求）
          },
          error: `Token 查询失败 ${newCount} 次，请检查 Notion Token DB`,
          stack: ''
        })
        // 标记 webhook_pushed=true，防止 Z-Pay 后续重试时重复推送
        // 来源：2026-06-24 production log 显示 count=5、6 都触发了 webhook
        await markWebhookPushed(pageId, outTradeNo)
      }
      // === "放弃治疗" 模式（2026-06-25）===
      // 达到阈值后返 'success' 让 Z-Pay 停止重试（避免无限循环）
      // 1-4 次：返 'error' 让 Z-Pay 重试
      // 第 5 次：推 webhook + 返 'success'（承认"放弃"）
      // 原因：Z-Pay 只重试 3-5 次，如果一直返 'error' 会"鬼打墙"
      const giveUp = newCount >= TOKEN_RETRY_THRESHOLD
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      return res.status(200).send(giveUp ? 'success' : 'error')
    }

    // === 一次性码：paid 时 mark used（2026-07-18）===
    // 位置：所有 token retry 决策完成后，确保只在"订单成功写入"路径上执行
    // 永久码路径（extra.discountCode 为永久码）：lookup 返回 isOneTime=false → 不进内层 if
    // 抛错：吞掉不让 notify 返非 200（避免 Z-Pay 重试副作用）
    if (pageId && extra.discountCode) {
      try {
        const fresh = await lookupDiscountCode(extra.discountCode)
        // DEBUG(2026-07-18): 把 fresh 整个对象序列化 + pageId 单独抓
        console.log('[notify-debug] lookupDiscountCode return FULL', {
          outTradeNo,
          discountCode: extra.discountCode,
          freshFullJson: JSON.stringify(fresh),
          freshJsonKeys: fresh ? Object.keys(fresh) : 'null',
          freshPageIdValue: fresh?.pageId,
          freshPageIdJS: typeof fresh?.pageId === 'undefined' ? 'undefined' : String(fresh.pageId)
        })
        if (fresh && fresh.isOneTime && !fresh.used) {
          await markDiscountCodeUsed(fresh.pageId)
        }
      } catch (e) {
        console.error('[notify] mark discount used failed', {
          outTradeNo,
          err: e?.message
        })
      }
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    return res.status(200).send('success')
  } catch (error) {
    // 增强日志：包含订单上下文，便于运营定位失败原因
    // ⚠️ param 来自客户端，含 PII (email/name/discountCode)。
    // 落到 EdgeOne 函数日志长期保留 = 永久 PII 存储。必须脱敏。
    // paramLength 单独记录，让运营能发现异常长 param 但看不到内容。
    const paramStr = req?.body?.param
    const paramLength = typeof paramStr === 'string' ? paramStr.length : 0
    const paramLog = typeof paramStr === 'string' && paramStr.length > 200
      ? '[REDACTED:long]'
      : '[REDACTED]'
    console.error('[notify] 回调处理异常', {
      outTradeNo: req?.body?.out_trade_no,
      tradeNo: req?.body?.trade_no,
      amount: req?.body?.money,
      param: paramLog,
      paramLength,
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
