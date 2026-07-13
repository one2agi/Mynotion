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

function sameRule(left, right) {
  return left?.source === right.source && left?.destination === right.destination
}

function verifyBuildContract({ buildId, manifest, edgeoneConfig, locale }) {
  if (!buildId) throw new Error('missing Next.js Build ID')
  if (locale !== 'zh-CN') throw new Error(`unsupported contract locale: ${locale}`)

  for (const rule of REQUIRED_LOCALE_REWRITES) {
    if (!(edgeoneConfig.rewrites || []).some(candidate => sameRule(candidate, rule))) {
      throw new Error(`missing EdgeOne locale data rewrite: ${rule.source}`)
    }
  }

  // Build routes use locale prefix (e.g. /zh-CN, /zh-CN/archive); data routes are stripped of locale
  const localeRoutePrefix = 'zh-CN'
  // Match pagination routes regardless of locale prefix (e.g. /page/2 or /zh-CN/page/2)
  const pagination = Object.keys(manifest.routes || {})
    .filter(route => /\/page\/\d+$/.test(route))
    .sort((a, b) => Number(a.split('/').pop()) - Number(b.split('/').pop()))
  const checkedRoutes = [`/${localeRoutePrefix}`, `/${localeRoutePrefix}/archive`, ...pagination]

  for (const route of checkedRoutes) {
    const entry = manifest.routes?.[route]
    if (!entry) throw new Error(`missing prerender route: ${route}`)
    if (entry.initialRevalidateSeconds !== 300) {
      throw new Error(`route ${route} revalidates at ${entry.initialRevalidateSeconds}`)
    }
    // data route should be stripped of locale prefix; home page maps to index.json
    const stripped = route.replace(`/${localeRoutePrefix}`, '')
    const expectedDataRouteSuffix = stripped === '' ? 'index' : stripped
    if (!entry.dataRoute?.endsWith(`${expectedDataRouteSuffix}.json`)) {
      throw new Error(`route ${route} has invalid data route: ${entry.dataRoute}`)
    }
  }

  return { buildId, checkedRoutes }
}

function verifyFromDisk(root = process.cwd()) {
  const buildId = fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim()
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, '.next/prerender-manifest.json'), 'utf8')
  )
  const edgeoneConfig = JSON.parse(
    fs.readFileSync(path.join(root, 'edgeone.json'), 'utf8')
  )
  return verifyBuildContract({ buildId, manifest, edgeoneConfig, locale: 'zh-CN' })
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
  REQUIRED_LOCALE_REWRITES,
  verifyBuildContract,
  verifyFromDisk
}
