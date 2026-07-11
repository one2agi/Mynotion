import mentionFixture from '../../fixtures/notion/knowledge-graph-page-mention.json'
import relationFixture from '../../fixtures/notion/knowledge-graph-relation.json'
import {
  extractMentionPageIds,
  extractPageLinks,
  extractRelationPageIds
} from '@/lib/knowledge-graph/extract'

declare const test: (name: string, callback: () => void) => void
declare const expect: (value: unknown) => { toEqual(expected: unknown): void }

test('extracts the real page mention target', () => {
  expect(Array.from(extractMentionPageIds(mentionFixture.recordMap))).toEqual([
    mentionFixture.expectedTargetId
  ])
})

test('extracts relation page ids from the real property shape', () => {
  expect(
    Array.from(extractRelationPageIds(relationFixture.page, relationFixture.schema))
  ).toEqual(relationFixture.expectedTargetIds)
})

test('merges, deduplicates, and sorts page links deterministically', () => {
  const mentionProperty = Object.values(mentionFixture.recordMap.block)[0]!
    .value.properties.title
  const input = {
    recordMap: mentionFixture.recordMap,
    pageValue: {
      properties: {
        related: [
          ...relationFixture.page.properties.related,
          ...mentionProperty
        ]
      }
    },
    schema: relationFixture.schema
  }
  const expected = [
    relationFixture.expectedTargetIds[0]!,
    mentionFixture.expectedTargetId
  ]

  expect(extractPageLinks(input)).toEqual(expected)
  expect(extractPageLinks(input)).toEqual(expected)
})

test('ignores UUID-looking ordinary text', () => {
  expect(
    extractMentionPageIds({
      block: {
        ordinaryText: {
          value: {
            properties: {
              title: [['0000000000000000000000000000000a']]
            }
          }
        }
      }
    })
  ).toEqual(new Set())
})

test('ignores decorated page ids in non-relation properties', () => {
  expect(
    extractRelationPageIds(relationFixture.page, {
      related: { type: 'text' }
    })
  ).toEqual(new Set())
})

test('ignores invalid page ids in mention and relation decorations', () => {
  const invalidRichText = [
    [
      'Invalid page id',
      [['p', '00000000-0000-0000-0000-00000000000g']]
    ]
  ]

  expect(
    extractPageLinks({
      recordMap: {
        block: {
          invalidMention: {
            value: { properties: { title: invalidRichText } }
          }
        }
      },
      pageValue: { properties: { related: invalidRichText } },
      schema: { related: { type: 'relation' } }
    })
  ).toEqual([])
})
