/**
 * Event 数据的官方 API 补充管道。
 *
 * 背景：NotionNext 的非官方 API 读取当前数据库视图时，可能漏掉
 * 不在当前视图中的社区活动条目。此模块通过 Notion 官方 API 补充
 * 读取 Event 条目，并映射为 SiteDataApi 可消费的页面数据。
 */

import { findPropertyKey, readPropertyValue } from './memberDataSource'

function readFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function readFirstArray(...values) {
  for (const value of values) {
    if (Array.isArray(value)) return value.filter(Boolean)
    if (typeof value === 'string' && value.trim()) {
      return value
        .split(/[,，、\n]/)
        .map(item => item.trim())
        .filter(Boolean)
    }
  }
  return []
}

function readOfficialImage(image) {
  if (!image || typeof image !== 'object') return ''
  if (image.type === 'external') return image.external?.url || ''
  if (image.type === 'file') return image.file?.url || ''
  if (image.type === 'emoji') return image.emoji || ''
  return ''
}

function parseJsonObject(value) {
  if (!value || typeof value !== 'string') return {}

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch (error) {
    console.warn('[eventDataSource] Invalid ext JSON:', value)
    return {}
  }
}

function slugifyEventTitle(title, pageId) {
  const titleSlug = String(title || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (titleSlug) return titleSlug
  const idPart = String(pageId || '').replace(/[^a-z0-9]/gi, '').slice(0, 8)
  return idPart ? `event-${idPart}` : ''
}

function normalizeEventSlug(rawSlug, title, pageId) {
  const cleaned = readFirstString(rawSlug).replace(/^\/+|\/+$/g, '')

  if (cleaned && !/^https?:\/\//i.test(cleaned)) {
    const parts = cleaned.split('/').filter(Boolean)
    const terminal = parts[parts.length - 1]
    if (terminal) return terminal
  }

  return slugifyEventTitle(title, pageId)
}

function readOfficialDate(property) {
  if (!property || property.type !== 'date') return null
  const date = property.date
  if (!date?.start) return null

  return {
    start_date: date.start,
    end_date: date.end || undefined,
    time_zone: date.time_zone || undefined
  }
}

export function mapOfficialEventPage(page, { statusProperty = 'status' } = {}) {
  const props = page.properties || {}
  const get = candidates => {
    const key = findPropertyKey(props, Array.isArray(candidates) ? candidates : [candidates])
    return key ? readPropertyValue(props[key]) : null
  }
  const getProperty = candidates => {
    const key = findPropertyKey(props, Array.isArray(candidates) ? candidates : [candidates])
    return key ? props[key] : null
  }

  const title = readFirstString(get(['title', 'Title']))
  if (!title) return null

  const rawSlug = readFirstString(get(['slug', 'Slug']))
  const slug = normalizeEventSlug(rawSlug, title, page.id)
  if (!slug) return null

  const rawExt = readFirstString(get(['ext', 'Ext']))
  const ext = parseJsonObject(rawExt)
  const eventStart = readOfficialDate(getProperty(['event_start', 'eventStart', 'Event Start']))
  const eventEnd = readOfficialDate(getProperty(['event_end', 'eventEnd', 'Event End']))
  const date = eventStart || readOfficialDate(getProperty(['date', 'Date'])) || {}
  if (eventEnd?.start_date && !date.end_date) {
    date.end_date = eventEnd.start_date
  }

  const cover = readFirstString(readOfficialImage(page.cover), ext.cover, ext.coverUrl)
  const icon = readOfficialImage(page.icon)

  return {
    id: page.id,
    title,
    slug,
    type: 'Event',
    status: readFirstString(get([statusProperty, 'status', 'Status']), 'Published'),
    summary: readFirstString(get(['summary', 'Summary'])),
    category: readFirstString(get(['category', 'Category'])),
    tags: readFirstArray(get(['tags', 'Tags'])),
    date,
    publishDate: page.created_time ? new Date(page.created_time).getTime() : Date.now(),
    publishDay: date.start_date || '',
    lastEditedDate: page.last_edited_time ? new Date(page.last_edited_time) : new Date(),
    pageIcon: icon,
    pageCover: cover,
    pageCoverThumbnail: cover,
    ext,
    href: `/events/${slug}`
  }
}

export async function fetchEventsFromOfficialAPI({
  dataSourceId = process.env.NOTION_EVENTS_DATA_SOURCE_ID || process.env.NOTION_MEMBERS_DATA_SOURCE_ID,
  typeProperty = 'type',
  statusProperty = 'status',
  typeValue = 'Event',
  statusValue = 'Published'
} = {}) {
  const token = process.env.NOTION_API_TOKEN
  if (!token || !dataSourceId) return []

  try {
    const events = []
    let startCursor = undefined

    do {
      const response = await fetch(
        `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            filter: { property: typeProperty, select: { equals: typeValue } },
            page_size: 100,
            ...(startCursor ? { start_cursor: startCursor } : {})
          })
        }
      )

      if (!response.ok) {
        console.error('[eventDataSource] API request failed:', response.status)
        return events
      }

      const data = await response.json()
      events.push(
        ...(data.results || [])
          .map(page => mapOfficialEventPage(page, { statusProperty }))
          .filter(event => event?.status === statusValue)
          .filter(Boolean)
      )
      startCursor = data.has_more ? data.next_cursor : undefined
    } while (startCursor)

    console.log(`[eventDataSource] Fetched ${events.length} events from official API`)
    return events
  } catch (error) {
    console.error('[eventDataSource] Error fetching events:', error)
    return []
  }
}
