/**
 * AbortController 工具
 *
 * 单一来源：lib/zpay.js (ESM) 和 lib/dead-letter.js (CJS) 都复用此 helper。
 * 避免在两个文件里维护字节相同的实现。
 *
 * 设计：
 * - 返回 { signal, cancel } 而非仅 AbortSignal
 * - 必须调用 cancel() 来回收 setTimeout，否则定时器会泄漏到超时时间点才回收
 * - AbortSignal.timeout() (Node 17.3+) 不可用 — jsdom 环境不支持，所以保留手写实现
 *
 * @param {number} ms - 超时毫秒数
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

module.exports = { timeoutSignal }
