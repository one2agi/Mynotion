import {
  isLegacyNotionId,
  resolveLegacyNotionRedirect
} from '@/lib/utils/legacyNotionRedirect'

const compactId = '1234567890abcdef1234567890abcdef'
const uuid = '12345678-90ab-cdef-1234-567890abcdef'
const published = {
  id: uuid,
  status: 'Published',
  type: 'Post',
  href: '/article/example'
}

describe('legacy Notion redirect resolver', () => {
  test.each([compactId, uuid])('recognizes and redirects %s', value => {
    expect(isLegacyNotionId(value)).toBe(true)
    expect(
      resolveLegacyNotionRedirect({
        value,
        allPages: [published],
        locale: 'zh-CN'
      })
    ).toEqual({
      destination: '/zh-CN/article/example',
      permanent: true
    })
  })

  test('does not duplicate an existing locale prefix', () => {
    expect(
      resolveLegacyNotionRedirect({
        value: compactId,
        allPages: [{ ...published, href: '/zh-CN/article/example' }],
        locale: 'zh-CN'
      })
    ).toEqual({
      destination: '/zh-CN/article/example',
      permanent: true
    })
  })

  test.each([
    ['article-slug', [published]],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [published]],
    [compactId, [{ ...published, status: 'Draft' }]],
    [compactId, [{ ...published, type: 'Menu' }]],
    [compactId, [{ ...published, href: '' }]],
    [compactId, [{ ...published, href: 'https://example.com' }]],
    [compactId, [{ ...published, href: '//example.com' }]]
  ])('returns null for unsafe or unresolved input', (value, allPages) => {
    expect(
      resolveLegacyNotionRedirect({ value, allPages, locale: 'zh-CN' })
    ).toBeNull()
  })
})
