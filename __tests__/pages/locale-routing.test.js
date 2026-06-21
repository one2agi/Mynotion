// __tests__/pages/locale-routing.test.js
/**
 * Regression test: locale-prefixed JSON data endpoints (e.g. /_next/data/{buildId}/zh-CN/archive.json)
 * must NOT 404.
 *
 * Bug history (2026-06-21):
 *   next.config.js uses rewrites to strip the locale prefix:
 *     /:locale(zh-CN|en)/:path*  →  /:path*
 *   Rewrites work for HTML (runtime) but NOT for pre-generated JSON data files (build time).
 *   Next.js only generates data files for actual page file paths, not for rewritten source paths.
 *   Result: visiting /zh-CN/archive triggers client-side router prefetch of
 *     /_next/data/{buildId}/zh-CN/archive.json → 404 → SPA navigation falls back to full reload.
 *
 * Fix (Plan B): convert affected pages from getStaticProps (pre-build JSON) to
 * getServerSideProps (runtime SSR — no pre-built JSON file lookup needed).
 *
 * This test asserts the structural contract:
 *   - Page MUST export getServerSideProps
 *   - Page MUST NOT export getStaticProps (would re-introduce the bug)
 */

const fs = require('fs')
const path = require('path')

// Pages accessed via /zh-CN/* that previously 404'd on their JSON data endpoint.
// Each must use getServerSideProps so Next.js SSRs at request time (no pre-built JSON needed).
const PAGES_REQUIRING_SSR = [
  // Confirmed 404 from production logs (2026-06-21 EdgeOne function logs):
  'pages/index.js', // /zh-CN.json  → 404
  'pages/archive/index.js', // /zh-CN/archive.json → 404

  // Same root cause (rewrites + getStaticProps → no JSON file at /zh-CN/* path):
  'pages/page/[page].js', // /zh-CN/page/N.json → 404
  'pages/dashboard/[[...index]].js' // /zh-CN/dashboard.json → 404
]

const HAS_GET_SERVER_SIDE_PROPS = /export\s+(?:async\s+)?function\s+getServerSideProps\s*\(/
const HAS_GET_STATIC_PROPS = /export\s+(?:async\s+)?function\s+getStaticProps\s*\(/

describe('locale JSON 404 fix: pages accessed via /zh-CN/* must use SSR', () => {
  describe.each(PAGES_REQUIRING_SSR)('page %s', pagePath => {
    let source

    beforeAll(() => {
      const fullPath = path.resolve(process.cwd(), pagePath)
      source = fs.readFileSync(fullPath, 'utf8')
    })

    test('exports getServerSideProps (so Next.js SSRs and skips JSON data file lookup)', () => {
      expect(source).toMatch(HAS_GET_SERVER_SIDE_PROPS)
    })

    test('does NOT export getStaticProps (would re-introduce the JSON 404 bug)', () => {
      expect(source).not.toMatch(HAS_GET_STATIC_PROPS)
    })
  })
})
