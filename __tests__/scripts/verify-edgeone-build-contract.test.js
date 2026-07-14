const {
  CONFLICTING_LOCALE_REWRITES,
  REQUIRED_BLOCKING_DYNAMIC_ROUTES,
  verifyBuildContract
} = require('../../scripts/verify-edgeone-build-contract')

describe('EdgeOne locale page-data contract', () => {
  const buildId = 'build-123'
  // This project pre-generates locale-prefixed routes through static paths.
  const manifest = {
    routes: {
      '/zh-CN': {
        dataRoute: '/_next/data/build-123/index.json',
        initialRevalidateSeconds: 300
      },
      '/zh-CN/archive': {
        dataRoute: '/_next/data/build-123/archive.json',
        initialRevalidateSeconds: 300
      },
      '/zh-CN/page/2': {
        dataRoute: '/_next/data/build-123/page/2.json',
        initialRevalidateSeconds: 300
      },
      '/zh-CN/search/NotionNext/page/1': {
        dataRoute: '/_next/data/build-123/zh-CN/search/NotionNext/page/1.json',
        initialRevalidateSeconds: 300
      }
    },
    dynamicRoutes: Object.fromEntries(
      REQUIRED_BLOCKING_DYNAMIC_ROUTES.map(route => [route, { fallback: null }])
    )
  }

  test('accepts native i18n page data without conflicting EdgeOne rewrites', () => {
    expect(
      verifyBuildContract({
        buildId,
        manifest,
        edgeoneConfig: {},
        locale: 'zh-CN'
      })
    ).toEqual({
      buildId,
      checkedRoutes: ['/zh-CN', '/zh-CN/archive', '/zh-CN/page/2']
    })
  })

  test('rejects a conflicting locale rewrite that masks Next i18n data', () => {
    expect(() =>
      verifyBuildContract({
        buildId,
        manifest,
        edgeoneConfig: { rewrites: [CONFLICTING_LOCALE_REWRITES[0]] },
        locale: 'zh-CN'
      })
    ).toThrow('conflicting EdgeOne locale data rewrite')
  })

  test('rejects SSR or a conflicting revalidation value', () => {
    const broken = JSON.parse(JSON.stringify(manifest))
    delete broken.routes['/zh-CN/archive']
    expect(() =>
      verifyBuildContract({
        buildId,
        manifest: broken,
        edgeoneConfig: {},
        locale: 'zh-CN'
      })
    ).toThrow('missing prerender route: /zh-CN/archive')
  })

  test('does not confuse taxonomy or search pagination with general pagination', () => {
    expect(
      verifyBuildContract({
        buildId,
        manifest,
        edgeoneConfig: {},
        locale: 'zh-CN'
      }).checkedRoutes
    ).toEqual(['/zh-CN', '/zh-CN/archive', '/zh-CN/page/2'])
  })

  test('rejects a page data route from a different build', () => {
    const broken = JSON.parse(JSON.stringify(manifest))
    broken.routes['/zh-CN/archive'].dataRoute =
      '/_next/data/stale-build/archive.json'

    expect(() =>
      verifyBuildContract({
        buildId,
        manifest: broken,
        edgeoneConfig: {},
        locale: 'zh-CN'
      })
    ).toThrow('route /zh-CN/archive has invalid data route')
  })

  test('rejects non-blocking fallback for newly published articles', () => {
    const broken = JSON.parse(JSON.stringify(manifest))
    broken.dynamicRoutes['/[prefix]/[slug]'].fallback = '/[prefix]/[slug].html'

    expect(() =>
      verifyBuildContract({
        buildId,
        manifest: broken,
        edgeoneConfig: {},
        locale: 'zh-CN'
      })
    ).toThrow('dynamic route /[prefix]/[slug] is not blocking fallback')
  })
})
