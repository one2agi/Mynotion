import type {
  ExtractPageLinksInput,
  NotionPageValue,
  NotionRecordMap,
  NotionSchema
} from './types'
import { normalizePageId } from './normalizePageId'

export { normalizePageId }

export function extractMentionPageIds(recordMap: NotionRecordMap): Set<string> {
  const ids = new Set<string>()

  for (const block of Object.values(recordMap?.block || {})) {
    const value = unwrapBlockValue(block)
    for (const property of Object.values(value?.properties || {})) {
      collectMentionPageIds(property, ids)
    }
  }

  return ids
}

export function extractRelationPageIds(
  pageValue: NotionPageValue,
  schema: NotionSchema
): Set<string> {
  const ids = new Set<string>()

  for (const [property, definition] of Object.entries(schema || {})) {
    if (definition?.type === 'relation') {
      collectMentionPageIds(pageValue?.properties?.[property], ids)
    }
  }

  return ids
}

export function extractPageLinks({
  pageId,
  pageValue,
  schema,
  recordMap
}: ExtractPageLinksInput): string[] {
  const normalizedPageId = normalizePageId(pageId)
  const blocks = normalizedBlocks(recordMap || {})
  const ids = new Set<string>()

  if (normalizedPageId) {
    blocks.forEach(block => {
      if (!blockBelongsToPage(block, normalizedPageId, blocks)) return
      for (const property of Object.values(block.properties || {})) {
        collectMentionPageIds(property, ids)
      }
    })
  }

  extractRelationPageIds(pageValue || {}, schema || {}).forEach(id =>
    ids.add(id)
  )
  if (normalizedPageId) ids.delete(normalizedPageId)

  return Array.from(ids).sort()
}

function blockBelongsToPage(
  block: NotionPageValue,
  pageId: string,
  blocks: Map<string, NotionPageValue>
): boolean {
  let current: NotionPageValue | undefined = block
  const visited = new Set<string>()

  while (current) {
    const currentId = normalizePageId(current.id)
    if (currentId === pageId) return true

    const parentId = normalizePageId(current.parent_id)
    if (!parentId || visited.has(parentId)) return false
    visited.add(parentId)
    current = blocks.get(parentId)
  }

  return false
}

function normalizedBlocks(
  recordMap: NotionRecordMap
): Map<string, NotionPageValue> {
  const blocks = new Map<string, NotionPageValue>()

  for (const block of Object.values(recordMap.block || {})) {
    const value = unwrapBlockValue(block)
    const id = normalizePageId(value?.id)
    if (value && id) blocks.set(id, value)
  }

  return blocks
}

function collectMentionPageIds(value: unknown, ids: Set<string>): void {
  if (!Array.isArray(value)) return

  if (value[0] === 'p') {
    const id = normalizePageId(value[1])
    if (id) ids.add(id)
  }

  for (const item of value) {
    collectMentionPageIds(item, ids)
  }
}

function unwrapBlockValue(value: unknown): NotionPageValue | null {
  if (!isRecord(value)) return null

  let block = value
  while (isRecord(block.value)) {
    block = block.value
  }

  return block as NotionPageValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
