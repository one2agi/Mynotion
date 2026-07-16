import { render, screen } from '@testing-library/react'

jest.mock('@/lib/config', () => ({
  siteConfig: key => {
    if (key === 'LINK') return 'https://www.one2agi.com'
    return undefined
  }
}))

import SmartLink from '@/components/SmartLink'

const originalRole = process.env.NEXT_PUBLIC_SITE_ROLE
const originalContentUrl = process.env.NEXT_PUBLIC_CONTENT_SITE_URL

describe('SmartLink landing/content ownership', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_ROLE = 'landing'
    process.env.NEXT_PUBLIC_CONTENT_SITE_URL = 'https://way.one2agi.com'
  })

  afterAll(() => {
    if (originalRole === undefined) delete process.env.NEXT_PUBLIC_SITE_ROLE
    else process.env.NEXT_PUBLIC_SITE_ROLE = originalRole
    if (originalContentUrl === undefined) {
      delete process.env.NEXT_PUBLIC_CONTENT_SITE_URL
    } else {
      process.env.NEXT_PUBLIC_CONTENT_SITE_URL = originalContentUrl
    }
  })

  test('opens owned content in the current tab on way', () => {
    render(<SmartLink href='/article/3213'>打开文章</SmartLink>)
    const link = screen.getByRole('link', { name: '打开文章' })
    expect(link).toHaveAttribute('href', 'https://way.one2agi.com/article/3213')
    expect(link).not.toHaveAttribute('target')
  })

  test('serializes object-form owned content links for native navigation', () => {
    render(
      <SmartLink href={{ pathname: '/tag/AI', query: { page: 2 } }}>
        AI 第二页
      </SmartLink>
    )
    expect(screen.getByRole('link', { name: 'AI 第二页' })).toHaveAttribute(
      'href',
      'https://way.one2agi.com/tag/AI?page=2'
    )
  })

  test('keeps the brand homepage local and third-party links external', () => {
    render(
      <>
        <SmartLink href='/'>品牌首页</SmartLink>
        <SmartLink href='https://example.com/docs'>外部文档</SmartLink>
      </>
    )
    expect(screen.getByRole('link', { name: '品牌首页' })).toHaveAttribute(
      'href',
      '/'
    )
    expect(screen.getByRole('link', { name: '外部文档' })).toHaveAttribute(
      'target',
      '_blank'
    )
  })
})
