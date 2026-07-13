describe('EdgeOne probe helpers', () => {
  test('uses canonical sitemap URLs without cache-busting queries', async () => {
    const { extractCanonicalUrls } = await import('../../scripts/probe-edgeone-stability.mjs')
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
    const { summarize } = await import('../../scripts/probe-edgeone-stability.mjs')
    const summary = summarize([
      { status: 200, durationMs: 100 },
      { status: 545, durationMs: 300 },
      { networkError: 'fetch failed', durationMs: 200 }
    ])
    expect(summary.statuses).toEqual({ 200: 1, 545: 1 })
    expect(summary.networkErrors).toBe(1)
    expect(summary.p95Ms).toBe(300)
  })
})
