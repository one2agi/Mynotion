import { render, screen } from '@testing-library/react'

const mockResolveSiteHref = jest.fn(href => href)

jest.mock('@/lib/config', () => ({
  siteConfig: key => {
    if (key === 'LINK') return 'https://www.one2agi.com'
    return undefined
  }
}))

jest.mock('@/lib/site-role', () => ({
  resolveSiteHref: (...args) => mockResolveSiteHref(...args),
  isOwnedContentHref: () => false
}))

import SmartLink from '@/components/SmartLink'

describe('SmartLink client build environment', () => {
  beforeEach(() => {
    mockResolveSiteHref.mockClear()
    process.env.NEXT_PUBLIC_SITE_ROLE = 'landing'
    process.env.NEXT_PUBLIC_CONTENT_SITE_URL = 'https://way.one2agi.com'
  })

  test('passes the public site role explicitly to the route resolver', () => {
    render(<SmartLink href='/article/3213'>打开文章</SmartLink>)

    expect(screen.getByRole('link', { name: '打开文章' })).toBeInTheDocument()
    expect(mockResolveSiteHref).toHaveBeenCalledWith('/article/3213', {
      role: 'landing',
      currentSiteUrl: 'https://www.one2agi.com',
      contentSiteUrl: 'https://way.one2agi.com'
    })
  })
})
