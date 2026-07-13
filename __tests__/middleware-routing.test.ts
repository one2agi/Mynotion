import { describe, expect, test } from '@jest/globals'
import fs from 'fs'
import path from 'path'

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'middleware.ts'),
  'utf8'
)

describe('middleware route boundary', () => {
  test('matches only Clerk-protected routes', () => {
    const matcherBody = source.match(
      /export const config\s*=\s*\{[\s\S]*?matcher:\s*\[([\s\S]*?)\][\s\S]*?\}/
    )?.[1]
    const matchers = Array.from(
      matcherBody?.matchAll(/['"]([^'"]+)['"]/g) || [],
      match => match[1]
    )
    expect(matchers).toEqual([
      '/dashboard/:path*',
      '/user/organization-selector/:path*',
      '/user/orgid/:path*',
      '/admin/:orgId/memberships',
      '/admin/:orgId/domain'
    ])
  })

  test('contains no public UUID redirect work', () => {
    for (const forbidden of [
      'redirect.json',
      'UUID_REDIRECT',
      'notion-utils',
      'checkStrIsNotionId',
      'blog.config'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
