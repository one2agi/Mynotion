import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { resolvePostProps } from '@/lib/db/SiteDataApi'
import { getStaticPathsBase } from '@/lib/build/staticPaths'
import { getPublicContentRevalidateSeconds } from '@/lib/cache/publicContentCache'
import { checkSlugHasMorThanTwoSlash } from '@/lib/utils/post'
import Slug, { resolveStoredSlugResult } from '..'

/**
 * 根据notion的slug访问页面
 * 解析三级以上目录 /article/2023/10/29/test
 * @param {*} props
 * @returns
 */
const PrefixSlug = props => {
  return <Slug {...props} />
}

export async function getStaticPaths() {
  return getStaticPathsBase({
    from: 'slug-paths',
    filterFn: row => checkSlugHasMorThanTwoSlash(row),
    mapPageToParams: row => ({
      params: {
        prefix: row.slug.split('/')[0],
        slug: row.slug.split('/')[1],
        suffix: row.slug.split('/').slice(2)
      }
    })
  })
}

/**
 * 抓取页面数据
 * @param {*} param0
 * @returns
 */
export async function getStaticProps({
  params: { prefix, slug, suffix },
  locale,
  revalidateReason
}) {
  const { getStoredRedirect, isExplicitlyPrivate } = await import(
    '@/lib/notion-webhook/routeState'
  )
  const props = await resolvePostProps({
    prefix,
    slug,
    suffix,
    locale,
    isPageExplicitlyPrivate: isExplicitlyPrivate,
    allowSourceConfirmedWithoutRouteState:
      revalidateReason === 'build' && !BLOG.REDIS_URL
  })

  return resolveStoredSlugResult({
    props,
    segments: [prefix, slug, ...suffix],
    locale,
    revalidate: getPublicContentRevalidateSeconds(props.NOTION_CONFIG),
    readStoredRedirect: getStoredRedirect
  })
}

export default PrefixSlug
