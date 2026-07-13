const COMPACT_NOTION_ID = /^[a-f0-9]{32}$/i
const NOTION_UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

export function isLegacyNotionId(value) {
  if (typeof value !== 'string') return false
  return COMPACT_NOTION_ID.test(value) || NOTION_UUID.test(value)
}

function normalizeNotionId(value) {
  if (!isLegacyNotionId(value)) return null
  const compact = value.replaceAll('-', '').toLowerCase()
  return [
    compact.slice(0, 8),
    compact.slice(8, 12),
    compact.slice(12, 16),
    compact.slice(16, 20),
    compact.slice(20)
  ].join('-')
}

export function resolveLegacyNotionRedirect({ value, allPages, locale }) {
  const normalizedId = normalizeNotionId(value)
  if (!normalizedId || !Array.isArray(allPages)) return null

  const page = allPages.find(candidate => {
    const href = candidate?.href
    return (
      normalizeNotionId(candidate?.id) === normalizedId &&
      candidate?.status === 'Published' &&
      !candidate?.type?.includes('Menu') &&
      typeof href === 'string' &&
      href.startsWith('/') &&
      !href.startsWith('//')
    )
  })
  if (!page) return null

  const cleanLocale = String(locale || '').replace(/^\/+|\/+$/g, '')
  const localePrefix = cleanLocale ? `/${cleanLocale}` : ''
  const destination =
    localePrefix && !page.href.startsWith(`${localePrefix}/`)
      ? `${localePrefix}${page.href}`
      : page.href

  return { destination, permanent: true }
}
