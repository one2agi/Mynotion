// __tests__/lib/cache/cache_manager.test.js
//
// 验证 cache_manager.js 的"有效缓存"判断:
// 1. 空数据(失败返的)不能被判为"可缓存"——否则 ISR 会把失败结果当成功存
// 2. 真实数据(即使 allPages:[])应能判为"可缓存"——0 篇文章是合法状态
//
// 关联 bug: fetchGlobalAllData 失败时返 {allPages:[],...},
//           原 isUsableCacheValue 对 object 永远返 true,导致空数据被缓存

import memoryCache from 'memory-cache'

jest.mock('@/lib/cache/redis_fallback', () => ({
  saveFallback: jest.fn(),
  loadFallback: jest.fn()
}))

import { isUsableCacheValue, getOrSetDataWithCache } from '@/lib/cache/cache_manager'
import { saveFallback, loadFallback } from '@/lib/cache/redis_fallback'

describe('isUsableCacheValue', () => {
  describe('基础类型', () => {
    test('null 不可用', () => {
      expect(isUsableCacheValue(null)).toBe(false)
    })

    test('undefined 不可用', () => {
      expect(isUsableCacheValue(undefined)).toBe(false)
    })

    test('空数组不可用', () => {
      expect(isUsableCacheValue([])).toBe(false)
    })

    test('非空数组可用', () => {
      expect(isUsableCacheValue([1, 2, 3])).toBe(true)
    })

    test('非空对象可用', () => {
      expect(isUsableCacheValue({ foo: 'bar' })).toBe(true)
    })

    test('字符串值可用', () => {
      expect(isUsableCacheValue('hello')).toBe(true)
    })

    test('数字 0 可用(在 fetchGlobalAllData 上下文中)', () => {
      // 注意:0 不应被判为"不可用",因为它是合法的 fetch 结果
      expect(isUsableCacheValue(0)).toBe(true)
    })
  })

  describe('全局数据形状(Notion fetchGlobalAllData 返回值)', () => {
    test('allPages:[] 应判为不可用(失败的特征)', () => {
      // 这是核心 bug:fetchGlobalAllData 失败时返 {allPages:[],siteInfo:{},...}
      // 原实现会判 true,导致空数据被缓存
      expect(isUsableCacheValue({ allPages: [] })).toBe(false)
    })

    test('allPages:[{...}] 应判为可用(真实数据)', () => {
      expect(
        isUsableCacheValue({ allPages: [{ id: '1', title: 'foo' }] })
      ).toBe(true)
    })

    test('allPages 缺失的对象视为普通对象(非空可用)', () => {
      // 没有 allPages 字段的对象属于"其他类型"数据(如单文章 blocks),
      // isUsableCacheValue 不应替调用方做"全局数据形状"判断
      expect(isUsableCacheValue({ siteInfo: {}, notice: null })).toBe(true)
    })

    test('allPages 不是数组的对象不可用(类型错误)', () => {
      expect(isUsableCacheValue({ allPages: 'not-array' })).toBe(false)
    })
  })
})

describe('getOrSetDataWithCache - stale fallback', () => {
  // 模拟只有内存缓存(无 Redis 无文件)
  jest.mock('@/blog.config', () => ({
    REDIS_URL: '',
    isProd: true,
    ENABLE_CACHE: true
  }))

  // 这些测试假设只有 MemoryCache 在 chain 里
  // (build phase 会被跳过,Redis 和 file cache 都被禁用)

  beforeEach(() => {
    // 清空内存缓存避免测试间污染
    memoryCache.clear()
  })

  afterEach(() => {
    memoryCache.clear()
  })

  test('fetch 抛错 + 有 stale 缓存 → 返回 stale(不 throw)', async () => {
    const staleData = { allPages: [{ id: 'stale' }] }
    const STALE_KEY = 'test:stale:fallback'

    // 预填 stale 缓存
    await memoryCache.put(STALE_KEY, staleData, 60_000)

    const fetchFn = jest.fn().mockRejectedValue(new Error('notion down'))

    const result = await getOrSetDataWithCache(STALE_KEY, fetchFn)

    expect(result).toEqual(staleData)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('fetch 抛错 + 无 stale 缓存 → throw', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('notion down'))
    const EMPTY_KEY = 'test:no:stale'

    await expect(getOrSetDataWithCache(EMPTY_KEY, fetchFn)).rejects.toThrow(
      'notion down'
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('fetch 返空数据({allPages:[]})→ 不缓存,下次仍 fetch', async () => {
    const EMPTY_KEY = 'test:empty:not:cached'
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce({ allPages: [] })
      .mockResolvedValueOnce({ allPages: [{ id: 'real' }] })

    // 第一次:返空数据
    const r1 = await getOrSetDataWithCache(EMPTY_KEY, fetchFn)
    expect(r1).toEqual({ allPages: [] })  // 仍然返回(不 throw)

    // 第二次:空数据没被缓存,会再次调用 fetch
    const r2 = await getOrSetDataWithCache(EMPTY_KEY, fetchFn)
    expect(r2).toEqual({ allPages: [{ id: 'real' }] })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })
})

describe('getOrSetDataWithCache - Redis fallback 接入', () => {
  // 模拟只有内存缓存 + Redis 兜底(无文件 cache)
  jest.mock('@/blog.config', () => ({
    REDIS_URL: 'redis://test',
    isProd: true,
    ENABLE_CACHE: true
  }))

  beforeEach(() => {
    memoryCache.clear()
    saveFallback.mockReset()
    loadFallback.mockReset()
  })

  afterEach(() => {
    memoryCache.clear()
  })

  test('fetch 成功后,写入 Redis fallback', async () => {
    const KEY = 'test:redis:save'
    const data = { allPages: [{ id: 'r1' }] }

    await getOrSetDataWithCache(KEY, async () => data)

    expect(saveFallback).toHaveBeenCalledWith(KEY, data)
  })

  test('fetch 失败 + Redis fallback 有数据 → 返 fallback(优先于 stale)', async () => {
    const KEY = 'test:redis:hit'
    const fbData = { allPages: [{ id: 'from-fallback' }] }
    loadFallback.mockResolvedValue(fbData)

    const fetchFn = jest.fn().mockRejectedValue(new Error('notion down'))
    const result = await getOrSetDataWithCache(KEY, fetchFn)

    expect(result).toEqual(fbData)
    expect(loadFallback).toHaveBeenCalledWith(KEY)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  test('fetch 失败 + Redis 无 fallback + 无 stale → throw', async () => {
    const KEY = 'test:redis:miss:all'
    loadFallback.mockResolvedValue(null)

    const fetchFn = jest.fn().mockRejectedValue(new Error('notion down'))
    await expect(getOrSetDataWithCache(KEY, fetchFn)).rejects.toThrow(
      'notion down'
    )
  })

  test('fetch 返空数据 → 不写 Redis fallback', async () => {
    const KEY = 'test:redis:no:save:empty'
    const fetchFn = jest.fn().mockResolvedValue({ allPages: [] })

    await getOrSetDataWithCache(KEY, fetchFn)

    expect(saveFallback).not.toHaveBeenCalled()
  })
})
