const fs = require('fs')
const path = require('path')
const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

// [prefix] routes delegate to getStaticPathsBase() which returns fallback: 'blocking';
// they are covered by __tests__/lib/staticPaths.test.js instead of a direct source check.
const blockingFallbackPages = [
  'pages/tag/[tag]/index.js',
  'pages/tag/[tag]/page/[page].js',
  'pages/category/[category]/index.js',
  'pages/category/[category]/page/[page].js',
  'pages/search/[keyword]/index.js',
  'pages/search/[keyword]/page/[page].js'
]

describe('public dynamic SSG routes', () => {
  test.each(blockingFallbackPages)('%s uses blocking fallback', file => {
    const source = read(file)
    expect(source).toMatch(/fallback:\s*['"]blocking['"]/)
    expect(source).not.toMatch(/fallback:\s*true/)
  })
})

describe('landing build excludes every dynamic content path', () => {
  const dynamicContentFiles = [
    'pages/page/[page].js',
    'pages/tag/[tag]/index.js',
    'pages/tag/[tag]/page/[page].js',
    'pages/category/[category]/index.js',
    'pages/category/[category]/page/[page].js',
    'pages/search/[keyword]/index.js',
    'pages/search/[keyword]/page/[page].js'
  ]

  test.each(dynamicContentFiles)('%s uses the landing-only path gate', file => {
    expect(read(file)).toContain('getLandingOnlyStaticPaths')
  })
})

const allPublicIsrPages = [
  'pages/index.js',
  'pages/archive/index.js',
  'pages/page/[page].js',
  'pages/[prefix]/index.js',
  'pages/[prefix]/[slug]/index.js',
  'pages/[prefix]/[slug]/[...suffix].js',
  'pages/tag/index.js',
  'pages/tag/[tag]/index.js',
  'pages/tag/[tag]/page/[page].js',
  'pages/category/index.js',
  'pages/category/[category]/index.js',
  'pages/category/[category]/page/[page].js',
  'pages/search/index.js',
  'pages/search/[keyword]/index.js',
  'pages/search/[keyword]/page/[page].js'
]

describe('one public ISR policy', () => {
  test.each(allPublicIsrPages)('%s uses the shared resolver', file => {
    const source = read(file)
    expect(source).toMatch(
      /import\s+\{\s*getPublicContentRevalidateSeconds\s*\}\s+from\s+['"]@\/lib\/cache\/publicContentCache['"]/
    )
    expect(source).toMatch(
      /revalidate:\s*getPublicContentRevalidateSeconds\(props\.NOTION_CONFIG\)/
    )
    expect(source).not.toMatch(/siteConfig\(\s*['"]NEXT_REVALIDATE_SECOND['"]/)
  })
})
