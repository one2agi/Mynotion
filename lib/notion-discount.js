/**
 * Notion 优惠码查询
 * 数据库：NOTION_DISCOUNT_DATABASE_ID
 */

const { Client } = require('@notionhq/client')

let notionClient = null

function getNotionClient() {
  if (!notionClient) {
    notionClient = new Client({ auth: process.env.NOTION_TOKEN })
  }
  return notionClient
}

/**
 * 查询优惠码
 * @param {string} code - 优惠码
 * @returns {Promise<{ amount: number, name: string } | null>}
 */
async function lookupDiscountCode(code) {
  if (!code || code.trim() === '') {
    return null
  }

  const notion = getNotionClient()
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DISCOUNT_DATABASE_ID,
    filter: {
      and: [
        { property: '优惠码', rich_text: { equals: code } },
        { property: '状态', status: { equals: 'active' } }
      ]
    }
  })

  if (response.results.length === 0) {
    return null
  }

  const page = response.results[0]
  const amount = page.properties['优惠金额']?.number || 0
  const name = page.properties['Name']?.title?.[0]?.plain_text || code

  return { amount, name }
}

module.exports = { lookupDiscountCode }