describe('EdgeOne probe helpers', () => {
  test('uses canonical sitemap URLs without cache-busting queries', async () => {
    const { extractCanonicalUrls } =
      await import('../../scripts/probe-edgeone-stability.mjs')
    const urls = extractCanonicalUrls(
      '<loc>https://www.one2agi.com/</loc><loc>https://www.one2agi.com/article/3213</loc>',
      new URL('https://www.one2agi.com')
    )
    expect(urls).toEqual([
      'https://www.one2agi.com/',
      'https://www.one2agi.com/article/3213'
    ])
    expect(urls.join(' ')).not.toMatch(/[?&](_|cb|cacheBust)=/)
  })

  test('counts 545 and network disconnects separately and computes P95', async () => {
    const { summarize } =
      await import('../../scripts/probe-edgeone-stability.mjs')
    const summary = summarize([
      { status: 200, durationMs: 100 },
      { status: 545, durationMs: 300 },
      { networkError: 'fetch failed', durationMs: 200 }
    ])
    expect(summary.statuses).toEqual({ 200: 1, 545: 1 })
    expect(summary.networkErrors).toBe(1)
    expect(summary.p95Ms).toBe(300)
  })

  test('fails acceptance for any non-2xx response or network error', async () => {
    const { hasAcceptanceFailures } =
      await import('../../scripts/probe-edgeone-stability.mjs')

    expect(
      hasAcceptanceFailures({ statuses: { 200: 180 }, networkErrors: 0 })
    ).toBe(false)
    expect(
      hasAcceptanceFailures({
        statuses: { 200: 179, 404: 1 },
        networkErrors: 0
      })
    ).toBe(true)
    expect(
      hasAcceptanceFailures({
        statuses: { 200: 179, 545: 1 },
        networkErrors: 0
      })
    ).toBe(true)
    expect(
      hasAcceptanceFailures({ statuses: { 200: 179 }, networkErrors: 1 })
    ).toBe(true)
  })

  test('rebases the real production sitemap paths onto the deployment origin', async () => {
    const fs = await import('node:fs')
    const { extractCanonicalUrls } =
      await import('../../scripts/probe-edgeone-stability.mjs')
    const sitemap = fs.readFileSync(
      '__tests__/fixtures/edgeone/production-sitemap.xml',
      'utf8'
    )

    const urls = extractCanonicalUrls(
      sitemap,
      new URL('https://www.one2agi.com')
    )

    expect(urls).toContain('https://www.one2agi.com/')
    expect(urls).toContain('https://www.one2agi.com/article/3213')
    expect(urls).toHaveLength(12)
    expect(urls.some(url => new URL(url).pathname.startsWith('/rss/'))).toBe(
      false
    )
    expect(
      urls.every(url => new URL(url).origin === 'https://www.one2agi.com')
    ).toBe(true)
  })

  test('builds absolute locale page-data URLs without duplicating the locale', async () => {
    const { buildPageDataUrl } =
      await import('../../scripts/probe-edgeone-stability.mjs')
    const options = {
      baseUrl: new URL('https://www.one2agi.com'),
      buildId: 'build-123',
      locale: 'zh-CN'
    }

    expect(
      buildPageDataUrl({ pageUrl: 'https://www.one2agi.com/', ...options })
    ).toBe('https://www.one2agi.com/_next/data/build-123/zh-CN.json')
    expect(
      buildPageDataUrl({
        pageUrl: 'https://www.one2agi.com/zh-CN/article/3213',
        ...options
      })
    ).toBe(
      'https://www.one2agi.com/_next/data/build-123/zh-CN/article/3213.json'
    )
  })

  test('honors count as the exact total request count', async () => {
    const { buildProbeUrls } =
      await import('../../scripts/probe-edgeone-stability.mjs')
    const urls = buildProbeUrls({
      canonicalUrls: [
        'https://www.one2agi.com/',
        'https://www.one2agi.com/article/3213'
      ],
      dataUrls: [
        'https://www.one2agi.com/_next/data/b1/zh-CN.json',
        'https://www.one2agi.com/_next/data/b1/zh-CN/article/3213.json'
      ],
      staticAssetUrl: 'https://www.one2agi.com/_next/static/chunks/main-123.js',
      count: 5
    })

    expect(urls).toHaveLength(5)
    expect(
      urls.every(url => new URL(url).origin === 'https://www.one2agi.com')
    ).toBe(true)
    expect(new Set(urls)).toEqual(
      new Set([
        'https://www.one2agi.com/',
        'https://www.one2agi.com/article/3213',
        'https://www.one2agi.com/_next/data/b1/zh-CN.json',
        'https://www.one2agi.com/_next/data/b1/zh-CN/article/3213.json',
        'https://www.one2agi.com/_next/static/chunks/main-123.js'
      ])
    )
  })

  test('turns a hung edge request into a bounded network failure', async () => {
    const { probeOne } =
      await import('../../scripts/probe-edgeone-stability.mjs')

    const result = await probeOne('https://www.one2agi.com/', 'warm', {
      fetchImpl: () => new Promise(() => {}),
      timeoutMs: 5
    })

    expect(result.status).toBeUndefined()
    expect(result.networkError).toBe('request timeout after 5ms')
    expect(result.durationMs).toBeGreaterThanOrEqual(5)
  })
})
