// pages/llms.txt.js
// 动态生成 llms.txt，为 AI 爬虫提供站点内容索引
import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'
import { extractLangId, extractLangPrefix } from '@/lib/utils/pageId'
import { isLandingSite } from '@/lib/site-role'

export const getServerSideProps = async ctx => {
  const { res } = ctx
  let lines = []

  if (isLandingSite()) {
    const link = siteConfig('LINK', BLOG.LINK)
    lines.push(`# ${BLOG.TITLE}\n`)
    lines.push(`URL: ${link}\n`)
    lines.push(`Description: ${BLOG.DESCRIPTION || ''}\n`)
  } else {
    const siteIds = BLOG.NOTION_PAGE_ID.split(',')

    for (let index = 0; index < siteIds.length; index++) {
      const siteId = siteIds[index]
      const id = extractLangId(siteId)
      const locale = extractLangPrefix(siteId) || 'zh'
      const siteData = await fetchGlobalAllData({
        pageId: id,
        from: 'llms.txt'
      })
      const link = siteConfig(
        'LINK',
        siteData?.siteInfo?.link,
        siteData.NOTION_CONFIG
      )
      const posts = (siteData?.allPages || [])
        .filter(p => p.status === BLOG.NOTION_PROPERTY_NAME.status_publish)
        .filter(p => p.slug && !p.slug.startsWith('http') && !p.slug.startsWith('#'))
        .sort((a, b) => {
          const dateA = a.publishDay ? new Date(a.publishDay) : new Date(0)
          const dateB = b.publishDay ? new Date(b.publishDay) : new Date(0)
          return dateB - dateA
        })

      if (index > 0) {
        lines.push('\n---\n')
      }

      for (const post of posts) {
        const postUrl = `${link}/${post.slug}`
        const title = post.title || 'Untitled'
        const summary = post.summary || post.description || ''
        const updated = post.publishDay || ''

        lines.push(`Title: ${title}`)
        lines.push(`URL: ${postUrl}`)
        if (summary) {
          lines.push(`Summary: ${summary.replace(/\n/g, ' ').trim()}`)
        }
        if (updated) {
          const d = new Date(updated)
          if (!isNaN(d)) {
            lines.push(`Updated: ${d.toISOString().split('T')[0]}`)
          }
        }
        lines.push('---')
      }
    }
  }

  const content = lines.join('\n') + '\n'

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader(
    'Cache-Control',
    'public, max-age=3600, stale-while-revalidate=59'
  )
  res.statusCode = 200
  res.end(content)

  return { props: {} }
}

export default () => null
