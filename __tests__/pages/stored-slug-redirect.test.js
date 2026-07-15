jest.mock('@/blog.config', () => ({
  LANG: 'zh-CN',
  THEME: 'next'
}))

jest.mock('@/lib/db/SiteDataApi', () => ({
  resolvePostProps: jest.fn()
}))

jest.mock('@/lib/notion-webhook/routeState', () => ({
  getStoredRedirect: jest.fn()
}))

jest.mock('@/lib/cache/publicContentCache', () => ({
  getPublicContentRevalidateSeconds: jest.fn(() => 300)
}))

jest.mock('@/lib/build/staticPaths', () => ({
  getSharedAllPages: jest.fn(),
  getStaticPathsBase: jest.fn()
}))

jest.mock('@/themes/theme', () => ({ DynamicLayout: () => null }))
jest.mock('@/components/Notification', () => () => ({}))
jest.mock('@/components/TechGrow', () => () => null)
jest.mock('@/lib/global', () => ({
  useGlobal: () => ({ locale: { COMMON: {} } })
}))
jest.mock('@/lib/db/notion/getPageTableOfContents', () => ({
  getPageTableOfContents: jest.fn(() => [])
}))
jest.mock('notion-utils', () => ({}))

import { resolvePostProps } from '@/lib/db/SiteDataApi'
import { getStoredRedirect } from '@/lib/notion-webhook/routeState'
import { getStaticProps as resolveOneSegment } from '@/pages/[prefix]'
import { getStaticProps as resolveTwoSegments } from '@/pages/[prefix]/[slug]'
import { getStaticProps as resolveManySegments } from '@/pages/[prefix]/[slug]/[...suffix]'

const missingProps = () => ({ post: null, NOTION_CONFIG: {} })
const activeProps = () => ({
  post: { id: 'active-page', slug: 'article/old' },
  NOTION_CONFIG: {}
})

describe('stored old-slug redirects', () => {
  beforeEach(() => {
    resolvePostProps.mockReset()
    getStoredRedirect.mockReset()
    resolvePostProps.mockResolvedValue(missingProps())
    getStoredRedirect.mockResolvedValue(null)
  })

  test('redirects a one-segment inactive route', async () => {
    getStoredRedirect.mockResolvedValue('/new')

    await expect(
      resolveOneSegment({ params: { prefix: 'old' }, locale: 'zh-CN' })
    ).resolves.toEqual({
      redirect: { destination: '/new', permanent: true }
    })
    expect(getStoredRedirect).toHaveBeenCalledWith(undefined, '/old')
  })

  test('redirects a two-segment inactive route', async () => {
    getStoredRedirect.mockResolvedValue('/article/new')

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old' },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({
      redirect: { destination: '/article/new', permanent: true }
    })
    expect(getStoredRedirect).toHaveBeenCalledWith(undefined, '/article/old')
  })

  test('redirects a three-plus-segment inactive route', async () => {
    getStoredRedirect.mockResolvedValue('/article/2026/new')

    await expect(
      resolveManySegments({
        params: {
          prefix: 'article',
          slug: '2026',
          suffix: ['07', 'old']
        },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({
      redirect: { destination: '/article/2026/new', permanent: true }
    })
    expect(getStoredRedirect).toHaveBeenCalledWith(
      undefined,
      '/article/2026/07/old'
    )
  })

  test('uses the locale-scoped path and accepts its canonical destination', async () => {
    getStoredRedirect.mockResolvedValue('/en/article/new')

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old' },
        locale: 'en'
      })
    ).resolves.toEqual({
      redirect: { destination: '/en/article/new', permanent: true }
    })
    expect(getStoredRedirect).toHaveBeenCalledWith('en', '/en/article/old')
  })

  test('preserves a canonical .html redirect', async () => {
    getStoredRedirect.mockResolvedValue('/article/new.html')

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old.html' },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({
      redirect: { destination: '/article/new.html', permanent: true }
    })
  })

  test('uses the flattened final destination returned by route state', async () => {
    getStoredRedirect.mockResolvedValue('/article/final')

    const result = await resolveTwoSegments({
      params: { prefix: 'article', slug: 'first' },
      locale: 'zh-CN'
    })

    expect(result).toEqual({
      redirect: { destination: '/article/final', permanent: true }
    })
  })

  test('lets an active page take precedence without reading redirects', async () => {
    const props = activeProps()
    resolvePostProps.mockResolvedValue(props)

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old' },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({ props, revalidate: 300 })
    expect(getStoredRedirect).not.toHaveBeenCalled()
  })

  test.each([
    ['an external destination', 'https://evil.example/steal'],
    ['a protocol-relative destination', '//evil.example/steal'],
    ['a redirect loop', '/article/old']
  ])('rejects %s', async (_label, destination) => {
    getStoredRedirect.mockResolvedValue(destination)

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old' },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({ notFound: true })
  })

  test('degrades a redirect-store outage to notFound', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    getStoredRedirect.mockRejectedValue(new Error('redis unavailable'))

    await expect(
      resolveTwoSegments({
        params: { prefix: 'article', slug: 'old' },
        locale: 'zh-CN'
      })
    ).resolves.toEqual({ notFound: true })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('route state unavailable'),
      expect.any(Error)
    )
  })
})
