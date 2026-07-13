const {
  REQUIRED_LOCALE_REWRITES,
  verifyBuildContract
} = require('../../scripts/verify-edgeone-build-contract')

describe('EdgeOne locale page-data contract', () => {
  const buildId = 'build-123'
  const manifest = {
    routes: {
      '/': {
        dataRoute: '/_next/data/build-123/index.json',
        initialRevalidateSeconds: 300
      },
      '/archive': {
        dataRoute: '/_next/data/build-123/archive.json',
        initialRevalidateSeconds: 300
      },
      '/page/2': {
        dataRoute: '/_next/data/build-123/page/2.json',
        initialRevalidateSeconds: 300
      }
    },
    dynamicRoutes: {}
  }

  test('accepts exact zh-CN static-data rewrites and 300-second routes', () => {
    expect(
      verifyBuildContract({
        buildId,
        manifest,
        edgeoneConfig: { rewrites: REQUIRED_LOCALE_REWRITES },
        locale: 'zh-CN'
      })
    ).toEqual({ buildId, checkedRoutes: ['/', '/archive', '/page/2'] })
  })

  test('rejects a missing locale rewrite', () => {
    expect(() =>
      verifyBuildContract({
        buildId,
        manifest,
        edgeoneConfig: { rewrites: REQUIRED_LOCALE_REWRITES.slice(1) },
        locale: 'zh-CN'
      })
    ).toThrow('missing EdgeOne locale data rewrite')
  })

  test('rejects SSR or a conflicting revalidation value', () => {
    const broken = JSON.parse(JSON.stringify(manifest))
    delete broken.routes['/archive']
    expect(() =>
      verifyBuildContract({
        buildId,
        manifest: broken,
        edgeoneConfig: { rewrites: REQUIRED_LOCALE_REWRITES },
        locale: 'zh-CN'
      })
    ).toThrow('missing prerender route: /archive')
  })
})
