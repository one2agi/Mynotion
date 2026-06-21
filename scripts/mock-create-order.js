/**
 * Mock Notion 订单写入测试脚本
 * 用法：node --env-file=.env.local scripts/mock-create-order.js [discountCode]
 *
 * 示例：
 *   # 不带优惠码（直写）
 *   node --env-file=.env.local scripts/mock-create-order.js
 *   # 带优惠码 SAVE10
 *   node --env-file=.env.local scripts/mock-create-order.js SAVE10
 *
 * 用于本地测试 Notion 写入路径，不需要 Z-Pay 真实回调。
 * 配合 dev server 创建的订单号使用（curl POST /api/pay/create-order 拿到 outTradeNo）。
 */
const { createOrderPage } = require('../lib/notion-order')

const DISCOUNT_CODE = process.argv[2] || ''

const MOCK_ORDER = {
  productName: 'Starter 入门版',
  outTradeNo: `MOCK_${Date.now()}`,
  email: DISCOUNT_CODE ? 'discount-test@example.com' : 'test@example.com',
  name: DISCOUNT_CODE ? '优惠码测试用户' : '测试用户（mock 直写）',
  amount: DISCOUNT_CODE ? 29.9 : 0.1,  // 带折扣假设基础版 39.9 - 10 = 29.9
  discountCode: DISCOUNT_CODE,
  paidAt: new Date().toISOString()
}

async function main() {
  console.log(`=== Mock Notion 订单写入${DISCOUNT_CODE ? '（带优惠码）' : ''} ===\n`)
  console.log('写入参数：')
  console.log(JSON.stringify(MOCK_ORDER, null, 2))
  console.log()

  try {
    const pageId = await createOrderPage(MOCK_ORDER)
    console.log('\n✅ 写入成功')
    console.log('Page ID:', pageId)
    console.log('订单号:', MOCK_ORDER.outTradeNo)
    if (DISCOUNT_CODE) {
      console.log('优惠码:', DISCOUNT_CODE)
    }
    console.log('\n请到 Notion DB 验证：')
    console.log('  DB: 4044f4cfc8e28236a41e818304648b77（模板客户管理）')
    console.log('  按"订单号"过滤 =', MOCK_ORDER.outTradeNo)
    if (DISCOUNT_CODE) {
      console.log('\n请额外验证"优惠码"字段 =', DISCOUNT_CODE)
    }
    console.log('\n注意：Token / 源链接 / 备注 / 交付时间 由用户/运营手动填，本脚本不写')
  } catch (error) {
    console.error('\n❌ 写入失败')
    console.error('Error:', error.message)
    if (error.code) console.error('Code:', error.code)
    process.exit(1)
  }
}

main()