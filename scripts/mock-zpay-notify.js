/**
 * Mock Z-Pay 回调测试脚本
 * 用法：node scripts/mock-zpay-notify.js <out_trade_no> [money]
 *
 * 示例：
 *   node scripts/mock-zpay-notify.js TEST123456 29.90
 */
const crypto = require('crypto')

const ZPAY_KEY = process.env.ZPAY_KEY
const OUT_TRADE_NO = process.argv[2]
const MONEY = process.argv[3] || '39.90'

if (!OUT_TRADE_NO) {
  console.error('用法：node mock-zpay-notify.js <out_trade_no> [money]')
  console.error('示例：node mock-zpay-notify.js TEST123456 29.90')
  process.exit(1)
}

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

// 生成签名
function signParams(p) {
  const sorted = Object.keys(p)
    .filter(k => k !== 'sign' && k !== 'sign_type' && p[k] !== undefined)
    .sort()
  const prestr = sorted.map(k => `${k}=${p[k]}`).join('&')
  return crypto.createHash('md5').update(prestr + ZPAY_KEY).digest('hex')
}

params.sign = signParams(params)

const url = process.env.ZPAY_NOTIFY_URL || 'http://localhost:3000/api/pay/notify'
const formData = new URLSearchParams(params).toString()

console.log('发送 Mock 回调：')
console.log('URL:', url)
console.log('Params:', params)

fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: formData
})
  .then(res => res.text())
  .then(body => {
    console.log('\n回调响应：', body)
    console.log('\n测试完成！请检查 Notion 数据库是否写入订单：', OUT_TRADE_NO)
  })
  .catch(err => {
    console.error('\n回调失败：', err.message)
    process.exit(1)
  })