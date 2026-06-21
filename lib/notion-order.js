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

const fs = require('fs')
const path = require('path')
const { Client } = require('@notionhq/client')

// 死信文件路径：失败订单的兜底（gitignore，运行时生成）
const DEAD_LETTER_PATH = path.join(process.cwd(), 'lib', 'orders-failed.json')

/**
 * 指数退避重试 helper
 * - 默认 3 次重试（4 次总尝试），间隔 200ms / 400ms / 800ms
 * - 捕获所有错误统一重试（Notion 错误码识别复杂，简单重试风险低）
 * @param {Function} fn - 异步函数
 * @param {Object} [options]
 * @param {number} [options.retries=3] - 重试次数
 * @param {number} [options.baseMs=200] - 基础间隔（毫秒）
 * @returns {Promise<*>} 函数返回值
 */
async function withRetry(fn, { retries = 3, baseMs = 200 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        const delay = baseMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

/**
 * 写入死信文件：失败订单兜底（Vercel 临时文件系统重启会丢，仅 MVP）
 * @param {Object} entry
 */
function writeDeadLetter(entry) {
  try {
    let arr = []
    if (fs.existsSync(DEAD_LETTER_PATH)) {
      try {
        arr = JSON.parse(fs.readFileSync(DEAD_LETTER_PATH, 'utf8'))
      } catch (e) {
        // 文件损坏，重新开始
        arr = []
      }
    }
    arr.push(entry)
    fs.writeFileSync(DEAD_LETTER_PATH, JSON.stringify(arr, null, 2))
  } catch (e) {
    // 死信文件本身写失败（Vercel 只读 FS 等），仅警告不抛出
    console.warn('[notion-order] 死信文件写入失败', e.message)
  }
}

/**
 * 获取 Notion 客户端
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Object} Notion client instance
 */
function getNotionClient(client) {
  return client || new Client({ auth: process.env.NOTION_TOKEN })
}

/**
 * 写入订单到 Notion（带重试 + 死信兜底）
 * @param {Object} orderData
 * @param {string} orderData.productName - 商品名称（写入"商品名称"字段）
 * @param {string} orderData.outTradeNo - 商户订单号
 * @param {string} orderData.email - 客户邮箱
 * @param {string} orderData.name - 客户姓名（写入"姓名"字段）
 * @param {number} orderData.amount - 金额（元）
 * @param {string} orderData.discountCode - 优惠码（直接存入"优惠码"字段，不带前缀）
 * @param {string} [orderData.paidAt] - 付款时间（ISO 字符串），不传则用当前时间
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<string|null>} pageId，失败时返回 null（已写入死信）
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
    // 重试耗尽 → 写入死信文件，不抛错（notify.js 永远返回 success）
    const entry = {
      timestamp: new Date().toISOString(),
      outTradeNo,
      orderData,
      error: error.message,
      stack: error.stack
    }
    writeDeadLetter(entry)
    console.error('[notion-order] createOrderPage 失败（已写入死信）', {
      outTradeNo,
      error: error.message
    })
    return null
  }
}

module.exports = { createOrderPage, getNotionClient, withRetry, writeDeadLetter }