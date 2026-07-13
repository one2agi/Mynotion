import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'

export const DEFAULT_PUBLIC_CONTENT_REVALIDATE_SECONDS = 300

export function getPublicContentRevalidateSeconds(notionConfig) {
  if (process.env.EXPORT === 'true') return undefined

  const configured = Number(
    siteConfig(
      'NEXT_REVALIDATE_SECOND',
      BLOG.NEXT_REVALIDATE_SECOND,
      notionConfig
    )
  )

  if (!Number.isFinite(configured) || configured <= 0) {
    return DEFAULT_PUBLIC_CONTENT_REVALIDATE_SECONDS
  }

  return Math.floor(configured)
}
