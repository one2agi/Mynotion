import type { NextApiRequest, NextApiResponse } from 'next'

import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'
import { enqueueDirtyPage } from '@/lib/notion-webhook/queue'
import {
  readRawBody,
  verifyNotionSignature
} from '@/lib/notion-webhook/signature'

export const config = {
  api: { bodyParser: false }
}

const MAX_BODY_BYTES = 64 * 1024
const SUPPORTED_PAGE_EVENTS = new Set([
  'page.content_updated',
  'page.properties_updated',
  'page.created',
  'page.deleted',
  'page.undeleted',
  'page.moved'
])

type WebhookPayload = {
  id: string
  timestamp: string
  attempt_number: number
  api_version: string
  entity: {
    id: string
    type: 'page'
  }
  type: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isUuid = (value: unknown): value is string =>
  normalizePageId(value) !== null

const isValidTimestamp = (value: unknown): value is string => {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  ) {
    return false
  }
  const date = new Date(value)
  const canonicalValue = value.includes('.')
    ? value
    : value.replace('Z', '.000Z')
  return !Number.isNaN(date.valueOf()) && date.toISOString() === canonicalValue
}

const isValidApiVersion = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value)
}

const parsePageEvent = (value: unknown): WebhookPayload | null => {
  if (!isRecord(value) || !isRecord(value.entity)) return null
  if (
    typeof value.type !== 'string' ||
    !SUPPORTED_PAGE_EVENTS.has(value.type)
  ) {
    return null
  }
  if (value.entity.type !== 'page') return null
  if (!isUuid(value.id) || !isUuid(value.entity.id)) return null
  if (!isValidTimestamp(value.timestamp)) return null
  if (
    !Number.isSafeInteger(value.attempt_number) ||
    Number(value.attempt_number) < 1
  ) {
    return null
  }
  if (!isValidApiVersion(value.api_version)) return null

  return value as WebhookPayload
}

const end = (res: NextApiResponse, status: number) => res.status(status).end()

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const startedAt = Date.now()

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return end(res, 405)
  }

  const verificationToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
  if (!verificationToken) return end(res, 503)

  let rawBody: Buffer
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES)
  } catch (error) {
    return end(res, error instanceof RangeError ? 413 : 400)
  }

  if (
    !verifyNotionSignature(
      rawBody,
      req.headers['x-notion-signature'],
      verificationToken
    )
  ) {
    return end(res, 401)
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return end(res, 400)
  }

  const event = parsePageEvent(decoded)
  if (event === null) return end(res, 400)

  const pageId = normalizePageId(event.entity.id)
  if (pageId === null) return end(res, 400)

  try {
    await enqueueDirtyPage({
      pageId,
      eventTimestampMs: Date.parse(event.timestamp)
    })
  } catch {
    return end(res, 503)
  }

  console.info({
    eventType: event.type,
    pageId,
    outcome: 'enqueued',
    elapsedMs: Date.now() - startedAt
  })
  return res.status(200).json({ ok: true })
}
