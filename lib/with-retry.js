/**
 * 通用指数退避重试 helper
 * 用于包装 Notion API、第三方 HTTP 调用等可能瞬时失败的异步操作。
 *
 * 设计原则：
 * - 捕获所有错误统一重试（避免对错误类型分类不当）
 * - 默认 3 次重试（4 次总尝试），间隔 200ms / 400ms / 800ms，总耗时 < 2s
 * - 重试耗尽后抛最后一次错误给调用方
 *
 * @param {Function} fn - 异步函数
 * @param {Object} [options]
 * @param {number} [options.retries=3] - 重试次数（不含首次）
 * @param {number} [options.baseMs=200] - 基础间隔（毫秒）
 * @returns {Promise<*>} 函数返回值
 * @throws 重试耗尽后抛最后一次错误
 */
async function withRetry(fn, { retries = 3, baseMs = 200 } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        const delay = baseMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  throw lastError
}

module.exports = { withRetry }
