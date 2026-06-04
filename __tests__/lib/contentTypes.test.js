import {
  CONTENT_STATUS,
  CONTENT_TYPES,
  hasVisibleStatus,
  isCommunityContentType,
  isKnownContentType,
  isLinkableContentType,
  isNavContentType,
  isPublishedContent
} from '@/lib/site/contentTypes'

describe('contentTypes registry', () => {
  test('recognizes core and community content types', () => {
    expect(isKnownContentType(CONTENT_TYPES.POST)).toBe(true)
    expect(isKnownContentType(CONTENT_TYPES.MEMBER)).toBe(true)
    expect(isKnownContentType(CONTENT_TYPES.EVENT)).toBe(true)
    expect(isKnownContentType('Unknown')).toBe(false)
  })

  test('separates community, nav, and linkable types', () => {
    expect(isCommunityContentType(CONTENT_TYPES.MEMBER)).toBe(true)
    expect(isCommunityContentType(CONTENT_TYPES.POST)).toBe(false)

    expect(isNavContentType(CONTENT_TYPES.MENU)).toBe(true)
    expect(isNavContentType(CONTENT_TYPES.SUB_MENU)).toBe(true)
    expect(isNavContentType(CONTENT_TYPES.PAGE)).toBe(false)

    expect(isLinkableContentType(CONTENT_TYPES.POST)).toBe(true)
    expect(isLinkableContentType(CONTENT_TYPES.PAGE)).toBe(true)
    expect(isLinkableContentType(CONTENT_TYPES.EVENT)).toBe(false)
  })

  test('handles public and invisible statuses', () => {
    expect(hasVisibleStatus(CONTENT_STATUS.PUBLISHED)).toBe(true)
    expect(hasVisibleStatus(CONTENT_STATUS.INVISIBLE)).toBe(true)
    expect(hasVisibleStatus('Draft')).toBe(false)
  })

  test('matches published content with optional type filter', () => {
    const post = { type: CONTENT_TYPES.POST, status: CONTENT_STATUS.PUBLISHED }
    const hiddenPost = { type: CONTENT_TYPES.POST, status: CONTENT_STATUS.INVISIBLE }

    expect(isPublishedContent(post)).toBe(true)
    expect(isPublishedContent(post, CONTENT_TYPES.POST)).toBe(true)
    expect(isPublishedContent(post, CONTENT_TYPES.PAGE)).toBe(false)
    expect(isPublishedContent(hiddenPost)).toBe(false)
    expect(isPublishedContent(null)).toBe(false)
  })
})
