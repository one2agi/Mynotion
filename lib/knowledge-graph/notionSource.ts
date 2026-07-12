import { getTextContent } from 'notion-utils'
import { normalizePageId } from './normalizePageId'
import type { NotionProperties, NotionRecordMap, NotionSchema } from './types'

export type KnowledgeGraphPropertyNames = {
  title: string
  slug: string
  type: string
  status: string
}

export type KnowledgeGraphSourceOptions = {
  pageId: string
  locale?: string
  notionIndex?: number
  postUrlPrefix: string
  propertyNames: KnowledgeGraphPropertyNames
  fetchDatabase(id: string, from: string): Promise<NotionRecordMap | null>
  fetchPageValues(ids: string[]): Promise<Record<string, unknown>>
}

export type GraphSourcePage = {
  id: string
  title: string
  slug: string
  href: string
  icon?: string
  type: string
  status: string
  lastEditedDate: unknown
  properties: NotionProperties
}

type SourceSchemaEntry = {
  name?: unknown
  type?: unknown
}

type SourceSchema = Record<string, SourceSchemaEntry | undefined>

type DatabaseRecordMap = NotionRecordMap & {
  collection?: Record<string, unknown>
  collection_query?: Record<string, unknown>
  collection_view?: Record<string, unknown>
}

type DatabaseData = {
  block: Record<string, unknown>
  collectionId: string
  pageIds: string[]
  schema: SourceSchema
}

const DATABASE_UNAVAILABLE = 'Knowledge graph Notion database is unavailable'

export async function fetchKnowledgeGraphSiteData(
  options: KnowledgeGraphSourceOptions
): Promise<{ allPages: GraphSourcePage[]; schema: NotionSchema }> {
  const databaseMap = await options.fetchDatabase(
    options.pageId,
    'knowledge-graph-database'
  )
  const database = readDatabase(
    databaseMap,
    options.pageId,
    options.notionIndex ?? 0
  )
  if (!database) {
    throw new TypeError(DATABASE_UNAVAILABLE)
  }

  const missingIds = database.pageIds.filter(id => !database.block[id])
  const missingValues = missingIds.length
    ? await options.fetchPageValues(missingIds)
    : {}
  const block = {
    ...database.block,
    ...normalizeRecordKeys(missingValues)
  }

  const allPages = database.pageIds.flatMap(id => {
    const value = unwrapRecordValue(block[id])
    if (!value || normalizePageId(value.parent_id) !== database.collectionId) {
      return []
    }

    return [mapPage(value, id, database.schema, options)]
  })

  return {
    allPages,
    schema: database.schema as NotionSchema
  }
}

function readDatabase(
  recordMap: NotionRecordMap | null,
  pageId: string,
  notionIndex: number
): DatabaseData | null {
  if (!recordMap || !isRecord(recordMap.block)) return null

  const block = recordMap.block
  const databaseMap = recordMap as DatabaseRecordMap
  const root = unwrapRecordValue(findRecord(block, pageId))
  if (
    !root ||
    (root.type !== 'collection_view' && root.type !== 'collection_view_page')
  ) {
    return null
  }

  const collectionId = normalizePageId(root.collection_id)
  if (!collectionId || !isRecord(databaseMap.collection)) return null

  const collection = unwrapRecordValue(
    findRecord(databaseMap.collection, collectionId)
  )
  if (!collection || !isRecord(collection.schema)) return null

  const schema = collection.schema as SourceSchema
  if (!Object.keys(schema).length) return null

  const viewId = normalizedIdAt(root.view_ids, notionIndex)
  if (!viewId) return null

  const pageIds = readPageIds(databaseMap, collectionId, viewId)
  if (!pageIds.length) return null

  return {
    block: normalizeRecordKeys(block),
    collectionId,
    pageIds,
    schema
  }
}

function readPageIds(
  recordMap: DatabaseRecordMap,
  collectionId: string,
  viewId: string
): string[] {
  const collectionQuery = findRecord(recordMap.collection_query, collectionId)
  const selectedQuery = isRecord(collectionQuery)
    ? findRecord(collectionQuery, viewId)
    : undefined

  if (isRecord(selectedQuery)) {
    const collectionGroupBlockIds =
      nestedBlockIds(selectedQuery, 'collection_group_results') ??
      nestedReducerBlockIds(selectedQuery)
    return uniqueNormalizedIds([
      collectionGroupBlockIds,
      nestedBlockIds(selectedQuery, 'results'),
      selectedQuery.blockIds
    ])
  }

  const collectionView = unwrapRecordValue(
    findRecord(recordMap.collection_view, viewId)
  )
  return collectionView ? uniqueNormalizedIds([collectionView.page_sort]) : []
}

function nestedBlockIds(value: Record<string, unknown>, key: string): unknown {
  const nested = value[key]
  return isRecord(nested) ? nested.blockIds : undefined
}

function nestedReducerBlockIds(value: Record<string, unknown>): unknown {
  const reducerResults = value.reducerResults
  if (!isRecord(reducerResults)) return undefined
  return nestedBlockIds(reducerResults, 'collection_group_results')
}

function uniqueNormalizedIds(groups: unknown[]): string[] {
  const ids = new Set<string>()

  for (const group of groups) {
    if (!Array.isArray(group)) continue
    for (const value of group) {
      const id = normalizePageId(value)
      if (id) ids.add(id)
    }
  }

  return Array.from(ids)
}

function normalizedIdAt(value: unknown, index: number): string | null {
  return Array.isArray(value) ? normalizePageId(value[index]) : null
}

function mapPage(
  value: Record<string, unknown>,
  selectedId: string,
  schema: SourceSchema,
  options: KnowledgeGraphSourceOptions
): GraphSourcePage {
  const properties = isRecord(value.properties) ? value.properties : {}
  const id = normalizePageId(value.id) || selectedId
  const title = readProperty(properties, schema, options.propertyNames.title)
  const slug = readProperty(properties, schema, options.propertyNames.slug)
  const type = readProperty(properties, schema, options.propertyNames.type)
  const status = readProperty(properties, schema, options.propertyNames.status)
  const format = isRecord(value.format) ? value.format : null
  const icon = format?.page_icon

  return {
    id,
    title,
    slug,
    href: buildHref(options.locale, options.postUrlPrefix, slug),
    ...(typeof icon === 'string' && icon ? { icon } : {}),
    type,
    status,
    lastEditedDate: value.last_edited_time,
    properties
  }
}

function readProperty(
  properties: NotionProperties,
  schema: SourceSchema,
  name: string
): string {
  const propertyId = Object.entries(schema).find(
    ([, definition]) => definition?.name === name
  )?.[0]
  if (!propertyId) return ''

  const value = properties[propertyId]
  return value === undefined
    ? ''
    : getTextContent(value as Parameters<typeof getTextContent>[0]) || ''
}

function buildHref(
  locale: string | undefined,
  postUrlPrefix: string,
  slug: string
): string {
  const parts = [locale, postUrlPrefix, slug]
    .map(part => String(part || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)

  return `/${parts.join('/')}`
}

function normalizeRecordKeys(
  record: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    const id = normalizePageId(key)
    if (id) normalized[id] = value
  }

  return normalized
}

function findRecord(
  record: Record<string, unknown> | undefined,
  id: unknown
): unknown {
  const normalizedId = normalizePageId(id)
  if (!record || !normalizedId) return undefined

  for (const [key, value] of Object.entries(record)) {
    if (normalizePageId(key) === normalizedId) return value
  }

  return undefined
}

function unwrapRecordValue(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null

  let current = value
  for (let depth = 0; depth < 3 && isRecord(current.value); depth++) {
    current = current.value
  }

  return current
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
