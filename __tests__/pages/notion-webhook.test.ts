import { createHmac } from 'node:crypto'
import { Readable } from 'node:stream'
import type { NextApiRequest, NextApiResponse } from 'next'
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'

import pageContentUpdated from '../fixtures/notion-webhook/page-content-updated.json'
import pageCreated from '../fixtures/notion-webhook/page-created.json'
import pageDeleted from '../fixtures/notion-webhook/page-deleted.json'
import pagePropertiesUpdated from '../fixtures/notion-webhook/page-properties-updated.json'
import pageUndeleted from '../fixtures/notion-webhook/page-undeleted.json'
import handler, { config } from '@/pages/api/notion-webhook'
import { enqueueDirtyPage } from '@/lib/notion-webhook/queue'

declare const jest: typeof import('@jest/globals').jest

jest.mock('@/lib/notion-webhook/queue', () => ({
  enqueueDirtyPage: jest.fn()
}))

const mockedEnqueueDirtyPage = jest.mocked(enqueueDirtyPage)
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

  beforeEach(() => {
    process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = TOKEN
    mockedEnqueueDirtyPage.mockResolvedValue(undefined)
    jest.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterAll(() => {
    if (originalToken === undefined) {
      delete process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN
    } else {
      process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN = originalToken
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

  it('rejects the one-time verification payload in the permanent receiver', async () => {
    const logMethods = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ]
    const verification = {
      verification_token: 'must-not-be-written',
      type: 'url_verification'
    }
    const { status, end } = await invoke(
      createRequest({ body: JSON.stringify(verification) })
    )

    expect(status).toHaveBeenCalledWith(400)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
    expect(jest.mocked(console.info)).not.toHaveBeenCalled()
    for (const method of logMethods) expect(method).not.toHaveBeenCalled()
  })

  it('rejects signed but unsupported events', async () => {
    const payload = { ...pageContentUpdated, type: 'comment.created' }
    const { status, end } = await invoke(
      createRequest({ body: JSON.stringify(payload) })
    )

    expect(status).toHaveBeenCalledWith(400)
    expect(end).toHaveBeenCalledWith()
    expect(mockedEnqueueDirtyPage).not.toHaveBeenCalled()
  })

  it.each([
    ['entity type', { entity: { ...pageContentUpdated.entity, type: 'block' } }],
    ['entity id', { entity: { ...pageContentUpdated.entity, id: 'not-a-uuid' } }],
    ['event id', { id: 'not-a-uuid' }],
    ['timestamp', { timestamp: 'not-a-timestamp' }],
    ['calendar timestamp', { timestamp: '2026-02-31T03:05:05.000Z' }],
    ['attempt number', { attempt_number: 0 }],
    ['api version', { api_version: 'latest' }]
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
