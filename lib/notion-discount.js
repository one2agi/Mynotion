/**
 * Notion 优惠码查询
 * 数据库：NOTION_DISCOUNT_DATABASE_ID
 */

const { Client } = require('@notionhq/client')
const { withRetry } = require('@/lib/with-retry')

/**
 * 获取 Notion 客户端（与 lib/notion-order.js 保持一致：
 * 接受可选 client 用于测试，无模块级单例）。
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Object} Notion client instance
 */
function getNotionClient(client) {
  return client || new Client({ auth: process.env.NOTION_TOKEN })
}

/**
 * 查询优惠码
 * - Notion query 用 withRetry 包装，捕获瞬时 5xx/429/network 错误
 * - 失败重试 3 次（200/400/800ms），总耗时 < 2s
 * - 重试耗尽抛错给调用方（API route catch → 返回 500）
 * @param {string} code - 优惠码
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<{ amount: number, name: string } | null>}
 */
async function lookupDiscountCode(code, client) {
  if (!code || code.trim() === '') {
    return null
  }

  const notion = getNotionClient(client)
  const response = await withRetry(() =>
    notion.databases.query({
      database_id: process.env.NOTION_DISCOUNT_DATABASE_ID,
      filter: {
        and: [
          { property: '优惠码', rich_text: { equals: code } },
          { property: '状态', status: { equals: 'active' } }
        ]
      }
    })
  )

  if (response.results.length === 0) {
    return null
  }

  const page = response.results[0]
  const amount = page.properties['优惠金额']?.number || 0
  const name = page.properties['Name']?.title?.[0]?.plain_text || code

  return { amount, name }
}

module.exports = { lookupDiscountCode, getNotionClient }