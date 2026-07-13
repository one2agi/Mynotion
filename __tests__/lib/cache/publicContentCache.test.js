jest.mock('@/lib/config', () => ({ siteConfig: jest.fn() }))

import { siteConfig } from '@/lib/config'
import {
  DEFAULT_PUBLIC_CONTENT_REVALIDATE_SECONDS,
  getPublicContentRevalidateSeconds
} from '@/lib/cache/publicContentCache'

describe('public content ISR policy', () => {
  const originalExport = process.env.EXPORT

  afterEach(() => {
    process.env.EXPORT = originalExport
    jest.clearAllMocks()
  })

  test('uses the approved 300 second value', () => {
    siteConfig.mockReturnValue(300)
    expect(DEFAULT_PUBLIC_CONTENT_REVALIDATE_SECONDS).toBe(300)
    expect(getPublicContentRevalidateSeconds({})).toBe(300)
  })

  test.each([undefined, null, 0, -1, NaN, 'invalid'])(
    'falls back to 300 for invalid value %p',
    value => {
      siteConfig.mockReturnValue(value)
      expect(getPublicContentRevalidateSeconds({})).toBe(300)
    }
  )

  test('accepts a positive numeric override', () => {
    siteConfig.mockReturnValue('600')
    expect(getPublicContentRevalidateSeconds({})).toBe(600)
  })

  test('disables ISR only for a real static export', () => {
    process.env.EXPORT = 'true'
    expect(getPublicContentRevalidateSeconds({})).toBeUndefined()
  })

  test('configures a one-day stale response window', () => {
    const fs = require('node:fs')
    const source = fs.readFileSync('next.config.js', 'utf8')
    expect(source).toMatch(/swrDelta:\s*86400/)
  })
})
