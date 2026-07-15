import { NotionAPI as NotionLibrary } from 'notion-client'
import BLOG from '@/blog.config'
import path from 'path'
import { RateLimiter } from './RateLimiter'
import {
  getNotionBuildRateMaxPerMinute,
  getNotionBuildRateMinIntervalMs,
  logBuildEnvSummary
} from '@/lib/build/buildEnv'
import {
  DEFAULT_PROXY_CIRCUIT_MS,
  createNotionTransport
} from './notionTransport'

const DIRECT_NOTION_API_BASE_URL = 'https://www.notion.so/api/v3'
const DEFAULT_PROXY_TIMEOUT_MS = 6000

// 限流配置，打包编译阶段避免接口频繁，限制频率
const useRateLimiter = process.env.BUILD_MODE || process.env.EXPORT
const lockFilePath = path.resolve(process.cwd(), '.notion-api-lock')
const rateLimiter = new RateLimiter(
  getNotionBuildRateMaxPerMinute(),
  lockFilePath,
  getNotionBuildRateMinIntervalMs()
)
if (useRateLimiter) {
  logBuildEnvSummary()
}

const globalStore = { transport: null, inflight: new Map() }

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.floor(parsed)))
}

function createClient(apiBaseUrl, { proxyToken, timeout } = {}) {
  const ofetchOptions = proxyToken
    ? {
        timeout,
        headers: { 'x-notion-proxy-token': proxyToken }
      }
    : undefined

  return new NotionLibrary({
    apiBaseUrl,
    activeUser: BLOG.NOTION_ACTIVE_USER || null,
    authToken: BLOG.NOTION_TOKEN_V2 || null,
    userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(ofetchOptions ? { ofetchOptions } : {})
  })
}

function getNotionTransport() {
  if (!globalStore.transport) {
    const proxyUrl = normalizeBaseUrl(process.env.NOTION_API_PROXY_URL)
    const proxyToken = String(
      process.env.NOTION_API_PROXY_TOKEN || ''
    ).trim()
    const proxyEnabled = Boolean(proxyUrl && proxyToken)
    const directBaseUrl = proxyEnabled
      ? DIRECT_NOTION_API_BASE_URL
      : normalizeBaseUrl(BLOG.API_BASE_URL) || DIRECT_NOTION_API_BASE_URL

    const directClient = createClient(directBaseUrl)
    const proxyClient = proxyEnabled
      ? createClient(proxyUrl, {
          proxyToken,
          timeout: boundedNumber(
            process.env.NOTION_API_PROXY_TIMEOUT_MS,
            DEFAULT_PROXY_TIMEOUT_MS,
            1000,
            30000
          )
        })
      : null

    globalStore.transport = createNotionTransport({
      proxyClient,
      directClient,
      proxyEnabled,
      circuitMs: boundedNumber(
        process.env.NOTION_API_PROXY_CIRCUIT_MS,
        DEFAULT_PROXY_CIRCUIT_MS,
        1000,
        600000
      )
    })
  }
  return globalStore.transport
}

async function callNotion(methodName, ...args) {
  const transport = getNotionTransport()

  const key = `${methodName}-${JSON.stringify(args)}`

  if (globalStore.inflight.has(key)) return globalStore.inflight.get(key)

  // 注意：原函数已返回 Promise，不需要再 async 包一层
  const execute = () => transport.call(methodName, ...args)
  const promise = useRateLimiter
    ? rateLimiter.enqueue(key, execute)
    : Promise.resolve().then(execute)

  globalStore.inflight.set(key, promise)
  // 始终把 inflight 清掉；即便上层不消费 reject 也不抛 unhandledRejection
  promise
    .catch(() => {})
    .finally(() => globalStore.inflight.delete(key))
  return promise
}

export const notionAPI = {
  getPage: (...args) => callNotion('getPage', ...args),
  getBlocks: (...args) => callNotion('getBlocks', ...args),
  getSignedFileUrls: (...args) => callNotion('getSignedFileUrls', ...args),
  getUsers: (...args) => callNotion('getUsers', ...args),
  __call: callNotion
}

export default notionAPI
