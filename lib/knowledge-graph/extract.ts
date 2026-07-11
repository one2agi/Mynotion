import type {
  ExtractPageLinksInput,
  NotionPageValue,
  NotionRecordMap,
  NotionSchema
} from './types'

export const normalizePageId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const id = value.replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(id) ? id : null
}

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
  pageValue,
  schema,
  recordMap
}: ExtractPageLinksInput): string[] {
  const ids = extractMentionPageIds(recordMap || {})
  extractRelationPageIds(pageValue || {}, schema || {}).forEach(id => ids.add(id))

  return Array.from(ids).sort()
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
