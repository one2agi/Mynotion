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
