import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

export const config = { api: { bodyParser: false } }

const CAPTURE_DIR = '/tmp/notion-webhook-capture'
const MAX_BYTES = 64 * 1024
const MAX_EVENT_TYPE_LENGTH = 80

async function readBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0

  for await (const chunk of req as AsyncIterable<unknown>) {
    let value: Uint8Array
    if (typeof chunk === 'string') value = Buffer.from(chunk)
    else if (Buffer.isBuffer(chunk)) value = Uint8Array.from(chunk)
    else if (chunk instanceof Uint8Array) value = chunk
    else throw new TypeError('unsupported body chunk')

    size += value.length
    if (size > MAX_BYTES) throw new RangeError('body too large')
    chunks.push(value)
  }

  return Buffer.concat(chunks)
}

function eventTypeForFilename(value: unknown): string {
  if (typeof value !== 'string') return 'verification'

  const sanitized = value
    .replace(/[^a-z0-9_.-]/gi, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, MAX_EVENT_TYPE_LENGTH)

  return sanitized || 'verification'
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const expected = process.env.NOTION_WEBHOOK_CAPTURE_NONCE || ''
  const queryKeys = Object.keys(req.query)
  const received =
    queryKeys.length === 1 &&
    queryKeys[0] === 'capture' &&
    typeof req.query.capture === 'string'
      ? req.query.capture
      : ''

  if (!expected || received !== expected) return res.status(404).end()

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).end()
  }

  let body: Buffer
  try {
    body = await readBody(req)
  } catch (error) {
    return res.status(error instanceof RangeError ? 413 : 400).end()
  }

  let payload: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return res.status(400).end()
    }
    payload = parsed as Record<string, unknown>
  } catch {
    return res.status(400).end()
  }

  const type = eventTypeForFilename(payload.type)
  const signature =
    typeof req.headers['x-notion-signature'] === 'string'
      ? req.headers['x-notion-signature']
      : null

  try {
    await mkdir(CAPTURE_DIR, { recursive: true, mode: 0o700 })
    await writeFile(
      `${CAPTURE_DIR}/${Date.now()}-${type}-${randomUUID()}.json`,
      JSON.stringify({ signature, rawBody: body.toString('utf8') }),
      { mode: 0o600, flag: 'wx' }
    )
  } catch {
    return res.status(500).end()
  }

  return res.status(200).json({ ok: true })
}
