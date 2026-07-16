const DEPLOYMENT_ROLES = new Set(['landing', 'content'])

export function getSiteRole(env = process.env) {
  const role = String(env?.NEXT_PUBLIC_SITE_ROLE || '')
    .trim()
    .toLowerCase()
  return DEPLOYMENT_ROLES.has(role) ? role : 'standalone'
}

export function isLandingSite(env = process.env) {
  return getSiteRole(env) === 'landing'
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    return new URL(value).origin
  } catch {
    return ''
  }
}

function isRootPath(pathname) {
  return pathname === '' || pathname === '/'
}

export function resolveSiteHref(
  href,
  {
    role = getSiteRole(),
    currentSiteUrl = process.env.NEXT_PUBLIC_LINK || '',
    contentSiteUrl = process.env.NEXT_PUBLIC_CONTENT_SITE_URL || ''
  } = {}
) {
  if (role !== 'landing' || href == null) return href

  if (typeof href === 'object') {
    if (typeof href.pathname !== 'string') return href
    const pathname = resolveSiteHref(href.pathname, {
      role,
      currentSiteUrl,
      contentSiteUrl
    })
    if (pathname === href.pathname || typeof pathname !== 'string') return href

    const url = new URL(pathname)
    for (const [key, rawValue] of Object.entries(href.query || {})) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue]
      for (const value of values) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value))
        }
      }
    }
    if (href.hash) {
      url.hash = String(href.hash).replace(/^#/, '')
    }
    return url.toString()
  }

  if (typeof href !== 'string' || !href || href.startsWith('#')) return href
  if (/^(mailto:|tel:|sms:|javascript:)/i.test(href)) return href

  const contentOrigin = normalizeOrigin(contentSiteUrl)
  if (!contentOrigin) return href

  const currentOrigin =
    normalizeOrigin(currentSiteUrl) || 'https://landing.invalid'
  let parsed
  try {
    parsed = new URL(href, currentOrigin)
  } catch {
    return href
  }

  if (!/^https?:$/.test(parsed.protocol)) return href
  if (parsed.origin !== currentOrigin && parsed.origin !== contentOrigin) {
    return href
  }
  if (isRootPath(parsed.pathname)) return href

  return `${contentOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function isOwnedContentHref(
  href,
  contentSiteUrl = process.env.NEXT_PUBLIC_CONTENT_SITE_URL || ''
) {
  if (typeof href !== 'string') return false
  const contentOrigin = normalizeOrigin(contentSiteUrl)
  if (!contentOrigin) return false
  try {
    return (
      new URL(href, contentOrigin).origin === contentOrigin &&
      /^https?:\/\//i.test(href)
    )
  } catch {
    return false
  }
}
