/**
 * Temporary tests for the capture-only Notion webhook adapter.
 * Delete these with the route after real fixtures have been captured.
 */
import { Readable } from 'node:stream'
import type { NextApiRequest, NextApiResponse } from 'next'
import { mkdir, writeFile } from 'node:fs/promises'
import { afterAll, beforeEach, describe, expect, it } from '@jest/globals'

import handler, { config } from '@/pages/api/notion-webhook-capture'

// A declaration preserves Babel's global jest.mock hoisting; an imported jest
// value is typed correctly but does not get hoisted by this repository's setup.
declare const jest: typeof import('@jest/globals').jest

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn()
}))

const mockedMkdir = jest.mocked(mkdir)
const mockedWriteFile = jest.mocked(writeFile)

type JsonBody = Record<string, unknown>

function createRequest({
  body = '{}',
  headers = {},
  method = 'POST',
  query = { capture: 'test-nonce' }
}: {
  body?: string | Buffer
  headers?: NextApiRequest['headers']
  method?: string
  query?: NextApiRequest['query']
} = {}): NextApiRequest {
  return Object.assign(Readable.from([body]), {
    headers,
    method,
    query
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

describe('temporary Notion webhook capture route', () => {
  const originalNonce = process.env.NOTION_WEBHOOK_CAPTURE_NONCE

  beforeEach(() => {
    process.env.NOTION_WEBHOOK_CAPTURE_NONCE = 'test-nonce'
    mockedMkdir.mockResolvedValue(undefined)
    mockedWriteFile.mockResolvedValue(undefined)
  })

  afterAll(() => {
    if (originalNonce === undefined) {
      delete process.env.NOTION_WEBHOOK_CAPTURE_NONCE
    } else {
      process.env.NOTION_WEBHOOK_CAPTURE_NONCE = originalNonce
    }
  })

  it('disables the Pages Router body parser', () => {
    expect(config).toEqual({ api: { bodyParser: false } })
  })

  it.each([
    ['missing environment nonce', undefined, { capture: 'test-nonce' }],
    ['empty environment nonce', '', { capture: 'test-nonce' }],
    ['wrong nonce', 'test-nonce', { capture: 'wrong' }],
    ['repeated capture query', 'test-nonce', { capture: ['test-nonce'] }],
    [
      'additional query parameter',
      'test-nonce',
      { capture: 'test-nonce', extra: 'value' }
    ]
  ])('returns 404 for %s', async (_name, nonce, query) => {
    if (nonce === undefined) delete process.env.NOTION_WEBHOOK_CAPTURE_NONCE
    else process.env.NOTION_WEBHOOK_CAPTURE_NONCE = nonce

    const { status, end, setHeader } = await invoke(
      createRequest({ method: 'GET', query })
    )

    expect(status).toHaveBeenCalledWith(404)
    expect(end).toHaveBeenCalledWith()
    expect(setHeader).not.toHaveBeenCalled()
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('returns 405 with Allow only when the nonce is valid', async () => {
    const { status, end, setHeader } = await invoke(
      createRequest({ method: 'GET' })
    )

    expect(setHeader).toHaveBeenCalledWith('Allow', 'POST')
    expect(status).toHaveBeenCalledWith(405)
    expect(end).toHaveBeenCalledWith()
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('stores an exclusive private envelope and returns only ok', async () => {
    const rawBody = JSON.stringify({ type: 'page.content_updated', data: {} })
    const { status, json } = await invoke(
      createRequest({
        body: rawBody,
        headers: { 'x-notion-signature': 'sha256=private-signature' }
      })
    )

    expect(mockedMkdir).toHaveBeenCalledWith('/tmp/notion-webhook-capture', {
      recursive: true,
      mode: 0o700
    })
    expect(mockedWriteFile).toHaveBeenCalledTimes(1)
    const [path, contents, options] = mockedWriteFile.mock.calls[0]!
    expect(path).toMatch(
      /^\/tmp\/notion-webhook-capture\/\d+-page\.content_updated-[0-9a-f-]+\.json$/
    )
    expect(JSON.parse(String(contents)) as JsonBody).toEqual({
      signature: 'sha256=private-signature',
      rawBody
    })
    expect(options).toEqual({ mode: 0o600, flag: 'wx' })
    expect(status).toHaveBeenCalledWith(200)
    expect(json).toHaveBeenCalledWith({ ok: true })
  })

  it('uses a safe verification filename for missing or unsafe event types', async () => {
    await invoke(createRequest({ body: JSON.stringify({}) }))
    await invoke(
      createRequest({ body: JSON.stringify({ type: '../../secret/name' }) })
    )

    const firstPath = String(mockedWriteFile.mock.calls[0]![0])
    const secondPath = String(mockedWriteFile.mock.calls[1]![0])
    expect(firstPath).toContain('-verification-')
    expect(secondPath).not.toContain('..')
    expect(
      secondPath.slice('/tmp/notion-webhook-capture/'.length)
    ).not.toContain('/')
  })

  it.each(['not json', 'null', '[]', '"text"'])(
    'returns 400 without writing for invalid object body %p',
    async body => {
      const { status, end } = await invoke(createRequest({ body }))

      expect(status).toHaveBeenCalledWith(400)
      expect(end).toHaveBeenCalledWith()
      expect(mockedWriteFile).not.toHaveBeenCalled()
    }
  )

  it('returns 413 without writing when the raw body exceeds 64 KiB', async () => {
    const { status, end } = await invoke(
      createRequest({ body: Buffer.alloc(64 * 1024 + 1, 0x61) })
    )

    expect(status).toHaveBeenCalledWith(413)
    expect(end).toHaveBeenCalledWith()
    expect(mockedWriteFile).not.toHaveBeenCalled()
  })

  it('returns an empty 500 and never logs a filesystem error', async () => {
    mockedWriteFile.mockRejectedValueOnce(new Error('sensitive path details'))
    const consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined)
    ]

    const { status, end, json } = await invoke()

    expect(status).toHaveBeenCalledWith(500)
    expect(end).toHaveBeenCalledWith()
    expect(json).not.toHaveBeenCalled()
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})
