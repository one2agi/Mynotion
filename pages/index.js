import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import {
  cleanPostSummaries,
  fetchGlobalAllData,
  getPostBlocks
} from '@/lib/db/SiteDataApi'
import { formatNotionBlock } from '@/lib/db/notion/getPostBlocks'
import { DynamicLayout } from '@/themes/theme'
import pLimit from 'p-limit'
import { adapterNotionBlockMap } from '@/lib/utils/notion.util'
import { getPublicContentRevalidateSeconds } from '@/lib/cache/publicContentCache'

/**
 * 首页布局
 * @param {*} props
 * @returns
 */
const Index = props => {
  const theme = siteConfig('THEME', BLOG.THEME, props.NOTION_CONFIG)
  return <DynamicLayout theme={theme} layoutName='LayoutIndex' {...props} />
}

/**
 * ISR data fetching.
 */
export async function getStaticProps({ locale }) {
  const from = 'index'
  const props = await fetchGlobalAllData({ from, locale })
  if (process.env.NODE_ENV === 'development') {
    const configTheme = BLOG.THEME
    const notionTheme = props?.NOTION_CONFIG?.THEME || null
    const finalTheme = siteConfig('THEME', BLOG.THEME, props?.NOTION_CONFIG)
    const source = notionTheme ? 'notion:config' : 'blog/env:config'
    console.log(
      '[ThemeResolver][static-props]',
      JSON.stringify({
        route: '/',
        configTheme,
        notionTheme,
        finalTheme,
        source
      })
    )
  }
  const POST_PREVIEW_LINES = siteConfig(
    'POST_PREVIEW_LINES',
    8,
    props?.NOTION_CONFIG
  )
  const POST_PREVIEW_MAX_COUNT = siteConfig(
    'POST_PREVIEW_MAX_COUNT',
    4,
    props?.NOTION_CONFIG
  )
  const POST_LIST_PREVIEW = siteConfig(
    'POST_LIST_PREVIEW',
    false,
    props?.NOTION_CONFIG
  )
  props.posts = props.allPages?.filter(
    page => page.type === 'Post' && page.status === 'Published'
  )

  // 处理分页
  const POST_LIST_STYLE = siteConfig(
    'POST_LIST_STYLE',
    'page',
    props?.NOTION_CONFIG
  )
  if (POST_LIST_STYLE === 'scroll') {
    // 滚动列表默认给前端返回所有数据
  } else if (POST_LIST_STYLE === 'page') {
    props.posts = props.posts?.slice(
      0,
      siteConfig('POSTS_PER_PAGE', 12, props?.NOTION_CONFIG)
    )
  }

  // 预览文章内容
  if (POST_LIST_PREVIEW) {
    const previewLimit = pLimit(
      siteConfig('POST_PREVIEW_CONCURRENCY', 5, props?.NOTION_CONFIG)
    )
    const previewTargets = props.posts.filter(
      post => !post.password || post.password === ''
    ).slice(0, POST_PREVIEW_MAX_COUNT)
    await Promise.all(
      previewTargets.map(post =>
        previewLimit(async () => {
          const rawBlockMap = await getPostBlocks(post.id, 'slug', POST_PREVIEW_LINES)
          post.blockMap = adapterNotionBlockMap(rawBlockMap)
          if (post.blockMap?.block) {
            post.blockMap.block = formatNotionBlock(post.blockMap.block)
          }
        })
      )
    )
  }

  if (!POST_LIST_PREVIEW) {
    props.posts = cleanPostSummaries(props.posts)
  }
  props.latestPosts = cleanPostSummaries(props.latestPosts)
  delete props.allPages

  return {
    props,
    revalidate: getPublicContentRevalidateSeconds(props.NOTION_CONFIG)
  }
}

export default Index
