import mentionFixture from '../../fixtures/notion/knowledge-graph-page-mention.json'
import relationFixture from '../../fixtures/notion/knowledge-graph-relation.json'
import {
  extractMentionPageIds,
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
