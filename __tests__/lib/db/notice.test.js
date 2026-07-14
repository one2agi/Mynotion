/**
 * Regression test for Vercel deploy failure:
 *   "Error: Error serializing `.notice` returned from `getStaticProps`"
 *
 * Root cause: when Notion API calls fail mid-build (Vercel hit this
 * because of rate limiting), the cached site data could end up without
 * a `notice` property at all (undefined). Next.js refuses to
 * JSON-serialize `undefined` and the build dies.
 *
 * Fix: lib/db/notice.js exports `normalizeNotice` and `cleanNoticeForClient`.
 * handleDataBeforeReturn in lib/db/SiteDataApi.js funnels the value
 * through `normalizeNotice()` so the property is guaranteed to be either
 * `null` or a BasePage, never `undefined`.
 *
 * This test exercises the helper directly so it stays independent of
 * SiteDataApi.js's heavy transitive dependencies (notion-client, etc.).
 */

const { normalizeNotice, cleanNoticeForClient } = require('@/lib/db/notice')

describe('normalizeNotice', () => {
  test('undefined becomes null (the Vercel bug case)', () => {
    expect(normalizeNotice(undefined)).toBeNull()
  })

  test('null stays null', () => {
    expect(normalizeNotice(null)).toBeNull()
  })

  test.each([0, '', false, NaN])('falsy non-undefined value %p becomes null', value => {
    expect(normalizeNotice(value)).toBeNull()
  })

  test('plain object passes through unchanged', () => {
    const obj = { id: 'x', title: 't' }
    expect(normalizeNotice(obj)).toBe(obj)
  })

  test('notice-like object passes through', () => {
    const obj = { id: 'n1', blockMap: { block: {} }, type: 'Notice' }
    expect(normalizeNotice(obj)).toBe(obj)
  })
})

describe('cleanNoticeForClient', () => {
  test('undefined becomes null', () => {
    expect(cleanNoticeForClient(undefined)).toBeNull()
  })

  test('null stays null', () => {
    expect(cleanNoticeForClient(null)).toBeNull()
  })

  test('object with blockMap is cleaned (id removed)', () => {
    const out = cleanNoticeForClient({ id: 'abc-123', blockMap: { block: { root: { value: {} } } } })
    expect(out).not.toBeNull()
    expect(out.id).toBeUndefined()
    expect(out.blockMap).toBeDefined()
  })

  test('object without blockMap becomes null (Vercel data path)', () => {
    expect(cleanNoticeForClient({ id: 'abc-123' })).toBeNull()
  })
})