import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { resolvePostProps } from '@/lib/db/SiteDataApi'
import Slug, { resolveStoredSlugResult } from '..'
import { getStaticPathsBase } from '@/lib/build/staticPaths'
import { getPublicContentRevalidateSeconds } from '@/lib/cache/publicContentCache'
import { checkSlugHasOneSlash } from '@/lib/utils/post'

/**
 * 根据notion的slug访问页面
 * 解析二级目录 /article/about
 * @param {*} props
 * @returns
 */
const PrefixSlug = props => {
  return <Slug {...props} />
}

export async function getStaticPaths() {
  return getStaticPathsBase({
    from: 'slug-paths',
    filterFn: row => checkSlugHasOneSlash(row),
    mapPageToParams: row => ({
      params: {
        prefix: row.slug.split('/')[0],
        slug: row.slug.split('/')[1]
      }
    })
  })
}

export async function getStaticProps({
  params: { prefix, slug },
  locale,
  revalidateReason
}) {
  const { getStoredRedirect, isExplicitlyPrivate } = await import(
    '@/lib/notion-webhook/routeState'
  )
  const props = await resolvePostProps({
    prefix,
    slug,
    locale,
    isPageExplicitlyPrivate: isExplicitlyPrivate,
    allowSourceConfirmedWithoutRouteState:
      revalidateReason === 'build' && !BLOG.REDIS_URL
  })

  return resolveStoredSlugResult({
    props,
    segments: [prefix, slug],
    locale,
    revalidate: getPublicContentRevalidateSeconds(props.NOTION_CONFIG),
    readStoredRedirect: getStoredRedirect
  })
}

export default PrefixSlug
