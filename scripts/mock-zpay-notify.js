/**
 * Mock Z-Pay 回调测试脚本
 * 用法：node scripts/mock-zpay-notify.js <out_trade_no> [money]
 *
 * 示例：
 *   node --env-file=.env.local scripts/mock-zpay-notify.js TEST123456 29.90
 *
 * 注意：lib/zpay.js 是 ESM，本脚本是 CJS，所以用 dynamic import 复用 signParams，
 * 避免在两处各自维护 MD5+sort 签名逻辑（防止签名规则改动时 mock 与生产漂移）。
 */

const OUT_TRADE_NO = process.argv[2]
const MONEY = process.argv[3] || '39.90'

if (!OUT_TRADE_NO) {
  console.error('用法：node mock-zpay-notify.js <out_trade_no> [money]')
  console.error('示例：node mock-zpay-notify.js TEST123456 29.90')
  process.exit(1)
}

if (!process.env.ZPAY_KEY) {
  console.error('错误：未设置 ZPAY_KEY 环境变量')
  console.error('签名计算需要 ZPAY_KEY，否则生成的签名会与 notify.js 验证时不匹配。')
  console.error('')
  console.error('用法 1（推荐）：node --env-file=.env.local scripts/mock-zpay-notify.js <out_trade_no> [money]')
  console.error('用法 2：ZPAY_KEY=xxx ZPAY_NOTIFY_URL=xxx node scripts/mock-zpay-notify.js <out_trade_no> [money]')
  process.exit(1)
}

;(async () => {
  const { signParams } = await import('../lib/zpay.js')

  // 构造模拟的 Z-Pay 回调参数
  const params = {
    trade_no: 'MOCK_' + Date.now(),
    out_trade_no: OUT_TRADE_NO,
    name: 'Starter 基础版',
    money: MONEY,
    type: 'wxpay',
    trade_status: 'TRADE_SUCCESS',
    param: JSON.stringify({ email: 'test@example.com', name: '测试用户', discountCode: '' }),
    sign_type: 'MD5'
  }

  params.sign = signParams(params)

  const url = process.env.ZPAY_NOTIFY_URL || 'http://localhost:3000/api/pay/notify'
  const formData = new URLSearchParams(params).toString()

  console.log('发送 Mock 回调：')
  console.log('URL:', url)
  console.log('Params:', params)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    })
    const body = await res.text()
    console.log('\n回调响应：', body)
    console.log('\n测试完成！请检查 Notion 数据库是否写入订单：', OUT_TRADE_NO)
  } catch (err) {
    console.error('\n回调失败：', err.message)
    process.exit(1)
  }
})()