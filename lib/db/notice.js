/**
 * Defensive normalization for the optional `notice` field on site data.
 *
 * Background: Vercel deploys intermittently failed with
 *   "Error: Error serializing `.notice` returned from `getStaticProps`"
 * because when Notion API calls fail mid-build, the cached data object
 * can end up without a `notice` property at all (undefined). Next.js
 * refuses to JSON-serialize `undefined` and the build dies.
 *
 * Callers (handleDataBeforeReturn, fetchGlobalAllData) should funnel
 * the value through `normalizeNotice()` so the property is guaranteed
 * to be either `null` or a BasePage, never `undefined`.
 */

function normalizeNotice(notice) {
  if (notice && typeof notice === 'object') return notice
  return null
}

function cleanNoticeForClient(notice) {
  if (!notice || !notice.blockMap) return null
  const cleaned = { ...notice }
  if (cleaned.id) delete cleaned.id
  return cleaned
}

module.exports = { normalizeNotice, cleanNoticeForClient }