const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const clerk = ['clerk'].join('')

describe('Clerk is not a deployment dependency', () => {
  test('package.json contains no Clerk package', () => {
    expect(read('package.json').toLowerCase()).not.toContain(clerk)
  })

  test('the local lockfile contains no Clerk package when present', () => {
    const lockfile = path.resolve(process.cwd(), 'pnpm-lock.yaml')
    if (fs.existsSync(lockfile)) {
      expect(fs.readFileSync(lockfile, 'utf8').toLowerCase()).not.toContain(
        clerk
      )
    }
  })

  test('environment validation does not require Clerk keys', () => {
    const source = read('lib/config/env-validation.js')
    expect(source).not.toMatch(/CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY/)
  })
})
