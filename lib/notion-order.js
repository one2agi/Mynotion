/**
 * Notion 订单写入
 * 数据库：NOTION_DATABASE_ID (6ab4f4cf-c8e2-825e-bde8-016c2d9be1c2)
 *
 * 实际数据库 schema（2026-06-21 验证）：
 *   客户名 (title) | 客户邮箱 (email) | 购买日期 (date) | 状态 (status)
 *   订单号 (rich_text) | Token (rich_text) | 商品名 (rich_text) | 金额 (number)
 *   备注 (rich_text) | 交付时间 (date) | 源链接 (url) | 发送唯一链接 (formula)
 *   交付产品369 (button)
 */

const { Client } = require('@notionhq/client')

/**
 * 获取 Notion 客户端
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Object} Notion client instance
 */
function getNotionClient(client) {
  return client || new Client({ auth: process.env.NOTION_TOKEN })
}

/**
 * 写入订单到 Notion
 * @param {Object} orderData
 * @param {string} orderData.productName - 商品名称（写入"商品名"字段）
 * @param {string} orderData.outTradeNo - 商户订单号
 * @param {string} orderData.email - 客户邮箱
 * @param {string} orderData.name - 客户姓名（写入"客户名" title）
 * @param {number} orderData.amount - 金额（元）
 * @param {string} orderData.discountCode - 优惠码（可为空，DB 无此字段会写入"备注"）
 * @param {string} orderData.tradeNo - Z-Pay 平台订单号（写入"Token"字段）
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<string>} pageId
 */
async function createOrderPage(orderData, client) {
  const { productName, outTradeNo, email, name, amount, discountCode, tradeNo } = orderData
  const notion = getNotionClient(client)

  // 幂等性检查：先查询订单号是否已存在
  const existing = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: '订单号',
      rich_text: { equals: outTradeNo }
    }
  })

  if (existing.results.length > 0) {
    return existing.results[0].id
  }

  // 创建新订单
  const page = await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      // 客户名：title 字段，优先用 name（用户填的姓名），fallback 到 productName
      '客户名': {
        title: [{ text: { content: name || productName || '' } }]
      },
      '订单号': {
        rich_text: [{ text: { content: outTradeNo } }]
      },
      '客户邮箱': { email },
      '商品名': {
        rich_text: [{ text: { content: productName || '' } }]
      },
      '金额': { number: amount },
      '状态': { status: { name: '待发送' } },
      '购买日期': { date: { start: new Date().toISOString() } },
      // Token 字段：存放 Z-Pay 平台订单号
      'Token': {
        rich_text: [{ text: { content: tradeNo || '' } }]
      },
      // 备注：保存优惠码（如果有）
      '备注': {
        rich_text: [{ text: { content: discountCode ? `优惠码: ${discountCode}` : '' } }]
      }
    }
  })

  return page.id
}

module.exports = { createOrderPage, getNotionClient }