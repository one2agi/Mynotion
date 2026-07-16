import { getSiteRole, isLandingSite, resolveSiteHref } from '@/lib/site-role'

describe('site role routing', () => {
  test('normalizes only the two explicit deployment roles', () => {
    expect(getSiteRole({ NEXT_PUBLIC_SITE_ROLE: 'landing' })).toBe('landing')
    expect(getSiteRole({ NEXT_PUBLIC_SITE_ROLE: ' CONTENT ' })).toBe('content')
    expect(getSiteRole({ NEXT_PUBLIC_SITE_ROLE: 'unknown' })).toBe('standalone')
    expect(isLandingSite({ NEXT_PUBLIC_SITE_ROLE: 'landing' })).toBe(true)
  })

  test('keeps root, root query, anchors and non-http protocols on landing', () => {
    const options = {
      role: 'landing',
      currentSiteUrl: 'https://www.one2agi.com',
      contentSiteUrl: 'https://way.one2agi.com'
    }
    expect(resolveSiteHref('/', options)).toBe('/')
    expect(resolveSiteHref('/?from=hero#top', options)).toBe('/?from=hero#top')
    expect(resolveSiteHref('#about', options)).toBe('#about')
    expect(resolveSiteHref('mailto:faiz@example.com', options)).toBe(
      'mailto:faiz@example.com'
    )
  })

  test('moves landing content paths to way with query and hash intact', () => {
    const options = {
      role: 'landing',
      currentSiteUrl: 'https://www.one2agi.com',
      contentSiteUrl: 'https://way.one2agi.com'
    }
    expect(resolveSiteHref('/article/3213?theme=next#comment', options)).toBe(
      'https://way.one2agi.com/article/3213?theme=next#comment'
    )
    expect(
      resolveSiteHref('https://www.one2agi.com/tag/AI?sort=new#posts', options)
    ).toBe('https://way.one2agi.com/tag/AI?sort=new#posts')
    expect(
      resolveSiteHref(
        {
          pathname: '/search/agent',
          query: { page: 2, tag: ['AI', 'LLM'] },
          hash: 'results'
        },
        options
      )
    ).toBe(
      'https://way.one2agi.com/search/agent?page=2&tag=AI&tag=LLM#results'
    )
  })

  test('does not rewrite content links for content or standalone builds', () => {
    expect(
      resolveSiteHref('/article/3213', {
        role: 'content',
        currentSiteUrl: 'https://way.one2agi.com',
        contentSiteUrl: 'https://way.one2agi.com'
      })
    ).toBe('/article/3213')
    expect(resolveSiteHref('/article/3213', { role: 'standalone' })).toBe(
      '/article/3213'
    )
  })
})
