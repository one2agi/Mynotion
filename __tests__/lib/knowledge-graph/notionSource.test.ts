import fixture from '../../fixtures/notion/knowledge-graph-database.json'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'

declare const jest: any
declare const test: any
declare const expect: any

jest.mock('notion-utils', () => ({
  getTextContent: (value: unknown) =>
    Array.isArray(value)
      ? value.reduce(
          (text, item) =>
            text +
            (Array.isArray(item) && item[0] !== '⁍' && item[0] !== '‣'
              ? item[0] || ''
              : ''),
          ''
        )
      : value || ''
}))

const propertyNames = {
  title: 'title',
  slug: 'slug',
  type: 'type',
  status: 'status'
}

const COLLECTION_ID = '00000000000000000000000000000011'
const DEFAULT_VIEW_ID = '00000000-0000-0000-0000-000000000012'
const SECOND_VIEW_ID = '00000000-0000-0000-0000-000000000013'

const cloneFixtureMap = () => JSON.parse(JSON.stringify(fixture.recordMap))

test('maps article metadata and preserves raw Relation values', async () => {
  const fetchDatabase = jest.fn(async () => fixture.recordMap)
  const fetchPageValues = jest.fn(async () => fixture.missingPageValues)

  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    locale: 'zh-CN',
    postUrlPrefix: '/article/',
    propertyNames,
    fetchDatabase,
    fetchPageValues
  })

  expect(fetchDatabase).toHaveBeenCalledWith(
    fixture.databaseId,
    'knowledge-graph-database'
  )
  expect(fetchPageValues).toHaveBeenCalledWith([fixture.expected.targetId])
  expect(result.schema.related).toEqual({
    name: '相关引用',
    type: 'relation'
  })
  expect(result.allPages).toHaveLength(2)
  expect(result.allPages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.expected.sourceId,
        title: fixture.expected.title,
        slug: fixture.expected.slug,
        href: '/zh-CN/article/' + fixture.expected.slug,
        icon: '/sanitized-icon.png',
        type: 'Post',
        status: 'Published',
        lastEditedDate: 1700000000000,
        properties: expect.objectContaining({
          related: fixture.expected.relationValue
        })
      }),
      expect.objectContaining({
        id: fixture.expected.targetId,
        href: '/zh-CN/article/sanitized-target'
      })
    ])
  )
  expect(result.allPages.map(page => page.id)).not.toContain(
    fixture.expected.fallbackOnlyId
  )
})

test('falls back to page_sort only when the selected query is unavailable', async () => {
  const recordMap = cloneFixtureMap()
  delete recordMap.collection_query
  recordMap.collection_view[
    '00000000000000000000000000000012'
  ].value.value.page_sort = [
    fixture.expected.sourceId,
    fixture.expected.targetId
  ]

  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    postUrlPrefix: 'article',
    propertyNames,
    fetchDatabase: async () => recordMap,
    fetchPageValues: async () => fixture.missingPageValues
  })

  expect(result.allPages.map(page => page.id)).toEqual([
    fixture.expected.sourceId,
    fixture.expected.targetId
  ])
})

test('selects a non-default configured database view', async () => {
  const recordMap = cloneFixtureMap()
  recordMap.block['00000000000000000000000000000010'].value.value.view_ids.push(
    SECOND_VIEW_ID
  )
  recordMap.collection_query[COLLECTION_ID][SECOND_VIEW_ID] = {
    collection_group_results: {
      blockIds: [fixture.expected.targetId]
    }
  }
  const fetchPageValues = jest.fn(async () => fixture.missingPageValues)

  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    notionIndex: 1,
    postUrlPrefix: 'article',
    propertyNames,
    fetchDatabase: async () => recordMap,
    fetchPageValues
  })

  expect(fetchPageValues).toHaveBeenCalledWith([fixture.expected.targetId])
  expect(result.allPages.map(page => page.id)).toEqual([
    fixture.expected.targetId
  ])
})

test('does not union reducer page ids into direct query results', async () => {
  const recordMap = cloneFixtureMap()
  recordMap.collection_query[COLLECTION_ID][DEFAULT_VIEW_ID] = {
    collection_group_results: {
      blockIds: [fixture.expected.sourceId]
    },
    reducerResults: {
      collection_group_results: {
        blockIds: [fixture.expected.targetId]
      }
    }
  }
  const fetchPageValues = jest.fn(async () => fixture.missingPageValues)

  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    postUrlPrefix: 'article',
    propertyNames,
    fetchDatabase: async () => recordMap,
    fetchPageValues
  })

  expect(fetchPageValues).not.toHaveBeenCalled()
  expect(result.allPages.map(page => page.id)).toEqual([
    fixture.expected.sourceId
  ])
})

test('uses reducer page ids when direct query results have no ids', async () => {
  const recordMap = cloneFixtureMap()
  recordMap.collection_query[COLLECTION_ID][DEFAULT_VIEW_ID] = {
    collection_group_results: { blockIds: [] },
    results: { blockIds: [] },
    blockIds: [],
    reducerResults: {
      collection_group_results: {
        blockIds: [fixture.expected.targetId]
      }
    }
  }

  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    postUrlPrefix: 'article',
    propertyNames,
    fetchDatabase: async () => recordMap,
    fetchPageValues: async () => fixture.missingPageValues
  })

  expect(result.allPages.map(page => page.id)).toEqual([
    fixture.expected.targetId
  ])
})

test.each([
  ['missing root', { block: {} }],
  [
    'missing collection',
    (() => {
      const recordMap = cloneFixtureMap()
      delete recordMap.collection
      return recordMap
    })()
  ],
  [
    'missing schema',
    (() => {
      const recordMap = cloneFixtureMap()
      delete recordMap.collection['00000000-0000-0000-0000-000000000011'].value
        .value.schema
      return recordMap
    })()
  ],
  [
    'missing page ids',
    (() => {
      const recordMap = cloneFixtureMap()
      recordMap.collection_query['00000000000000000000000000000011'][
        '00000000-0000-0000-0000-000000000012'
      ] = {
        collection_group_results: { blockIds: [] }
      }
      return recordMap
    })()
  ]
])(
  'fails explicitly for an invalid database: %s',
  async (_name: string, recordMap: { block?: Record<string, unknown> }) => {
    await expect(
      fetchKnowledgeGraphSiteData({
        pageId: fixture.databaseId,
        postUrlPrefix: 'article',
        propertyNames,
        fetchDatabase: async () => recordMap,
        fetchPageValues: async () => ({})
      })
    ).rejects.toThrow('Knowledge graph Notion database is unavailable')
  }
)

test('fails when the configured page is not a database', async () => {
  const recordMap = cloneFixtureMap()
  recordMap.block['00000000000000000000000000000010'].value.value.type = 'page'

  await expect(
    fetchKnowledgeGraphSiteData({
      pageId: fixture.databaseId,
      postUrlPrefix: 'article',
      propertyNames,
      fetchDatabase: async () => recordMap,
      fetchPageValues: async () => ({})
    })
  ).rejects.toThrow('Knowledge graph Notion database is unavailable')
})
