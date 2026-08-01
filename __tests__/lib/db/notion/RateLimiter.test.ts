/** @jest-environment node */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { RateLimiter } from '@/lib/db/notion/RateLimiter'

describe('Notion build RateLimiter', () => {
  test('shares failed-attempt spacing across limiter instances', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notion-rate-'))
    const lockPath = path.join(tempDir, 'notion.lock')
    const firstLimiter = new RateLimiter(200, lockPath, 80)
    const secondLimiter = new RateLimiter(200, lockPath, 80)
    const attemptTimes: number[] = []

    try {
      await expect(
        firstLimiter.enqueue('first', async () => {
          attemptTimes.push(Date.now())
          throw new Error('Notion 429')
        })
      ).rejects.toThrow('Notion 429')

      await secondLimiter.enqueue('second', async () => {
        attemptTimes.push(Date.now())
        return 'ok'
      })

      expect(attemptTimes).toHaveLength(2)
      expect(attemptTimes[1] - attemptTimes[0]).toBeGreaterThanOrEqual(65)
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
