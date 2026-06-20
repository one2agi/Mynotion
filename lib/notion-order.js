/**
 * Notion 订单写入
 * 数据库：NOTION_DATABASE_ID (6ab4f4cf-c8e2-825e-bde8-016c2d9be1c2)
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
 * @param {string} orderData.productName - 商品名称
 * @param {string} orderData.outTradeNo - 商户订单号
 * @param {string} orderData.email - 客户邮箱
 * @param {string} orderData.name - 客户姓名
 * @param {number} orderData.amount - 金额（元）
 * @param {string} orderData.discountCode - 优惠码（可为空）
 * @param {string} orderData.tradeNo - Z-Pay 平台订单号
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
      'Name': {
        title: [{ text: { content: productName } }]
      },
      '订单号': {
        rich_text: [{ text: { content: outTradeNo } }]
      },
      '客户邮箱': { email },
      '姓名': {
        rich_text: [{ text: { content: name || '' } }]
      },
      '金额': { number: amount },
      '优惠码': {
        rich_text: [{ text: { content: discountCode || '' } }]
      },
      '状态': { status: { name: 'paid' } },
      '购买日期': { date: { start: new Date().toISOString() } },
      'Z-Pay Trade No': {
        rich_text: [{ text: { content: tradeNo || '' } }]
      }
    }
  })

  return page.id
}

module.exports = { createOrderPage, getNotionClient }