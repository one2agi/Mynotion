# 支付功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 NotionNext Starter 主题接入微信支付（Z-Pay），实现用户下单、二维码展示、优惠码验证、支付回调、Notion 订单写入的完整流程。

**Architecture:** 使用 Z-Pay 作为第四方支付通道，接入微信支付 Native 模式。前端 PayModal 组件负责表单收集和二维码展示；后端 API Route 负责订单创建、状态查询、回调处理；优惠码和订单数据存储在 Notion 数据库中。

**Tech Stack:** Next.js API Routes, React, qrcode (npm), Notion API, Z-Pay API

## Global Constraints

- Node.js >=20 <25（生产用 Node 22）
- 包管理：pnpm 9.15.0（`packageManager` 字段强制）
- 提交格式：Conventional Commits（`feat:`, `fix:`, `test:`, `chore:`）
- 测试：`pnpm test`（Jest），覆盖支付核心逻辑
- 编码：2 空格缩进

---

## 文件结构

```
lib/
├── zpay.js              # Z-Pay API 封装（新建）
│   └── signParams(), verifySign(), createNativeOrder(), queryOrder()
├── notion-discount.js   # Notion 优惠码查询（新建）
│   └── lookupDiscountCode(code) → { amount, status }
├── notion-order.js      # Notion 订单写入（新建）
│   └── createOrderPage(orderData) → pageId

pages/api/pay/
├── create-order.js      # POST 创建订单（含优惠码验证）
├── query-order.js       # GET 查询订单状态
└── notify.js           # POST 回调处理

themes/starter/
├── components/
│   └── PayModal.js      # 支付弹窗组件（新建）
└── config.js           # 支付配置（改造）

scripts/
└── mock-zpay-notify.js # Mock 回调测试脚本（新建）
```

---

## Task 1: Z-Pay API 封装（lib/zpay.js）

**Files:**

- Create: `lib/zpay.js`
- Test: `__tests__/lib/zpay.test.js`

**Interfaces:**

- Consumes: `process.env.ZPAY_PID`, `process.env.ZPAY_KEY`, `process.env.ZPAY_API_URL`

- Produces:
  
  - `signParams(params: Object): string` — 生成 MD5 签名
  - `verifySign(params: Object): boolean` — 验签
  - `createNativeOrder(orderInfo: Object): Promise<{ qrcode: string }>` — 创建 Native 订单
  - `queryOrder(outTradeNo: string): Promise<Object>` — 查询订单状态

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/lib/zpay.test.js
import { signParams, verifySign } from '@/lib/zpay'

describe('Z-Pay 签名', () => {
  const TEST_KEY = 'testkey123'

  beforeEach(() => {
    process.env.ZPAY_KEY = TEST_KEY
  })

  test('signParams 生成正确签名', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(typeof sign).toBe('string')
    expect(sign).toHaveLength(32) // MD5 hex length
  })

  test('verifySign 验签成功', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(verifySign({ ...params, sign })).toBe(true)
  })

  test('verifySign 验签失败（篡改数据）', () => {
    const params = {
      pid: '2026050116254529',
      out_trade_no: 'TEST123',
      money: '39.90',
      name: '测试商品'
    }
    const sign = signParams(params)
    expect(verifySign({ ...params, money: '0.01', sign })).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd /home/morav/myblog/NotionNext && pnpm test __tests__/lib/zpay.test.js --watchAll=false`
Expected: FAIL — "signParams is not defined"

- [ ] **Step 3: 实现 Z-Pay 封装**

```javascript
// lib/zpay.js
/**
 * Z-Pay API 封装
 * 文档：https://member.z-pay.cn/member/doc.html
 */

const ZPAY_PID = process.env.ZPAY_PID
const ZPAY_KEY = process.env.ZPAY_KEY
const ZPAY_API_URL = process.env.ZPAY_API_URL || 'https://z-pay.cn'

/**
 * 生成签名（按字典序排列后拼接 + MD5）
 * @param {Object} params - 参数对象（不含 sign）
 * @returns {string} 小写 MD5 签名
 */
export function signParams(params) {
  const sorted = Object.keys(params)
    .filter(k => params[k] !== undefined && params[k] !== null && k !== 'sign' && k !== 'sign_type')
    .sort()
  const prestr = sorted.map(k => `${k}=${params[k]}`).join('&')
  const crypto = require('crypto')
  return crypto.createHash('md5').update(prestr + ZPAY_KEY).digest('hex')
}

/**
 * 验证签名
 * @param {Object} params - 包含 sign 的完整参数
 * @returns {boolean}
 */
export function verifySign(params) {
  const { sign, sign_type, ...rest } = params
  if (!sign) return false
  return signParams(rest) === sign
}

/**
 * 创建 Native 订单（微信扫码支付）
 * @param {Object} orderInfo
 * @param {string} orderInfo.outTradeNo - 商户订单号
 * @param {string} orderInfo.name - 商品名称
 * @param {number} orderInfo.money - 金额（元），最多两位小数
 * @param {string} orderInfo.notifyUrl - 回调地址
 * @param {string} orderInfo.param - 附加参数（JSON 字符串）
 * @returns {Promise<{ qrcode: string }>}
 */
export async function createNativeOrder({ outTradeNo, name, money, notifyUrl, param }) {
  const params = {
    pid: ZPAY_PID,
    type: 'wxpay',
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    name,
    money: String(money), // Z-Pay 接受字符串或数字
    param,
    sign_type: 'MD5'
  }
  params.sign = signParams(params)

  const formData = new URLSearchParams()
  Object.keys(params).forEach(k => formData.append(k, params[k]))

  const response = await fetch(`${ZPAY_API_URL}/mapi.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formData.toString()
  })

  const result = await response.json()
  if (result.code !== 1) {
    throw new Error(result.msg || 'Z-Pay 创建订单失败')
  }
  return { qrcode: result.qrcode }
}

/**
 * 查询订单状态
 * @param {string} outTradeNo - 商户订单号
 * @returns {Promise<{ tradeStatus: string, tradeNo: string, money: string }>}
 */
export async function queryOrder(outTradeNo) {
  const params = {
    act: 'order',
    pid: ZPAY_PID,
    key: ZPAY_KEY,
    out_trade_no: outTradeNo
  }
  const url = `${ZPAY_API_URL}/api.php?${new URLSearchParams(params).toString()}`
  const response = await fetch(url)
  const result = await response.json()
  return {
    tradeStatus: result.trade_status,
    tradeNo: result.trade_no,
    money: result.money
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/lib/zpay.test.js --watchAll=false`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/zpay.js __tests__/lib/zpay.test.js
git commit -m "feat(payment): add Z-Pay API wrapper with sign/verify functions"
```

---

## Task 2: Notion 优惠码查询（lib/notion-discount.js）

**Files:**

- Create: `lib/notion-discount.js`
- Test: `__tests__/lib/notion-discount.test.js`

**Interfaces:**

- Consumes: `process.env.NOTION_TOKEN`, `process.env.NOTION_DISCOUNT_DATABASE_ID`

- Produces:
  
  - `lookupDiscountCode(code: string): Promise<{ amount: number, name: string } | null>` — 查询优惠码，返回 null 表示无效

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/lib/notion-discount.test.js
import { lookupDiscountCode } from '@/lib/notion-discount'

// Mock @notionhq/client
jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    databases: {
      query: jest.fn()
    }
  }))
}))

describe('优惠码查询', () => {
  test('查询有效优惠码返回金额', async () => {
    const mockNotion = require('@notionhq/client').Client.mock.results[0].value
    mockNotion.databases.query.mockResolvedValue({
      results: [{
        properties: {
          '优惠码': { rich_text: [{ plain_text: 'SAVE10' }] },
          '优惠金额': { number: 10 },
          '状态': { status: { name: 'active' } }
        }
      }]
    })

    const result = await lookupDiscountCode('SAVE10')
    expect(result).toEqual({ amount: 10, name: 'SAVE10' })
  })

  test('查询无效优惠码返回 null', async () => {
    const mockNotion = require('@notionhq/client').Client.mock.results[0].value
    mockNotion.databases.query.mockResolvedValue({ results: [] })

    const result = await lookupDiscountCode('INVALID')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test __tests__/lib/notion-discount.test.js --watchAll=false`
Expected: FAIL — "lookupDiscountCode is not defined"

- [ ] **Step 3: 实现优惠码查询**

```javascript
// lib/notion-discount.js
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
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/lib/notion-discount.test.js --watchAll=false`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/notion-discount.js __tests__/lib/notion-discount.test.js
git commit -m "feat(payment): add discount code lookup from Notion"
```

---

## Task 3: Notion 订单写入（lib/notion-order.js）

**Files:**

- Create: `lib/notion-order.js`
- Test: `__tests__/lib/notion-order.test.js`

**Interfaces:**

- Consumes: `process.env.NOTION_TOKEN`, `process.env.NOTION_DATABASE_ID`

- Produces:
  
  - `createOrderPage(orderData: Object): Promise<string>` — 写入 Notion 订单页，返回 pageId

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/lib/notion-order.test.js
import { createOrderPage } from '@/lib/notion-order'

jest.mock('@notionhq/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    databases: {
      query: jest.fn()
    },
    pages: {
      create: jest.fn()
    }
  }))
}))

describe('Notion 订单写入', () => {
  test('创建订单页成功', async () => {
    const mockNotion = require('@notionhq/client').Client.mock.results[0].value
    mockNotion.pages.create.mockResolvedValue({ id: 'new-page-id-123' })

    const orderData = {
      productName: 'Starter 基础版',
      outTradeNo: 'TEST123456',
      email: 'test@example.com',
      name: '测试用户',
      amount: 29.9,
      discountCode: 'SAVE10',
      tradeNo: 'ZPAY123456'
    }

    const pageId = await createOrderPage(orderData)
    expect(pageId).toBe('new-page-id-123')
    expect(mockNotion.pages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: expect.objectContaining({
          'Name': { title: [{ text: { content: 'Starter 基础版' } }] },
          '订单号': { rich_text: [{ text: { content: 'TEST123456' } }] },
          '客户邮箱': { email: 'test@example.com' },
          '姓名': { rich_text: [{ text: { content: '测试用户' } }] },
          '金额': { number: 29.9 },
          '优惠码': { rich_text: [{ text: { content: 'SAVE10' } }] },
          '状态': { status: { name: 'paid' } },
          'Z-Pay Trade No': { rich_text: [{ text: { content: 'ZPAY123456' } }] }
        })
      })
    )
  })

  test('幂等性：重复订单号不重复创建', async () => {
    const mockNotion = require('@notionhq/client').Client.mock.results[0].value
    // 模拟已存在订单
    mockNotion.databases.query.mockResolvedValue({
      results: [{ id: 'existing-page-id' }]
    })

    const orderData = {
      productName: 'Starter 基础版',
      outTradeNo: 'EXISTING123',
      email: 'test@example.com'
    }

    const pageId = await createOrderPage(orderData)
    // 应该返回已存在的 pageId，不调用 create
    expect(pageId).toBe('existing-page-id')
    expect(mockNotion.pages.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test __tests__/lib/notion-order.test.js --watchAll=false`
Expected: FAIL — "createOrderPage is not defined"

- [ ] **Step 3: 实现订单写入**

```javascript
// lib/notion-order.js
/**
 * Notion 订单写入
 * 数据库：NOTION_DATABASE_ID (6ab4f4cf-c8e2-825e-bde8-016c2d9be1c2)
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
 * 写入订单到 Notion
 * @param {Object} orderData
 * @param {string} orderData.productName - 商品名称
 * @param {string} orderData.outTradeNo - 商户订单号
 * @param {string} orderData.email - 客户邮箱
 * @param {string} orderData.name - 客户姓名
 * @param {number} orderData.amount - 金额（元）
 * @param {string} orderData.discountCode - 优惠码（可为空）
 * @param {string} orderData.tradeNo - Z-Pay 平台订单号
 * @returns {Promise<string>} pageId
 */
async function createOrderPage(orderData) {
  const { productName, outTradeNo, email, name, amount, discountCode, tradeNo } = orderData
  const notion = getNotionClient()

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

module.exports = { createOrderPage }
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/lib/notion-order.test.js --watchAll=false`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/notion-order.js __tests__/lib/notion-order.test.js
git commit -m "feat(payment): add Notion order write with idempotency check"
```

---

## Task 4: 创建订单 API（pages/api/pay/create-order.js）

**Files:**

- Create: `pages/api/pay/create-order.js`
- Test: `__tests__/pages/api/pay/create-order.test.js`

**Interfaces:**

- Consumes: `lib/zpay.createNativeOrder()`, `lib/notion-discount.lookupDiscountCode()`, `lib/config.js` (STARTER_PRICING_*)

- Produces:
  
  - `POST /api/pay/create-order` → `{ success: true, data: { outTradeNo, qrcode, amount, originalAmount, discountAmount, productName } }`

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/pages/api/pay/create-order.test.js
// 使用 next-test-api-route-handler 进行集成测试
import { createRouter } from 'next-connect'
import handler from '@/pages/api/pay/create-order'

// Mock 依赖
jest.mock('@/lib/zpay', () => ({
  createNativeOrder: jest.fn()
}))
jest.mock('@/lib/notion-discount', () => ({
  lookupDiscountCode: jest.fn()
}))
jest.mock('@/lib/config', () => ({
  siteConfig: (key, defaultVal) => {
    const config = {
      'STARTER_PRICING_1_TITLE': '入门版',
      'STARTER_PRICING_1_PRICE': '19.9',
      'STARTER_PRICING_2_TITLE': '基础版',
      'STARTER_PRICING_2_PRICE': '39.9',
      'STARTER_PRICING_3_TITLE': '高级版',
      'STARTER_PRICING_3_PRICE': '59.9',
      'STARTER_PAYMENT_NOTIFY_URL': 'https://test.com/api/pay/notify'
    }
    return config[key] || defaultVal
  }
}))

describe('POST /api/pay/create-order', () => {
  let router

  beforeEach(() => {
    router = createRouter()
    router.use(handler)
  })

  test('无优惠码创建订单成功', async () => {
    const { createNativeOrder } = require('@/lib/zpay')
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'starter-basic'
      }
    }

    const resp = await router.handler(req, { json: jest.fn() })
    expect(resp.status).toBe(200)
    const json = JSON.parse(resp.body)
    expect(json.success).toBe(true)
    expect(json.data.qrcode).toBe('weixin://wxpay/xxx')
    expect(json.data.originalAmount).toBe(39.9)
    expect(json.data.discountAmount).toBe(0)
  })

  test('有效优惠码抵扣成功', async () => {
    const { createNativeOrder } = require('@/lib/zpay')
    const { lookupDiscountCode } = require('@/lib/notion-discount')
    createNativeOrder.mockResolvedValue({ qrcode: 'weixin://wxpay/xxx' })
    lookupDiscountCode.mockResolvedValue({ amount: 10, name: 'SAVE10' })

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'SAVE10',
        productId: 'starter-basic'
      }
    }

    const resp = await router.handler(req, { json: jest.fn() })
    expect(resp.status).toBe(200)
    const json = JSON.parse(resp.body)
    expect(json.data.originalAmount).toBe(39.9)
    expect(json.data.discountAmount).toBe(10)
    expect(json.data.amount).toBe(29.9)
  })

  test('无效优惠码返回错误', async () => {
    const { lookupDiscountCode } = require('@/lib/notion-discount')
    lookupDiscountCode.mockResolvedValue(null)

    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: 'INVALID',
        productId: 'starter-basic'
      }
    }

    const resp = await router.handler(req, { json: jest.fn() })
    expect(resp.status).toBe(400)
    const json = JSON.parse(resp.body)
    expect(json.success).toBe(false)
    expect(json.code).toBe('INVALID_DISCOUNT')
  })

  test('无效商品 ID 返回错误', async () => {
    const req = {
      method: 'POST',
      body: {
        name: '张三',
        email: 'zhangsan@example.com',
        discountCode: '',
        productId: 'invalid-product'
      }
    }

    const resp = await router.handler(req, { json: jest.fn() })
    expect(resp.status).toBe(400)
    const json = JSON.parse(resp.body)
    expect(json.success).toBe(false)
    expect(json.code).toBe('INVALID_PRODUCT')
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test __tests__/pages/api/pay/create-order.test.js --watchAll=false`
Expected: FAIL — module not found or handler errors

- [ ] **Step 3: 实现创建订单 API**

```javascript
// pages/api/pay/create-order.js
/**
 * POST /api/pay/create-order
 * 验证优惠码 → 创建订单 → 返回微信支付二维码链接
 */
import { createNativeOrder } from '@/lib/zpay'
import { lookupDiscountCode } from '@/lib/notion-discount'
import { siteConfig } from '@/lib/config'

// 商品配置映射
const PRODUCT_MAP = {
  'starter-basic': { index: 1 },
  'starter-pro': { index: 2 },
  'starter-premium': { index: 3 }
}

function getProductConfig(index) {
  return {
    name: siteConfig(`STARTER_PRICING_${index}_TITLE`),
    price: parseFloat(siteConfig(`STARTER_PRICING_${index}_PRICE`, '0'))
  }
}

function generateOutTradeNo() {
  return `NN${Date.now()}${Math.random().toString(36).substring(2, 8).toUpperCase()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  try {
    const { name, email, discountCode, productId } = req.body

    // 验证必填字段
    if (!name || name.trim().length === 0 || name.length > 50) {
      return res.status(400).json({ success: false, error: '姓名必填，最多50字符', code: 'INVALID_INPUT' })
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, error: '请提供有效邮箱', code: 'INVALID_INPUT' })
    }
    if (!productId || !PRODUCT_MAP[productId]) {
      return res.status(400).json({ success: false, error: '商品不存在', code: 'INVALID_PRODUCT' })
    }

    // 获取商品配置
    const productIndex = PRODUCT_MAP[productId].index
    const { name: productName, price: originalAmount } = getProductConfig(productIndex)

    let discountAmount = 0

    // 验证优惠码（如有）
    if (discountCode && discountCode.trim() !== '') {
      const discount = await lookupDiscountCode(discountCode.trim())
      if (!discount) {
        return res.status(400).json({ success: false, error: '优惠码不存在或已过期', code: 'INVALID_DISCOUNT' })
      }
      discountAmount = discount.amount
    }

    // 计算实付金额
    const amount = Math.max(0, originalAmount - discountAmount)

    // 生成订单号
    const outTradeNo = generateOutTradeNo()

    // 回调地址
    const notifyUrl = siteConfig('STARTER_PAYMENT_NOTIFY_URL', process.env.ZPAY_NOTIFY_URL)

    // 附加参数（回调时返回，用于写入 Notion）
    const param = JSON.stringify({ email, name, discountCode: discountCode || '' })

    // 调用 Z-Pay 创建订单
    const { qrcode } = await createNativeOrder({
      outTradeNo,
      name: productName,
      money: amount,
      notifyUrl,
      param
    })

    return res.status(200).json({
      success: true,
      data: {
        outTradeNo,
        qrcode,
        amount,
        originalAmount,
        discountAmount,
        productName
      }
    })
  } catch (error) {
    console.error('创建订单失败:', error)
    return res.status(500).json({ success: false, error: '订单创建失败', code: 'INTERNAL_ERROR' })
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/pages/api/pay/create-order.test.js --watchAll=false`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add pages/api/pay/create-order.js __tests__/pages/api/pay/create-order.test.js
git commit -m "feat(payment): add create-order API with discount code validation"
```

---

## Task 5: 查询订单 API（pages/api/pay/query-order.js）

**Files:**

- Create: `pages/api/pay/query-order.js`
- Test: `__tests__/pages/api/pay/query-order.test.js`

**Interfaces:**

- Consumes: `lib/zpay.queryOrder()`

- Produces:
  
  - `GET /api/pay/query-order?outTradeNo=xxx` → `{ success: true, data: { outTradeNo, status, paidAt? } }`

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/pages/api/pay/query-order.test.js
import { createRouter } from 'next-connect'
import handler from '@/pages/api/pay/query-order'

jest.mock('@/lib/zpay', () => ({
  queryOrder: jest.fn()
}))

describe('GET /api/pay/query-order', () => {
  let router

  beforeEach(() => {
    router = createRouter()
    router.use(handler)
    jest.clearAllMocks()
  })

  test('查询待支付订单返回 pending', async () => {
    const { queryOrder } = require('@/lib/zpay')
    queryOrder.mockResolvedValue({
      tradeStatus: 'WAIT_BUYER_PAY',
      tradeNo: 'ZPAY123',
      money: '39.90'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const resp = await router.handler(req, { json: jest.fn() })

    expect(resp.status).toBe(200)
    const json = JSON.parse(resp.body)
    expect(json.success).toBe(true)
    expect(json.data.status).toBe('pending')
    expect(json.data.outTradeNo).toBe('TEST123')
  })

  test('查询已支付订单返回 paid', async () => {
    const { queryOrder } = require('@/lib/zpay')
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_SUCCESS',
      tradeNo: 'ZPAY123',
      money: '39.90'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const resp = await router.handler(req, { json: jest.fn() })

    expect(resp.status).toBe(200)
    const json = JSON.parse(resp.body)
    expect(json.data.status).toBe('paid')
  })

  test('查询已关闭订单返回 closed', async () => {
    const { queryOrder } = require('@/lib/zpay')
    queryOrder.mockResolvedValue({
      tradeStatus: 'TRADE_CLOSED',
      tradeNo: '',
      money: '0'
    })

    const req = { method: 'GET', query: { outTradeNo: 'TEST123' } }
    const resp = await router.handler(req, { json: jest.fn() })

    expect(resp.status).toBe(200)
    const json = JSON.parse(resp.body)
    expect(json.data.status).toBe('closed')
  })

  test('缺少 outTradeNo 参数返回错误', async () => {
    const req = { method: 'GET', query: {} }
    const resp = await router.handler(req, { json: jest.fn() })

    expect(resp.status).toBe(400)
    const json = JSON.parse(resp.body)
    expect(json.success).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test __tests__/pages/api/pay/query-order.test.js --watchAll=false`
Expected: FAIL

- [ ] **Step 3: 实现查询订单 API**

```javascript
// pages/api/pay/query-order.js
/**
 * GET /api/pay/query-order
 * 查询订单支付状态
 */
import { queryOrder as queryZpayOrder } from '@/lib/zpay'

const STATUS_MAP = {
  'WAIT_BUYER_PAY': 'pending',
  'TRADE_SUCCESS': 'paid',
  'TRADE_CLOSED': 'closed'
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' })
  }

  const { outTradeNo } = req.query

  if (!outTradeNo) {
    return res.status(400).json({ success: false, error: '缺少订单号参数' })
  }

  try {
    const result = await queryZpayOrder(outTradeNo)
    const status = STATUS_MAP[result.tradeStatus] || 'unknown'

    return res.status(200).json({
      success: true,
      data: {
        outTradeNo,
        status,
        paidAt: status === 'paid' ? new Date().toISOString() : undefined
      }
    })
  } catch (error) {
    console.error('查询订单失败:', error)
    return res.status(500).json({ success: false, error: '查询失败' })
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/pages/api/pay/query-order.test.js --watchAll=false`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add pages/api/pay/query-order.js __tests__/pages/api/pay/query-order.test.js
git commit -m "feat(payment): add query-order API for payment status polling"
```

---

## Task 6: 回调处理 API（pages/api/pay/notify.js）

**Files:**

- Create: `pages/api/pay/notify.js`
- Test: `__tests__/pages/api/pay/notify.test.js`

**Interfaces:**

- Consumes: `lib/zpay.verifySign()`, `lib/zpay.queryOrder()`, `lib/notion-order.createOrderPage()`

- Produces:
  
  - `POST /api/pay/notify` → `text/plain: "success" | "error"`

- [ ] **Step 1: 创建测试文件**

```javascript
// __tests__/pages/api/pay/notify.test.js
import { createRouter } from 'next-connect'
import handler from '@/pages/api/pay/notify'

jest.mock('@/lib/zpay', () => ({
  verifySign: jest.fn(),
  queryOrder: jest.fn()
}))
jest.mock('@/lib/notion-order', () => ({
  createOrderPage: jest.fn()
}))

describe('POST /api/pay/notify', () => {
  let router

  beforeEach(() => {
    router = createRouter()
    router.use(handler)
    jest.clearAllMocks()
  })

  test('验签失败返回 error', async () => {
    const { verifySign } = require('@/lib/zpay')
    verifySign.mockReturnValue(false)

    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '测试商品',
        money: '39.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: '{}',
        sign_type: 'MD5',
        sign: 'invalidsign'
      })
    }

    const mockSend = jest.fn()
    await router.handler(req, { send: mockSend })
    expect(mockSend).toHaveBeenCalledWith('error')
  })

  test('支付成功写入 Notion 返回 success', async () => {
    const { verifySign, queryOrder } = require('@/lib/zpay')
    const { createOrderPage } = require('@/lib/notion-order')
    verifySign.mockReturnValue(true)
    queryOrder.mockResolvedValue({ tradeStatus: 'TRADE_SUCCESS', tradeNo: 'ZPAY123' })
    createOrderPage.mockResolvedValue('new-page-id')

    const req = {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        trade_no: 'ZPAY123',
        out_trade_no: 'TEST123',
        name: '基础版',
        money: '29.90',
        type: 'wxpay',
        trade_status: 'TRADE_SUCCESS',
        param: JSON.stringify({ email: 'test@example.com', name: '张三', discountCode: 'SAVE10' }),
        sign_type: 'MD5',
        sign: 'realsign'
      })
    }

    const mockSend = jest.fn()
    await router.handler(req, { send: mockSend })
    expect(mockSend).toHaveBeenCalledWith('success')
    expect(createOrderPage).toHaveBeenCalledWith(expect.objectContaining({
      outTradeNo: 'TEST123',
      tradeNo: 'ZPAY123',
      amount: 29.90
    }))
  })
})
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test __tests__/pages/api/pay/notify.test.js --watchAll=false`
Expected: FAIL

- [ ] **Step 3: 实现回调处理 API**

```javascript
// pages/api/pay/notify.js
/**
 * POST /api/pay/notify
 * Z-Pay 异步回调通知
 */
import { verifySign, queryOrder as queryZpayOrder } from '@/lib/zpay'
import { createOrderPage } from '@/lib/notion-order'

export const config = {
  api: {
    bodyParser: false
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end()
  }

  try {
    // 解析表单数据
    const formData = await req.formData()
    const params = Object.fromEntries(formData.entries())

    // 验签
    if (!verifySign(params)) {
      console.error('回调验签失败:', params.out_trade_no)
      return res.status(200).type('text/plain').send('error')
    }

    const outTradeNo = params.out_trade_no

    // 查询 Z-Pay 确认订单状态（防伪造）
    const zpayResult = await queryZpayOrder(outTradeNo)
    if (zpayResult.tradeStatus !== 'TRADE_SUCCESS') {
      // 非成功订单也返回 success，避免 Z-Pay 重复通知
      return res.status(200).type('text/plain').send('success')
    }

    // 解析附加参数
    let extra = { email: '', name: '', discountCode: '' }
    try {
      extra = JSON.parse(params.param || '{}')
    } catch (e) {
      // ignore parse error
    }

    // 写入 Notion
    await createOrderPage({
      productName: params.name,
      outTradeNo,
      tradeNo: params.trade_no,
      email: extra.email || '',
      name: extra.name || '',
      discountCode: extra.discountCode || '',
      amount: parseFloat(params.money),
      status: 'paid',
      paidAt: new Date().toISOString()
    })

    return res.status(200).type('text/plain').send('success')
  } catch (error) {
    console.error('回调处理异常:', error)
    // 注意：回调处理失败也返回 success，避免 Z-Pay 无限重试
    // 实际可通过日志告警处理
    return res.status(200).type('text/plain').send('success')
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test __tests__/pages/api/pay/notify.test.js --watchAll=false`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add pages/api/pay/notify.js __tests__/pages/api/pay/notify.test.js
git commit -m "feat(payment): add notify API for Z-Pay callback handling"
```

---

## Task 7: PayModal 组件（themes/starter/components/PayModal.js）

**Files:**

- Create: `themes/starter/components/PayModal.js`
- Modify: `themes/starter/components/Pricing.js:69-73, 121-125, 165-169`（按钮事件）
- Modify: `themes/starter/config.js`（支付配置）

**Interfaces:**

- Props: `visible: boolean`, `onClose: () => void`, `pricingIndex: number`

- Consumes: `/api/pay/create-order`, `/api/pay/query-order`

- Produces: 支付弹窗 UI，包含表单、二维码、轮询、成功提示

- [ ] **Step 1: 创建 PayModal 组件**

```javascript
// themes/starter/components/PayModal.js
'use client'

import { useState, useEffect, useRef } from 'react'
import { siteConfig } from '@/lib/config'
import QRCode from 'qrcode'

/**
 * 支付弹窗组件
 * 状态机：CLOSED → FORM → LOADING → QR_CODE → POLLING → SUCCESS | FAILED
 */
export default function PayModal({ visible, onClose, pricingIndex }) {
  const [step, setStep] = useState('FORM')
  const [productName, setProductName] = useState('')
  const [price, setPrice] = useState(0)
  const [formData, setFormData] = useState({ name: '', email: '', discountCode: '' })
  const [orderInfo, setOrderInfo] = useState(null)
  const [error, setError] = useState('')
  const [qrcodeUrl, setQrcodeUrl] = useState('')
  const canvasRef = useRef(null)
  const pollingTimerRef = useRef(null)

  // 根据 pricingIndex 加载商品信息
  useEffect(() => {
    if (visible && pricingIndex) {
      const name = siteConfig(`STARTER_PRICING_${pricingIndex}_TITLE`)
      const priceVal = parseFloat(siteConfig(`STARTER_PRICING_${pricingIndex}_PRICE`, '0'))
      setProductName(name)
      setPrice(priceVal)
    }
  }, [visible, pricingIndex])

  // 清理轮询定时器
  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current)
      }
    }
  }, [])

  // 渲染二维码
  useEffect(() => {
    if (qrcodeUrl && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, qrcodeUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      })
    }
  }, [qrcodeUrl])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setStep('LOADING')

    try {
      const resp = await fetch('/api/pay/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          productId: `starter-${pricingIndex === 1 ? 'basic' : pricingIndex === 2 ? 'pro' : 'premium'}`
        })
      })

      const json = await resp.json()

      if (!json.success) {
        setError(json.error || '订单创建失败')
        setStep('FAILED')
        return
      }

      setOrderInfo(json.data)
      setQrcodeUrl(json.data.qrcode)
      setStep('QR_CODE')

      // 存储到 sessionStorage
      sessionStorage.setItem('payOrder', JSON.stringify({
        outTradeNo: json.data.outTradeNo,
        pricingIndex,
        productName: json.data.productName,
        amount: json.data.amount
      }))

      // 开始轮询
      startPolling(json.data.outTradeNo)
    } catch (err) {
      setError('网络错误，请重试')
      setStep('FAILED')
    }
  }

  const startPolling = (outTradeNo) => {
    setStep('POLLING')
    pollingTimerRef.current = setInterval(async () => {
      try {
        const resp = await fetch(`/api/pay/query-order?outTradeNo=${outTradeNo}`)
        const json = await resp.json()
        if (json.data.status === 'paid') {
          clearInterval(pollingTimerRef.current)
          setStep('SUCCESS')
          sessionStorage.removeItem('payOrder')
        } else if (json.data.status === 'closed') {
          clearInterval(pollingTimerRef.current)
          setError('订单已超时关闭，请重新购买')
          setStep('FAILED')
          sessionStorage.removeItem('payOrder')
        }
      } catch (err) {
        // 轮询失败继续重试
      }
    }, 3000)
  }

  const handleClose = () => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current)
    }
    setStep('FORM')
    setFormData({ name: '', email: '', discountCode: '' })
    setOrderInfo(null)
    setError('')
    setQrcodeUrl('')
    onClose()
  }

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <button
          onClick={handleClose}
          className="absolute right-4 top-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <h3 className="mb-4 text-xl font-semibold text-dark">购买 {productName}</h3>

        {/* FORM 状态 */}
        {step === 'FORM' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">姓名</label>
              <input
                type="text"
                required
                maxLength={50}
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="请输入姓名"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">电子邮箱</label>
              <input
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="用于接收发货邮件"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">优惠码（可选）</label>
              <input
                type="text"
                value={formData.discountCode}
                onChange={(e) => setFormData({ ...formData, discountCode: e.target.value })}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                placeholder="如有优惠码请输入"
              />
            </div>
            <div className="rounded-md bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">商品</span>
                <span className="font-medium">{productName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">原价</span>
                <span className="font-medium">¥{price.toFixed(2)}</span>
              </div>
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-primary py-3 text-center text-base font-medium text-white hover:bg-blue-dark"
            >
              确认支付 ¥{price.toFixed(2)}
            </button>
          </form>
        )}

        {/* LOADING 状态 */}
        {step === 'LOADING' && (
          <div className="py-8 text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
            <p className="mt-4 text-gray-600">验证中...</p>
          </div>
        )}

        {/* QR_CODE / POLLING 状态 */}
        {(step === 'QR_CODE' || step === 'POLLING') && (
          <div className="text-center">
            <canvas ref={canvasRef} className="mx-auto"></canvas>
            <p className="mt-4 text-sm text-gray-600">请使用微信扫码支付</p>
            {orderInfo && (
              <div className="mt-2 rounded-md bg-gray-50 p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">订单号</span>
                  <span className="font-mono text-xs">{orderInfo.outTradeNo}</span>
                </div>
                {orderInfo.originalAmount !== orderInfo.amount && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-gray-600">原价</span>
                      <span>¥{orderInfo.originalAmount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-green-600">
                      <span>折扣</span>
                      <span>-¥{orderInfo.discountAmount.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-semibold">
                  <span>实付</span>
                  <span className="text-primary">¥{orderInfo.amount.toFixed(2)}</span>
                </div>
              </div>
            )}
            {step === 'POLLING' && (
              <p className="mt-3 text-sm text-gray-500">等待支付中...</p>
            )}
          </div>
        )}

        {/* SUCCESS 状态 */}
        {step === 'SUCCESS' && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <span className="text-3xl">✅</span>
            </div>
            <h4 className="text-lg font-semibold text-green-600">支付成功</h4>
            <p className="mt-2 text-sm text-gray-600">
              邮件5分钟内发送，请注意查收<br />
              可添加QQ群：1001627468
            </p>
            <button
              onClick={handleClose}
              className="mt-4 w-full rounded-md bg-green-600 py-3 text-center text-base font-medium text-white hover:bg-green-700"
            >
              确认关闭
            </button>
          </div>
        )}

        {/* FAILED 状态 */}
        {step === 'FAILED' && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
              <span className="text-3xl">❌</span>
            </div>
            <p className="text-sm text-red-600">{error}</p>
            <button
              onClick={() => setStep('FORM')}
              className="mt-4 w-full rounded-md bg-primary py-3 text-center text-base font-medium text-white hover:bg-blue-dark"
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 修改 Pricing.js 按钮事件**

在 Pricing.js 中，将购买按钮从 `<SmartLink>` 改为 `<button>` 并打开 PayModal：

```javascript
// themes/starter/components/Pricing.js:69-73 修改
// 替换第一个购买按钮
<button
  onClick={() => openPayModal(1)}
  className='inline-block rounded-md bg-primary px-7 py-3 text-center text-base font-medium text-white transition hover:bg-blue-dark'>
  {siteConfig('STARTER_PRICING_1_BUTTON_TEXT')}
</button>

// 类似修改第2个 (line 121-125) 和第3个 (line 165-169) 按钮
```

在 Pricing.js 组件中导出 openPayModal 函数（可在组件底部添加）：

```javascript
// 在 Pricing.js 底部添加
const [payModalVisible, setPayModalVisible] = useState(false)
const [selectedPricing, setSelectedPricing] = useState(1)

function openPayModal(index) {
  setSelectedPricing(index)
  setPayModalVisible(true)
}

export { openPayModal }
export { payModalVisible, selectedPricing }
```

然后在 Pricing 组件 return 之前添加 PayModal：

```javascript
{/* 在 Pricing 组件 return 末尾添加 */}
<PayModal
  visible={payModalVisible}
  onClose={() => setPayModalVisible(false)}
  pricingIndex={selectedPricing}
/>
```

同时在文件顶部添加 import：

```javascript
import PayModal from './PayModal'
import { useState } from 'react'
```

- [ ] **Step 3: 添加支付配置到 config.js**

在 `themes/starter/config.js` 的 CONFIG 对象中添加：

```javascript
// 支付相关配置（在 STARTER_PRICING_3_BUTTON_URL 之后添加）
STARTER_PAYMENT_ENABLE: true,                          // 支付功能开关
STARTER_PAYMENT_NOTIFY_URL: process.env.ZPAY_NOTIFY_URL, // 回调地址
```

- [ ] **Step 4: 手动测试**

```bash
pnpm dev
# 访问 http://localhost:3000
# 切换到 Starter 主题
# 点击"立即购买"按钮
# 验证弹窗显示、表单验证、二维码生成
```

- [ ] **Step 5: Commit**

```bash
git add themes/starter/components/PayModal.js themes/starter/components/Pricing.js themes/starter/config.js
git commit -m "feat(payment): add PayModal component and integrate with Pricing buttons"
```

---

## Task 8: Mock 回调测试脚本（scripts/mock-zpay-notify.js）

**Files:**

- Create: `scripts/mock-zpay-notify.js`

- [ ] **Step 1: 创建 Mock 脚本**

```javascript
// scripts/mock-zpay-notify.js
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
```

- [ ] **Step 2: 测试脚本**

```bash
# 先启动开发服务器
pnpm dev &

# 另一个终端
NOTION_TOKEN=xxx NOTION_DATABASE_ID=xxx ZPAY_KEY=xxx \
  node scripts/mock-zpay-notify.js TEST123456 29.90
```

- [ ] **Step 3: Commit**

```bash
git add scripts/mock-zpay-notify.js
git commit -m "test(payment): add mock Z-Pay notify script for local testing"
```

---

## Task 9: 安装 qrcode 依赖

- [ ] **Step 1: 安装依赖**

```bash
pnpm add qrcode @types/qrcode
```

- [ ] **Step 2: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(payment): add qrcode dependency for payment QR code rendering"
```

---

## Task 10: 端到端本地测试（本地 ngrok）

- [ ] **Step 1: 启动 ngrok**

```bash
ngrok http 3000
# 记录输出的 https URL，如 https://xxxx.ngrok.io
```

- [ ] **Step 2: 配置环境变量**

```bash
# .env.local
ZPAY_NOTIFY_URL=https://xxxx.ngrok.io/api/pay/notify
```

- [ ] **Step 3: 在 Z-Pay 商户后台临时配置回调地址为 ngrok URL**

登录 https://merchant.z-pay.cn 后台，修改异步通知地址为 ngrok URL。

- [ ] **Step 4: 完整流程测试**

```bash
pnpm dev
# 1. 访问 http://localhost:3000，切换到 Starter 主题
# 2. 点击"立即购买"
# 3. 填写姓名、邮箱（优惠码留空或填 SAVE10 测试折扣）
# 4. 确认二维码显示
# 5. 在 Z-Pay 商户后台手动触发通知，或使用 Mock 脚本
# 6. 检查 Notion 数据库有新订单记录
```

- [ ] **Step 5: 恢复生产配置**

测试完成后：

1. 将 Z-Pay 商户后台的 `notify_url` 改回 `https://www.one2agi.com/api/pay/notify`
2. `.env.local` 中的 `ZPAY_NOTIFY_URL` 改回生产地址或删除

---

## 自检清单

**1. Spec 覆盖检查：**

- [x] 优惠码查询 → Task 2（`lib/notion-discount.js`）
- [x] 订单创建 → Task 4（`create-order.js`）
- [x] 二维码展示 → Task 7（`PayModal.js` 使用 `qrcode` + Canvas）
- [x] 状态轮询 → Task 5（`query-order.js`）+ Task 7（轮询逻辑）
- [x] 回调处理 → Task 6（`notify.js`）
- [x] Notion 写入 → Task 3（`lib/notion-order.js`）
- [x] 幂等性 → Task 3（创建前检查订单号是否存在）
- [x] Mock 测试脚本 → Task 8

**2. 占位符检查：**

- 无 "TBD"、"TODO"、"implement later"
- 无 "Add appropriate error handling"（每个分支都有具体处理）
- 所有步骤都有完整代码

**3. 类型一致性检查：**

- `outTradeNo` 在所有任务中一致使用（驼峰命名）
- `createOrderPage` 参数 `{ productName, outTradeNo, email, name, amount, discountCode, tradeNo }` 在 Task 3 定义，Task 6 调用时匹配
- `lookupDiscountCode` 返回 `{ amount, name }` 在 Task 2 定义，Task 4 使用时匹配
- `STATUS_MAP` 在 Task 5 定义的映射在所有任务中一致

---

**Plan complete.** 文件已保存到 `docs/superpowers/plans/2026-06-20-payment-implementation.md`。

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**