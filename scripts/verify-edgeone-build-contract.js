const fs = require('node:fs')
const path = require('node:path')

const REQUIRED_LOCALE_REWRITES = [
  {
    source: '/_next/data/:buildId/zh-CN.json',
    destination: '/_next/data/:buildId/index.json'
  },
  {
    source: '/_next/data/:buildId/zh-CN/archive.json',
    destination: '/_next/data/:buildId/archive.json'
  },
  {
    source: '/_next/data/:buildId/zh-CN/page/*.json',
    destination: '/_next/data/:buildId/page/:splat.json'
  }
]

const REQUIRED_BLOCKING_DYNAMIC_ROUTES = [
  '/search/[keyword]',
  '/search/[keyword]/page/[page]',
  '/[prefix]',
  '/tag/[tag]/page/[page]',
  '/category/[category]',
  '/tag/[tag]',
  '/category/[category]/page/[page]',
  '/[prefix]/[slug]',
  '/page/[page]',
  '/[prefix]/[slug]/[...suffix]'
]

function sameRule(left, right) {
  return (
    left?.source === right.source && left?.destination === right.destination
  )
}

function verifyBuildContract({ buildId, manifest, edgeoneConfig, locale }) {
  if (!buildId) throw new Error('missing Next.js Build ID')
  if (locale !== 'zh-CN')
    throw new Error(`unsupported contract locale: ${locale}`)

  for (const rule of REQUIRED_LOCALE_REWRITES) {
    if (
      !(edgeoneConfig.rewrites || []).some(candidate =>
        sameRule(candidate, rule)
      )
    ) {
      throw new Error(`missing EdgeOne locale data rewrite: ${rule.source}`)
    }
  }

  const localeRoutePrefix = `/${locale}`
  const escapedLocale = locale.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const generalPaginationPattern = new RegExp(`^/${escapedLocale}/page/\\d+$`)
  const pagination = Object.keys(manifest.routes || {})
    .filter(route => generalPaginationPattern.test(route))
    .sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()))
  const checkedRoutes = [
    localeRoutePrefix,
    `${localeRoutePrefix}/archive`,
    ...pagination
  ]

  for (const route of checkedRoutes) {
    const entry = manifest.routes?.[route]
    if (!entry) throw new Error(`missing prerender route: ${route}`)
    if (entry.initialRevalidateSeconds !== 300) {
      throw new Error(
        `route ${route} revalidates at ${entry.initialRevalidateSeconds}`
      )
    }
    const stripped = route.slice(localeRoutePrefix.length)
    const expectedDataRoute = `/_next/data/${buildId}${
      stripped === '' ? '/index' : stripped
    }.json`
    if (entry.dataRoute !== expectedDataRoute) {
      throw new Error(
        `route ${route} has invalid data route: ${entry.dataRoute}`
      )
    }
  }

  for (const [route, entry] of Object.entries(manifest.routes || {})) {
    if (
      entry.initialRevalidateSeconds !== false &&
      entry.initialRevalidateSeconds !== 300
    ) {
      throw new Error(
        `public route ${route} revalidates at ${entry.initialRevalidateSeconds}`
      )
    }
  }

  for (const route of REQUIRED_BLOCKING_DYNAMIC_ROUTES) {
    const entry = manifest.dynamicRoutes?.[route]
    if (!entry || entry.fallback !== null) {
      throw new Error(`dynamic route ${route} is not blocking fallback`)
    }
  }

  return { buildId, checkedRoutes }
}

function verifyFromDisk(root = process.cwd()) {
  const buildId = fs
    .readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8')
    .trim()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, '.next/prerender-manifest.json'), 'utf8')
  )
  const edgeoneConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'edgeone.json'), 'utf8')
  )
  return verifyBuildContract({
    buildId,
    manifest,
    edgeoneConfig,
    locale: 'zh-CN'
  })
}

if (require.main === module) {
  try {
    const result = verifyFromDisk()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = {
  REQUIRED_BLOCKING_DYNAMIC_ROUTES,
  REQUIRED_LOCALE_REWRITES,
  verifyBuildContract,
  verifyFromDisk
}
