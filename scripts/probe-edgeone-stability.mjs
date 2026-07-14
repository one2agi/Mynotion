export function extractCanonicalUrls(xml, baseUrl) {
  const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(match => new URL(match[1].trim(), baseUrl))
    .filter(url => !url.pathname.startsWith('/rss/'))
    .map(sourceUrl => {
      const targetUrl = new URL(
        `${sourceUrl.pathname}${sourceUrl.search}`,
        baseUrl
      )
      targetUrl.hash = ''
      return targetUrl.href
    })
  return [...new Set(found)]
}

export function buildPageDataUrl({ pageUrl, baseUrl, buildId, locale }) {
  const parsed = new URL(pageUrl, baseUrl)
  const localePrefix = `/${locale}`
  let routePath = parsed.pathname.replace(/\/$/, '')

  if (routePath === localePrefix) {
    routePath = ''
  } else if (routePath.startsWith(`${localePrefix}/`)) {
    routePath = routePath.slice(localePrefix.length)
  }

  const dataPath = routePath
    ? `/_next/data/${buildId}/${locale}${routePath}.json`
    : `/_next/data/${buildId}/${locale}.json`
  return new URL(dataPath, baseUrl).href
}

export function buildProbeUrls({
  canonicalUrls,
  dataUrls,
  staticAssetUrl,
  count
}) {
  const pool = []
  const pairCount = Math.max(canonicalUrls.length, dataUrls.length)

  for (let index = 0; index < pairCount; index++) {
    if (canonicalUrls[index]) pool.push(canonicalUrls[index])
    if (dataUrls[index]) pool.push(dataUrls[index])
  }
  if (staticAssetUrl) pool.push(staticAssetUrl)

  if (!Number.isInteger(count) || count <= 0) {
    throw new TypeError('count must be a positive integer')
  }
  if (pool.length === 0) throw new Error('no canonical probe URLs found')

  return Array.from({ length: count }, (_, index) => pool[index % pool.length])
}

export function summarize(records) {
  const statuses = {}
  const durations = records
    .map(record => record.durationMs)
    .sort((a, b) => a - b)
  for (const record of records) {
    if (record.status)
      statuses[record.status] = (statuses[record.status] || 0) + 1
  }
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1)
  return {
    requests: records.length,
    statuses,
    networkErrors: records.filter(record => record.networkError).length,
    p95Ms: durations[p95Index] || 0
  }
}

export function hasAcceptanceFailures(summary) {
  if (summary.networkErrors > 0) return true
  return Object.entries(summary.statuses).some(
    ([status, count]) =>
      count > 0 && (Number(status) < 200 || Number(status) >= 300)
  )
}

async function fetchText(url, label) {
  const response = await fetch(url)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`)
  }
  return body
}

async function probeOne(url, mode) {
  const started = performance.now()
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers:
        mode === 'cold'
          ? { 'cache-control': 'no-cache', pragma: 'no-cache' }
          : undefined
    })
    await response.arrayBuffer()
    return {
      url,
      status: response.status,
      durationMs: Math.round(performance.now() - started),
      cacheStatus:
        response.headers.get('eo-cache-status') ||
        response.headers.get('x-cache'),
      nwsLogUuid: response.headers.get('x-nws-log-uuid'),
      edgeoneRequestId: response.headers.get('x-edgeone-request-id'),
      functionRequestId: response.headers.get('x-function-request-id')
    }
  } catch (error) {
    return {
      url,
      durationMs: Math.round(performance.now() - started),
      networkError: error?.cause?.code || error.message
    }
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    // Skip pnpm/npm double-dash separator
    if (arg === '--') continue
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=')
      args[key] = value
    }
  }
  return args
}

async function main(argv) {
  const args = parseArgs(argv)
  const baseUrl = args['base-url']
  const mode = args.mode || 'warm'
  const count = parseInt(args.count || '180', 10)
  const outPath = args.out

  if (!baseUrl) {
    console.error(
      'usage: probe-edgeone --base-url=<url> --mode=warm|cold --count=<n> --out=<path>'
    )
    process.exit(1)
  }

  // Step 1: Fetch home page to get buildId and locale
  const targetBaseUrl = new URL(baseUrl)
  const homeUrl = new URL('/', targetBaseUrl)
  const homeText = await fetchText(homeUrl, 'home page')
  const nextDataMatch = homeText.match(
    /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/
  )
  if (!nextDataMatch) {
    console.error('Could not find __NEXT_DATA__ in home page')
    process.exit(1)
  }
  const nextData = JSON.parse(nextDataMatch[1])
  const buildId = nextData.buildId
  const locale = nextData.locale || 'zh-CN'
  if (locale !== 'zh-CN') {
    throw new Error(`unsupported production probe locale: ${locale}`)
  }

  // Step 2: Fetch sitemap and extract canonical URLs
  const sitemapXml = await fetchText(
    new URL('/sitemap.xml', targetBaseUrl),
    'sitemap'
  )
  const canonicalUrls = extractCanonicalUrls(sitemapXml, targetBaseUrl)

  // Add /archive
  canonicalUrls.push(new URL('/archive', targetBaseUrl).href)
  const uniqueCanonicalUrls = [...new Set(canonicalUrls)]

  // Step 3: Build page-data URLs
  const dataUrls = uniqueCanonicalUrls.map(pageUrl =>
    buildPageDataUrl({ pageUrl, baseUrl: targetBaseUrl, buildId, locale })
  )

  // Step 4: Discover a static asset from home HTML
  const staticAssetMatch = homeText.match(/"\/_next\/static\/([^"]+)"/)
  const staticAssetUrl = staticAssetMatch
    ? new URL(`/_next/static/${staticAssetMatch[1]}`, targetBaseUrl).href
    : null

  // Step 5: Build exactly count requests across HTML, page data, and a static asset
  const urlsToProbe = buildProbeUrls({
    canonicalUrls: uniqueCanonicalUrls,
    dataUrls,
    staticAssetUrl,
    count
  })

  // Step 6: Set concurrency
  const concurrency = mode === 'warm' ? 6 : 3

  // Step 7: Execute probes with concurrency control
  const records = []
  for (let i = 0; i < urlsToProbe.length; i += concurrency) {
    const batch = urlsToProbe.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(url => probeOne(url, mode))
    )
    records.push(...batchResults)
  }

  // Step 8: Compute summary
  const summary = summarize(records)

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    buildId,
    mode,
    summary,
    records
  }

  // Step 9: Write report
  if (outPath) {
    const fs = await import('node:fs')
    const path = await import('node:path')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  } else {
    console.log(JSON.stringify(report, null, 2))
  }

  // Step 10: Exit non-zero on any failed request
  if (hasAcceptanceFailures(summary)) {
    process.exit(1)
  }
}

// Only run main when executed directly, not imported as a module
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main(process.argv.slice(2))
}
