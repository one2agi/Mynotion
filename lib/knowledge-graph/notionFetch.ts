import notionAPI from '@/lib/db/notion/getNotionAPI'
import { delay } from '@/lib/utils/serverRuntime'
import type { NotionRecordMap } from './types'

const PAGE_FETCH_ATTEMPTS = 3
const RETRY_DELAY_MS = 50

type PageFetchOptions = {
  cacheVersion?: string | number | Date
}

export async function fetchKnowledgeGraphPageBlocks(
  id: string,
  _from?: string,
  _options?: PageFetchOptions
): Promise<NotionRecordMap | null> {
  for (let attempt = 1; attempt <= PAGE_FETCH_ATTEMPTS; attempt++) {
    try {
      return (await notionAPI.getPage(id)) as NotionRecordMap | null
    } catch (error) {
      if (attempt === PAGE_FETCH_ATTEMPTS) throw error
      await delay(RETRY_DELAY_MS)
    }
  }

  throw new Error('Knowledge graph page fetch exhausted unexpectedly')
}

export async function fetchKnowledgeGraphPageValues(
  ids: string[],
  batchSize = 30
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new TypeError('Knowledge graph batch size must be a positive integer')
  }

  const values: Record<string, unknown> = {}

  for (let index = 0; index < ids.length; index += batchSize) {
    const pageChunk: unknown = await notionAPI.getBlocks(
      ids.slice(index, index + batchSize)
    )
    const recordMap = isRecord(pageChunk) ? pageChunk.recordMap : undefined
    const blocks = isRecord(recordMap) ? recordMap.block : undefined
    if (isRecord(blocks)) Object.assign(values, blocks)
  }

  return values
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
