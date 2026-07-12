import { deepClone, delay } from '@/lib/utils/serverRuntime'

test('deepClone copies nested values and serializes Date values', () => {
  const source = { nested: [{ editedAt: new Date('2026-07-12T00:00:00Z') }] }
  const result = deepClone(source)

  expect(result).toEqual({
    nested: [{ editedAt: '2026-07-12T00:00:00.000Z' }]
  })
  expect(result).not.toBe(source)
  expect(result.nested).not.toBe(source.nested)
})

test('delay resolves after the requested timer fires', async () => {
  jest.useFakeTimers()
  const task = delay(25)
  jest.advanceTimersByTime(25)
  await expect(task).resolves.toBeUndefined()
  jest.useRealTimers()
})
