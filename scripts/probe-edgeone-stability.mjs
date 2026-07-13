export function extractCanonicalUrls(xml, baseUrl) {
  const found = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map(match => new URL(match[1].trim(), baseUrl))
    .filter(url => url.origin === baseUrl.origin)
    .map(url => {
      url.hash = ''
      return url.href
    })
  return [...new Set(found)]
}

export function summarize(records) {
  const statuses = {}
  const durations = records.map(record => record.durationMs).sort((a, b) => a - b)
  for (const record of records) {
    if (record.status) statuses[record.status] = (statuses[record.status] || 0) + 1
  }
  const p95Index = Math.max(0, Math.ceil(durations.length * 0.95) - 1)
  return {
    requests: records.length,
    statuses,
    networkErrors: records.filter(record => record.networkError).length,
    p95Ms: durations[p95Index] || 0
  }
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
    console.error('usage: probe-edgeone --base-url=<url> --mode=warm|cold --count=<n> --out=<path>')
    process.exit(1)
  }

  // Step 1: Fetch home page to get buildId and locale
  const homeResponse = await fetch(baseUrl)
  const homeText = await homeResponse.text()
  const nextDataMatch = homeText.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/)
  if (!nextDataMatch) {
    console.error('Could not find __NEXT_DATA__ in home page')
    process.exit(1)
  }
  const nextData = JSON.parse(nextDataMatch[1])
  const buildId = nextData.buildId
  const locale = nextData.locale || 'zh-CN'

  // Step 2: Fetch sitemap and extract canonical URLs
  const sitemapResponse = await fetch(`${baseUrl}/sitemap.xml`)
  const sitemapXml = await sitemapResponse.text()
  const canonicalUrls = extractCanonicalUrls(sitemapXml, new URL(baseUrl))

  // Add /archive
  const archiveUrl = new URL(`${baseUrl}/archive`)
  canonicalUrls.push(archiveUrl.href)

  // Step 3: Build page-data URLs
  const dataUrls = canonicalUrls.map(url => {
    const parsed = new URL(url)
    // For home page: /_next/data/{buildId}/{locale}.json
    // For others: /_next/data/{buildId}/{locale}/path.json
    const pathname = parsed.pathname
    if (pathname === '/') {
      return `/_next/data/${buildId}/${locale}.json`
    } else {
      const cleanPath = pathname.replace(/\/$/, '')
      return `/_next/data/${buildId}/${locale}${cleanPath}.json`
    }
  })

  // Step 4: Discover a static asset from home HTML
  const staticAssetMatch = homeText.match(/"\/_next\/static\/([^"]+)"/)
  const staticAssetUrl = staticAssetMatch
    ? `${baseUrl}/_next/static/${staticAssetMatch[1]}`
    : null

  // Step 5: Build request list - round-robin canonical HTML, page data, and static asset
  const urlsToProbe = []
  const staticAssets = staticAssetUrl ? [staticAssetUrl] : []

  for (let i = 0; i < count; i++) {
    const htmlIdx = i % canonicalUrls.length
    const dataIdx = i % dataUrls.length
    const staticIdx = i % staticAssets.length

    urlsToProbe.push(canonicalUrls[htmlIdx])
    urlsToProbe.push(dataUrls[dataIdx])
    if (staticAssets.length > 0) {
      urlsToProbe.push(staticAssets[staticIdx])
    }
  }

  // Step 6: Set concurrency
  const concurrency = mode === 'warm' ? 6 : 3

  // Step 7: Execute probes with concurrency control
  const records = []
  for (let i = 0; i < urlsToProbe.length; i += concurrency) {
    const batch = urlsToProbe.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(url => probeOne(new URL(url, baseUrl).href, mode))
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

  // Step 10: Exit non-zero on 545 or network errors
  if ((summary.statuses['545'] || 0) > 0 || summary.networkErrors > 0) {
    process.exit(1)
  }
}

// Only run main when executed directly, not imported as a module
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  main(process.argv.slice(2))
}
