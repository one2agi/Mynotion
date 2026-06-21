/**
 * Mock 订单写入（绕过 notify.js，直接调用 Notion 写入）
 * 用法：node --env-file=.env.local scripts/mock-create-order.js
 *
 * 用于本地测试 Notion 写入路径，不需要 Z-Pay 真实回调。
 * 配合 dev server 创建的订单号使用（curl POST /api/pay/create-order 拿到 outTradeNo）。
 */
const { createOrderPage } = require('../lib/notion-order')

const MOCK_ORDER = {
  productName: 'Starter 入门版',
  outTradeNo: `MOCK_${Date.now()}`,
  email: 'test@example.com',
  name: '测试用户（mock 直写）',
  amount: 0.1,
  discountCode: '',
  paidAt: new Date().toISOString()
}

async function main() {
  console.log('=== Mock Notion 订单写入 ===\n')
  console.log('写入参数：')
  console.log(JSON.stringify(MOCK_ORDER, null, 2))
  console.log()

  try {
    const pageId = await createOrderPage(MOCK_ORDER)
    console.log('\n✅ 写入成功')
    console.log('Page ID:', pageId)
    console.log('订单号:', MOCK_ORDER.outTradeNo)
    console.log('\n请到 Notion DB 验证：')
    console.log('  DB: 4044f4cfc8e28236a41e818304648b77（模板客户管理）')
    console.log('  按"订单号"过滤 =', MOCK_ORDER.outTradeNo)
    console.log('\n注意：Token / 源链接 / 备注 / 交付时间 由用户/运营手动填，本脚本不写')
  } catch (error) {
    console.error('\n❌ 写入失败')
    console.error('Error:', error.message)
    if (error.code) console.error('Code:', error.code)
    process.exit(1)
  }
}

main()
