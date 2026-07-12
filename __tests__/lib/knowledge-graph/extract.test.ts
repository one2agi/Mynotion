import scopeFixture from '../../fixtures/notion/knowledge-graph-page-scope.json'
import { extractInlineMentionPageIds } from '@/lib/knowledge-graph/extract'

declare const test: (name: string, callback: () => void) => void
declare const expect: (value: unknown) => {
  toEqual(expected: unknown): void
  not: { toContain(expected: unknown): void }
}

const PAGE_ID = '00000000000000000000000000000001'
const BODY_TARGET = '00000000000000000000000000000002'
const RELATION_TARGET = '00000000000000000000000000000003'
const LEGACY_RELATION_TARGET = '00000000000000000000000000000005'

test('extracts only body page mentions and excludes root relation properties', () => {
  expect(
    extractInlineMentionPageIds({
      pageId: PAGE_ID,
      schema: { related: { type: 'relation' } },
      recordMap: {
        block: {
          [PAGE_ID]: {
            value: {
              id: PAGE_ID,
              properties: {
                related: [['Related', [['p', RELATION_TARGET]]]]
              }
            }
          },
          body: {
            value: {
              id: '00000000000000000000000000000004',
              parent_id: PAGE_ID,
              properties: {
                title: [['Mention', [['p', BODY_TARGET]]]]
              }
            }
          }
        }
      }
    })
  ).toEqual([BODY_TARGET])
})

test('ignores deleted relation decorations on the root page block', () => {
  expect(
    extractInlineMentionPageIds({
      pageId: PAGE_ID,
      schema: { related: { type: 'relation' } },
      recordMap: {
        block: {
          [PAGE_ID]: {
            value: {
              id: PAGE_ID,
              properties: {
                related: [['Related', [['p', RELATION_TARGET]]]],
                deleted_related: [
                  ['Deleted relation', [['p', LEGACY_RELATION_TARGET]]]
                ]
              }
            }
          },
          body: {
            value: {
              id: '00000000000000000000000000000004',
              parent_id: PAGE_ID,
              properties: {
                title: [['Mention', [['p', BODY_TARGET]]]]
              }
            }
          }
        }
      }
    })
  ).toEqual([BODY_TARGET])
})

test('ignores ordinary article hyperlinks', () => {
  expect(
    extractInlineMentionPageIds({
      pageId: PAGE_ID,
      schema: {},
      recordMap: {
        block: {
          [PAGE_ID]: {
            value: { id: PAGE_ID, properties: {} }
          },
          body: {
            value: {
              id: '00000000000000000000000000000004',
              parent_id: PAGE_ID,
              properties: {
                title: [['Article', [['a', '/article/target']]]]
              }
            }
          }
        }
      }
    })
  ).toEqual([])
})

test('ignores mentions from attached foreign page records', () => {
  const result = extractInlineMentionPageIds({
    pageId: scopeFixture.pageId,
    schema: { related: { type: 'relation' } },
    recordMap: scopeFixture.recordMap
  })

  expect(result).toEqual([scopeFixture.validTargetIds[0]])
  for (const falseTarget of scopeFixture.falseTargetIds) {
    expect(result).not.toContain(falseTarget)
  }
})

test('includes nested descendants and removes self links', () => {
  const recordMap = {
    block: {
      [scopeFixture.pageId]: {
        value: { id: scopeFixture.pageId, properties: {} }
      },
      '00000000000000000000000000000030': {
        value: {
          id: '00000000000000000000000000000030',
          parent_id: scopeFixture.pageId,
          properties: {}
        }
      },
      '00000000000000000000000000000031': {
        value: {
          id: '00000000000000000000000000000031',
          parent_id: '00000000000000000000000000000030',
          properties: {
            title: [
              ['Nested', [['p', scopeFixture.validTargetIds[0]]]],
              ['Self', [['p', scopeFixture.pageId]]]
            ]
          }
        }
      }
    }
  }

  expect(
    extractInlineMentionPageIds({
      pageId: scopeFixture.pageId,
      schema: {},
      recordMap
    })
  ).toEqual([scopeFixture.validTargetIds[0]])
})
