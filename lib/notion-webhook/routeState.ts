import { redisClient } from '@/lib/cache/redis_cache'
import { normalizePageId } from '@/lib/knowledge-graph/normalizePageId'

const ROUTE_HASH = 'notion:refresh:routes'
const REDIRECT_HASH = 'notion:refresh:redirects'
const BOOTSTRAP_KEY = 'notion:refresh:bootstrapped-at'

export type RouteSnapshot = {
  pageId: string
  locale?: string
  href: string
  slug: string
  public: boolean
  type: string
  status: string
  title: string
  summary: string
  categories: string[]
  tags: string[]
  lastEditedDate: number
  processedEventAt: number
  pendingEventAt?: number
}

type StrictRedisClient = {
  hget(key: string, field: string): Promise<string | null>
  hset(key: string, ...fieldValues: string[]): Promise<number>
  eval(
    script: string,
    numberOfKeys: number,
    ...args: string[]
  ): Promise<unknown>
}

type BootstrapOptions = {
  snapshots: RouteSnapshot[]
  sourceConfirmed: boolean
  bootstrappedAt: number
}

const strictRedis = (): StrictRedisClient => {
  const client = redisClient as Partial<StrictRedisClient>
  if (
    typeof client.hget !== 'function' ||
    typeof client.hset !== 'function' ||
    typeof client.eval !== 'function'
  ) {
    throw new Error(
      'Route state requires an initialized ioredis client. Check REDIS_URL.'
    )
  }
  return client as StrictRedisClient
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(item => typeof item === 'string')

const isTimestamp = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const validateSnapshot = (value: unknown): RouteSnapshot => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid route snapshot: expected an object')
  }

  const candidate = value as Partial<RouteSnapshot>
  const normalizedPageId = normalizePageId(candidate.pageId)
  const validOptionalLocale =
    candidate.locale === undefined ||
    (typeof candidate.locale === 'string' && candidate.locale.length > 0)
  const validPendingEventAt =
    candidate.pendingEventAt === undefined ||
    isTimestamp(candidate.pendingEventAt)

  if (
    normalizedPageId === null ||
    !validOptionalLocale ||
    typeof candidate.href !== 'string' ||
    !candidate.href.startsWith('/') ||
    typeof candidate.slug !== 'string' ||
    typeof candidate.public !== 'boolean' ||
    typeof candidate.type !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.summary !== 'string' ||
    !isStringArray(candidate.categories) ||
    !isStringArray(candidate.tags) ||
    !isTimestamp(candidate.lastEditedDate) ||
    !isTimestamp(candidate.processedEventAt) ||
    !validPendingEventAt
  ) {
    throw new Error(
      'Invalid route snapshot: record does not match the contract'
    )
  }

  return { ...candidate, pageId: normalizedPageId } as RouteSnapshot
}

const decodeSnapshot = (encoded: string): RouteSnapshot => {
  let decoded: unknown
  try {
    decoded = JSON.parse(encoded)
  } catch {
    throw new Error('Invalid route snapshot: malformed JSON')
  }
  return validateSnapshot(decoded)
}

const encodeSnapshot = (snapshot: RouteSnapshot): [string, string] => {
  const validated = validateSnapshot(snapshot)
  return [validated.pageId, JSON.stringify(validated)]
}

const normalizePath = (value: string): string => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.includes('?') ||
    value.includes('#') ||
    value.includes('\\')
  ) {
    throw new Error(`Invalid redirect path: ${String(value)}`)
  }

  const collapsed = value.replace(/\/{2,}/g, '/')
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed
}

const redirectField = (locale: string | undefined, path: string): string =>
  `${locale || 'default'}:${normalizePath(path)}`

const BOOTSTRAP_SCRIPT = `
local marker = redis.call('GET', KEYS[1])
if marker then
  return {0, marker}
end

for index = 2, #ARGV, 2 do
  redis.call('HSETNX', KEYS[2], ARGV[index], ARGV[index + 1])
end
redis.call('SET', KEYS[1], ARGV[1])
return {1, ARGV[1]}
`

const FLATTEN_REDIRECT_SCRIPT = `
local prefix = ARGV[1]
local source = ARGV[2]
local target = ARGV[3]
local redirects = {}

local function validPath(path)
  return type(path) == 'string'
    and string.sub(path, 1, 1) == '/'
    and string.find(path, '?', 1, true) == nil
    and string.find(path, '#', 1, true) == nil
    and string.find(path, string.char(92), 1, true) == nil
    and string.find(path, '//', 1, true) == nil
    and (#path == 1 or string.sub(path, -1) ~= '/')
end

local records = redis.call('HGETALL', KEYS[1])
for index = 1, #records, 2 do
  local field = records[index]
  if string.sub(field, 1, #prefix) == prefix then
    local storedSource = string.sub(field, #prefix + 1)
    local storedTarget = records[index + 1]
    if not validPath(storedSource) or not validPath(storedTarget) then
      error('Invalid stored redirect path')
    end
    redirects[storedSource] = storedTarget
  end
end
redirects[source] = target

local function resolve(start)
  local visited = {}
  local current = start
  while redirects[current] do
    if visited[current] then
      error('Redirect cycle detected')
    end
    visited[current] = true
    current = redirects[current]
  end
  return current
end

for storedSource, _ in pairs(redirects) do
  redis.call('HSET', KEYS[1], prefix .. storedSource, resolve(storedSource))
end
return resolve(source)
`

const decodeBootstrapResult = (value: unknown): boolean => {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    (value[0] !== 0 && value[0] !== 1) ||
    typeof value[1] !== 'string' ||
    !/^(0|[1-9]\d*)$/.test(value[1]) ||
    !isTimestamp(Number(value[1]))
  ) {
    throw new Error('Invalid route bootstrap marker')
  }
  return value[0] === 1
}

export async function getRouteSnapshot(
  pageId: string
): Promise<RouteSnapshot | null> {
  const normalizedPageId = normalizePageId(pageId)
  if (normalizedPageId === null) throw new Error('Invalid Notion page ID')

  const encoded = await strictRedis().hget(ROUTE_HASH, normalizedPageId)
  if (encoded === null) return null

  const snapshot = decodeSnapshot(encoded)
  if (snapshot.pageId !== normalizedPageId) {
    throw new Error(
      'Invalid route snapshot: stored page ID does not match field'
    )
  }
  return snapshot
}

export async function putRouteSnapshot(snapshot: RouteSnapshot): Promise<void> {
  const [pageId, encoded] = encodeSnapshot(snapshot)
  await strictRedis().hset(ROUTE_HASH, pageId, encoded)
}

export async function bootstrapRouteSnapshots({
  snapshots,
  sourceConfirmed,
  bootstrappedAt
}: BootstrapOptions): Promise<boolean> {
  if (!sourceConfirmed) {
    throw new Error('Route bootstrap requires a source-confirmed directory')
  }
  if (snapshots.length === 0) {
    throw new Error('Route bootstrap requires a non-empty directory')
  }
  if (!isTimestamp(bootstrappedAt)) {
    throw new Error('Route bootstrap requires a valid timestamp')
  }

  const client = strictRedis()
  const entries = snapshots.flatMap(snapshot => encodeSnapshot(snapshot))
  const result = await client.eval(
    BOOTSTRAP_SCRIPT,
    2,
    BOOTSTRAP_KEY,
    ROUTE_HASH,
    String(bootstrappedAt),
    ...entries
  )
  return decodeBootstrapResult(result)
}

export async function getStoredRedirect(
  locale: string | undefined,
  path: string
): Promise<string | null> {
  const encoded = await strictRedis().hget(
    REDIRECT_HASH,
    redirectField(locale, path)
  )
  return encoded === null ? null : normalizePath(encoded)
}

export async function saveFlattenedRedirect(
  locale: string | undefined,
  fromPath: string,
  targetPath: string
): Promise<string> {
  const client = strictRedis()
  const localeKey = locale || 'default'
  const prefix = `${localeKey}:`
  const source = normalizePath(fromPath)
  const target = normalizePath(targetPath)
  if (source === target)
    throw new Error('Redirect source and target must differ')

  const result = await client.eval(
    FLATTEN_REDIRECT_SCRIPT,
    1,
    REDIRECT_HASH,
    prefix,
    source,
    target
  )
  if (typeof result !== 'string') {
    throw new Error('Invalid stored redirect result')
  }
  return normalizePath(result)
}

export async function isExplicitlyPrivate(pageId: string): Promise<boolean> {
  const snapshot = await getRouteSnapshot(pageId)
  return snapshot?.public === false
}
