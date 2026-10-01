import {
  generateStructuredData,
  generateClipperSoftwareSchema,
  generateClipperFAQSchema,
  getClipperKeywords,
  getClipperLandingMeta,
  getClipperAlternateLinks,
  CLIPPER_ZH_KEYWORDS,
  CLIPPER_EN_KEYWORDS,
  CLIPPER_EN_TITLE,
  CLIPPER_EN_DESCRIPTION,
  buildRichMetaDescription,
  getSEOMeta
} from '@/components/SEO'

describe('SEO structured data', () => {
  const siteInfo = {
    title: 'Example Blog',
    description: 'Example description',
    icon: '/logo.png'
  }

  it('generates BlogPosting data for published articles', () => {
    const data = generateStructuredData(
      {
        type: 'Post',
        title: 'Structured data in NotionNext',
        description: 'A test article',
        publishTime: '2026-07-01T00:00:00.000Z',
        modifiedTime: '2026-07-02T00:00:00.000Z',
        tags: ['notion', 'seo'],
        category: 'Engineering'
      },
      siteInfo,
      'https://example.com/article/structured-data',
      'https://example.com/cover.png',
      'Example Author',
      'https://example.com'
    )

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: 'Structured data in NotionNext',
      url: 'https://example.com/article/structured-data',
      datePublished: '2026-07-01T00:00:00.000Z',
      dateModified: '2026-07-02T00:00:00.000Z',
      keywords: 'notion, seo',
      articleSection: 'Engineering',
      mainEntityOfPage: {
        '@type': 'WebPage',
        '@id': 'https://example.com/article/structured-data'
      }
    })
    expect(data.publisher.logo.url).toBe('https://example.com/logo.png')
  })

  it('generates WebSite data for non-article pages', () => {
    const data = generateStructuredData(
      { type: 'Page' },
      siteInfo,
      'https://example.com/about',
      'https://example.com/cover.png',
      'Example Author',
      'https://example.com'
    )

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Example Blog',
      url: 'https://example.com'
    })
  })

  it('generates SoftwareApplication schema for clipper site', () => {
    const data = generateClipperSoftwareSchema(
      siteInfo,
      'https://clipper.one2agi.com'
    )
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'one2notion clipper',
      applicationCategory: 'BrowserExtension',
      offers: {
        '@type': 'Offer',
        price: '269',
        priceCurrency: 'CNY'
      }
    })
  })

  it('generates FAQPage schema for clipper site', () => {
    const data = generateClipperFAQSchema()
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'FAQPage'
    })
    expect(data.mainEntity.length).toBeGreaterThan(0)
  })
})

describe('Clipper SEO fine-tuning and internationalization', () => {
  const siteInfo = {
    title: 'one2notion · Notion 智能剪藏与知识中枢',
    description: '专为 Notion 打造的沉浸式极速剪藏插件',
    pageCover: '/cover.png'
  }

  it('provides high-intent Chinese keywords by default', () => {
    const kw = getClipperKeywords({ isEn: false, customKeywords: 'AI赋能' })
    expect(kw).toBe(CLIPPER_ZH_KEYWORDS)
    expect(kw).toContain('Notion剪藏')
    expect(kw).toContain('Save to Notion')
  })

  it('provides high-intent English keywords for en locale', () => {
    const kw = getClipperKeywords({ isEn: true, customKeywords: 'AI赋能' })
    expect(kw).toBe(CLIPPER_EN_KEYWORDS)
    expect(kw).toContain('Notion Clipper')
    expect(kw).toContain('web clipper for Notion')
  })

  it('appends non-default custom keywords when configured in Notion', () => {
    const kw = getClipperKeywords({ isEn: false, customKeywords: '效率神器' })
    expect(kw).toBe(`${CLIPPER_ZH_KEYWORDS}, 效率神器`)
  })

  it('generates English landing metadata on /en', () => {
    const meta = getClipperLandingMeta({ isEn: true, siteInfo })
    expect(meta.title).toBe(CLIPPER_EN_TITLE)
    expect(meta.description).toBe(CLIPPER_EN_DESCRIPTION)
    expect(meta.slug).toBe('en')
  })

  it('generates Chinese landing metadata on default /', () => {
    const meta = getClipperLandingMeta({ isEn: false, siteInfo })
    expect(meta.title).toBe(`${siteInfo.title} | ${siteInfo.description}`)
    expect(meta.slug).toBe('')
  })

  it('generates Google-compliant hreflang alternate links', () => {
    const links = getClipperAlternateLinks('https://clipper.one2agi.com')
    expect(links).toEqual([
      { hrefLang: 'zh-CN', href: 'https://clipper.one2agi.com' },
      { hrefLang: 'en', href: 'https://clipper.one2agi.com/en' },
      { hrefLang: 'x-default', href: 'https://clipper.one2agi.com' }
    ])
  })
})

describe('buildRichMetaDescription & Dynamic SEO Meta generation', () => {
  const siteInfo = {
    title: '机场推荐评测',
    description: '高速稳定专线评测与梯子选型指南'
  }

  it('generates rich, distinct description for tag pages and eliminates duplicates', () => {
    const descWindows = buildRichMetaDescription('Windows', 'tag', { siteInfo, tag: 'Windows' })
    const descClash = buildRichMetaDescription('Clash', 'tag', { siteInfo, tag: 'Clash' })

    expect(descWindows).toContain('Windows')
    expect(descClash).toContain('Clash')
    expect(descWindows).not.toBe(descClash)
    expect(descWindows.length).toBeGreaterThanOrEqual(35)
    expect(descWindows.length).toBeLessThanOrEqual(160)
  })

  it('generates rich, distinct description for category pages', () => {
    const descCategory = buildRichMetaDescription('教程', 'category', { siteInfo, category: '教程' })
    expect(descCategory).toContain('教程')
    expect(descCategory.length).toBeGreaterThanOrEqual(35)
  })

  it('preserves concise, crisp post summaries that meet the length threshold (>=30 chars)', () => {
    const crispSummary = 'Clash Verge Rev 官方正版下载、中文界面设置及常见问题解决完整图文教程。'
    const result = buildRichMetaDescription(crispSummary, 'post', { siteInfo })
    expect(result).toBe(crispSummary)
  })

  it('augments short post summaries (<30 chars) with site context to avoid "description too short" warning', () => {
    const shortSummary = 'Clash配置指南'
    const result = buildRichMetaDescription(shortSummary, 'post', { siteInfo })
    expect(result).toContain(shortSummary)
    expect(result).toContain('机场推荐评测')
    expect(result.length).toBeGreaterThanOrEqual(35)
  })

  it('synthesizes unique description from post title when post summary is missing or empty', () => {
    const post = { title: 'Shadowrocket 小火箭保姆级配置教程' }
    const result = buildRichMetaDescription('', 'post', { siteInfo, post })
    expect(result).toContain(post.title)
    expect(result.length).toBeGreaterThanOrEqual(35)
  })

  it('integrates with getSEOMeta for tag and category routes', () => {
    const locale = { COMMON: { TAGS: '标签', CATEGORY: '分类' } }
    const tagMeta = getSEOMeta({ siteInfo, tag: 'Shadowrocket' }, { route: '/tag/[tag]' }, locale)
    expect(tagMeta.description).toContain('Shadowrocket')
    expect(tagMeta.description.length).toBeGreaterThanOrEqual(35)

    const catMeta = getSEOMeta({ siteInfo, category: '工具' }, { route: '/category/[category]' }, locale)
    expect(catMeta.description).toContain('工具')
    expect(catMeta.description.length).toBeGreaterThanOrEqual(35)
  })
})

