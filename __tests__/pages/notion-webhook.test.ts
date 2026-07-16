import { createHmac } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { NextApiRequest, NextApiResponse } from 'next'
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'

import pageContentUpdated from '../fixtures/notion-webhook/page-content-updated.json'
import pageCreated from '../fixtures/notion-webhook/page-created.json'
import pageDeleted from '../fixtures/notion-webhook/page-deleted.json'
import pagePropertiesUpdated from '../fixtures/notion-webhook/page-properties-updated.json'
import pageUndeleted from '../fixtures/notion-webhook/page-undeleted.json'
import verificationFixture from '../fixtures/notion-webhook/verification.json'
import handler, { config } from '@/pages/api/notion-webhook'
import { enqueueDirtyPage } from '@/lib/notion-webhook/queue'

declare const jest: typeof import('@jest/globals').jest

jest.mock('@/lib/notion-webhook/queue', () => ({
  enqueueDirtyPage: jest.fn()
}))
jest.mock('node:fs/promises', () => ({
  writeFile: jest.fn()
}))

const mockedEnqueueDirtyPage = jest.mocked(enqueueDirtyPage)
const mockedWriteFile = jest.mocked(writeFile)
const TOKEN = 'fixture-verification-token'

function sign(rawBody: Buffer | string, token = TOKEN): string {
  return `sha256=${createHmac('sha256', token)
    .update(rawBody)
    .digest('hex')}`
}

function createRequest({
  body = JSON.stringify(pageContentUpdated),
  headers,
  method = 'POST'
}: {
  body?: string | Buffer
  headers?: NextApiRequest['headers']
  method?: string
} = {}): NextApiRequest {
  const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body)
  return Object.assign(Readable.from([rawBody]), {
    headers: headers ?? { 'x-notion-signature': sign(rawBody) },
    method,
    query: {}
  }) as unknown as NextApiRequest
}

function createResponse() {
  const json = jest.fn()
  const end = jest.fn()
  const setHeader = jest.fn()
  const response = { json, end, setHeader } as unknown as NextApiResponse
  const status = jest.fn(() => response)
  Object.assign(response, { status })
  return { response, status, json, end, setHeader }
}

async function invoke(request = createRequest()) {
  const result = createResponse()
  await handler(request, result.response)
  return result
}

describe('Notion webhook receiver', () => {
  const originalToken = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
  const originalSetupMode = process.env.NOTION_WEBHOOK_SETUP_MODE

  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = TOKEN
    delete process.env.NOTION_WEBHOOK_SETUP_MODE
    mockedEnqueueDirtyPage.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
    } else {
      process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = originalToken
    }
    if (originalSetupMode === undefined) {
      delete process.env.NOTION_WEBHOOK_SETUP_MODE
    } else {
      process.env.NOTION_WEBHOOK_SETUP_MODE = originalSetupMode
    }
  })

  it('disables the Pages Router body parser', () => {
    expect(config).toEqual({ api: { bodyParser: false } })
  })

  it('returns 405 with the allowed method for non-POST requests', async () => {
    const { status, end, setHeader } = await invoke(
      createRequest({ method: 'GET' })
    )

    expect(setHeader).toHaveBeenCalledWith('Allow', 'POST')
    expect(status).toHaveBeenCalledWith(405)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('returns 503 without consuming the stream when the token is absent', async () => {
    delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
    const request = createRequest()
    const iterator = jest.spyOn(request, Symbol.asyncIterator)

    const { status, end } = await invoke(request)

    expect(status).toHaveBeenCalledWith(503)
    expect(end).toHaveBeenCalledWith()
    expect(iterator).not.toHaveBeenCalled()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('verifies and enqueues a real page fixture with its event time', async () => {
    const { status, json } = await invoke()

    expect(mockedEnqueueDirtyPage).toHaveBeenCalledWith({
      pageId: '50000000000040008000000000000001',
      eventTimestampMs: Date.parse(pageContentUpdated.timestamp)
    })
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ ok: true })
    const infoLog = jest.mocked(console.info)
    expect(infoLog).toHaveBeenCalledTimes(1)
    expect(infoLog).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'page.content_updated',
        pageId: '50000000000040008000000000000001',
        outcome: 'enqueued',
        elapsedMs: expect.any(Number)
      })
    )
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain(TOKEN)
    expect(JSON.stringify(infoLog.mock.calls)).not.toContain('Fixture Workspace')
  })

  it('preserves the webhook timestamp at millisecond precision', async () => {
    const timestamp = '2024-12-05T23:55:34.285Z'
    const payload = { ...pageContentUpdated, timestamp }

    const { status } = await invoke(
      createRequest({ body: JSON.stringify(payload) })
    )

    expect(status).toHaveBeenCalledWith(200)
    expect(mockedEnqueueDirtyPage).toHaveBeenCalledWith({
      pageId: '50000000000040008000000000000001',
      eventTimestampMs: Date.parse(timestamp)
    })
  })

  it.each([
    ['page.content_updated', pageContentUpdated],
    ['page.properties_updated', pagePropertiesUpdated],
    ['page.created', pageCreated],
    ['page.deleted', pageDeleted],
    ['page.undeleted', pageUndeleted],
    ['page.moved', { ...pageContentUpdated, type: 'page.moved' }]
  ])('accepts supported real-shaped event type %s', async (_type, payload) => {
    const rawBody = JSON.stringify(payload)

    const { status } = await invoke(createRequest({ body: rawBody }))

    expect(status).toHaveBeenCalledWith(200)
    expect(mockedEnqueueDirtyPage).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for an invalid signature before parsing the body', async () => {
    const { status, end } = await invoke(
      createRequest({
        body: 'not-json',
        headers: { 'x-notion-signature': `sha256=${'0'.repeat(64)}` }
      })
    )

    expect(status).toHaveBeenCalledWith(401)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('returns 413 for a body larger than 64 KiB', async () => {
    const body = Buffer.alloc(64 * 1024 + 1, 0x61)
    const { status, end } = await invoke(createRequest({ body }))

    expect(status).toHaveBeenCalledWith(413)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it.each(['not-json', 'null', '[]', '"text"'])(
    'returns 400 for malformed JSON object %p',
    async body => {
      const { status, end } = await invoke(createRequest({ body }))

      expect(status).toHaveBeenCalledWith(400)
      expect(end).toHaveBeenCalledWith()
      expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
    }
  )

  it('captures only the real verification token during explicit setup mode', async () => {
    const logMethods = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ]
    process.env.NOTION_WEBHOOK_SETUP_MODE = 'true'
    delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN

    const { status, json } = await invoke(
      createRequest({
        body: JSON.stringify(verificationFixture),
        headers: {}
      })
    )

    expect(mockedWriteFile).toHaveBeenCalledWith(
      '/tmp/notion-webhook-verification-token',
      verificationFixture.verification_token,
      { mode: 0o600, flag: 'wx' }
    )
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ ok: true })
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
    expect(jest.mocked(console.info)).not.toHaveBeenCalled()
    for (const method of logMethods) expect(method).not.toHaveBeenCalled()
    expect(JSON.stringify(json.mock.calls)).not.toContain(
      verificationFixture.verification_token
    )
  })

  it.each([
    ['extra event field', { ...verificationFixture, type: 'page.created' }],
    ['empty token', { verification_token: '' }],
    ['blank token', { verification_token: '   ' }],
    ['array body', [verificationFixture]]
  ])('rejects invalid setup payload with %s', async (_name, payload) => {
    process.env.NOTION_WEBHOOK_SETUP_MODE = 'true'
    const { status, end } = await invoke(
      createRequest({ body: JSON.stringify(payload), headers: {} })
    )

    expect(status).toHaveBeenCalledWith(400)
    expect(end).toHaveBeenCalledWith()
    expect(mockedWriteFile).not.toHaveBeenCalled()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('returns 409 when the one-time setup token file already exists', async () => {
    process.env.NOTION_WEBHOOK_SETUP_MODE = 'true'
    mockedWriteFile.mockRejectedValueOnce(
      Object.assign(new Error('exists'), { code: 'EEXIST' })
    )

    const { status, end } = await invoke(
      createRequest({
        body: JSON.stringify(verificationFixture),
        headers: {}
      })
    )

    expect(status).toHaveBeenCalledWith(409)
    expect(end).toHaveBeenCalledWith()
  })

  it('returns 503 without logging when setup token persistence fails', async () => {
    process.env.NOTION_WEBHOOK_SETUP_MODE = 'true'
    mockedWriteFile.mockRejectedValueOnce(new Error('private token in error'))
    const errorLog = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined)

    const { status, end } = await invoke(
      createRequest({
        body: JSON.stringify(verificationFixture),
        headers: {}
      })
    )

    expect(status).toHaveBeenCalledWith(503)
    expect(end).toHaveBeenCalledWith()
    expect(errorLog).not.toHaveBeenCalled()
    expect(jest.mocked(console.info)).not.toHaveBeenCalled()
  })

  it('authenticates then ignores a verification payload outside setup mode', async () => {
    const rawBody = JSON.stringify(verificationFixture)
    const { status, json } = await invoke(createRequest({ body: rawBody }))

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ ok: true, ignored: true })
    expect(mockedWriteFile).not.toHaveBeenCalled()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('does not accept an unsigned verification payload outside setup mode', async () => {
    const { status, end } = await invoke(
      createRequest({
        body: JSON.stringify(verificationFixture),
        headers: {}
      })
    )

    expect(status).toHaveBeenCalledWith(401)
    expect(end).toHaveBeenCalledWith()
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('acknowledges signed but unsupported events without enqueueing', async () => {
    const payload = { ...pageContentUpdated, type: 'comment.created' }
    const { status, json } = await invoke(
      createRequest({ body: JSON.stringify(payload) })
    )

    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ ok: true, ignored: true })
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it.each([
    ['entity type', { entity: { ...pageContentUpdated.entity, type: 'block' } }],
    ['entity id', { entity: { ...pageContentUpdated.entity, id: 'not-a-uuid' } }],
    [
      'unhyphenated entity id',
      {
        entity: {
          ...pageContentUpdated.entity,
          id: pageContentUpdated.entity.id.replaceAll('-', '')
        }
      }
    ],
    ['event id', { id: 'not-a-uuid' }],
    ['unhyphenated event id', { id: pageContentUpdated.id.replaceAll('-', '') }],
    ['timestamp', { timestamp: 'not-a-timestamp' }],
    ['calendar timestamp', { timestamp: '2026-02-31T03:05:05.000Z' }],
    ['pre-epoch timestamp', { timestamp: '1969-12-31T23:59:59.999Z' }],
    ['attempt number', { attempt_number: 0 }],
    ['attempt number above retry limit', { attempt_number: 9 }],
    ['api version', { api_version: 'latest' }],
    ['unknown dated api version', { api_version: '2024-01-01' }]
  ])('returns 400 for invalid %s', async (_name, replacement) => {
    const payload = { ...pageContentUpdated, ...replacement }
    const { status, end } = await invoke(
      createRequest({ body: JSON.stringify(payload) })
    )

    expect(status).toHaveBeenCalledWith(400)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it('returns 503 when Redis does not confirm the queue write', async () => {
    mockedEnqueueDirtyPage.mockRejectedValueOnce(new Error('redis unavailable'))
    const logMethods = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ]

    const { status, end, json } = await invoke()

    expect(status).toHaveBeenCalledWith(503)
    expect(end).toHaveBeenCalledWith()
    expect(json).not.toHaveBeenCalled()
    for (const method of logMethods) expect(method).not.toHaveBeenCalled()
    expect(jest.mocked(console.info)).not.toHaveBeenCalled()
  })
})
