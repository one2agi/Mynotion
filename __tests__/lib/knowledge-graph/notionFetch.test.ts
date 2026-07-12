/** @jest-environment node */

jest.mock('@/lib/db/notion/getNotionAPI', () => ({
  __esModule: true,
  default: {
    getBlocks: jest.fn(),
    getPage: jest.fn()
  }
}))
jest.mock('@/lib/utils/serverRuntime', () => ({
  delay: jest.fn(async () => undefined)
}))

import notionAPI from '@/lib/db/notion/getNotionAPI'
import {
  fetchKnowledgeGraphPageBlocks,
  fetchKnowledgeGraphPageValues
} from '@/lib/knowledge-graph/notionFetch'
import { delay } from '@/lib/utils/serverRuntime'

declare const beforeEach: (callback: () => void) => void
declare const expect: any
declare const jest: any
declare const test: (name: string, callback: () => Promise<void>) => void

const PAGE_ID = '00000000000000000000000000000001'

beforeEach(() => {
  jest.clearAllMocks()
})

test('retries a page fetch up to three attempts and returns the raw record map', async () => {
  const recordMap = { block: { [PAGE_ID]: { value: { id: PAGE_ID } } } }
  jest
    .mocked(notionAPI.getPage)
    .mockRejectedValueOnce(new Error('first failure'))
    .mockRejectedValueOnce(new Error('second failure'))
    .mockResolvedValueOnce(recordMap)

  await expect(
    fetchKnowledgeGraphPageBlocks(PAGE_ID, 'knowledge-graph-database', {
      cacheVersion: 123
    })
  ).resolves.toBe(recordMap)

  expect(notionAPI.getPage).toHaveBeenCalledTimes(3)
  expect(notionAPI.getPage).toHaveBeenCalledWith(PAGE_ID)
  expect(delay).toHaveBeenCalledTimes(2)
})

test('throws the final page-fetch error after three failed attempts', async () => {
  const finalError = new Error('third failure')
  jest
    .mocked(notionAPI.getPage)
    .mockRejectedValueOnce(new Error('first failure'))
    .mockRejectedValueOnce(new Error('second failure'))
    .mockRejectedValueOnce(finalError)

  await expect(fetchKnowledgeGraphPageBlocks(PAGE_ID)).rejects.toBe(finalError)
  expect(notionAPI.getPage).toHaveBeenCalledTimes(3)
  expect(delay).toHaveBeenCalledTimes(2)
})

test('fetches page values in batches and merges every block record', async () => {
  const ids = Array.from({ length: 31 }, (_, index) =>
    String(index + 1).padStart(32, '0')
  )
  jest
    .mocked(notionAPI.getBlocks)
    .mockResolvedValueOnce({
      recordMap: { block: { [ids[0]!]: { value: { id: ids[0] } } } }
    })
    .mockResolvedValueOnce({
      recordMap: { block: { [ids[30]!]: { value: { id: ids[30] } } } }
    })

  await expect(fetchKnowledgeGraphPageValues(ids)).resolves.toEqual({
    [ids[0]!]: { value: { id: ids[0] } },
    [ids[30]!]: { value: { id: ids[30] } }
  })
  expect(jest.mocked(notionAPI.getBlocks).mock.calls).toEqual([
    [ids.slice(0, 30)],
    [ids.slice(30)]
  ])
})

test('rejects the whole page-value fetch when any batch fails', async () => {
  const ids = Array.from({ length: 3 }, (_, index) =>
    String(index + 1).padStart(32, '0')
  )
  const batchError = new Error('batch failed')
  jest.mocked(notionAPI.getBlocks).mockResolvedValueOnce({
    recordMap: { block: { [ids[0]!]: { value: { id: ids[0] } } } }
  })
  jest.mocked(notionAPI.getBlocks).mockRejectedValueOnce(batchError)

  await expect(fetchKnowledgeGraphPageValues(ids, 2)).rejects.toBe(batchError)
  expect(notionAPI.getBlocks).toHaveBeenCalledTimes(2)
})
