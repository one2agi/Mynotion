const fs = require('fs')
const path = require('path')
const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

const localePublicPages = [
  'pages/index.js',
  'pages/archive/index.js',
  'pages/page/[page].js'
]

describe('locale-prefixed public pages use build-time ISR', () => {
  test.each(localePublicPages)('%s uses static props and shared ISR', file => {
    const source = read(file)
    expect(source).toMatch(/export\s+async\s+function\s+getStaticProps\s*\(/)
    expect(source).not.toMatch(/getServerSideProps/)
    expect(source).toMatch(/getPublicContentRevalidateSeconds/)
  })

  test('general pagination pre-generates known pages and blocks on new ones', () => {
    const source = read('pages/page/[page].js')
    expect(source).toMatch(/export\s+async\s+function\s+getStaticPaths\s*\(/)
    expect(source).toMatch(/fallback:\s*['"]blocking['"]/)
  })
})
