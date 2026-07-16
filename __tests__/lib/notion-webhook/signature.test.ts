import { describe, expect, it } from '@jest/globals'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Readable } from 'node:stream'

import verificationFixture from '../../fixtures/notion-webhook/verification.json'
import {
  readRawBody,
  verifyNotionSignature
} from '@/lib/notion-webhook/signature'

const fixturePath =
  '__tests__/fixtures/notion-webhook/page-content-updated.json'
const token = verificationFixture.verification_token

const invalidSignatures: Array<
  [label: string, signature: string | string[] | undefined]
> = [
  ['missing', undefined],
  ['multiple header values', [sign(fixtureBytes())]],
  ['wrong algorithm', `hmac=${'0'.repeat(64)}`],
  ['missing prefix', '0'.repeat(64)],
  ['uppercase hex', `sha256=${'A'.repeat(64)}`],
  ['surrounding whitespace', ` sha256=${'0'.repeat(64)} `],
  ['non-hex digest', `sha256=${'g'.repeat(64)}`],
  ['short digest', `sha256=${'0'.repeat(63)}`],
  ['long digest', `sha256=${'0'.repeat(65)}`]
]

function fixtureBytes(): Buffer {
  return readFileSync(fixturePath)
}

function sign(rawBody: Buffer): string {
  const digest = createHmac('sha256', token).update(rawBody).digest('hex')
  return `sha256=${digest}`
}

describe('verifyNotionSignature', () => {
  it('accepts the exact sha256=<hex> signature computed from real fixture bytes', () => {
    const rawBody = fixtureBytes()

    expect(verifyNotionSignature(rawBody, sign(rawBody), token)).toBe(true)
  })

  it('rejects semantically identical JSON when its raw bytes differ', () => {
    const rawBody = fixtureBytes()
    const compactBody = Buffer.from(
      JSON.stringify(JSON.parse(rawBody.toString()))
    )

    expect(compactBody.equals(rawBody)).toBe(false)
    expect(verifyNotionSignature(compactBody, sign(rawBody), token)).toBe(false)
  })

  it.each(invalidSignatures)(
    'rejects a %s signature header',
    (_label, signature) => {
      expect(verifyNotionSignature(fixtureBytes(), signature, token)).toBe(
        false
      )
    }
  )

  it('rejects an empty verification token', () => {
    const rawBody = fixtureBytes()

    expect(verifyNotionSignature(rawBody, sign(rawBody), '')).toBe(false)
  })

  it('checks encoded lengths before calling timingSafeEqual', () => {
    const rawBody = fixtureBytes()

    expect(() =>
      verifyNotionSignature(rawBody, `sha256=${'0'.repeat(63)}`, token)
    ).not.toThrow()
  })
})

describe('readRawBody', () => {
  it('returns all streamed chunks as their exact bytes', async () => {
    const expected = Buffer.from('first\u0000second\nthird')
    const stream = Readable.from([
      expected.subarray(0, 6),
      expected.subarray(6, 12),
      expected.subarray(12)
    ])

    await expect(readRawBody(stream)).resolves.toEqual(expected)
  })

  it('accepts a body exactly at the 64 KiB default limit', async () => {
    const body = Buffer.alloc(64 * 1024, 0x61)

    await expect(readRawBody(Readable.from([body]))).resolves.toEqual(body)
  })

  it('rejects a body exceeding the 64 KiB default limit', async () => {
    const stream = Readable.from([
      Buffer.alloc(64 * 1024, 0x61),
      Buffer.from('b')
    ])

    await expect(readRawBody(stream)).rejects.toBeInstanceOf(RangeError)
  })

  it('honors a caller-provided byte limit', async () => {
    await expect(
      readRawBody(Readable.from([Buffer.from('12345')]), 4)
    ).rejects.toBeInstanceOf(RangeError)
  })

  it('propagates stream errors', async () => {
    const failure = new Error('stream failed')
    const stream = new Readable({
      read() {
        this.push(Buffer.from('partial'))
        this.destroy(failure)
      }
    })

    await expect(readRawBody(stream)).rejects.toBe(failure)
  })
})
