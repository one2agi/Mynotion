# 支付功能集成设计文档

> **项目**：NotionNext Starter 主题支付接口接入（Z-Pay 微信支付）
> **日期**：2026-06-20
> **状态**：设计完成
> **架构版本**：v1.0
> **关联文档**：实现计划 `../plans/2026-06-20-payment-implementation.md`

---

## 1. 系统架构

### 1.1 架构总览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户浏览器                                      │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        Starter 主题 Pricing 区块                       │   │
│  │                                                                      │   │
│  │    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐            │   │
│  │    │  入门版     │   │  基础版     │   │  高级版     │            │   │
│  │    │  ¥19.9/月  │   │  ¥39.9/月  │   │  ¥59.9/月  │            │   │
│  │    │ [立即购买] │   │ [立即购买] │   │ [立即购买] │            │   │
│  │    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘            │   │
│  └─────────────┼────────────────┼────────────────┼─────────────────────┘   │
│                │                │                │                        │
│                └────────────────┴────────────────┘                        │
│                                 │                                         │
│                                 ▼                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        PayModal 支付弹窗                              │   │
│  │                                                                      │   │
│  │  状态机：FORM → LOADING → QR_CODE → POLLING → SUCCESS | FAILED      │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐     │   │
│  │  │ FORM: 姓名 / 邮箱 / 优惠码(可选)  ──[提交]──▶  LOADING    │     │   │
│  │  └─────────────────────────────────────────────────────────────┘     │   │
│  │                              │                                        │   │
│  │                              ▼                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────┐     │   │
│  │  │ QR_CODE: 二维码 Canvas + 金额明细 ──[轮询]──▶  POLLING    │     │   │
│  │  │        ↑                                                   │     │   │
│  │  │        └────────────────────────────── SUCCESS ───────────┘     │   │
│  │  └─────────────────────────────────────────────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┬────┘
                                                                         │
                    ┌─────────────────────────────────────────────────┴──┐
                    │                                                   │
                    ▼                                                   ▼
         ┌──────────────────────┐                        ┌──────────────────────┐
         │   本地开发环境         │                        │    生产环境 (EdgeOne) │
         │                      │                        │                      │
         │  pnpm dev           │                        │  pnpm build          │
         │  + ngrok tunnel     │                        │                      │
         │                      │                        │                      │
         │  POST /api/pay/     │                        │  POST /api/pay/      │
         │    create-order     │                        │    create-order      │
         │                      │                        │                      │
         │  GET /api/pay/     │                        │  GET /api/pay/       │
         │    query-order     │                        │    query-order       │
         │                      │                        │                      │
         │  POST /api/pay/   │◄─────────────────────│  POST /api/pay/      │
         │    notify          │      Z-Pay 回调       │    notify            │
         │  (ngrok → localhost)│                        │  (EdgeOne Serverless) │
         └──────────────────────┘                        └──────────────────────┘
                    │                                                   │
                    └─────────────────────┬─────────────────────────────┘
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │    Z-Pay 平台        │
                               │  (第四方支付通道)    │
                               │                      │
                               │  POST mapi.php       │
                               │    → code_url        │
                               │                      │
                               │  微信支付 Native     │
                               │  用户扫码 ──────────┼──▶ 微信支付
                               │                      │
                               │  POST notify_url     │
                               │    (异步回调)        │
                               └──────────────────────┘
                                          │
                                          ▼
                               ┌──────────────────────┐
                               │   Notion 数据库       │
                               │                      │
                               │  ┌────────────────┐  │
                               │  │ 订单库         │  │
                               │  │ 6ab4f4cf...   │  │
                               │  └────────────────┘  │
                               │                      │
                               │  ┌────────────────┐  │
                               │  │ 优惠码库       │  │
                               │  │ 3834f4cfc...  │  │
                               │  └────────────────┘  │
                               └──────────────────────┘
```

### 1.2 数据流序列图

```
用户浏览器              前端组件            API Routes           Z-Pay              Notion
   │                     │                    │                   │                   │
   │  点击购买按钮        │                    │                   │                   │
   │──────────────────▶ │                    │                   │                   │
   │                     │                    │                   │                   │
   │  显示 PayModal      │                    │                   │                   │
   │◀────────────────── │                    │                   │                   │
   │                     │                    │                   │                   │
   │  填写表单提交        │                    │                   │                   │
   │──────────────────▶ │                    │                   │                   │
   │                     │  POST /create-order                    │                   │
   │                     │────────────────────────────────▶        │                   │
   │                     │                    │                   │                   │
   │                     │                    │  验证优惠码        │                   │
   │                     │                    │────────────────────────────────▶  │
   │                     │                    │◀──────────────────────────────── │
   │                     │                    │                   │                   │
   │                     │                    │  调用 Z-Pay      │                   │
   │                     │                    │────────────────▶ │                   │
   │                     │                    │◀──────────────── │                   │
   │                     │◀────────────────────────────────    │                   │
   │                     │                    │                   │                   │
   │  显示二维码          │                    │                   │                   │
   │◀────────────────── │                    │                   │                   │
   │                     │                    │                   │                   │
   │  每3秒轮询状态       │                    │                   │                   │
   │────────────────────────────────────────────────────────────────────────▶      │
   │◀────────────────────────────────────────────────────────────────────────      │
   │                     │                    │                   │                   │
   │  (用户扫码支付...)   │                    │                   │                   │
   │                     │                    │                   │                   │
   │                     │                    │ ◄── Z-Pay 回调 ─────────────────── │
   │                     │                    │                   │                   │
   │                     │                    │  验签              │                   │
   │                     │                    │  查询 Z-Pay 确认    │                   │
   │                     │                    │────────────────────────────────▶  │
   │                     │                    │◀──────────────────────────────── │
   │                     │                    │                   │                   │
   │                     │                    │                   │  写入订单          │
   │                     │                    │                   │────────────────▶  │
   │                     │                    │                   │◀──────────────── │
   │                     │                    │                   │                   │
   │  轮询得知已支付      │                    │                   │                   │
   │────────────────────────────────────────────────────────────────────────▶      │
   │◀──────────────────────────────────────────────────────────────────────── │
   │                     │                    │                   │                   │
   │  显示支付成功        │                    │                   │                   │
   │◀────────────────── │                    │                   │                   │
```

---

## 2. API 规范

### 2.1 POST /api/pay/create-order

**用途**：验证优惠码 → 创建订单 → 获取微信支付二维码链接

**请求**：

```typescript
// POST /api/pay/create-order
// Content-Type: application/json

interface CreateOrderRequest {
  name: string           // 必填，1-50 字符
  email: string          // 必填，有效邮箱格式
  discountCode: string     // 可为空字符串
  productId: string      // 必填，starter-basic | starter-pro | starter-premium
}
```

**响应**：

```typescript
// 200 OK
interface CreateOrderResponse {
  success: true
  data: {
    outTradeNo: string     // 商户订单号，格式：NN{timestamp}{random}
    qrcode: string         // Z-Pay 返回的二维码链接（weixin://...）
    amount: number         // 实付金额（元）
    originalAmount: number // 原价（元）
    discountAmount: number // 优惠金额（元）
    productName: string   // 商品名称
  }
}

// 400 Bad Request
interface ErrorResponse {
  success: false
  error: string
  code: 'INVALID_INPUT' | 'INVALID_PRODUCT' | 'INVALID_DISCOUNT' | 'INTERNAL_ERROR'
}
```

**错误码**：
| code | HTTP | 说明 |
|------|------|------|
| `INVALID_INPUT` | 400 | 姓名或邮箱格式错误 |
| `INVALID_PRODUCT` | 400 | 商品 ID 不存在 |
| `INVALID_DISCOUNT` | 400 | 优惠码无效/已过期 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |

### 2.2 GET /api/pay/query-order

**用途**：查询订单支付状态（前端轮询 + 回调验证明细）

**请求**：

```
GET /api/pay/query-order?outTradeNo=NN1234567890ABCDEF
```

**响应**：

```typescript
// 200 OK
interface QueryOrderResponse {
  success: true
  data: {
    outTradeNo: string           // 商户订单号
    status: 'pending' | 'paid' | 'closed' | 'unknown'
    paidAt?: string              // ISO 时间，status=paid 时返回
  }
}

// 400 Bad Request
interface ErrorResponse {
  success: false
  error: string
}
```

**Z-Pay 状态映射**：
| Z-Pay trade_status | 映射结果 |
|--------------------|---------|
| `WAIT_BUYER_PAY` | `pending` |
| `TRADE_SUCCESS` | `paid` |
| `TRADE_CLOSED` | `closed` |
| 其他 | `unknown` |

### 2.3 POST /api/pay/notify

**用途**：Z-Pay 异步回调通知

**请求**（Z-Pay 服务器 POST，Content-Type: `application/x-www-form-urlencoded`）：

```
trade_no=ZPAYxxx              # Z-Pay 平台订单号
out_trade_no=NNxxx            # 商户订单号
name=基础版                    # 商品名称
money=29.90                   # 订单金额（元）
type=wxpay                    # 支付类型
trade_status=TRADE_SUCCESS     # 交易状态
param={...}                   # 附加参数 JSON
sign_type=MD5                 # 签名类型
sign=xxx                      # 签名
```

**响应**：

```
Content-Type: text/plain

success    # 验签成功，处理完成
error     # 验签失败
```

**处理流程**：

```
1. 解析 formData
2. 验签（verifySign）
   └── 失败 → 返回 "error"
3. 查询 Z-Pay 确认状态（queryOrder）
   └── 非 TRADE_SUCCESS → 返回 "success"（避免重复通知）
4. 解析 param 获取 { email, name, discountCode }
5. 写入 Notion 订单（createOrderPage）
6. 返回 "success"
```

---

## 3. 数据模型

### 3.1 Notion 订单数据库

**Database ID**：`6ab4f4cf-c8e2-825e-bde8-016c2d9be1c2`

```
┌─────────────────────────────────────────────────────────────┐
│                    订单数据库 Schema                         │
├─────────────────┬──────────────────┬─────────────────────────┤
│ 字段名          │ 类型             │ 说明                    │
├─────────────────┼──────────────────┼─────────────────────────┤
│ Name (标题)     │ title           │ 商品名称                │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 订单号          │ rich_text       │ 商户订单号 (out_trade_no) │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 客户邮箱        │ email           │ 用户邮箱                │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 姓名           │ rich_text       │ 用户姓名                │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 金额           │ number          │ 价格（元），2位小数      │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 优惠码         │ rich_text       │ 优惠码字符串，无则留空  │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 状态           │ status          │ pending / paid          │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 购买日期       │ date            │ 支付成功时间             │
├─────────────────┼──────────────────┼─────────────────────────┤
│ Z-Pay Trade No │ rich_text       │ Z-Pay 平台订单号        │
└─────────────────┴──────────────────┴─────────────────────────┘
```

### 3.2 Notion 优惠码数据库

**Database ID**：`3834f4cfc8e280d79e19c2428035c490`

```
┌─────────────────────────────────────────────────────────────┐
│                   优惠码数据库 Schema                         │
├─────────────────┬──────────────────┬─────────────────────────┤
│ 字段名          │ 类型             │ 说明                    │
├─────────────────┼──────────────────┼─────────────────────────┤
│ Name (标题)     │ title           │ 优惠码名称（如"限时10元"）│
├─────────────────┼──────────────────┼─────────────────────────┤
│ 优惠码         │ rich_text       │ 优惠码字符串，唯一键     │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 优惠金额       │ number          │ 固定减免金额（元）       │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 状态           │ status          │ active / expired        │
├─────────────────┼──────────────────┼─────────────────────────┤
│ 创建日期       │ date            │ 创建时间                 │
└─────────────────┴──────────────────┴─────────────────────────┘
```

**重要约束**：

- 优惠码类型：**固定金额折扣**，可重复使用，无过期日期检查
- 折扣计算：`实付金额 = max(0, 原价 - 优惠金额)`
  - 例：原价 39.9 - 优惠 10 = 实付 29.9
  - 例：原价 5 - 优惠 10 = 实付 0（最低为 0）

### 3.3 sessionStorage 持久化

**Key**：`payOrder`

**Value**：

```typescript
interface PayOrderData {
  outTradeNo: string
  pricingIndex: number      // 1 | 2 | 3
  productName: string
  amount: number
  createdAt: number         // Date.now()
}
```

**用途**：

- 页面刷新后恢复支付状态
- 用户关闭弹窗后重新打开可继续支付

**清除时机**：

- 支付成功后点击"确认关闭"
- 订单关闭（TRADE_CLOSED）

---

## 4. 组件设计

### 4.1 PayModal 状态机

```
┌─────────────────────────────────────────────────────────────────────┐
│                           状态机                                      │
│                                                                      │
│    ┌──────┐                                                          │
│    │CLOSED│◀─────────────────────────────────────────────────────────┤
│    └──┬───┘                                                          │
│       │ openPayModal(pricingIndex)                                    │
│       ▼                                                              │
│    ┌───────┐                                                         │
│    │ FORM │ ───[提交]──▶ ┌─────────┐                                 │
│    └───┬───┘             │ LOADING │                                 │
│        │                 └────┬────┘                                 │
│        │                      │                                       │
│        │                      ▼                                       │
│        │                 ┌─────────┐                                 │
│        │                 │ QR_CODE │ ───[开始轮询]──▶ ┌─────────┐    │
│        │                 └─────────┘                │ POLLING │    │
│        │                                           └────┬────┘    │
│        │                                                │          │
│        │         ┌──────────────────────┬──────────────┴──────────┐│
│        │         │                      │                          ││
│        │         ▼                      ▼                          ▼│
│        │    ┌─────────┐          ┌────────────┐              ┌─────────┐│
│        │    │ SUCCESS │          │  FAILED   │              │  FAILED ││
│        │    └─────────┘          └────────────┘              └─────────┘│
│        │         │                      │                          │
│        │         └──────────────────────┴──────────────────────────┘
│        │                          (onClose / 重试)
│        │                                                               │
│        └─────────────────────────────────────────────────────────────┘
│                              (确认关闭)                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**状态说明**：

| 状态        | 显示内容                         | 进入条件             |
| --------- | ---------------------------- | ---------------- |
| `FORM`    | 姓名、邮箱、优惠码表单 + 原价 + 确认按钮      | 弹窗打开、关闭弹窗后、重试    |
| `LOADING` | 旋转动画 + "验证中..."              | 表单提交后            |
| `QR_CODE` | Canvas 二维码 + 订单号 + 金额明细      | 订单创建成功           |
| `POLLING` | Canvas 二维码 + "等待支付中..."      | 开始轮询             |
| `SUCCESS` | ✅ + "邮件5分钟内发送" + QQ群号 + 关闭按钮 | 轮询得知已支付          |
| `FAILED`  | ❌ + 错误原因 + 重试按钮              | 订单创建失败/网络错误/订单关闭 |

### 4.2 组件 Props

```typescript
interface PayModalProps {
  visible: boolean      // 弹窗显示/隐藏
  onClose: () => void  // 关闭回调
  pricingIndex: number  // 套餐序号 1 | 2 | 3
}
```

### 4.3 二维码渲染

**依赖**：`qrcode` npm 包

```javascript
import QRCode from 'qrcode'

async function renderQRCode(canvas, url) {
  await QRCode.toCanvas(canvas, url, {
    width: 200,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  })
}
```

---

## 5. 安全设计

### 5.1 签名机制

**Z-Pay MD5 签名算法**：

```
1. 排除 sign 和 sign_type 参数
2. 按参数名字典序排序
3. 拼接 key=value&key=value&...
4. 末尾拼接 ZPAY_KEY
5. MD5 哈希（32位小写hex）
```

```javascript
function signParams(params) {
  const sorted = Object.keys(params)
    .filter(k => params[k] !== undefined && k !== 'sign' && k !== 'sign_type')
    .sort()
  const prestr = sorted.map(k => `${k}=${params[k]}`).join('&')
  return crypto.createHash('md5').update(prestr + ZPAY_KEY).digest('hex')
}
```

### 5.2 回调验签

```javascript
function verifySign(params) {
  const { sign, sign_type, ...rest } = params
  if (!sign) return false
  return signParams(rest) === sign
}
```

### 5.3 回调防伪造

回调处理时必须**二次查询 Z-Pay** 确认订单状态，防止伪造回调：

```javascript
// 1. 验签通过后
const zpayResult = await queryZpayOrder(outTradeNo)
if (zpayResult.tradeStatus !== 'TRADE_SUCCESS') {
  return res.status(200).type('text/plain').send('success')
}
```

### 5.4 幂等性保证

写入 Notion 前先检查订单号是否已存在：

```javascript
const existing = await notion.databases.query({
  filter: { property: '订单号', rich_text: { equals: outTradeNo } }
})
if (existing.results.length > 0) {
  return existing.results[0].id  // 已存在，返回已有 pageId
}
```

### 5.5 敏感数据保护

| 数据             | 保护方式                               |
| -------------- | ---------------------------------- |
| `ZPAY_KEY`     | 仅服务端环境变量，不暴露到前端                    |
| `NOTION_TOKEN` | 仅 API Route 使用，不暴露到前端              |
| 用户邮箱           | 通过 `param` JSON 传递（回调时返回），不存储在 URL |

---

## 6. 环境变量

### 6.1 必需变量

```bash
# Z-Pay 配置
ZPAY_PID=2026050116254529
ZPAY_KEY=FFOiGaR1bNuOzVtHcUFYjfQ97VKH5ieP
ZPAY_NOTIFY_URL=https://www.one2agi.com/api/pay/notify

# Notion 订单库
NOTION_TOKEN=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
NOTION_DATABASE_ID=6ab4f4cf-c8e2-825e-bde8-016c2d9be1c2

# Notion 优惠码库
NOTION_DISCOUNT_DATABASE_ID=3834f4cfc8e280d79e19c2428035c490
```

### 6.2 本地开发额外配置

```bash
# 本地回调地址（ngrok 隧道）
ZPAY_NOTIFY_URL=http://localhost:3000/api/pay/notify
```

---

## 7. 文件结构

```
lib/
├── zpay.js                  # Z-Pay API 封装
│   ├── signParams(params) → string
│   ├── verifySign(params) → boolean
│   ├── createNativeOrder({outTradeNo, name, money, notifyUrl, param}) → {qrcode}
│   └── queryOrder(outTradeNo) → {tradeStatus, tradeNo, money}
│
├── notion-discount.js       # Notion 优惠码查询
│   └── lookupDiscountCode(code) → {amount, name} | null
│
└── notion-order.js         # Notion 订单写入
    └── createOrderPage(orderData) → pageId

pages/api/pay/
├── create-order.js         # POST 创建订单（含优惠码验证）
├── query-order.js          # GET 查询订单状态
└── notify.js              # POST 回调处理

themes/starter/
├── components/
│   └── PayModal.js        # 支付弹窗组件
├── config.js              # 支付配置（STARTER_PAYMENT_*）
└── components/
    └── Pricing.js        # 按钮事件改造

scripts/
└── mock-zpay-notify.js   # Mock 回调测试脚本
```

---

## 8. 里程碑

| 里程碑 | 内容                   | 产出                               |
| --- | -------------------- | -------------------------------- |
| M1  | 基础下单 + 二维码展示 + 优惠码验证 | `create-order` API + `PayModal`  |
| M2  | 回调处理 + Notion 写入     | `notify` API + `notion-order.js` |
| M3  | 轮询状态 + 成功提示          | `query-order` API + 轮询逻辑         |
| M4  | 端到端测试                | ngrok 完整流程 + Mock 脚本             |
| M5  | 生产部署                 | EdgeOne 配置 + 监控                  |

---

## 9. 待定项

| 项      | 优先级  | 说明                  |
| ------ | ---- | ------------------- |
| 速率限制   | 🟡 中 | 同一 IP 5 分钟最多 10 个订单 |
| 订单超时关闭 | 🟢 低 | 15 分钟未支付自动关闭        |
| 邮件通知   | 🟢 低 | 支付成功后发邮件            |
| 退款处理   | 🟢 低 | 用户申请退款流程            |

---

**文档版本**：v1.0
**最后更新**：2026-06-20
**关联实现计划**：`../plans/2026-06-20-payment-implementation.md`
