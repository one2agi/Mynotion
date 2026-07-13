const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const publicPages = [
  'pages/index.js',
  'pages/archive/index.js',
  'pages/page/[page].js'
]
const privatePages = ['pages/auth/index.js']

describe('public SSR edge cache wiring', () => {
  test.each(publicPages)('%s sets public page cache', file => {
    const source = read(file)
    expect(source).toMatch(
      /import\s+\{\s*setPublicPageCache\s*\}\s+from\s+['"]@\/lib\/cache\/publicPageCache['"]/
    )
    expect(source).toMatch(
      /getServerSideProps\s*\(\s*\{[^}]*\bres\b[^}]*\}\s*\)/s
    )
    expect(source).toMatch(/setPublicPageCache\(res\)/)
  })

  test.each(privatePages)('%s never uses public page cache', file => {
    expect(read(file)).not.toMatch(/setPublicPageCache/)
  })
})
