/**
 * Notion Token 查询与标记
 * 数据库：NOTION_TOKEN_DATABASE_ID
 *
 * 用途：订单支付成功后，从 Token 数据库取出一个未使用的 token，
 * 写入订单的"发送产品链接"，然后将该 Token 记录标为已使用。
 */

const { Client } = require('@notionhq/client')
const { withRetry } = require('@/lib/with-retry')

/**
 * 获取 Notion 客户端（与 lib/notion-order.js 保持一致）
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Object} Notion client instance
 */
function getNotionClient(client) {
  return client || new Client({ auth: process.env.NOTION_TOKEN })
}

/**
 * 查询一个未使用的 token
 *
 * ⚠️  API 契约：此函数 MUST NOT throw
 * --------------------------------------------------
 * 调用方（pages/api/pay/notify.js）依赖此契约来区分：
 *   - 成功：{ token: string, pageId: string }
 *   - 失败：null（Token 用完 / 网络错误 / API 限流）
 *
 * 任何错误路径都必须被本函数内部 catch，返回 null。
 * --------------------------------------------------
 *
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<{ token: string, pageId: string } | null>}
 */
async function lookupUnusedToken(client) {
  const notion = getNotionClient(client)

  try {
    const response = await withRetry(() =>
      notion.databases.query({
        database_id: process.env.NOTION_TOKEN_DATABASE_ID,
        filter: {
          and: [
            { property: 'token', rich_text: { is_not_empty: true } },
            { property: '已使用', checkbox: { equals: false } }
          ]
        },
        page_size: 1
      })
    )

    if (response.results.length === 0) {
      console.warn('[notion-token] 没有可用的 token（可能已用完）')
      return null
    }

    const page = response.results[0]
    const tokenText = page.properties?.token?.rich_text?.[0]?.plain_text

    if (!tokenText) {
      console.warn('[notion-token] token 字段为空或格式异常', { pageId: page.id })
      return null
    }

    return { token: tokenText, pageId: page.id }
  } catch (error) {
    console.error('[notion-token] lookupUnusedToken 失败', {
      error: error.message
    })
    return null
  }
}

/**
 * 将 Token 记录标为已使用
 *
 * ⚠️  API 契约：此函数 MUST NOT throw
 * --------------------------------------------------
 * 调用方（pages/api/pay/notify.js）在订单写入成功后调用。
 * 即使标记失败，订单数据已落库，不影响业务。
 * 标记失败只导致该 Token 可能被重复使用（但 Notion 复制链接只第一次有效）。
 *
 * 任何错误路径都必须被本函数内部 catch，吞掉错误。
 * --------------------------------------------------
 *
 * @param {string} tokenPageId - Token 记录在 Notion 中的 pageId
 * @param {Object} [client] - 仅用于测试，注入 mock client
 * @returns {Promise<boolean>} true=成功, false=失败
 */
async function markTokenAsUsed(tokenPageId, client) {
  const notion = getNotionClient(client)

  try {
    await withRetry(() =>
      notion.pages.update({
        page_id: tokenPageId,
        properties: {
          '已使用': { checkbox: true }
        }
      })
    )
    return true
  } catch (error) {
    console.error('[notion-token] markTokenAsUsed 失败', {
      tokenPageId,
      error: error.message
    })
    return false
  }
}

module.exports = { lookupUnusedToken, markTokenAsUsed, getNotionClient }
