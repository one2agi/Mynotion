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
 * @returns {Promise<{ amount: number, name: string, isOneTime: boolean,
 *   code: string, pageId: string, used: boolean } | null>}
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
          { property: '状态', status: { equals: '启用' } }
        ]
      }
    })
  )

  if (response.results.length === 0) {
    return null
  }

  const page = response.results[0]
  const props = page.properties
  const amount = props['优惠金额']?.number || 0
  const name = props['Name']?.title?.[0]?.plain_text || code

  // 一次性码判别（2026-07-18 新增）
  // 永久码完全无视 '已使用(一次性)' 字段 — 即使被运营手抖勾上也无效
  const isOneTime = props['一次/永久']?.select?.name === '一次性'
  const used = isOneTime ? props['已使用(一次性)']?.checkbox === true : false
  const pageId = page.id

  return { amount, name, isOneTime, code, pageId, used }
}

/**
 * 标记一次性码已使用（2026-07-18 新增）
 * - 把 Notion 行的"已使用(一次性)"checkbox 置为 true
 * - 失败重试 3 次（与 lookupDiscountCode 一致）
 * - 抛错给调用方（notify.js 用 try/catch 吞掉以避免 Z-Pay 重试风暴）
 * @param {string} pageId - Notion page ID
 * @param {Object} [client] - 仅用于测试，注入 mock client
 */
async function markDiscountCodeUsed(pageId, client) {
  const notion = getNotionClient(client)
  // 修复（2026-07-18）：必须用对象形式 { page_id, properties }
  // 调用 positional `pages.update(pageId, properties)` 会让 SDK 把 string 当 config 对象，
  // 内部 page_id 字段解析为 undefined → Notion API 报 "page_id should be a valid uuid"。
  // 参照现有 markTokenAsUsed (lib/notion-token.js:91-102) 的工作写法。
  await withRetry(() =>
    notion.pages.update({
      page_id: pageId,
      properties: {
        '已使用(一次性)': { checkbox: true }
      }
    })
  )
}

module.exports = { lookupDiscountCode, markDiscountCodeUsed, getNotionClient }