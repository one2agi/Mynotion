#!/usr/bin/env node
/**
 * Prebuild static asset generator.
 *
 * Why this exists:
 *   pages/index.js used to run build-time side effects inside its getStaticProps
 *   (guarded by isBuildLifecycle): generateRobotsTxt, generateRss,
 *   generateSitemapXml, checkDataFromAlgolia, generateRedirectJson.
 *
 *   We converted index.js to getServerSideProps to fix the /zh-CN.json
 *   client-router 404 (Next.js doesn't generate data files for rewritten
 *   locale source paths; see __tests__/pages/locale-routing.test.js).
 *
 *   getServerSideProps runs only at request time, so the build-time side
 *   effects would silently stop happening. This script preserves the 3
 *   critical artifacts by running them BEFORE `next build`:
 *
 *     - public/robots.txt       — read by crawlers on every request
 *     - public/rss/*.{xml,json}  — read by RSS subscribers
 *     - public/redirect.json     — read by middleware.ts at runtime
 *
 *   Two side effects were intentionally DROPPED:
 *     - generateSitemapXml    — replaced by pages/sitemap.xml.js (SSR)
 *     - checkDataFromAlgolia  — was a sync probe, no artifact
 *
 * Wired via package.json `prebuild` script. On any failure, exit 1 so the
 * `next build` step never runs with missing artifacts (which would silently
 * break middleware redirects and crawler behavior in production).
 */

import BLOG from '../blog.config.js'
import { fetchGlobalAllData } from '../lib/db/SiteDataApi.js'
import { generateRobotsTxt } from '../lib/utils/robots.txt.js'
import { generateRss, shouldGenerateRssForLocale } from '../lib/utils/rss.js'
import { generateRedirectJson } from '../lib/utils/redirect.js'

async function main() {
  const locale = BLOG.LANG
  const from = 'prebuild-static-assets'

  console.log(`[prebuild] fetching data (locale=${locale}, from=${from})`)
  const props = await fetchGlobalAllData({ from, locale })

  // Order matters slightly: redirect.json first (cheapest, no async work),
  // then robots.txt, then RSS (heaviest — fetches per-post blocks).
  generateRedirectJson(props)
  generateRobotsTxt(props)
  if (shouldGenerateRssForLocale({ locale })) {
    await generateRss(props)
  }

  console.log('[prebuild] static assets generated:')
  console.log('  - public/redirect.json')
  console.log('  - public/robots.txt')
  if (shouldGenerateRssForLocale({ locale })) {
    console.log('  - public/rss/{feed.xml, atom.xml, feed.json}')
  }
}

main().catch(err => {
  console.error('[prebuild] FAILED:', err && err.message ? err.message : err)
  if (err && err.stack) {
    console.error(err.stack)
  }
  // Halt the build so next build never runs with missing artifacts.
  // A missing redirect.json would silently break middleware UUID redirects.
  // A missing robots.txt would confuse crawlers.
  process.exit(1)
})
