import { siteConfig } from '@/lib/config'
import { useGlobal } from '@/lib/global'
import { isClipperSite } from '@/lib/site-role'
import { createSiteUrl, normalizeSiteUrl } from '@/lib/sitemap-utils'
import { isHttpLink, loadExternalResource } from '@/lib/utils'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect } from 'react'

export const CLIPPER_ZH_KEYWORDS =
  'Notion剪藏, Notion Clipper, 网页剪藏插件, Save to Notion, Chrome扩展, 第二大脑, 智能剪藏, 浏览器插件'
export const CLIPPER_EN_KEYWORDS =
  'Notion Clipper, Notion Web Clipper, Save to Notion, Chrome extension, web clipper for Notion, Notion workflow, digital notes'
export const CLIPPER_EN_TITLE =
  'one2notion · Smart Clipper & Knowledge Hub for Notion | High-Fidelity Web Clipper, Canvas Annotations, Code Blocks & Lifetime License'
export const CLIPPER_EN_DESCRIPTION =
  'The ultimate Notion web clipper browser extension. High-fidelity layouts, code blocks, canvas image annotations, inline notes, and lifetime license. Zero server transit, direct Notion sync.'

export const getClipperKeywords = ({ isEn, customKeywords }) => {
  const defaultKeywords = isEn ? CLIPPER_EN_KEYWORDS : CLIPPER_ZH_KEYWORDS
  if (
    !customKeywords ||
    customKeywords === 'AI赋能' ||
    customKeywords === defaultKeywords
  ) {
    return defaultKeywords
  }
  return `${defaultKeywords}, ${customKeywords}`
}

export const getClipperAlternateLinks = siteUrl => {
  const base = normalizeSiteUrl(siteUrl)
  return [
    { hrefLang: 'zh-CN', href: createSiteUrl(base, '') || base },
    { hrefLang: 'en', href: createSiteUrl(base, 'en') || `${base}/en` },
    { hrefLang: 'x-default', href: createSiteUrl(base, '') || base }
  ]
}

export const getClipperLandingMeta = ({ isEn, siteInfo }) => {
  if (isEn) {
    return {
      title: CLIPPER_EN_TITLE,
      description: CLIPPER_EN_DESCRIPTION,
      image: `${siteInfo?.pageCover}`,
      slug: 'en',
      type: 'website'
    }
  }
  return {
    title: `${siteInfo?.title} | ${siteInfo?.description}`,
    description: `${siteInfo?.description}`,
    image: `${siteInfo?.pageCover}`,
    slug: '',
    type: 'website'
  }
}

/**
 * 页面的Head头，有用于SEO
 * @param {*} param0
 * @returns
 */
const SEO = props => {
  const { children, siteInfo, post, NOTION_CONFIG } = props
  const PATH = siteConfig('PATH')
  const LINK = normalizeSiteUrl(
    siteConfig('LINK', siteInfo?.link, NOTION_CONFIG)
  )
  const SUB_PATH = siteConfig('SUB_PATH', '')
  let url = PATH?.length ? createSiteUrl(LINK, SUB_PATH) || LINK : LINK
  let image
  const router = useRouter()
  const meta = getSEOMeta(props, router, useGlobal()?.locale)
  const webFontUrl = siteConfig('FONT_URL')
  const hasWebFontUrl = Array.isArray(webFontUrl)
    ? webFontUrl.filter(Boolean).length > 0
    : Boolean(webFontUrl)

  useEffect(() => {
    if (!hasWebFontUrl) return

    const timeoutId = window.setTimeout(() => {
      // 使用WebFontLoader字体加载
      loadExternalResource(
        'https://cdnjs.cloudflare.com/ajax/libs/webfont/1.6.28/webfontloader.js',
        'js'
      ).then(url => {
        const WebFont = window?.WebFont
        if (WebFont) {
          // console.log('LoadWebFont', webFontUrl)
          WebFont.load({
            custom: {
              // families: ['"LXGW WenKai"'],
              urls: webFontUrl
            }
          })
        }
      })
    }, 1500)

    return () => window.clearTimeout(timeoutId)
  }, [hasWebFontUrl, webFontUrl])

  const isClipper = isClipperSite()
  const isEn =
    router?.locale === 'en' ||
    (typeof router?.asPath === 'string' && router.asPath.startsWith('/en'))

  // SEO关键词
  const KEYWORDS = siteConfig('KEYWORDS')
  let keywords = meta?.tags || KEYWORDS
  if (post?.tags && post?.tags?.length > 0) {
    keywords = post?.tags?.join(',')
  } else if (isClipper) {
    keywords = getClipperKeywords({ isEn, customKeywords: KEYWORDS })
  }
  if (meta) {
    url = createSiteUrl(url, meta.slug) || url
    image = getAbsoluteImageUrl(meta.image || '/bg_image.jpg', LINK)
  }
  const TITLE = siteConfig('TITLE')
  const title = meta?.title || TITLE
  const description =
    meta?.description ||
    buildRichMetaDescription(siteInfo?.description, 'default', { siteInfo })
  const type = meta?.type === 'Post' ? 'article' : meta?.type || 'website'
  const language =
    router?.locale || siteConfig('LANG', 'zh-CN', NOTION_CONFIG)
  const lang = isClipper && isEn ? 'en_US' : String(language).replace('-', '_') // Facebook OpenGraph 要 zh_CN / en_US 格式
  const category = Array.isArray(meta?.category)
    ? meta?.category?.[0]
    : meta?.category || KEYWORDS // section 主要是像是 category 這樣的分類，Facebook 用這個來抓連結的分類
  const favicon = siteConfig('BLOG_FAVICON')
  const BACKGROUND_DARK = siteConfig('BACKGROUND_DARK', '', NOTION_CONFIG)

  const SEO_BING_VERIFICATION = siteConfig(
    'SEO_BING_VERIFICATION',
    null,
    NOTION_CONFIG
  )

  const SEO_BAIDU_SITE_VERIFICATION = siteConfig(
    'SEO_BAIDU_SITE_VERIFICATION',
    null,
    NOTION_CONFIG
  )

  const SEO_GOOGLE_SITE_VERIFICATION = siteConfig(
    'SEO_GOOGLE_SITE_VERIFICATION',
    null,
    NOTION_CONFIG
  )

  const BLOG_FAVICON = siteConfig('BLOG_FAVICON', null, NOTION_CONFIG)

  const COMMENT_WEBMENTION_ENABLE = siteConfig(
    'COMMENT_WEBMENTION_ENABLE',
    null,
    NOTION_CONFIG
  )

  const COMMENT_WEBMENTION_HOSTNAME = siteConfig(
    'COMMENT_WEBMENTION_HOSTNAME',
    null,
    NOTION_CONFIG
  )
  const COMMENT_WEBMENTION_AUTH = siteConfig(
    'COMMENT_WEBMENTION_AUTH',
    null,
    NOTION_CONFIG
  )
  const ANALYTICS_BUSUANZI_ENABLE = siteConfig(
    'ANALYTICS_BUSUANZI_ENABLE',
    null,
    NOTION_CONFIG
  )

  const FACEBOOK_PAGE = siteConfig('FACEBOOK_PAGE', null, NOTION_CONFIG)
  const TWITTER_SITE = siteConfig('TWITTER_SITE', '', NOTION_CONFIG)
  const TWITTER_CREATOR = siteConfig('TWITTER_CREATOR', '', NOTION_CONFIG)

  const AUTHOR = siteConfig('AUTHOR')
  return (
    <Head>
      <link rel='icon' href={favicon} />
      <title>{title}</title>
      <meta name='theme-color' content={BACKGROUND_DARK} />
      <meta
        name='viewport'
        content='width=device-width, initial-scale=1.0, maximum-scale=5.0, minimum-scale=1.0'
      />
      <meta name='robots' content='follow, index, max-snippet:-1, max-image-preview:large, max-video-preview:-1' />
      <meta charSet='UTF-8' />
      <meta name='format-detection' content='telephone=no' />
      <meta name='mobile-web-app-capable' content='yes' />
      <meta name='apple-mobile-web-app-capable' content='yes' />
      <meta name='apple-mobile-web-app-status-bar-style' content='default' />
      <meta name='apple-mobile-web-app-title' content={title} />

      {/* 搜索引擎验证 */}
      {SEO_GOOGLE_SITE_VERIFICATION && (
        <meta
          name='google-site-verification'
          content={SEO_GOOGLE_SITE_VERIFICATION}
        />
      )}
      {SEO_BING_VERIFICATION && (
        <meta
          name='msvalidate.01'
          content={SEO_BING_VERIFICATION}
        />
      )}
      {SEO_BAIDU_SITE_VERIFICATION && (
        <meta
          name='baidu-site-verification'
          content={SEO_BAIDU_SITE_VERIFICATION}
        />
      )}

      {/* 基础SEO元数据 */}
      <link rel='canonical' href={url} />
      <meta name='keywords' content={keywords} />
      <meta name='description' content={description} />
      <meta name='author' content={AUTHOR} />
      <meta name='generator' content='NotionNext' />

      {/* 语言和地区 */}
      <meta httpEquiv='content-language' content={language} />
      {(!isClipper || !isEn) && (
        <>
          <meta name='geo.region' content={siteConfig('GEO_REGION', 'CN')} />
          <meta name='geo.country' content={siteConfig('GEO_COUNTRY', 'CN')} />
        </>
      )}

      {/* 国际化 hreflang 声明 (Google SEO 标准) */}
      {isClipper &&
        getClipperAlternateLinks(LINK).map(alt => (
          <link
            key={alt.hrefLang}
            rel='alternate'
            hrefLang={alt.hrefLang}
            href={alt.href}
          />
        ))}
      {/* Open Graph 元数据 */}
      <meta property='og:locale' content={lang} />
      <meta property='og:title' content={title} />
      <meta property='og:description' content={description} />
      <meta property='og:url' content={url} />
      <meta property='og:image' content={image} />
      <meta property='og:image:width' content='1200' />
      <meta property='og:image:height' content='630' />
      <meta property='og:image:alt' content={title} />
      <meta property='og:site_name' content={siteConfig('TITLE')} />
      <meta property='og:type' content={type} />

      {/* Twitter Card 元数据 */}
      <meta name='twitter:card' content='summary_large_image' />
      {TWITTER_SITE && <meta name='twitter:site' content={TWITTER_SITE} />}
      {TWITTER_CREATOR && (
        <meta name='twitter:creator' content={TWITTER_CREATOR} />
      )}
      <meta name='twitter:title' content={title} />
      <meta name='twitter:description' content={description} />
      <meta name='twitter:image' content={image} />
      <meta name='twitter:image:alt' content={title} />

      <link rel='icon' href={BLOG_FAVICON} />

      {COMMENT_WEBMENTION_ENABLE && (
        <>
          <link
            rel='webmention'
            href={`https://webmention.io/${COMMENT_WEBMENTION_HOSTNAME}/webmention`}
          />
          <link
            rel='pingback'
            href={`https://webmention.io/${COMMENT_WEBMENTION_HOSTNAME}/xmlrpc`}
          />
          {COMMENT_WEBMENTION_AUTH && (
            <link href={COMMENT_WEBMENTION_AUTH} rel='me' />
          )}
        </>
      )}

      {ANALYTICS_BUSUANZI_ENABLE && (
        <meta name='referrer' content='no-referrer-when-downgrade' />
      )}
      {/* 文章特定元数据 */}
      {meta?.type === 'Post' && (
        <>
          {meta.publishTime && (
            <meta property='article:published_time' content={meta.publishTime} />
          )}
          {meta.modifiedTime && (
            <meta
              property='article:modified_time'
              content={meta.modifiedTime}
            />
          )}
          <meta property='article:author' content={AUTHOR} />
          <meta property='article:section' content={category} />
          <meta property='article:tag' content={keywords} />
          {FACEBOOK_PAGE && (
            <meta property='article:publisher' content={FACEBOOK_PAGE} />
          )}
        </>
      )}

      {/* 结构化数据 */}
      <script
        type='application/ld+json'
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            generateStructuredData(meta, siteInfo, url, image, AUTHOR, LINK)
          )
        }}
      />

      {/* 面包屑结构化数据（文章页） */}
      {meta?.type === 'Post' && (
        <script
          type='application/ld+json'
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(
              generateBreadcrumbList({ meta, url, LINK, category, post })
            )
          }}
        />
      )}

      {/* clipper 单品专属 SoftwareApplication 与 FAQPage 结构化数据 */}
      {isClipperSite() && (
        <>
          <script
            type='application/ld+json'
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(
                generateClipperSoftwareSchema(siteInfo, LINK)
              )
            }}
          />
          <script
            type='application/ld+json'
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(generateClipperFAQSchema())
            }}
          />
        </>
      )}

      {/* DNS预取和预连接 */}
      {hasWebFontUrl && <link rel='dns-prefetch' href='//fonts.googleapis.com' />}
      <link rel='dns-prefetch' href='//www.google-analytics.com' />
      <link rel='dns-prefetch' href='//www.googletagmanager.com' />
      {hasWebFontUrl && (
        <link
          rel='preconnect'
          href='https://fonts.gstatic.com'
          crossOrigin='anonymous'
        />
      )}

      {children}
    </Head>
  )
}

/**
 * 生成结构化数据
 * @param {*} meta
 * @param {*} siteInfo
 * @param {*} url
 * @param {*} image
 * @param {*} author
 * @returns
 */
export const generateStructuredData = (
  meta,
  siteInfo,
  url,
  image,
  author,
  siteUrl
) => {
  const baseData = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: siteInfo?.title,
    description: siteInfo?.description,
    url: siteUrl,
    author: {
      '@type': 'Person',
      name: author
    },
    publisher: {
      '@type': 'Organization',
      name: siteInfo?.title,
      logo: {
        '@type': 'ImageObject',
        url: getAbsoluteImageUrl(siteInfo?.icon, siteUrl)
      }
    }
  }

  // 如果是文章页面，添加文章结构化数据
  if (meta?.type === 'Post') {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: meta.title,
      description: meta.description,
      image: image,
      url: url,
      datePublished: meta.publishTime,
      dateModified: meta.modifiedTime || meta.publishTime,
      author: {
        '@type': 'Person',
        name: author
      },
      publisher: {
        '@type': 'Organization',
        name: siteInfo?.title,
        logo: {
          '@type': 'ImageObject',
          url: getAbsoluteImageUrl(siteInfo?.icon, siteUrl)
        }
      },
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': url
      },
      keywords: meta.tags?.join(', '),
      articleSection: meta.category
    }
  }

  return baseData
}

/**
 * 生成面包屑结构化数据（BreadcrumbList）
 * 文章页层级：首页 → 分类 → 文章
 */
export const generateBreadcrumbList = ({ meta, url, LINK, category, post }) => {
  const items = [{ position: 1, name: '首页', item: LINK }]
  if (category) {
    items.push({
      position: 2,
      name: category,
      item: `${LINK}/category/${encodeURIComponent(category)}`
    })
  }
  items.push({
    position: items.length + 1,
    name: post?.title || meta?.title || meta?.slug || '',
    item: url
  })
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map(i => ({
      '@type': 'ListItem',
      position: i.position,
      name: i.name,
      item: i.item
    }))
  }
}

/**
 * 为 clipper 站点生成软件应用结构化数据 (SoftwareApplication / Product)
 */
export const generateClipperSoftwareSchema = (siteInfo, siteUrl) => {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'one2notion clipper',
    applicationCategory: 'BrowserExtension',
    operatingSystem: 'Chrome, Edge, Firefox, Brave',
    offers: {
      '@type': 'Offer',
      price: '269',
      priceCurrency: 'CNY',
      priceValidUntil: '2030-12-31',
      availability: 'https://schema.org/InStock'
    },
    description:
      '专为 Notion 打造的沉浸式极速剪藏插件：高保真排版、代码块、Canvas 图片标注、行内批注与推广返现，永久买断一码到底。',
    softwareVersion: '2.0.0',
    url: siteUrl
  }
}

/**
 * 为 clipper 站点生成常见问答结构化数据 (FAQPage)
 */
export const generateClipperFAQSchema = () => {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'one2notion 剪藏插件是否需要注册第三方账号？数据安全吗？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '完全不需要。one2notion 采用免密 Cookie 直连 Notion 官方 API (v3)，所有剪藏内容直接从您的浏览器端安全存入个人 Notion 工作区，不经过任何第三方服务器中转，零数据留存。'
        }
      },
      {
        '@type': 'Question',
        name: '购买授权是一次性买断还是按月订阅？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '永久买断制。只需单次购买（¥269 / $129），即可获得专属激活码，永久享受后续所有功能升级，不限使用设备，无需每月续费。'
        }
      },
      {
        '@type': 'Question',
        name: '是否支持离线使用与极速唤起？',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '支持。客户端采用 Ed25519 非对称公钥离线极速验签（<5ms 秒开），无需依赖海外云端网络接口验证授权，无论网络波动都能毫秒级唤起剪藏浮窗。'
        }
      }
    ]
  }
}

const getAbsoluteImageUrl = (image, siteUrl) => {
  if (typeof image !== 'string') return ''

  const rawImage = image.trim()
  if (!rawImage) return ''
  if (isHttpLink(rawImage) || rawImage.startsWith('data:')) {
    return rawImage
  }

  return createSiteUrl(siteUrl, rawImage) || rawImage
}

const getIsoTime = value => {
  if (!value) return undefined

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined

  return date.toISOString()
}

/**
 * 格式化并丰富页面描述（Meta Description），消除过短（<25字）与跨页重复
 * @param {string} text - 原始文本（如 summary、tag 或 keyword）
 * @param {string} type - tag | category | archive | tag_index | category_index | search | post | default
 * @param {object} context - 包含 siteInfo, page, tag, category, post 等
 */
export const buildRichMetaDescription = (text, type, context = {}) => {
  const { siteInfo, page, tag, category, post } = context
  const siteTitle = siteInfo?.title || ''

  switch (type) {
    case 'tag': {
      const pageSuffix = page ? `（第 ${page} 页）` : ''
      return `${siteTitle ? siteTitle + ' · ' : ''}精选【${tag}】相关文章与实用指南${pageSuffix}，汇聚最新客户端下载、配置教程与深度评测，助您快速掌握核心技巧。`
    }
    case 'category': {
      const pageSuffix = page ? `（第 ${page} 页）` : ''
      return `${siteTitle ? siteTitle + ' · ' : ''}【${category}】专栏${pageSuffix}，汇总专业测评、配置教程与常见问题速查指南，提供高品质内容与一站式参考。`
    }
    case 'archive': {
      return `${siteTitle ? siteTitle + ' · ' : ''}全站文章归档列表，收录历史发布的全部精选教程、评测文章与技术笔记，方便按时间轴快速查阅。`
    }
    case 'tag_index': {
      return `${siteTitle ? siteTitle + ' · ' : ''}全站标签索引大全，快速定位各大平台、客户端、工具协议与专题精选文章。`
    }
    case 'category_index': {
      return `${siteTitle ? siteTitle + ' · ' : ''}全站内容分类导航，系统化整理教程指南、工具测评与常见问题，助您高效检索目标内容。`
    }
    case 'search': {
      return text
        ? `${siteTitle ? siteTitle + ' · ' : ''}搜索“${text}”的结果：为您检索包含该关键词的最新教程、评测与相关指南。`
        : `${siteTitle ? siteTitle + ' · ' : ''}站内智能检索，输入关键词即可快速查找相关技术教程、工具评测与实用问答。`
    }
    case 'post': {
      const summary = typeof text === 'string' ? text.trim() : ''
      if (summary) {
        // 遵循简洁干炼原则：若作者已写了清晰完整的摘要（>=30字），直接采用原稿
        if (summary.length >= 30) {
          return summary
        }
        // 若作者摘要过短（例如不足25字），补充站点精选来源，确保符合搜索引擎规范
        return `${summary}——精选自${siteTitle || '本站'}，提供详细操作步骤与实测解析。`
      }
      // 若未填写摘要，以文章标题动态生成专属唯一描述，彻底杜绝多篇文章描述完全一致
      const postTitle = post?.title || ''
      return `本文详细介绍《${postTitle}》的核心要点与实操步骤，涵盖详细配置说明与常见问题排查，助您轻松上手。`
    }
    default: {
      const raw = typeof text === 'string' ? text.trim() : ''
      if (raw && raw.length >= 30) {
        return raw
      }
      if (raw) {
        return `${raw} | ${siteTitle || '官方网站'}精选优质内容与实用操作指南。`
      }
      return `${siteTitle || ''}精选优质内容与实用操作指南，提供一站式技术教程与深度测评。`
    }
  }
}

/**
 * 获取SEO信息
 * @param {*} props
 * @param {*} router
 * @param {*} locale
 */
export const getSEOMeta = (props, router, locale) => {
  const { post, siteInfo, tag, category, page } = props
  const keyword = router?.query?.s

  switch (router.route) {
    case '/':
      if (isClipperSite()) {
        const isEn =
          router?.locale === 'en' ||
          (typeof router?.asPath === 'string' && router.asPath.startsWith('/en'))
        return getClipperLandingMeta({ isEn, siteInfo })
      }
      return {
        title: `${siteInfo?.title} | ${siteInfo?.description}`,
        description: buildRichMetaDescription(siteInfo?.description, 'default', { siteInfo }),
        image: `${siteInfo?.pageCover}`,
        slug: '',
        type: 'website'
      }
    case '/archive':
      return {
        title: `${locale?.NAV?.ARCHIVE || '归档'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription('', 'archive', { siteInfo }),
        image: `${siteInfo?.pageCover}`,
        slug: 'archive',
        type: 'website'
      }
    case '/page/[page]':
      return {
        title: `${page} | Page | ${siteInfo?.title}`,
        description: buildRichMetaDescription(siteInfo?.description, 'default', { siteInfo, page }),
        image: `${siteInfo?.pageCover}`,
        slug: 'page/' + page,
        type: 'website'
      }
    case '/category/[category]':
    case '/category/[category]/page/[page]':
      return {
        title: `${category} | ${locale?.COMMON?.CATEGORY || '分类'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription(category, 'category', { siteInfo, category, page }),
        slug: 'category/' + category,
        image: `${siteInfo?.pageCover}`,
        type: 'website'
      }
    case '/tag/[tag]':
    case '/tag/[tag]/page/[page]':
      return {
        title: `${tag} | ${locale?.COMMON?.TAGS || '标签'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription(tag, 'tag', { siteInfo, tag, page }),
        image: `${siteInfo?.pageCover}`,
        slug: 'tag/' + tag,
        type: 'website'
      }
    case '/search':
    case '/search/[keyword]':
    case '/search/[keyword]/page/[page]':
      return {
        title: `${keyword || ''}${keyword ? ' | ' : ''}${locale?.NAV?.SEARCH || '搜索'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription(keyword, 'search', { siteInfo }),
        image: `${siteInfo?.pageCover}`,
        slug: 'search' + (keyword ? '/' + keyword : ''),
        type: 'website'
      }
    case '/404':
      return {
        title: `${siteInfo?.title} | ${locale?.NAV?.PAGE_NOT_FOUND || '404'}`,
        image: `${siteInfo?.pageCover}`
      }
    case '/tag':
      return {
        title: `${locale?.COMMON?.TAGS || '标签'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription('', 'tag_index', { siteInfo }),
        image: `${siteInfo?.pageCover}`,
        slug: 'tag',
        type: 'website'
      }
    case '/category':
      return {
        title: `${locale?.COMMON?.CATEGORY || '分类'} | ${siteInfo?.title}`,
        description: buildRichMetaDescription('', 'category_index', { siteInfo }),
        image: `${siteInfo?.pageCover}`,
        slug: 'category',
        type: 'website'
      }
    default: {
      const postCategory = Array.isArray(post?.category)
        ? post?.category?.[0]
        : post?.category
      return {
        title: post
          ? `${post?.title} | ${siteInfo?.title}`
          : `${siteInfo?.title} | loading`,
        description: post
          ? buildRichMetaDescription(post?.summary, 'post', { siteInfo, post })
          : buildRichMetaDescription(siteInfo?.description, 'default', { siteInfo }),
        type: post?.type,
        slug: post?.slug,
        image: post?.pageCoverThumbnail || `${siteInfo?.pageCover}`,
        category: postCategory,
        tags: post?.tags,
        publishDay: post?.publishDay,
        lastEditedDay: post?.lastEditedDay,
        publishTime:
          getIsoTime(post?.publishDate) ||
          getIsoTime(post?.date?.start_date),
        modifiedTime: getIsoTime(post?.lastEditedTime || post?.lastEditedDate)
      }
    }
  }
}

export default SEO
