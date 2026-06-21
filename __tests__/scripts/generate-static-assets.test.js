// __tests__/scripts/generate-static-assets.test.js
/**
 * Contract tests for the prebuild script that replaces index.js's build-time
 * side effects after its conversion to getServerSideProps.
 *
 * Why this script exists:
 *   index.js originally ran 5 build-time side effects inside its getStaticProps
 *   (guarded by isBuildLifecycle): generateRobotsTxt, generateRss,
 *   generateSitemapXml, checkDataFromAlgolia, generateRedirectJson.
 *
 *   When we converted index.js to getServerSideProps, those side effects stop
 *   running — Next.js only invokes getServerSideProps at request time, not build.
 *
 *   To preserve the 3 critical artifacts (robots.txt, rss/, redirect.json),
 *   we extracted them into scripts/generate-static-assets.mjs and wired it as
 *   a `prebuild` npm hook in package.json so it runs before `next build`.
 *
 *   The 2 droppable side effects (generateSitemapXml replaced by
 *   pages/sitemap.xml.js SSR; checkDataFromAlgolia was just a sync probe)
 *   are intentionally NOT in the prebuild script.
 */

const fs = require('fs')
const path = require('path')

const SCRIPT_PATH = path.resolve(process.cwd(), 'scripts/generate-static-assets.mjs')
const PACKAGE_JSON_PATH = path.resolve(process.cwd(), 'package.json')
const INDEX_JS_PATH = path.resolve(process.cwd(), 'pages/index.js')

describe('prebuild static asset generator (replaces index.js build-time side effects)', () => {
  describe('scripts/generate-static-assets.mjs', () => {
    let source

    beforeAll(() => {
      expect(fs.existsSync(SCRIPT_PATH)).toBe(true)
      source = fs.readFileSync(SCRIPT_PATH, 'utf8')
    })

    test('exists and is a Node ESM module (.mjs)', () => {
      expect(SCRIPT_PATH.endsWith('.mjs')).toBe(true)
    })

    test('imports the 3 critical generators', () => {
      // These 3 MUST be preserved (consumed by crawlers / middleware / RSS readers).
      // If any of these are dropped, the production deployment breaks.
      expect(source).toMatch(/^import[^;]*generateRobotsTxt/m)
      expect(source).toMatch(/^import[^;]*generateRss/m)
      expect(source).toMatch(/^import[^;]*generateRedirectJson/m)
    })

    test('does NOT import the droppable generators (sitemap.xml.js handles these)', () => {
      // sitemap.xml.js already serves dynamically via getServerSideProps
      // (no static sitemap.xml needed). checkDataFromAlgolia was a probe.
      // Only check import statements (not comments which may document the removal).
      expect(source).not.toMatch(/^import[^;]*generateSitemapXml/m)
      expect(source).not.toMatch(/^import[^;]*checkDataFromAlgolia/m)
    })

    test('calls main() and exits 1 on failure (so build halts)', () => {
      // The prebuild must fail loudly if artifacts can't be written —
      // a missing robots.txt or redirect.json would silently break
      // production (no middleware redirects, crawlers confused).
      expect(source).toMatch(/main\s*\(\s*\)/)
      expect(source).toMatch(/process\.exit\(1\)|process\.exitCode\s*=\s*1/)
    })

    test('fetches data via fetchGlobalAllData before writing artifacts', () => {
      // The generators need { siteInfo, allPages } from the same source
      // index.js used. If we skip the fetch, we'd write empty/garbage files.
      expect(source).toMatch(/fetchGlobalAllData/)
    })
  })

  describe('package.json prebuild wiring', () => {
    let pkg

    beforeAll(() => {
      pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'))
    })

    test('has a prebuild script that runs the generator before next build', () => {
      expect(pkg.scripts).toBeDefined()
      expect(pkg.scripts.prebuild).toBeDefined()
      expect(pkg.scripts.prebuild).toMatch(/generate-static-assets/)
    })

    test('build script still invokes next build (prebuild runs first via npm lifecycle)', () => {
      expect(pkg.scripts.build).toMatch(/next build/)
    })
  })

  describe('pages/index.js no longer has build-time side effects', () => {
    let source

    beforeAll(() => {
      source = fs.readFileSync(INDEX_JS_PATH, 'utf8')
    })

    test('uses getServerSideProps (not getStaticProps)', () => {
      expect(source).toMatch(/export\s+(?:async\s+)?function\s+getServerSideProps\s*\(/)
      expect(source).not.toMatch(/export\s+(?:async\s+)?function\s+getStaticProps\s*\(/)
    })

    test('no longer references dropped generators (sitemap, algolia)', () => {
      // These were the droppable side effects — index.js should be clean now
      // (all 3 critical side effects live in scripts/generate-static-assets.mjs).
      // Check imports only — comments may still mention them for documentation.
      expect(source).not.toMatch(/^import[^;]*generateSitemapXml/m)
      expect(source).not.toMatch(/^import[^;]*checkDataFromAlgolia/m)
    })

    test('no longer has isBuildLifecycle guard (no build-time logic in page module)', () => {
      // The whole isBuildLifecycle block should be gone — the page module
      // is now pure SSR, and build-time logic lives in the prebuild script.
      expect(source).not.toMatch(/isBuildLifecycle/)
    })
  })
})
