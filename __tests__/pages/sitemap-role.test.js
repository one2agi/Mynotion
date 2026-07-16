/** @jest-environment node */

const mockGetServerSideSitemap = jest.fn((_ctx, fields) => ({
  props: { fields }
}))
const mockFetchGlobalAllData = jest.fn()

jest.mock('next-sitemap', () => ({
  getServerSideSitemap: (...args) => mockGetServerSideSitemap(...args)
}))
jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchGlobalAllData: (...args) => mockFetchGlobalAllData(...args)
}))
jest.mock('@/lib/config', () => ({
  siteConfig: (key, fallback) =>
    key === 'LINK' ? 'https://www.one2agi.com' : fallback
}))

import { getServerSideProps } from '@/pages/sitemap.xml'

const originalRole = process.env.NEXT_PUBLIC_SITE_ROLE

describe('role-aware sitemap', () => {
  afterEach(() => {
    jest.clearAllMocks()
    if (originalRole === undefined) delete process.env.NEXT_PUBLIC_SITE_ROLE
    else process.env.NEXT_PUBLIC_SITE_ROLE = originalRole
  })

  test('landing sitemap contains only the brand homepage without reading Notion', async () => {
    process.env.NEXT_PUBLIC_SITE_ROLE = 'landing'
    const setHeader = jest.fn()
    const result = await getServerSideProps({ res: { setHeader } })

    expect(mockFetchGlobalAllData).not.toHaveBeenCalled()
    expect(mockGetServerSideSitemap).toHaveBeenCalledWith(expect.any(Object), [
      expect.objectContaining({
        loc: 'https://www.one2agi.com',
        priority: '1.0'
      })
    ])
    expect(result.props.fields).toHaveLength(1)
  })

  test('content sitemap continues to read the configured Notion directory', async () => {
    process.env.NEXT_PUBLIC_SITE_ROLE = 'content'
    mockFetchGlobalAllData.mockResolvedValue({
      siteInfo: { link: 'https://way.one2agi.com' },
      NOTION_CONFIG: {},
      allPages: []
    })
    await getServerSideProps({ res: { setHeader: jest.fn() } })
    expect(mockFetchGlobalAllData).toHaveBeenCalled()
  })
})
