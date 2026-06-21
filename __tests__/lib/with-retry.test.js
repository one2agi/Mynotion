// __tests__/lib/with-retry.test.js
const { withRetry } = require('@/lib/with-retry')

describe('withRetry helper', () => {
  test('成功后不再重试', async () => {
    const fn = jest.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('4 次尝试（1 初始 + 3 重试）后抛错', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))
    await expect(withRetry(fn)).rejects.toThrow('fail')
    expect(fn).toHaveBeenCalledTimes(4)
  })

  test('成功后返回值正确传递', async () => {
    const fn = jest.fn().mockResolvedValue({ data: 'complex-object' })
    const result = await withRetry(fn)
    expect(result).toEqual({ data: 'complex-object' })
  })

  test('失败 2 次后第 3 次成功', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient 1'))
      .mockRejectedValueOnce(new Error('transient 2'))
      .mockResolvedValueOnce('recovered')

    const result = await withRetry(fn)
    expect(result).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('可自定义重试次数', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))
    await expect(withRetry(fn, { retries: 1 })).rejects.toThrow('fail')
    expect(fn).toHaveBeenCalledTimes(2) // 1 initial + 1 retry
  })

  test('可自定义基础间隔（用极小值加速测试）', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'))
    const start = Date.now()
    await expect(withRetry(fn, { retries: 2, baseMs: 1 })).rejects.toThrow('fail')
    const elapsed = Date.now() - start
    // 1ms + 2ms = 3ms 退避时间，测试应该 < 100ms 完成
    expect(elapsed).toBeLessThan(100)
  })
})
