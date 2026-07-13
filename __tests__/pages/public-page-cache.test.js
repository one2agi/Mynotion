const fs = require('fs')
const path = require('path')
const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('private routes stay outside public ISR', () => {
  test('auth remains server-side and never imports the public ISR policy', () => {
    const source = read('pages/auth/index.js')
    expect(source).toMatch(/getServerSideProps/)
    expect(source).not.toMatch(/publicContentCache/)
    expect(source).not.toMatch(/setPublicPageCache/)
  })

  test.each([
    'pages/api/notion-comments.js',
    'pages/api/subscribe.js'
  ])('%s never imports the public ISR policy', file => {
    expect(read(file)).not.toMatch(/publicContentCache/)
  })
})
