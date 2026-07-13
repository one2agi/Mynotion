const fs = require('fs')
const path = require('path')

describe('legacy Notion redirect page integration', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'pages/[prefix]/index.js'),
    'utf8'
  )

  test('resolves published UUIDs before normal post props', () => {
    expect(source).toMatch(/import\s+\{[^}]*getSharedAllPages[^}]*\}/s)
    expect(source).toMatch(
      /import\s+\{[^}]*isLegacyNotionId[^}]*resolveLegacyNotionRedirect[^}]*\}/s
    )
    expect(source.indexOf('isLegacyNotionId(prefix)')).toBeLessThan(
      source.indexOf('resolvePostProps({')
    )
    expect(source).toMatch(/if\s*\(redirect\)\s*return\s*\{\s*redirect\s*\}/s)
    expect(source).toMatch(
      /if\s*\(isLegacyNotionId\(prefix\)\)[\s\S]*return\s*\{\s*notFound:\s*true\s*\}/
    )
  })

  test('keeps normal slug ISR behavior', () => {
    expect(source).toContain('resolvePostProps({')
    expect(source).toMatch(/revalidate:/)
  })
})
