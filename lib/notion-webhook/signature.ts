import { createHmac, timingSafeEqual } from 'node:crypto'

const NOTION_SIGNATURE_PATTERN = /^sha256=[0-9a-f]{64}$/

export async function readRawBody(
  req: NodeJS.ReadableStream,
  maxBytes = 64 * 1024
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string | Uint8Array)
    size += value.length
    if (size > maxBytes) {
      throw new RangeError('request body too large')
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks, size)
}

export function verifyNotionSignature(
  rawBody: Buffer,
  signature: string | string[] | undefined,
  verificationToken: string
): boolean {
  if (
    typeof signature !== 'string' ||
    !verificationToken ||
    !NOTION_SIGNATURE_PATTERN.test(signature)
  ) {
    return false
  }

  const calculated = `sha256=${createHmac('sha256', verificationToken)
    .update(rawBody)
    .digest('hex')}`
  const calculatedBytes = Buffer.from(calculated)
  const signatureBytes = Buffer.from(signature)

  return (
    calculatedBytes.length === signatureBytes.length &&
    timingSafeEqual(calculatedBytes, signatureBytes)
  )
}
