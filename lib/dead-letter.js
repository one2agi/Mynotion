/**
 * Dead Letter Webhook — 失败订单通知器
 *
 * 替代旧的 writeDeadLetter 文件方案。原方案把失败订单写到 /tmp/orders-failed.json
 * （EdgeOne serverless），但 EdgeOne Pages 是 Vercel 兼容的 serverless 运行时，
 * 无 SSH、无 shell、无控制台读容器文件能力，运营无法人工读出补单。
 *
 * 修复：改为 webhook 推送。createOrderPage 失败时把 entry 推送到配置的 webhook 端点，
 * 运营在外部系统（faiz.one2agi.com 后台）看。
 *
 * 核心契约：notifyDeadLetter MUST NEVER reject
 * --------------------------------------------------
 * createOrderPage 的 catch 块 await notifyDeadLetter(entry)，如果这里 reject
 * 会冒泡到外层，破坏 createOrderPage 的 "MUST NOT throw" 契约。
 * notify.js 依赖此契约正确返回 success/error 给 Z-Pay。
 *
 * 失败处理策略：
 * - env 缺失 → console.error 一次后 silent return（不抛错、不重试）
 * - 4xx（401/403/404）→ 不重试，console.error 后 silent return（配置错误重试无意义）
 * - 5xx / 429 / 网络错误 / 超时 → 内部重试 2 次（共 3 次总尝试）
 * - 重试间隔 200ms / 400ms（参考 lib/with-retry.js 的指数退避节奏）
 * - 单次请求 5s 超时（沿用 lib/zpay.js 的 timeoutSignal 模式）
 * - 所有失败 → console.error 后 silent return（永不 reject）
 *
 * 最坏延迟：5s × 3 + 200ms + 400ms ≈ 15.4s
 * notify.js 调用方需接受此延迟（Z-Pay 通知超时通常 30s，可接受）。
 * 未来若延迟成问题可改 fire-and-forget：void notifyDeadLetter(entry)
 */

// 注意：env 必须在函数体内读取，不能用 module 顶层 const
// 否则 test setup 设 env（beforeEach）晚于 require，模块常量已被锁定
const REQUEST_TIMEOUT_MS = 5000
const MAX_ATTEMPTS = 3 // 1 初始 + 2 重试
const RETRY_BACKOFFS_MS = [200, 400] // attempt 2 等待 200ms，attempt 3 等待 400ms

/**
 * 复用 lib/zpay.js 的 timeoutSignal 模式：AbortController + setTimeout
 * 不可直接 import 因为 zpay.js 是 ESM 导出。
 * @param {number} ms
 * @returns {{ signal: AbortSignal, cancel: () => void }}
 */
function timeoutSignal(ms) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer)
  }
}

/**
 * 判断 HTTP 状态码是否值得重试
 * 4xx 中只有 429 (rate limit) 重试，其他 4xx（401/403/404 等）配置错误不重试
 * 5xx 全部重试（瞬时服务器错误）
 * 2xx/3xx 不应到这里（2xx 提前 return，3xx fetch 默认跟随重定向）
 * @param {number} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  // 429 单独处理：rate limit 应当重试
  if (status === 429) return true
  // 其他 4xx 不重试
  if (status >= 400 && status < 500) return false
  // 5xx 重试
  return status >= 500
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 推送一条死信到外部 webhook。**永不 reject**。
 * @param {Object} entry
 * @param {string} entry.timestamp - ISO 字符串
 * @param {string} entry.outTradeNo - 商户订单号
 * @param {Object} entry.orderData - createOrderPage 的入参快照
 * @param {string} entry.error - 错误 message
 * @param {string} entry.stack - 错误 stack
 * @returns {Promise<void>}
 */
async function notifyDeadLetter(entry) {
  // env 必须在函数体内读取（不要用 module 顶层 const，否则测试 setup 失效）
  const webhookUrl = process.env.DEAD_LETTER_WEBHOOK_URL
  const webhookToken = process.env.DEAD_LETTER_WEBHOOK_TOKEN

  // env 缺失：log 一次后 silent return
  // 生产环境漏配不能阻塞 createOrderPage；监控靠 EdgeOne 函数日志告警
  if (!webhookUrl || !webhookToken) {
    console.error('[dead-letter] env 未配置，跳过 webhook 推送', {
      hasUrl: Boolean(webhookUrl),
      hasToken: Boolean(webhookToken),
      outTradeNo: entry?.outTradeNo
    })
    return
  }

  const body = JSON.stringify({
    text: JSON.stringify(entry),
    mode: 'now'
  })

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const timeout = timeoutSignal(REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${webhookToken}`
        },
        body,
        signal: timeout.signal
      })

      if (response.ok) {
        // 2xx 成功
        return
      }

      const status = response.status
      if (!isRetryableStatus(status) || attempt === MAX_ATTEMPTS) {
        // 4xx 不重试，或已达最大重试次数 → 放弃
        console.error('[dead-letter] webhook 非 2xx，已放弃', {
          status,
          attempt,
          outTradeNo: entry?.outTradeNo
        })
        return
      }
      // 5xx / 429 → 重试
      await sleep(RETRY_BACKOFFS_MS[attempt - 1])
    } catch (err) {
      // 网络错误 / AbortError（超时）
      if (attempt === MAX_ATTEMPTS) {
        console.error('[dead-letter] webhook 调用失败，已放弃', {
          error: err.message,
          name: err.name,
          attempt,
          outTradeNo: entry?.outTradeNo
        })
        return
      }
      await sleep(RETRY_BACKOFFS_MS[attempt - 1])
    } finally {
      // 关键：避免 setTimeout 在请求完成（成功/失败）后泄漏
      timeout.cancel()
    }
  }
}

module.exports = { notifyDeadLetter }
