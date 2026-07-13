import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'
import { getPublicContentRevalidateSeconds } from '@/lib/cache/publicContentCache'
import { DynamicLayout } from '@/themes/theme'
import { useRouter } from 'next/router'

/**
 * 标签首页
 * @param {*} props
 * @returns
 */
const TagIndex = props => {
  const router = useRouter()
  const theme = siteConfig('THEME', BLOG.THEME, props.NOTION_CONFIG)
  return <DynamicLayout theme={theme} layoutName='LayoutTagIndex' {...props} />
}

export async function getStaticProps(req) {
  const { locale } = req

  const from = 'tag-index-props'
  const props = await fetchGlobalAllData({ from, locale })
  delete props.allPages
  return {
    props,
    revalidate: getPublicContentRevalidateSeconds(props.NOTION_CONFIG)
  }
}

export default TagIndex
