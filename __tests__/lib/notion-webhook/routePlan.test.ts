import { describe, expect, test } from '@jest/globals'

import {
  planRouteRevalidation,
  type RoutePageMetadata,
  type RoutePlanInput
} from '@/lib/notion-webhook/routePlan'
import type { RouteSnapshot } from '@/lib/notion-webhook/routeState'

const pageId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const page = (
  overrides: Partial<RoutePageMetadata> = {}
): RoutePageMetadata => ({
  pageId,
  locale: 'zh-CN',
  href: '/article/guides/notion',
  slug: 'article/guides/notion',
  public: true,
  type: 'Post',
  status: 'Published',
  title: 'Notion guide',
  summary: 'Old summary',
  categories: ['产品'],
  tags: ['Notion'],
  lastEditedDate: 100,
  ...overrides
})

const snapshot = (overrides: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
  ...page(),
  processedEventAt: 90,
  ...overrides
})

const directory = (
  count: number,
  overrides: Partial<RoutePageMetadata> = {},
  offset = 0
): RoutePageMetadata[] =>
  Array.from({ length: count }, (_, index) =>
    page({
      pageId: `${String(index + offset + 1).padStart(32, '0')}`,
      href: `/article/post-${index + 1}`,
      slug: `article/post-${index + 1}`,
      categories: [],
      tags: [],
      ...overrides
    })
  )

const input = (overrides: Partial<RoutePlanInput> = {}): RoutePlanInput => ({
  selectedQueueScore: 120,
  oldSnapshot: snapshot(),
  newPage: page({ lastEditedDate: 110 }),
  publicDirectory: directory(5),
  postsPerPage: 2,
  defaultLocale: 'zh-CN',
  configuredLocales: ['zh-CN', 'en'],
  ...overrides
})

describe('pure Notion webhook route planner', () => {
  test.each([
    {
      change: 'body or lastEditedDate only',
      value: input(),
      expectedPaths: ['/article/guides/notion'],
      refreshGraph: true
    },
    {
      change: 'title or summary',
      value: input({
        oldSnapshot: snapshot({ locale: 'en' }),
        newPage: page({
          locale: 'en',
          title: 'Renamed guide',
          lastEditedDate: 110
        }),
        publicDirectory: [
          ...directory(4, { locale: 'en' }),
          page({
            locale: 'en',
            categories: ['产品', '产品'],
            tags: ['Notion', 'Notion']
          })
        ]
      }),
      expectedPaths: [
        '/en',
        '/en/archive',
        '/en/article/guides/notion',
        '/en/page/2',
        '/en/page/3',
        '/en/search'
      ],
      refreshGraph: false
    },
    {
      change: 'category or tag',
      value: input({
        oldSnapshot: snapshot({
          categories: ['产品 设计'],
          tags: ['入门']
        }),
        newPage: page({
          categories: ['工程', '工程'],
          tags: ['进阶', '进阶'],
          lastEditedDate: 110
        }),
        publicDirectory: [
          ...directory(4, { categories: ['产品 设计'], tags: ['入门'] }),
          ...directory(5, { categories: ['工程'], tags: ['进阶'] }, 10),
          page({ categories: ['工程', '工程'], tags: ['进阶', '进阶'] })
        ]
      }),
      expectedPaths: [
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81%20%E8%AE%BE%E8%AE%A1',
        '/category/%E4%BA%A7%E5%93%81%20%E8%AE%BE%E8%AE%A1/page/1',
        '/category/%E4%BA%A7%E5%93%81%20%E8%AE%BE%E8%AE%A1/page/2',
        '/category/%E4%BA%A7%E5%93%81%20%E8%AE%BE%E8%AE%A1/page/3',
        '/category/%E5%B7%A5%E7%A8%8B',
        '/category/%E5%B7%A5%E7%A8%8B/page/1',
        '/category/%E5%B7%A5%E7%A8%8B/page/2',
        '/category/%E5%B7%A5%E7%A8%8B/page/3',
        '/tag/%E5%85%A5%E9%97%A8',
        '/tag/%E5%85%A5%E9%97%A8/page/1',
        '/tag/%E5%85%A5%E9%97%A8/page/2',
        '/tag/%E5%85%A5%E9%97%A8/page/3',
        '/tag/%E8%BF%9B%E9%98%B6',
        '/tag/%E8%BF%9B%E9%98%B6/page/1',
        '/tag/%E8%BF%9B%E9%98%B6/page/2',
        '/tag/%E8%BF%9B%E9%98%B6/page/3'
      ],
      refreshGraph: false
    },
    {
      change: 'slug',
      value: input({
        oldSnapshot: snapshot({
          locale: 'en',
          href: '/article/old guide',
          slug: 'article/old guide'
        }),
        newPage: page({
          locale: 'en',
          href: '/docs/guides/new notion',
          slug: 'docs/guides/new notion',
          lastEditedDate: 110
        }),
        publicDirectory: directory(3, { locale: 'en' })
      }),
      expectedPaths: [
        '/en',
        '/en/archive',
        '/en/article/old%20guide',
        '/en/docs/guides/new%20notion',
        '/en/page/2',
        '/en/search'
      ],
      refreshGraph: true
    },
    {
      change: 'publish or restore',
      value: input({
        oldSnapshot: null,
        newPage: page({
          categories: ['产品'],
          tags: ['新文章'],
          lastEditedDate: 110
        }),
        publicDirectory: [
          ...directory(4, { categories: ['产品'], tags: ['新文章'] }),
          page({ categories: ['产品'], tags: ['新文章'] })
        ]
      }),
      expectedPaths: [
        '/',
        '/archive',
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/category/%E4%BA%A7%E5%93%81/page/1',
        '/category/%E4%BA%A7%E5%93%81/page/2',
        '/category/%E4%BA%A7%E5%93%81/page/3',
        '/page/2',
        '/page/3',
        '/search',
        '/tag/%E6%96%B0%E6%96%87%E7%AB%A0',
        '/tag/%E6%96%B0%E6%96%87%E7%AB%A0/page/1',
        '/tag/%E6%96%B0%E6%96%87%E7%AB%A0/page/2',
        '/tag/%E6%96%B0%E6%96%87%E7%AB%A0/page/3'
      ],
      refreshGraph: true
    },
    {
      change: 'unpublish, delete, or move out',
      value: input({
        oldSnapshot: snapshot({
          categories: ['产品'],
          tags: ['Notion']
        }),
        newPage: page({
          public: false,
          status: 'Draft',
          categories: [],
          tags: [],
          lastEditedDate: 110
        }),
        publicDirectory: directory(4)
      }),
      expectedPaths: [
        '/',
        '/archive',
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/page/2',
        '/page/3',
        '/search',
        '/tag/Notion'
      ],
      refreshGraph: true
    },
    {
      change: 'irrelevant page',
      value: input({
        oldSnapshot: null,
        newPage: page({
          public: false,
          type: 'Menu',
          status: 'Published',
          lastEditedDate: 110
        }),
        publicDirectory: directory(4)
      }),
      expectedPaths: [],
      refreshGraph: false
    }
  ])(
    'plans the exact $change scope',
    ({ value, expectedPaths, refreshGraph }) => {
      const result = planRouteRevalidation(value)

      expect(result.paths).toEqual([...expectedPaths].sort())
      expect(result.refreshGraph).toBe(refreshGraph)
    }
  )

  test('returns a permanent locale-scoped redirect for a slug change', () => {
    const result = planRouteRevalidation(
      input({
        oldSnapshot: snapshot({
          locale: 'en',
          href: '/article/old guide',
          slug: 'article/old guide'
        }),
        newPage: page({
          locale: 'en',
          href: '/docs/guides/new notion',
          slug: 'docs/guides/new notion',
          lastEditedDate: 110
        }),
        publicDirectory: directory(3, { locale: 'en' })
      })
    )

    expect(result.redirect).toEqual({
      from: '/en/article/old%20guide',
      to: '/en/docs/guides/new%20notion',
      permanent: true,
      locale: 'en'
    })
  })

  test('omits the redirect locale key for the default locale', () => {
    const result = planRouteRevalidation(
      input({
        oldSnapshot: snapshot({ href: '/article/old', slug: 'article/old' }),
        newPage: page({
          href: '/article/new',
          slug: 'article/new',
          lastEditedDate: 110
        })
      })
    )

    expect(result.redirect).toEqual({
      from: '/article/old',
      to: '/article/new',
      permanent: true
    })
  })

  test('builds the next public snapshot at the selected queue score', () => {
    const result = planRouteRevalidation(input())

    expect(result.nextSnapshot).toEqual({
      ...page({ lastEditedDate: 110 }),
      processedEventAt: 120
    })
    expect(result.becamePrivate).toBe(false)
    expect(result.redirect).toBeNull()
  })

  test('builds a pending private tombstone without acknowledging it early', () => {
    const oldSnapshot = snapshot()
    const result = planRouteRevalidation(
      input({
        oldSnapshot,
        newPage: null,
        publicDirectory: directory(4)
      })
    )

    expect(result.nextSnapshot).toEqual({
      ...oldSnapshot,
      public: false,
      processedEventAt: 90,
      pendingEventAt: 120
    })
    expect(result.becamePrivate).toBe(true)
  })

  test('replans an unpublish when the same selected event has a pending tombstone', () => {
    const pending = snapshot({
      public: false,
      status: 'Draft',
      processedEventAt: 90,
      pendingEventAt: 120
    })
    const result = planRouteRevalidation(
      input({
        oldSnapshot: pending,
        newPage: null,
        publicDirectory: directory(4)
      })
    )

    expect(result.paths).toEqual(
      [
        '/',
        '/archive',
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/page/2',
        '/page/3',
        '/search',
        '/tag/Notion'
      ].sort()
    )
    expect(result.nextSnapshot).toEqual(pending)
    expect(result.becamePrivate).toBe(true)
    expect(result.refreshGraph).toBe(true)
  })

  test('replans a pending private tombstone when the queue score advances', () => {
    const pending = snapshot({
      public: false,
      status: 'Draft',
      processedEventAt: 90,
      pendingEventAt: 120
    })
    const result = planRouteRevalidation(
      input({
        selectedQueueScore: 130,
        oldSnapshot: pending,
        newPage: null,
        publicDirectory: directory(4)
      })
    )

    expect(result.paths).toEqual(
      [
        '/',
        '/archive',
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/page/2',
        '/page/3',
        '/search',
        '/tag/Notion'
      ].sort()
    )
    expect(result.nextSnapshot).toEqual({
      ...pending,
      pendingEventAt: 130
    })
    expect(result.becamePrivate).toBe(true)
    expect(result.refreshGraph).toBe(true)
  })

  test('restores all list and graph work when a newer public event follows a pending unpublish', () => {
    const pending = snapshot({
      public: false,
      status: 'Draft',
      processedEventAt: 90,
      pendingEventAt: 120
    })
    const restored = page({ lastEditedDate: 130 })
    const result = planRouteRevalidation(
      input({
        selectedQueueScore: 130,
        oldSnapshot: pending,
        newPage: restored,
        publicDirectory: [...directory(3), restored]
      })
    )

    expect(result.paths).toEqual(
      [
        '/',
        '/archive',
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/page/2',
        '/search',
        '/tag/Notion'
      ].sort()
    )
    expect(result.nextSnapshot).toEqual({
      ...restored,
      processedEventAt: 130
    })
    expect(result.becamePrivate).toBe(false)
    expect(result.refreshGraph).toBe(true)
  })

  test('includes explicit taxonomy page 1 through every known numbered page', () => {
    const changed = page({
      categories: ['工程'],
      tags: [],
      lastEditedDate: 110
    })
    const result = planRouteRevalidation(
      input({
        oldSnapshot: snapshot({ categories: ['产品'], tags: [] }),
        newPage: changed,
        publicDirectory: [...directory(2, { categories: ['工程'] }), changed]
      })
    )

    expect(result.paths).toEqual(
      [
        '/article/guides/notion',
        '/category/%E4%BA%A7%E5%93%81',
        '/category/%E5%B7%A5%E7%A8%8B',
        '/category/%E5%B7%A5%E7%A8%8B/page/1',
        '/category/%E5%B7%A5%E7%A8%8B/page/2'
      ].sort()
    )
  })

  test('invalidates old and new locale scopes with per-locale pagination on a locale transition', () => {
    const moved = page({
      locale: 'zh-CN',
      href: '/article/new',
      slug: 'article/new',
      categories: ['新分类'],
      tags: ['新标签'],
      lastEditedDate: 130
    })
    const result = planRouteRevalidation(
      input({
        selectedQueueScore: 130,
        oldSnapshot: snapshot({
          locale: 'en',
          href: '/article/old',
          slug: 'article/old',
          categories: ['Old Category'],
          tags: ['Old Tag']
        }),
        newPage: moved,
        publicDirectory: [
          ...directory(
            4,
            {
              locale: 'en',
              categories: ['Old Category'],
              tags: ['Old Tag']
            },
            10
          ),
          ...directory(
            4,
            {
              locale: 'zh-CN',
              categories: ['新分类'],
              tags: ['新标签']
            },
            20
          ),
          moved
        ]
      })
    )

    expect(result.paths).toEqual(
      [
        '/',
        '/archive',
        '/article/new',
        '/category/%E6%96%B0%E5%88%86%E7%B1%BB',
        '/category/%E6%96%B0%E5%88%86%E7%B1%BB/page/1',
        '/category/%E6%96%B0%E5%88%86%E7%B1%BB/page/2',
        '/category/%E6%96%B0%E5%88%86%E7%B1%BB/page/3',
        '/en',
        '/en/archive',
        '/en/article/old',
        '/en/category/Old%20Category',
        '/en/category/Old%20Category/page/1',
        '/en/category/Old%20Category/page/2',
        '/en/category/Old%20Category/page/3',
        '/en/page/2',
        '/en/page/3',
        '/en/search',
        '/en/tag/Old%20Tag',
        '/en/tag/Old%20Tag/page/1',
        '/en/tag/Old%20Tag/page/2',
        '/en/tag/Old%20Tag/page/3',
        '/page/2',
        '/page/3',
        '/search',
        '/tag/%E6%96%B0%E6%A0%87%E7%AD%BE',
        '/tag/%E6%96%B0%E6%A0%87%E7%AD%BE/page/1',
        '/tag/%E6%96%B0%E6%A0%87%E7%AD%BE/page/2',
        '/tag/%E6%96%B0%E6%A0%87%E7%AD%BE/page/3'
      ].sort()
    )
    expect(result.redirect).toEqual({
      from: '/en/article/old',
      to: '/article/new',
      permanent: true,
      locale: 'en'
    })
    expect(result.refreshGraph).toBe(true)
  })

  test('uses raw slug routes for ISR and canonical pseudo-static hrefs for redirects', () => {
    const result = planRouteRevalidation(
      input({
        oldSnapshot: snapshot({
          locale: 'en',
          href: '/article/old guide.html',
          slug: 'article/old guide'
        }),
        newPage: page({
          locale: 'en',
          href: '/docs/new guide.html',
          slug: 'docs/new guide',
          lastEditedDate: 130
        }),
        publicDirectory: directory(3, { locale: 'en' })
      })
    )

    expect(result.paths).toContain('/en/article/old%20guide')
    expect(result.paths).toContain('/en/docs/new%20guide')
    expect(result.paths.every(path => !path.endsWith('.html'))).toBe(true)
    expect(result.redirect).toEqual({
      from: '/en/article/old%20guide.html',
      to: '/en/docs/new%20guide.html',
      permanent: true,
      locale: 'en'
    })
  })

  test('redirects retained pending-public history to a newer cross-locale restore', () => {
    const pending = snapshot({
      locale: 'en',
      href: '/article/old guide.html',
      slug: 'article/old guide',
      public: false,
      status: 'Draft',
      processedEventAt: 90,
      pendingEventAt: 120
    })
    const restored = page({
      locale: 'zh-CN',
      href: '/docs/new guide.html',
      slug: 'docs/new guide',
      lastEditedDate: 130
    })
    const result = planRouteRevalidation(
      input({
        selectedQueueScore: 130,
        oldSnapshot: pending,
        newPage: restored,
        publicDirectory: [...directory(3), restored]
      })
    )

    expect(result.redirect).toEqual({
      from: '/en/article/old%20guide.html',
      to: '/docs/new%20guide.html',
      permanent: true,
      locale: 'en'
    })
  })

  test('does not redirect from an acknowledged ordinary private snapshot', () => {
    const acknowledgedPrivate = snapshot({
      href: '/article/retired.html',
      slug: 'article/retired',
      public: false,
      status: 'Draft',
      processedEventAt: 120
    })
    const restored = page({
      href: '/article/restored.html',
      slug: 'article/restored',
      lastEditedDate: 130
    })
    const result = planRouteRevalidation(
      input({
        selectedQueueScore: 130,
        oldSnapshot: acknowledgedPrivate,
        newPage: restored,
        publicDirectory: [...directory(3), restored]
      })
    )

    expect(result.redirect).toBeNull()
  })

  test('normalizes and deduplicates paths and never enumerates keyword searches', () => {
    const result = planRouteRevalidation(
      input({
        oldSnapshot: snapshot({ title: 'Before' }),
        newPage: page({ title: 'After', lastEditedDate: 110 }),
        publicDirectory: [
          ...directory(3),
          page({ categories: ['产品', '产品'], tags: ['Notion', 'Notion'] })
        ]
      })
    )

    expect(result.paths).toEqual(Array.from(new Set(result.paths)).sort())
    expect(result.paths.filter(path => path.includes('/search'))).toEqual([
      '/search'
    ])
  })

  test('rejects invalid pagination and unknown locales deterministically', () => {
    expect(() => planRouteRevalidation(input({ postsPerPage: 0 }))).toThrow(
      'postsPerPage'
    )
    expect(() =>
      planRouteRevalidation(
        input({ newPage: page({ locale: 'fr', lastEditedDate: 110 }) })
      )
    ).toThrow('configured locale')
  })
})
