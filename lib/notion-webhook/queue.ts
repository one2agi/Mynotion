import { randomUUID } from 'node:crypto'

import { redisClient } from '@/lib/cache/redis_cache'
import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'
import {
  CONSUMER_LOCK_KEY,
  CONSUMER_LOCK_SECONDS,
  DIRTY_KEY,
  QUIET_WINDOW_MS
} from '@/lib/notion-webhook/constants'

const CONSUMER_BATCH_SIZE = 50

type StrictRedisClient = {
  zadd(key: string, mode: 'GT', score: number, member: string): Promise<number>
  zrangebyscore(
    key: string,
    min: '-inf',
    max: number,
    withScores: 'WITHSCORES',
    limit: 'LIMIT',
    offset: 0,
    count: number
  ): Promise<string[]>
  eval(
    script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<unknown>
  set(
    key: string,
    value: string,
    nx: 'NX',
    ex: 'EX',
    seconds: number
  ): Promise<'OK' | null>
  zcard(key: string): Promise<number>
}

export type DirtyPage = {
  pageId: string
  score: number
}

export type DirtyConsumerLockResult<T> =
  | { status: 'busy' }
  | { status: 'acquired'; result: T }

export type DirtyConsumerLease = {
  assertOwned(): void
}

type DirtyConsumerLockOptions = {
  lockSeconds?: number
  renewEveryMs?: number
}

const strictRedis = (): StrictRedisClient => {
  const client = redisClient as Partial<StrictRedisClient>
  if (
    typeof client.zadd !== 'function' ||
    typeof client.zrangebyscore !== 'function' ||
    typeof client.eval !== 'function' ||
    typeof client.set !== 'function' ||
    typeof client.zcard !== 'function'
  ) {
    throw new Error(
      'Notion webhook queue requires an initialized ioredis client. Check REDIS_URL.'
    )
  }
  return client as StrictRedisClient
}

const requirePageId = (pageId: unknown): string => {
  const normalized = normalizePageId(pageId)
  if (normalized === null) throw new Error('Invalid Notion page ID')
  return normalized
}

const isSafeNonnegativeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const requireTimestamp = (value: unknown): number => {
  if (!isSafeNonnegativeInteger(value)) {
    throw new Error('Invalid dirty queue timestamp')
  }
  return value
}

const requireScore = (value: unknown): number => {
  if (!isSafeNonnegativeInteger(value)) {
    throw new Error('Invalid dirty queue score')
  }
  return value
}

const requireLimit = (value: unknown): number => {
  if (!isSafeNonnegativeInteger(value)) {
    throw new Error('Invalid dirty queue limit')
  }
  return Math.min(value, CONSUMER_BATCH_SIZE)
}

const decodeScore = (value: string): number => {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error('Invalid dirty queue result')
  }
  const score = Number(value)
  if (!isSafeNonnegativeInteger(score)) {
    throw new Error('Invalid dirty queue result')
  }
  return score
}

const decodeDirtyPages = (values: unknown): DirtyPage[] => {
  if (!Array.isArray(values) || values.length % 2 !== 0) {
    throw new Error('Invalid dirty queue result')
  }

  const entries = values as unknown[]
  const pages: DirtyPage[] = []
  for (let index = 0; index < entries.length; index += 2) {
    const pageId = requirePageId(entries[index])
    const encodedScore = entries[index + 1]
    if (typeof encodedScore !== 'string') {
      throw new Error('Invalid dirty queue result')
    }
    pages.push({ pageId, score: decodeScore(encodedScore) })
  }
  return pages
}

const ACK_DIRTY_PAGE_SCRIPT = `
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
if current and tonumber(current) == tonumber(ARGV[2]) then
  return redis.call('ZREM', KEYS[1], ARGV[1])
end
return 0
`

const RELEASE_CONSUMER_LOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and current == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

const RENEW_CONSUMER_LOCK_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and current == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`

const decodeMutationResult = (value: unknown, operation: string): boolean => {
  if (value !== 0 && value !== 1) {
    throw new Error(`Invalid Redis ${operation} result`)
  }
  return value === 1
}

const attachReleaseError = (primaryError: unknown, releaseError: unknown) => {
  if (
    primaryError instanceof Error &&
    Object.isExtensible(primaryError) &&
    !Object.prototype.hasOwnProperty.call(primaryError, 'releaseError')
  ) {
    Object.defineProperty(primaryError, 'releaseError', {
      configurable: true,
      value: releaseError
    })
  }
}

export async function enqueueDirtyPage({
  pageId,
  eventTimestampMs
}: {
  pageId: string
  eventTimestampMs: number
}): Promise<void> {
  const normalizedPageId = requirePageId(pageId)
  const timestamp = requireTimestamp(eventTimestampMs)
  await strictRedis().zadd(DIRTY_KEY, 'GT', timestamp, normalizedPageId)
}

export async function listQuietDirtyPages(
  now: number,
  limit = CONSUMER_BATCH_SIZE
): Promise<DirtyPage[]> {
  const timestamp = requireTimestamp(now)
  const batchSize = requireLimit(limit)
  const values = await strictRedis().zrangebyscore(
    DIRTY_KEY,
    '-inf',
    timestamp - QUIET_WINDOW_MS,
    'WITHSCORES',
    'LIMIT',
    0,
    batchSize
  )
  return decodeDirtyPages(values)
}

export async function ackDirtyPage(
  pageId: string,
  processedScore: number
): Promise<boolean> {
  const normalizedPageId = requirePageId(pageId)
  const score = requireScore(processedScore)
  const result = await strictRedis().eval(
    ACK_DIRTY_PAGE_SCRIPT,
    1,
    DIRTY_KEY,
    normalizedPageId,
    String(score)
  )
  return decodeMutationResult(result, 'dirty-page acknowledgement')
}

export async function getDirtyQueueDepth(): Promise<number> {
  const depth = await strictRedis().zcard(DIRTY_KEY)
  if (!isSafeNonnegativeInteger(depth)) {
    throw new Error('Invalid Redis dirty queue depth')
  }
  return depth
}

export async function withDirtyConsumerLock<T>(
  task: (lease: DirtyConsumerLease) => Promise<T>,
  options: DirtyConsumerLockOptions = {}
): Promise<DirtyConsumerLockResult<T>> {
  const client = strictRedis()
  const lockSeconds = options.lockSeconds ?? CONSUMER_LOCK_SECONDS
  const renewEveryMs = options.renewEveryMs ?? 60_000
  if (!Number.isSafeInteger(lockSeconds) || lockSeconds < 1) {
    throw new Error('Invalid consumer lock duration')
  }
  if (
    !Number.isSafeInteger(renewEveryMs) ||
    renewEveryMs < 1 ||
    renewEveryMs >= lockSeconds * 1_000
  ) {
    throw new Error('Invalid consumer lock renewal interval')
  }
  const ownerToken = randomUUID()
  const acquired = await client.set(
    CONSUMER_LOCK_KEY,
    ownerToken,
    'NX',
    'EX',
    lockSeconds
  )
  if (acquired === null) return { status: 'busy' }
  if (acquired !== 'OK') throw new Error('Invalid Redis consumer-lock result')

  let leaseError: Error | null = null
  const renewalState: { inFlight: Promise<void> | null } = { inFlight: null }
  const renew = async () => {
    try {
      const renewed = await client.eval(
        RENEW_CONSUMER_LOCK_SCRIPT,
        1,
        CONSUMER_LOCK_KEY,
        ownerToken,
        String(lockSeconds)
      )
      if (!decodeMutationResult(renewed, 'consumer-lock renewal')) {
        throw new Error('owner token no longer matches')
      }
    } catch (error) {
      leaseError = new Error('Notion consumer lock lease was lost', {
        cause: error
      })
    }
  }
  const timer = setInterval(() => {
    if (renewalState.inFlight || leaseError) return
    renewalState.inFlight = renew().finally(() => {
      renewalState.inFlight = null
    })
  }, renewEveryMs)
  timer.unref?.()

  const lease: DirtyConsumerLease = {
    assertOwned() {
      if (leaseError) throw leaseError
    }
  }

  let result: T | undefined
  let primaryError: unknown
  try {
    result = await task(lease)
    lease.assertOwned()
  } catch (error) {
    primaryError = error
  } finally {
    clearInterval(timer)
    if (renewalState.inFlight !== null) await renewalState.inFlight
    if (primaryError === undefined && leaseError) primaryError = leaseError
    try {
      const releaseResult = await client.eval(
        RELEASE_CONSUMER_LOCK_SCRIPT,
        1,
        CONSUMER_LOCK_KEY,
        ownerToken
      )
      const released = decodeMutationResult(
        releaseResult,
        'consumer-lock release'
      )
      if (!released) {
        const lostLease = new Error('Notion consumer lock lease was lost')
        if (primaryError === undefined) primaryError = lostLease
        else attachReleaseError(primaryError, lostLease)
      }
    } catch (releaseError) {
      if (primaryError === undefined) primaryError = releaseError
      else attachReleaseError(primaryError, releaseError)
    }
  }

  if (primaryError !== undefined) throw primaryError
  return { status: 'acquired', result: result as T }
}
