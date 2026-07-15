import { writeFile } from 'node:fs/promises'
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
const VERIFICATION_TOKEN_PATH = '/tmp/notion-webhook-verification-token'
const SUPPORTED_PAGE_EVENTS = new Set([
  'page.content_updated',
  'page.properties_updated',
  'page.created',
  'page.deleted',
  'page.undeleted',
  'page.moved'
])
const SUPPORTED_API_VERSIONS = new Set([
  '2022-06-28',
  '2025-09-03',
  '2026-03-11'
])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

const parseSetupToken = (value: unknown): string | null => {
  if (!isRecord(value) || Object.keys(value).length !== 1) return null
  const token = value.verification_token
  return typeof token === 'string' && token.trim().length > 0 ? token : null
}

const isFileExistsError = (error: unknown): boolean =>
  isRecord(error) && error.code === 'EEXIST'

const decodeRawBody = (
  rawBody: Buffer
): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(rawBody.toString('utf8')) }
  } catch {
    return { ok: false }
  }
}

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value)

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
  const timestampMs = date.valueOf()
  return (
    Number.isSafeInteger(timestampMs) &&
    timestampMs >= 0 &&
    date.toISOString() === canonicalValue
  )
}

const isValidApiVersion = (value: unknown): value is string =>
  typeof value === 'string' && SUPPORTED_API_VERSIONS.has(value)

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
    Number(value.attempt_number) < 1 ||
    Number(value.attempt_number) > 8
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

  const setupMode = process.env.NOTION_WEBHOOK_SETUP_MODE === 'true'
  const verificationToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
  if (!setupMode && !verificationToken) return end(res, 503)

  let rawBody: Buffer
  try {
    rawBody = await readRawBody(req, MAX_BODY_BYTES)
  } catch (error) {
    return end(res, error instanceof RangeError ? 413 : 400)
  }

  if (setupMode) {
    const decoded = decodeRawBody(rawBody)
    if (!decoded.ok) return end(res, 400)
    const setupToken = parseSetupToken(decoded.value)
    if (setupToken === null) return end(res, 400)
    try {
      await writeFile(VERIFICATION_TOKEN_PATH, setupToken, {
        mode: 0o600,
        flag: 'wx'
      })
    } catch (error) {
      return end(res, isFileExistsError(error) ? 409 : 503)
    }
    return res.status(200).json({ ok: true })
  }

  if (!verificationToken) return end(res, 503)
  if (
    !verifyNotionSignature(
      rawBody,
      req.headers['x-notion-signature'],
      verificationToken
    )
  ) {
    return end(res, 401)
  }

  const decoded = decodeRawBody(rawBody)
  if (!decoded.ok) return end(res, 400)

  if (parseSetupToken(decoded.value) !== null) {
    return res.status(200).json({ ok: true, ignored: true })
  }
  if (
    isRecord(decoded.value) &&
    typeof decoded.value.type === 'string' &&
    !SUPPORTED_PAGE_EVENTS.has(decoded.value.type)
  ) {
    return res.status(200).json({ ok: true, ignored: true })
  }

  const event = parsePageEvent(decoded.value)
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
