export type NotionProperties = Record<string, unknown>

export interface NotionPageValue {
  properties?: NotionProperties
}

export interface NotionRecordMap {
  block?: Record<string, unknown>
}

export interface NotionSchemaEntry {
  type?: string
}

export type NotionSchema = Record<string, NotionSchemaEntry | undefined>

export interface ExtractPageLinksInput {
  pageValue?: NotionPageValue
  schema?: NotionSchema
  recordMap?: NotionRecordMap
}
