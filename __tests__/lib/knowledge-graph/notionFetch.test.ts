/** @jest-environment node */

import fixture from '../../fixtures/notion/knowledge-graph-get-blocks.json'

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

const PAGE_ID = fixture.requestedIds[0]!
const REQUESTED_IDS = fixture.requestedIds
const FIXTURE_BLOCK = fixture.response.recordMap.block as Record<
  string,
  unknown
>
const [FIRST_BLOCK_ID, SECOND_BLOCK_ID] = Object.keys(FIXTURE_BLOCK)

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
  expect(jest.mocked(delay).mock.calls).toEqual([[50], [50]])
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
  expect(jest.mocked(delay).mock.calls).toEqual([[50], [50]])
})

test('fetches real-shape page values in batches and merges every block record', async () => {
  jest
    .mocked(notionAPI.getBlocks)
    .mockResolvedValueOnce({
      recordMap: {
        block: { [FIRST_BLOCK_ID!]: FIXTURE_BLOCK[FIRST_BLOCK_ID!] }
      }
    })
    .mockResolvedValueOnce({
      recordMap: {
        block: { [SECOND_BLOCK_ID!]: FIXTURE_BLOCK[SECOND_BLOCK_ID!] }
      }
    })

  await expect(
    fetchKnowledgeGraphPageValues(REQUESTED_IDS, 1)
  ).resolves.toEqual(FIXTURE_BLOCK)
  expect(jest.mocked(notionAPI.getBlocks).mock.calls).toEqual([
    [REQUESTED_IDS.slice(0, 1)],
    [REQUESTED_IDS.slice(1)]
  ])
})

test('rejects the whole page-value fetch when any batch fails', async () => {
  const batchError = new Error('batch failed')
  jest.mocked(notionAPI.getBlocks).mockResolvedValueOnce({
    recordMap: {
      block: { [FIRST_BLOCK_ID!]: FIXTURE_BLOCK[FIRST_BLOCK_ID!] }
    }
  })
  jest.mocked(notionAPI.getBlocks).mockRejectedValueOnce(batchError)

  await expect(fetchKnowledgeGraphPageValues(REQUESTED_IDS, 1)).rejects.toBe(
    batchError
  )
  expect(notionAPI.getBlocks).toHaveBeenCalledTimes(2)
})

test('rejects a fulfilled batch with a malformed response envelope', async () => {
  jest.mocked(notionAPI.getBlocks).mockResolvedValueOnce({
    recordMap: { block: [] }
  })

  await expect(
    fetchKnowledgeGraphPageValues([REQUESTED_IDS[0]!])
  ).rejects.toThrow('Knowledge graph block batch response is malformed')
})

test('rejects a fulfilled batch that omits a requested canonical ID', async () => {
  jest.mocked(notionAPI.getBlocks).mockResolvedValueOnce({
    recordMap: {
      block: { [FIRST_BLOCK_ID!]: FIXTURE_BLOCK[FIRST_BLOCK_ID!] }
    }
  })

  await expect(fetchKnowledgeGraphPageValues(REQUESTED_IDS)).rejects.toThrow(
    'Knowledge graph block batch response is incomplete'
  )
})
