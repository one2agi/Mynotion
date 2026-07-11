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

export interface PublishedPage {
  id: string
  title: string
  slug: string
  icon?: string
}

export interface PageSnapshot {
  links?: string[]
}

export type PageSnapshotMap = Record<string, PageSnapshot | undefined>

export interface GraphNode {
  id: string
  title: string
  slug: string
  icon?: string
}

export interface GraphEdge {
  source: string
  target: string
}

export interface PublicGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}
