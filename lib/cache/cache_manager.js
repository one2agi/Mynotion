import BLOG from '@/blog.config'
import FileCache from './local_file_cache'
import MemoryCache from './memory_cache'
import RedisCache from './redis_cache'
import { withFileLock } from './file_lock'
import { saveFallback, loadFallback } from './redis_fallback'

const cacheStats = {
  hit: 0,
  miss: 0,
  set: 0,
  error: 0,
  total: 0,
  perStore: {}
}

const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' ||
  process.env.npm_lifecycle_event === 'export'

const enableLocalCache = isBuildPhase || !BLOG.isProd
const hasRedis = !!BLOG.REDIS_URL
const inflightMap = new Map()
const BUILD_LOCK_TIMEOUT_MS = 120000
const BUILD_LOCK_MAX_WAIT_MS = 600000

/** 与 dev.config 中 ENABLE_CACHE 的多种写法兼容（boolean / JSON 字符串 / 'true'|'false'） */
function cacheReadsEnabled(force) {
  if (force) return true
  const v = BLOG.ENABLE_CACHE
  if (v === true) return true
  if (v === false) return false
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '' || s === 'false' || s === '0') return false
    if (s === 'true' || s === '1') return true
    try {
      return Boolean(JSON.parse(s))
    } catch {
      return true
    }
  }
  return Boolean(v)
}

function cacheLog(action, key, extra = '') {
  const type = getCacheType()
  console.log(
    `[Cache][${type.toUpperCase()}][pid:${process.pid}] ${action} key:${key} ${extra}`
  )
}

export function isUsableCacheValue(data) {
  if (data == null) return false
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === 'object') {
    // 全局数据形状(Notion fetchGlobalAllData 返回值):
    // 有 allPages 字段时,必须是数组才算可用
    // 防御性检查:即便 fetchGlobalAllData 失败时 catch 块可能返空对象,
    // 也能阻止"空数据"被当成功数据缓存
    if ('allPages' in data) {
      return Array.isArray(data.allPages) && data.allPages.length > 0
    }
    return Object.keys(data).length > 0
  }
  return true
}

export async function getOrSetDataWithCache(key, getDataFunction, ...getDataArgs) {
  return getOrSetDataWithCustomCache(key, null, getDataFunction, ...getDataArgs)
}

export async function getOrSetDataWithCustomCache(
  key,
  customCacheTime,
  getDataFunction,
  ...getDataArgs
) {
  const dataFromCache = await getDataFromCache(key)
  if (dataFromCache) {
    return dataFromCache
  }

  if (inflightMap.has(key)) {
    return inflightMap.get(key)
  }

  cacheLog('MISS', key, 'cache miss, fetch from source')

  if (isBuildPhase) {
    const promise = withFileLock(
      key,
      async () => {
        const doubleCheck = await getDataFromCache(key)
        if (doubleCheck) {
          cacheLog('DOUBLE-CHECK-HIT', key, 'lock holder found cached value')
          return doubleCheck
        }

        const data = await getDataFunction(...getDataArgs)
        if (isUsableCacheValue(data)) {
          await setDataToCache(key, data, customCacheTime)
          cacheLog('SET', key, 'cache stored by lock holder')
        } else {
          cacheLog('SKIP', key, 'fetch returned unusable data (empty/empty global)')
        }

        return data || null
      },
      () => getDataFromCache(key),
      {
        timeout: BUILD_LOCK_TIMEOUT_MS,
        staleLockMs: BUILD_LOCK_TIMEOUT_MS,
        timeoutStrategy: 'wait',
        maxWaitMs: BUILD_LOCK_MAX_WAIT_MS
      }
    ).catch(err => {
      cacheLog('ERROR', key, err.message)
      throw err
    })

    inflightMap.set(key, promise)
    promise.finally(() => inflightMap.delete(key))
    return promise
  }

  const promise = getDataFunction(...getDataArgs)
    .then(async data => {
      if (isUsableCacheValue(data)) {
        await setDataToCache(key, data, customCacheTime)
        // 写 Redis 长 TTL 兜底:跨容器重启仍可用
        await saveFallback(key, data)
        cacheLog('SET', key, 'cache stored')
      } else {
        cacheLog('SKIP', key, 'fetch returned unusable data (empty/empty global)')
      }

      inflightMap.delete(key)
      return data || null
    })
    .catch(async err => {
      inflightMap.delete(key)
      cacheLog('ERROR', key, err.message)
      // 失败时按"持久度优先"兜底:
      // 1. Redis fallback(7 天 TTL,跨容器重启存活) — 优先
      // 2. stale(本地内存/文件,容器重启就丢) — 次选
      const fb = await loadFallback(key)
      if (isUsableCacheValue(fb)) {
        cacheLog('REDIS-FALLBACK', key, 'returning Redis 7-day fallback')
        return fb
      }
      const stale = await getDataFromCache(key, true)
      if (isUsableCacheValue(stale)) {
        cacheLog('STALE-FALLBACK', key, 'returning last good cache')
        return stale
      }
      throw err
    })

  inflightMap.set(key, promise)
  return promise
}

export async function setDataToCache(key, data, customCacheTime) {
  if (!data) return

  const chain = getCacheChain()

  for (const { name, api } of chain) {
    try {
      await api.setCache(key, data, customCacheTime)

      cacheStats.set++
      cacheStats.perStore[name] = cacheStats.perStore[name] || { hit: 0, set: 0 }
      cacheStats.perStore[name].set++

      return
    } catch (e) {
      console.warn(`[Cache] ${name} set failed key:${key}`, e.message)
      cacheStats.error++
    }
  }

  console.warn(`[Cache] ALL set failed key:${key}`)
}

export async function getDataFromCache(key, force) {
  if (!cacheReadsEnabled(force)) return null

  cacheStats.total++
  const chain = getCacheChain()

  for (const { name, api } of chain) {
    try {
      const data = await api.getCache(key)

      if (isUsableCacheValue(data)) {
        cacheStats.hit++
        cacheStats.perStore[name] = cacheStats.perStore[name] || { hit: 0, set: 0 }
        cacheStats.perStore[name].hit++
        return data
      }
    } catch (e) {
      cacheStats.error++
      console.warn(`[Cache] ${name} get failed key:${key}`, e.message)
    }
  }

  cacheStats.miss++
  return null
}

export async function delCacheData(key) {
  const chain = getCacheChain()

  for (const { name, api } of chain) {
    try {
      await api.delCache(key)
    } catch (e) {
      console.warn(`[Cache] ${name} del failed key:${key}`, e.message)
    }
  }
}

function getCacheType() {
  if (hasRedis) return 'redis'
  if (isBuildPhase) return 'file'
  return 'memory'
}

export function getApi() {
  const type = getCacheType()

  switch (type) {
    case 'redis':
      return RedisCache
    case 'file':
      return FileCache
    default:
      return MemoryCache
  }
}

function getCacheChain() {
  const chain = []

  if (hasRedis) {
    chain.push({ name: 'redis', api: RedisCache })
  }

  if (enableLocalCache) {
    chain.push({ name: 'file', api: FileCache })
  }

  chain.push({ name: 'memory', api: MemoryCache })

  return chain
}

function printCacheSummary() {
  const hitRate = cacheStats.total
    ? ((cacheStats.hit / cacheStats.total) * 100).toFixed(1)
    : 0

  console.log('\n[Cache Summary]')
  console.log('Strategy:', getCacheChain().map(c => c.name).join(' -> '))
  console.log(
    `Stats: HIT ${hitRate}% | MISS ${cacheStats.miss} | ERROR ${cacheStats.error} | total ${cacheStats.total}`
  )
  console.log('[Per Store]')

  Object.entries(cacheStats.perStore).forEach(([name, stat]) => {
  })

  console.log('----------------------------------\n')
}

if (typeof process !== 'undefined') {
  process.on('exit', printCacheSummary)
}
