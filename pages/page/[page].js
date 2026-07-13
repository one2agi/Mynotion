import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { fetchGlobalAllData, getPostBlocks } from '@/lib/db/SiteDataApi'
import { formatNotionBlock } from '@/lib/db/notion/getPostBlocks'
import { adapterNotionBlockMap } from '@/lib/utils/notion.util'
import { DynamicLayout } from '@/themes/theme'
import { setPublicPageCache } from '@/lib/cache/publicPageCache'

/**
 * 文章列表分页
 * @param {*} props
 * @returns
 */
const Page = props => {
  const theme = siteConfig('THEME', BLOG.THEME, props.NOTION_CONFIG)
  return <DynamicLayout theme={theme} layoutName='LayoutPostList' {...props} />
}

// SSR (was getStaticProps + getStaticPaths) — required so the
// /_next/data/{buildId}/zh-CN/page/{N}.json data endpoint is generated at
// request time. With rewrites for locale stripping (next.config.js), Next.js
// does not generate data files for rewritten source paths — converting to
// getServerSideProps skips that lookup and fixes the client-side router's
// prefetch 404 (which previously forced full page reloads).
//
// getStaticPaths is removed entirely (incompatible with getServerSideProps).
// Invalid page numbers (non-numeric, <= 0, or beyond available pages) return
// { notFound: true } so Next.js serves the 404 page instead of an empty list.
export async function getServerSideProps({ params, locale, res }) {
  setPublicPageCache(res)
  const pageNum = parseInt(params.page, 10)
  if (Number.isNaN(pageNum) || pageNum < 2) {
    // page=1 is served by the home page; only page >= 2 is valid here
    return { notFound: true }
  }

  const from = `page-${params.page}`
  const props = await fetchGlobalAllData({ from, locale })
  const { allPages } = props
  const POST_PREVIEW_LINES = siteConfig(
    'POST_PREVIEW_LINES',
    12,
    props?.NOTION_CONFIG
  )

  const allPosts = allPages?.filter(
    page => page.type === 'Post' && page.status === 'Published'
  )
  const POSTS_PER_PAGE = siteConfig('POSTS_PER_PAGE', 12, props?.NOTION_CONFIG)

  // Beyond available data → notFound
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE)
  if (pageNum > totalPages) {
    return { notFound: true }
  }

  // 处理分页
  props.posts = allPosts.slice(
    POSTS_PER_PAGE * (pageNum - 1),
    POSTS_PER_PAGE * pageNum
  )
  props.page = pageNum

  // 处理预览
  if (siteConfig('POST_LIST_PREVIEW', false, props?.NOTION_CONFIG)) {
    for (const i in props.posts) {
      const post = props.posts[i]
      if (post.password && post.password !== '') {
        continue
      }
      const rawBlockMap = await getPostBlocks(post.id, 'slug', POST_PREVIEW_LINES)
      post.blockMap = adapterNotionBlockMap(rawBlockMap)
      if (post.blockMap?.block) {
        post.blockMap.block = formatNotionBlock(post.blockMap.block)
      }
    }
  }

  delete props.allPages
  return { props }
}

export default Page
