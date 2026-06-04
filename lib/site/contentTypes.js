export const CONTENT_TYPES = Object.freeze({
  POST: 'Post',
  PAGE: 'Page',
  NOTICE: 'Notice',
  MENU: 'Menu',
  SUB_MENU: 'SubMenu',
  MEMBER: 'Member',
  EVENT: 'Event'
})

export const CORE_CONTENT_TYPES = Object.freeze([
  CONTENT_TYPES.POST,
  CONTENT_TYPES.PAGE,
  CONTENT_TYPES.NOTICE,
  CONTENT_TYPES.MENU,
  CONTENT_TYPES.SUB_MENU
])

export const COMMUNITY_CONTENT_TYPES = Object.freeze([
  CONTENT_TYPES.MEMBER,
  CONTENT_TYPES.EVENT
])

export const NAV_CONTENT_TYPES = Object.freeze([
  CONTENT_TYPES.MENU,
  CONTENT_TYPES.SUB_MENU
])

export const LINKABLE_CONTENT_TYPES = Object.freeze([
  CONTENT_TYPES.POST,
  CONTENT_TYPES.PAGE
])

export const PUBLISHABLE_CONTENT_TYPES = Object.freeze([
  CONTENT_TYPES.POST,
  CONTENT_TYPES.PAGE,
  CONTENT_TYPES.MEMBER,
  CONTENT_TYPES.EVENT
])

export const CONTENT_STATUS = Object.freeze({
  PUBLISHED: 'Published',
  INVISIBLE: 'Invisible'
})

export function isContentType(type, expectedType) {
  return type === expectedType
}

export function isKnownContentType(type) {
  return [
    ...CORE_CONTENT_TYPES,
    ...COMMUNITY_CONTENT_TYPES
  ].includes(type)
}

export function isCommunityContentType(type) {
  return COMMUNITY_CONTENT_TYPES.includes(type)
}

export function isNavContentType(type) {
  return NAV_CONTENT_TYPES.includes(type)
}

export function isLinkableContentType(type) {
  return LINKABLE_CONTENT_TYPES.includes(type)
}

export function isPublished(status) {
  return status === CONTENT_STATUS.PUBLISHED
}

export function isInvisible(status) {
  return status === CONTENT_STATUS.INVISIBLE
}

export function hasVisibleStatus(status) {
  return isPublished(status) || isInvisible(status)
}

export function isPublishedContent(page, type) {
  if (!page || !isPublished(page.status)) return false
  return type ? isContentType(page.type, type) : isKnownContentType(page.type)
}
