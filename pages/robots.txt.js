// pages/robots.txt.js
// 动态生成 robots.txt，从 Notion LINK 配置读取站点地址
import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'
import { extractLangId, extractLangPrefix } from '@/lib/utils/pageId'
import { isLandingSite } from '@/lib/site-role'

export const getServerSideProps = async ctx => {
  const { res } = ctx

  let link = BLOG.LINK // 默认值

  if (isLandingSite()) {
    link = siteConfig('LINK', BLOG.LINK)
  } else {
    // 取第一个站点的配置
    const siteIds = BLOG.NOTION_PAGE_ID.split(',')
    if (siteIds.length > 0) {
      const firstSiteId = siteIds[0]
      const id = extractLangId(firstSiteId)
      const siteData = await fetchGlobalAllData({
        pageId: id,
        from: 'robots.txt'
      })
      link =
        siteConfig('LINK', siteData?.siteInfo?.link, siteData.NOTION_CONFIG) ||
        link
    }
  }

  // 确认为有效 URL
  let siteUrl = link
  try {
    siteUrl = new URL(link).origin
  } catch {
    siteUrl = 'https://jichang.world'
  }

  const robotsTxt = [
    '# *',
    'User-agent: *',
    'Allow: /',
    '',
    '# Host',
    `Host: ${siteUrl}`,
    '',
    '# Sitemaps',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    ''
  ].join('\n')

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader(
    'Cache-Control',
    'public, max-age=3600, stale-while-revalidate=59'
  )
  res.statusCode = 200
  res.end(robotsTxt)

  return { props: {} }
}

export default () => null
