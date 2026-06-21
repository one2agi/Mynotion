/**
 * Notion 订单写入
 * 数据库：NOTION_DATABASE_ID (4044f4cfc8e28236a41e818304648b77)
 *
 * 实际数据库 schema（2026-06-21 验证）：
 *   创建时间 (title, ISO 字符串)  | 电子邮箱 (email)
 *   订单号 (rich_text)             | 姓名 (rich_text)
 *   商品名称 (rich_text)           | 价格(元) (number)
 *   优惠码 (rich_text, 独立)       | 付款时间 (date)
 *   状态 (status: 待付款/待发送/已发送/已取消)
 *   备注 (rich_text)               | 交付时间 (date)
 *   源链接 (url)                   | 发送唯一链接 (formula)
 *   Token (rich_text, 不写)        | 交付产品369 (button)
 *
 * 注：Token、源链接、备注、交付时间 由用户/运营手动填，本函数不写。
 */

const { Client } = require('@notionhq/client')
const { withRetry } = require('@/lib/with-retry')
const { notifyDeadLetter } = require('@/lib/dead-letter')

/**
 * 获取 Notion 客户端
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Object} Notion client instance
 */
function getNotionClient(client) {
  return client || new Client({ auth: process.env.NOTION_TOKEN })
}

/**
 * 写入订单到 Notion（带重试 + 死信 webhook 兜底）
 *
 * ⚠️  API 契约：此函数 MUST NOT throw
 * --------------------------------------------------
 * 调用方（pages/api/pay/notify.js）依赖此契约来区分：
 *   - 成功：pageId 字符串
 *   - 失败：null（已推送死信 webhook，运营可在外部系统补单）
 *   - 抛错：未预期的 code bug（notify catch 会返回 'error' 让 Z-Pay 重试，
 *           重试耗尽 → 订单永久丢失）
 *
 * 任何错误路径都必须被本函数内部 catch：
 *   - Notion API 5xx/429/timeout → withRetry 重试 3 次后推送死信 webhook
 *   - 死信 webhook 自身失败 → notifyDeadLetter 内部已重试 2 次并 swallow，
 *     此函数仍返回 null（不会让 createOrderPage 抛错）
 *
 * 如果未来重构导致此函数抛错，必须同步更新 notify.js 的 catch 行为
 * （或加一层"重试 3 次后放弃"语义），否则会引入静默数据丢失。
 * --------------------------------------------------
 *
 * @param {Object} orderData
 * @param {string} orderData.productName - 商品名称（写入"商品名称"字段）
 * @param {string} orderData.outTradeNo - 商户订单号
 * @param {string} orderData.email - 客户邮箱
 * @param {string} orderData.name - 客户姓名（写入"姓名"字段）
 * @param {number} orderData.amount - 金额（元）
 * @param {string} orderData.discountCode - 优惠码（直接存入"优惠码"字段，不带前缀）
 * @param {string} [orderData.paidAt] - 付款时间（ISO 字符串），不传则用当前时间
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<string|null>} pageId，失败时返回 null（已推送死信 webhook）
 * @throws 永不抛错（API 契约：见上方 ⚠️ 说明）
 */
async function createOrderPage(orderData, client) {
  const { productName, outTradeNo, email, name, amount, discountCode, paidAt } = orderData
  const notion = getNotionClient(client)

  try {
    // 幂等性检查：先查询订单号是否已存在（带重试）
    const existing = await withRetry(() =>
      notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
        filter: {
          property: '订单号',
          rich_text: { equals: outTradeNo }
        }
      })
    )

    if (existing.results.length > 0) {
      return existing.results[0].id
    }

    const paidAtISO = paidAt || new Date().toISOString()

    // 创建新订单（带重试）
    const page = await withRetry(() =>
      notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          // title 字段：创建时间（ISO 字符串）
          '创建时间': {
            title: [{ text: { content: paidAtISO } }]
          },
          '订单号': {
            rich_text: [{ text: { content: outTradeNo } }]
          },
          '电子邮箱': { email },
          '姓名': {
            rich_text: [{ text: { content: name || '' } }]
          },
          '商品名称': {
            rich_text: [{ text: { content: productName || '' } }]
          },
          '价格(元)': { number: amount },
          // 优惠码独立字段（不带前缀）
          '优惠码': {
            rich_text: [{ text: { content: discountCode || '' } }]
          },
          // 付款时间
          '付款时间': {
            date: { start: paidAtISO }
          },
          // 状态：已付款待发邮件
          '状态': { status: { name: '待发送' } }
        }
      })
    )

    return page.id
  } catch (error) {
    // 重试耗尽 → 推送死信 webhook，不抛错（notify.js 永远返回 success）
    const entry = {
      timestamp: new Date().toISOString(),
      outTradeNo,
      orderData,
      error: error.message,
      stack: error.stack
    }
    notifyDeadLetter(entry)
    console.error('[notion-order] createOrderPage 失败（已推送死信 webhook）', {
      outTradeNo,
      error: error.message
    })
    return null
  }
}

module.exports = { createOrderPage, getNotionClient }