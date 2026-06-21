/**
 * Mock 订单写入（带优惠码）— 验证优惠码字段
 * 用法：node --env-file=.env.local scripts/mock-order-with-discount.js [discountCode]
 *
 * 示例：
 *   node --env-file=.env.local scripts/mock-order-with-discount.js SAVE10
 */
const { createOrderPage } = require('../lib/notion-order')

const DISCOUNT_CODE = process.argv[2] || 'SAVE10'

const MOCK_ORDER = {
  productName: 'Starter 基础版',
  outTradeNo: `MOCK_DISC_${Date.now()}`,
  email: 'discount-test@example.com',
  name: '优惠码测试用户',
  amount: 29.9,  // 假设基础版原价 39.9 - 优惠码 10 = 29.9
  discountCode: DISCOUNT_CODE,
  paidAt: new Date().toISOString()
}

async function main() {
  console.log('=== Mock 订单写入（带优惠码）===\n')
  console.log('写入参数：')
  console.log(JSON.stringify(MOCK_ORDER, null, 2))
  console.log()

  try {
    const pageId = await createOrderPage(MOCK_ORDER)
    console.log('\n✅ 写入成功')
    console.log('Page ID:', pageId)
    console.log('订单号:', MOCK_ORDER.outTradeNo)
    console.log('优惠码:', DISCOUNT_CODE)
    console.log('\n请到 Notion DB 验证"优惠码"字段：')
    console.log('  DB: 4044f4cfc8e28236a41e818304648b77')
    console.log('  按"订单号"过滤 =', MOCK_ORDER.outTradeNo)
  } catch (error) {
    console.error('\n❌ 写入失败')
    console.error('Error:', error.message)
    if (error.code) console.error('Code:', error.code)
    process.exit(1)
  }
}

main()
