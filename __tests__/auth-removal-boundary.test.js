const fs = require('fs')
const path = require('path')

const root = process.cwd()
const exists = file => fs.existsSync(path.resolve(root, file))
const read = file => fs.readFileSync(path.resolve(root, file), 'utf8')
const clerkPackage = ['@clerk', '/'].join('')

const retiredPaths = [
  'middleware.ts',
  'pages/sign-in/[[...index]].js',
  'pages/sign-up/[[...index]].js',
  'pages/dashboard/[[...index]].js',
  'pages/api/user.ts'
]

describe('auth-free blog architecture', () => {
  test.each(retiredPaths)('%s is retired', file => {
    expect(exists(file)).toBe(false)
  })

  test('real comments and article password auth remain present', () => {
    for (const file of [
      'components/Comment.js',
      'pages/api/notion-comments.js',
      'pages/auth/index.js'
    ]) {
      expect(exists(file)).toBe(true)
      expect(read(file)).not.toContain(clerkPackage)
    }
  })
})
