/** @jest-environment node */

declare const jest: any
declare const describe: any
declare const beforeEach: any
declare const test: any
declare const expect: any

jest.mock('@/blog.config', () => ({
  LANG: 'zh-CN',
  NOTION_PAGE_ID: 'database'
}))

jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchFreshConfiguredGlobalData: jest.fn()
}))

import { fetchFreshConfiguredGlobalData } from '@/lib/db/SiteDataApi'
import { warmAllContentPaths } from '@/lib/notion-webhook/warmAll'

describe('warmAllContentPaths', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(fetchFreshConfiguredGlobalData).mockResolvedValue([
      {
        pageId: 'database',
        data: {
          allPages: [
            {
              id: 'post-a',
              slug: 'article/a',
              type: 'Post',
              status: 'Published'
            },
            {
              id: 'page-b',
              slug: 'about',
              type: 'Page',
              status: 'Published'
            },
            {
              id: 'menu',
              slug: 'menu',
              type: 'Menu',
              status: 'Published'
            },
            {
              id: 'draft',
              slug: 'article/draft',
              type: 'Post',
              status: 'Invisible'
            }
          ]
        }
      }
    ])
  })

  test('refreshes and warms published content paths from fresh Notion data', async () => {
    const calls: string[] = []
    const revalidate = jest.fn(async (path: string) => {
      calls.push(`revalidate:${path}`)
    })
    const warmPath = jest.fn(async (path: string) => {
      calls.push(`warm:${path}`)
    })

    await expect(
      warmAllContentPaths({ revalidate, warmPath, concurrency: 1 })
    ).resolves.toMatchObject({
      selected: 2,
      warmed: 2,
      failed: 0,
      paths: [
        { path: '/about', ok: true },
        { path: '/article/a', ok: true }
      ]
    })

    expect(fetchFreshConfiguredGlobalData).toHaveBeenCalledWith({
      from: 'revalidate-warm-all'
    })
    expect(calls).toEqual([
      'revalidate:/about',
      'warm:/about',
      'revalidate:/article/a',
      'warm:/article/a'
    ])
  })

  test('reports individual path failures without hiding the rest', async () => {
    const revalidate = jest.fn(async (path: string) => {
      if (path === '/about') throw new Error('ISR failed')
    })
    const warmPath = jest.fn(async () => undefined)

    await expect(
      warmAllContentPaths({ revalidate, warmPath, concurrency: 1 })
    ).resolves.toMatchObject({
      selected: 2,
      warmed: 1,
      failed: 1,
      paths: [
        { path: '/about', ok: false, error: 'ISR failed' },
        { path: '/article/a', ok: true }
      ]
    })
  })
})
