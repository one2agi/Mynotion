# Notion Webhook Active Revalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every public Notion article change visible to the first visitor within one to two minutes, while preserving the existing five-minute ISR, Worker-first/direct-fallback Notion transport, Redis fallback, knowledge graph, and dynamic comment behavior.

**Architecture:** A signed Notion webhook records normalized page IDs in a Redis sorted set and returns immediately. A one-minute systemd timer calls the existing authenticated `/api/revalidate` endpoint, which performs one source-confirmed metadata refresh, compares persistent route snapshots, eagerly regenerates the exact affected ISR paths, refreshes the existing knowledge graph, and removes queue entries only after all required work succeeds. Route snapshots retain private tombstones so an old seven-day fallback cannot republish an article that has been explicitly unpublished.

**Tech Stack:** Next.js 14 Pages Router, Node.js 22, TypeScript/JavaScript, Redis 7 through ioredis 5, Jest 29, Docker Compose, systemd, Nginx, official Notion Connection webhooks.

## Global Constraints

- Production remains one Next.js container and one Redis container on the Tencent VPS.
- Public ISR remains `300` seconds; Webhook refresh is additive, not a replacement.
- Notion content reads retain Worker-first transport, direct fallback, current retry behavior, Redis seven-day fallback, and empty-value rejection.
- `/api/notion-comments` remains dynamically loaded by stable article page ID; comment create, reply, or moderation must never enqueue article revalidation.
- The webhook handler must acknowledge only after Redis confirms the queue write.
- No request body, signature, verification token, Notion token, article body, or comment body may enter application logs.
- Real Notion webhook payloads must be captured and redacted before behavioral mocks are written.
- Every behavior change follows RED -> GREEN and is committed independently with Conventional Commits.
- Existing user changes in `AGENTS.md`, `deploy/scripts/deploy.sh`, and `deploy/scripts/weekly-check.sh` are out of scope and must not be staged.
- Do not add a second article cache, graph snapshot, transport retry layer, scheduler container, or revalidation endpoint.

---

## Code Audit Corrections Applied to the Approved Design

The following corrections are mandatory because the current code cannot satisfy the product requirements without them:

1. **Fresh-read proof:** `fetchGlobalAllData()` currently returns Redis fallback data without exposing whether Notion succeeded. Dirty jobs must use a new source-required read that bypasses short caches and refuses stale fallback; otherwise a stale directory can be mistaken for confirmation.
2. **Private tombstones:** deleting a route snapshot on unpublish loses the evidence needed to block a seven-day fallback. Keep a compact `public:false` tombstone containing the last public route instead.
3. **Bootstrap before subscription:** route snapshots must be initialized from a successful fresh directory read before Webhook events are enabled; otherwise the first slug change has no old route to redirect.
4. **Graph refresh window:** `createGraphStore().acquireRefreshClaim()` currently allows one refresh per ten-minute window. Dirty refreshes need an explicit 60-second claim window while normal graph GET refreshes retain ten minutes.
5. **All visible list pages:** title, summary, ordering, publish, and unpublish changes can affect `/page/N`, not just `/`. Route planning must include known home pagination and the affected category/tag pagination.
6. **Deployment isolation:** `deploy/scripts/deploy.sh` already has unrelated user edits and does not transfer host systemd assets. Add a separate installer/configurator instead of modifying that script.
7. **SDK compatibility:** the installed `@notionhq/client` is `2.3.0` and does not export `verifyWebhookSignature`. Use Node's built-in `createHmac` and `timingSafeEqual`; do not introduce a broad Notion SDK upgrade solely for this helper.

## File Structure

### New application modules

- `lib/notion-webhook/constants.ts` — Redis keys, event allowlist, timing and size limits.
- `lib/notion-webhook/signature.ts` — raw-body reader and HMAC verification.
- `lib/notion-webhook/queue.ts` — strict Redis queue operations and single-consumer lock.
- `lib/notion-webhook/routeState.ts` — persistent route snapshots, private tombstones, bootstrap marker, and redirect map.
- `lib/notion-webhook/routePlan.ts` — pure old/new metadata diff and exact ISR path planning.
- `lib/notion-webhook/consumer.ts` — source refresh, route diff, revalidation, graph refresh, and acknowledgement orchestration.
- `pages/api/notion-webhook.ts` — public verification/enqueue HTTP adapter.
- `lib/knowledge-graph/serverRefresh.ts` — shared Docker graph dependency factory used by both API GET and dirty refresh.

### New tests and fixtures

- `__tests__/fixtures/notion-webhook/*.json` — redacted real verification and page-event payloads.
- `__tests__/lib/notion-webhook/signature.test.ts`
- `__tests__/lib/notion-webhook/queue.test.ts`
- `__tests__/lib/notion-webhook/routeState.test.ts`
- `__tests__/lib/notion-webhook/routePlan.test.ts`
- `__tests__/lib/notion-webhook/consumer.test.ts`
- `__tests__/pages/notion-webhook.test.ts`
- `__tests__/pages/revalidate-dirty.test.ts`
- `__tests__/pages/stored-slug-redirect.test.js`
- `__tests__/deploy/notion-webhook-scripts.test.js`

### Modified application files

- `lib/db/notion/getPostBlocks.js` — source-required block fetch option that cannot fall back to a cached record map.
- `lib/db/SiteDataApi.js` — source-required global metadata refresh, cache-key exports, and private tombstone guard.
- `pages/api/revalidate.js` — backward-compatible `{dirty:true}` and `{bootstrap:true}` operations.
- `pages/api/knowledge-graph.ts` — use the shared server refresh factory.
- `lib/knowledge-graph/refresh.ts` and `lib/knowledge-graph/store.ts` — configurable refresh claim window.
- `pages/[prefix]/index.js`, `pages/[prefix]/[slug]/index.js`, and `pages/[prefix]/[slug]/[...suffix].js` — stored redirect lookup only after normal article resolution fails.
- `.env.example` and `package.json` — documented private variables and repeatable test command.

### New deployment files

- `deploy/systemd/notionnext-notion-refresh.service`
- `deploy/systemd/notionnext-notion-refresh.timer`
- `deploy/scripts/run-notion-refresh.sh`
- `deploy/scripts/configure-notion-webhook-vps.sh`
- `deploy/docs/NOTION-WEBHOOK.md`

---

### Task 0: Capture Real Notion Fixtures Before Behavioral Mocks

**Files:**
- Create temporarily, then delete before Task 1 commit: `pages/api/notion-webhook-capture.ts`
- Create after capture: `__tests__/fixtures/notion-webhook/verification.json`
- Create after capture: `__tests__/fixtures/notion-webhook/page-content-updated.json`
- Create after capture: `__tests__/fixtures/notion-webhook/page-properties-updated.json`
- Create after capture: `__tests__/fixtures/notion-webhook/page-created.json`
- Create after capture: `__tests__/fixtures/notion-webhook/page-deleted.json`
- Create after capture: `__tests__/fixtures/notion-webhook/page-undeleted.json`

**Interfaces:**
- Consumes: an official Notion Connection shared with the blog database and a disposable published test article.
- Produces: redacted payload structures used by every Webhook parser/handler test.

- [ ] **Step 1: Create a temporary capture-only subscription**

Use a disposable subscription and a random capture URL handled by a temporary, uncommitted capture route. Add exactly this diagnostic adapter; it is not production code:

```ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

export const config = { api: { bodyParser: false } }

const CAPTURE_DIR = '/tmp/notion-webhook-capture'
const MAX_BYTES = 64 * 1024

async function readBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += value.length
    if (size > MAX_BYTES) throw new RangeError('body too large')
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') return res.status(405).end()
  const expected = process.env.NOTION_WEBHOOK_CAPTURE_NONCE || ''
  const received = typeof req.query.capture === 'string' ? req.query.capture : ''
  if (!expected || received !== expected) return res.status(404).end()

  try {
    const body = await readBody(req)
    const payload = JSON.parse(body.toString('utf8')) as { type?: unknown }
    const type =
      typeof payload.type === 'string'
        ? payload.type.replace(/[^a-z0-9_.-]/gi, '_')
        : 'verification'
    await mkdir(CAPTURE_DIR, { recursive: true, mode: 0o700 })
    await writeFile(
      `${CAPTURE_DIR}/${Date.now()}-${type}-${randomUUID()}.json`,
      JSON.stringify({
        signature: req.headers['x-notion-signature'] || null,
        rawBody: body.toString('utf8')
      }),
      { mode: 0o600, flag: 'wx' }
    )
    return res.status(200).json({ ok: true })
  } catch (error) {
    return res.status(error instanceof RangeError ? 413 : 400).end()
  }
}
```

Generate a 32-byte nonce, place it temporarily in `/opt/notionnext/.env.production` with mode `0600`, deploy the capture build, and create the disposable subscription with:

```text
https://www.one2agi.com/api/notion-webhook-capture?capture=<generated 64-hex nonce>
```

Do not paste the nonce into shell history as a literal. Keep it in a mode-`0600` temporary file and expand it only in the Notion UI. The route writes request envelopes under `/tmp/notion-webhook-capture/`, returns `200`, caps each body at `64 KiB`, and never calls a console method.

- [ ] **Step 2: Trigger every required real event**

Perform these Notion UI operations on the test article: create, edit body, edit title, move to trash, restore. Wait for each aggregated event and verify the capture directory contains the six expected payload types.

Run on the VPS:

```bash
sudo docker exec notionnext-app sh -lc \
  'find /tmp/notion-webhook-capture -type f -maxdepth 1 -size +0c -print'
```

Expected: at least one non-empty file for verification, content update, properties update, create, delete, and undelete.

- [ ] **Step 3: Redact and commit only schema-preserving fixtures**

Replace workspace, user, page, subscription, integration, event, verification-token, and signature values with deterministic valid UUID/token placeholders. Preserve field names, nesting, array/object shapes, `api_version`, `attempt_number`, `entity.type`, `type`, `timestamp`, and `data` exactly.

Run:

```bash
rg -n "secret_|workspace_name|@|one2agi|morav" __tests__/fixtures/notion-webhook
```

Expected: no output.

Delete the disposable subscription, remove `NOTION_WEBHOOK_CAPTURE_NONCE` from the VPS environment, delete `pages/api/notion-webhook-capture.ts` with `apply_patch`, and deploy the route removal before continuing. The raw capture directory and verification token must be deleted after the redacted fixtures are safely stored.

Commit:

```bash
git add __tests__/fixtures/notion-webhook
git commit -m "test(notion): add real webhook fixtures"
```

---

### Task 1: Add Strict Webhook Signature and Queue Primitives

**Files:**
- Create: `lib/notion-webhook/constants.ts`
- Create: `lib/notion-webhook/signature.ts`
- Create: `lib/notion-webhook/queue.ts`
- Test: `__tests__/lib/notion-webhook/signature.test.ts`
- Test: `__tests__/lib/notion-webhook/queue.test.ts`

**Interfaces:**
- Produces: `readRawBody(req, maxBytes)`, `verifyNotionSignature(rawBody, signature, token)`, `enqueueDirtyPage(input)`, `listQuietDirtyPages(now)`, `ackDirtyPage(id, score)`, and `withDirtyConsumerLock(task)`.
- Uses: `redisClient` directly; cache wrappers that swallow Redis errors are forbidden here.

- [ ] **Step 1: Write failing signature tests from real fixtures**

Cover the exact `sha256=<hex>` header, raw-byte sensitivity, missing/malformed signature, unequal buffer lengths, and the `64 KiB` stream limit. Compute the test signature from the redacted fixture with Node `createHmac`; do not paste a fabricated signature.

Run:

```bash
pnpm test -- __tests__/lib/notion-webhook/signature.test.ts --runInBand
```

Expected: FAIL because `lib/notion-webhook/signature.ts` does not exist.

- [ ] **Step 2: Implement the minimal signature contract**

Use this public surface:

```ts
export async function readRawBody(
  req: NodeJS.ReadableStream,
  maxBytes = 64 * 1024
): Promise<Buffer>

export function verifyNotionSignature(
  rawBody: Buffer,
  signature: string | string[] | undefined,
  verificationToken: string
): boolean
```

The calculated value is `sha256=${createHmac('sha256', token).update(rawBody).digest('hex')}`. Call `timingSafeEqual` only when both buffers have the same length.

- [ ] **Step 3: Verify signature tests pass**

Run the command from Step 1.

Expected: PASS for valid raw bytes and FAIL-closed behavior for every malformed input.

- [ ] **Step 4: Write failing queue tests**

Mock the strict ioredis methods and assert:

```ts
await enqueueDirtyPage({
  pageId: '0123456789abcdef0123456789abcdef',
  eventTimestampMs: 1_000
})
```

emits `ZADD notion:refresh:dirty GT 1000 <pageId>`, a later score wins, an older score does not, quiet selection uses `now - 60_000`, acknowledgement removes only when the stored score still equals the processed score, and a concurrent consumer receives `busy` from `SET ... NX EX`.

Run:

```bash
pnpm test -- __tests__/lib/notion-webhook/queue.test.ts --runInBand
```

Expected: FAIL because the queue module does not exist.

- [ ] **Step 5: Implement strict queue operations**

Use constants:

```ts
export const DIRTY_KEY = 'notion:refresh:dirty'
export const CONSUMER_LOCK_KEY = 'notion:refresh:consumer-lock'
export const QUIET_WINDOW_MS = 60_000
export const CONSUMER_LOCK_SECONDS = 240
```

`ackDirtyPage(id, processedScore)` must use a Lua compare-and-delete so a newer event arriving during processing is never removed:

```lua
local current = redis.call('ZSCORE', KEYS[1], ARGV[1])
if current and tonumber(current) == tonumber(ARGV[2]) then
  return redis.call('ZREM', KEYS[1], ARGV[1])
end
return 0
```

Release the consumer lock with an owner-token compare-and-delete Lua script. Throw on all Redis errors so the HTTP layer can return `503`.

- [ ] **Step 6: Verify and commit primitives**

```bash
pnpm test -- __tests__/lib/notion-webhook/signature.test.ts __tests__/lib/notion-webhook/queue.test.ts --runInBand
git add lib/notion-webhook/constants.ts lib/notion-webhook/signature.ts lib/notion-webhook/queue.ts __tests__/lib/notion-webhook
git commit -m "feat(notion): add signed webhook queue primitives"
```

Expected: all selected tests PASS.

---

### Task 2: Implement the Public Webhook Receiver

**Files:**
- Create: `pages/api/notion-webhook.ts`
- Test: `__tests__/pages/notion-webhook.test.ts`

**Interfaces:**
- Consumes: Task 1 signature and queue functions; the real fixtures from Task 0.
- Produces: `POST /api/notion-webhook` and one-time setup-token capture.

- [ ] **Step 1: Write failing handler tests**

Use a real Node `Readable` request so the test exercises raw stream bytes. Cover:

- `405` plus `Allow: POST` for other methods;
- setup payload accepted only when `NOTION_WEBHOOK_SETUP_MODE=true`;
- setup token written with `{ mode: 0o600, flag: 'wx' }` and never logged;
- valid supported page event enqueued and returns `200`;
- invalid signature returns `401`;
- oversized body returns `413`;
- unsupported signed event returns `200` with `{ok:true, ignored:true}`;
- Redis failure returns `503`;
- invalid page ID/timestamp/entity returns `400` without enqueue.

Run:

```bash
pnpm test -- __tests__/pages/notion-webhook.test.ts --runInBand
```

Expected: FAIL because the API route does not exist.

- [ ] **Step 2: Implement the receiver**

Export the Pages Router setting:

```ts
export const config = {
  api: { bodyParser: false }
}
```

Allow only:

```ts
new Set([
  'page.content_updated',
  'page.properties_updated',
  'page.created',
  'page.deleted',
  'page.undeleted',
  'page.moved'
])
```

Normalize IDs with `lib/knowledge-graph/normalizePageId.ts`. The setup token path is `/tmp/notion-webhook-verification-token`; when the file already exists, return `409` rather than overwrite it. Normal mode requires `NOTION_WEBHOOK_VERIFICATION_TOKEN` and returns `503` when it is absent.

Emit one sanitized structured line containing only event type, normalized page ID, enqueue outcome, and elapsed milliseconds. Never interpolate the raw body, signature, verification token, authors, workspace name, or `data` object into logs.

- [ ] **Step 3: Verify and commit the receiver**

```bash
pnpm test -- __tests__/pages/notion-webhook.test.ts --runInBand
git add pages/api/notion-webhook.ts __tests__/pages/notion-webhook.test.ts
git commit -m "feat(notion): receive signed page webhooks"
```

Expected: all handler tests PASS and no secret value appears in captured console calls.

---

### Task 3: Add Source-Required Metadata Refresh

**Files:**
- Modify: `lib/db/notion/getPostBlocks.js`
- Modify: `lib/db/SiteDataApi.js`
- Test: `__tests__/lib/db/notion/freshPostBlocks.test.js`
- Test: `__tests__/lib/db/freshSiteData.test.js`

**Interfaces:**
- Produces: `fetchFreshConfiguredGlobalData({from}) -> Promise<Array<{locale?: string, data: GlobalData}>>`.
- Guarantee: success means this invocation reached Notion through the existing Worker/direct transport; Redis fallback is never returned on this path.

- [ ] **Step 1: Write failing source-required block tests**

Assert `fetchNotionPageBlocks(id, from, {forceSource:true})` invokes `notionAPI.getPage` even when a short cache exists and rejects after transport retries instead of returning `getDataFromCache(cacheKey)`.

Run:

```bash
pnpm test -- __tests__/lib/db/notion/freshPostBlocks.test.js --runInBand
```

Expected: FAIL because `forceSource` is not implemented.

- [ ] **Step 2: Implement `forceSource` without changing normal callers**

Extend the option shape:

```js
/** @param {{ cacheVersion?: string|number|Date, forceSource?: boolean }} options */
```

Normal calls retain `getOrSetDataWithCache`. A forced call invokes the same rate-limited `getPageWithRetry` transport path with cache fallback disabled and throws when the source returns null.

- [ ] **Step 3: Write failing fresh-directory tests**

Cover one database, configured locale databases in declaration order, successful writes to the existing `site_*`, `global_data_*`, and `fallback:*` layers, and total rejection when the source fails. Assert that failure does not delete or overwrite fallback keys.

Run:

```bash
pnpm test -- __tests__/lib/db/freshSiteData.test.js --runInBand
```

Expected: FAIL because `fetchFreshConfiguredGlobalData` does not exist.

- [ ] **Step 4: Refactor SiteDataApi around one source function**

Export cache-key helpers and add:

```ts
type FreshSiteData = {
  locale?: string
  pageId: string
  data: Record<string, unknown>
}

export async function fetchFreshConfiguredGlobalData({
  from = 'notion-webhook-consumer'
} = {}): Promise<FreshSiteData[]>
```

Refactor the current fetch callback so normal `fetchGlobalAllData()` and the fresh function share conversion, cleanup, retry, and successful-cache writes. Only the fresh function bypasses short reads and disables fallback reads.

- [ ] **Step 5: Run cache regressions and commit**

```bash
pnpm test -- __tests__/lib/db/notion/freshPostBlocks.test.js __tests__/lib/db/freshSiteData.test.js __tests__/lib/cache/cache_manager.test.js __tests__/lib/cache/redis_fallback.test.js --runInBand
git add lib/db/notion/getPostBlocks.js lib/db/SiteDataApi.js __tests__/lib/db
git commit -m "feat(notion): add source-confirmed metadata refresh"
```

Expected: selected tests PASS; existing stale fallback tests remain unchanged.

---

### Task 4: Persist Route State, Private Tombstones, and Redirects

**Files:**
- Create: `lib/notion-webhook/routeState.ts`
- Test: `__tests__/lib/notion-webhook/routeState.test.ts`

**Interfaces:**
- Produces: `RouteSnapshot`, `getRouteSnapshot`, `putRouteSnapshot`, `bootstrapRouteSnapshots`, `getStoredRedirect`, `saveFlattenedRedirect`, and `isExplicitlyPrivate`.
- Consumes: normalized page IDs and strict ioredis operations.

- [ ] **Step 1: Write failing route-state tests**

Use this persisted shape:

```ts
type RouteSnapshot = {
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
```

Assert:

- bootstrap is allowed only from a source-confirmed non-empty directory;
- normal consumption updates only dirty page snapshots, never every page observed in the directory;
- unpublish first writes `public:false` while retaining the last public `href`, leaves `processedEventAt` unchanged, and records the attempted score in `pendingEventAt`;
- redirect `A -> B` followed by `B -> C` resolves and stores `A -> C`;
- missing snapshot is not treated as private;
- Redis parse errors fail closed for explicit route-state operations.

Run:

```bash
pnpm test -- __tests__/lib/notion-webhook/routeState.test.ts --runInBand
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement compact Redis hashes**

Use:

```ts
const ROUTE_HASH = 'notion:refresh:routes'
const REDIRECT_HASH = 'notion:refresh:redirects'
const BOOTSTRAP_KEY = 'notion:refresh:bootstrapped-at'
```

Store JSON by normalized page ID. Store redirect fields as `${locale || 'default'}:${normalizedPath}`. Do not assign TTLs to tombstones or redirects. Validate every decoded record before use. A private tombstone is committed before its old route is revalidated, but it is not marked processed until every required path and graph action succeeds; this makes retries both safe and idempotent.

- [ ] **Step 3: Verify and commit route state**

```bash
pnpm test -- __tests__/lib/notion-webhook/routeState.test.ts --runInBand
git add lib/notion-webhook/routeState.ts __tests__/lib/notion-webhook/routeState.test.ts
git commit -m "feat(notion): persist route state and tombstones"
```

Expected: all route-state tests PASS.

---

### Task 5: Build a Pure, Locale-Aware ISR Route Planner

**Files:**
- Create: `lib/notion-webhook/routePlan.ts`
- Test: `__tests__/lib/notion-webhook/routePlan.test.ts`

**Interfaces:**
- Consumes: selected queue score, old snapshot, new page metadata, complete fresh public directory, `POSTS_PER_PAGE`, and default/configured locales.
- Produces: `{paths, nextSnapshot, redirect, refreshGraph, becamePrivate}` with sorted unique normalized paths.

- [ ] **Step 1: Write the route matrix as failing table tests**

Cover:

| Change | Exact expected scope |
| --- | --- |
| body/`lastEditedDate` only | canonical article + graph |
| title/summary | article, `/`, known `/page/N`, `/archive`, `/search` |
| category/tag | article, affected old/new taxonomy index and all known pagination |
| slug | old path, new path, listing paths, permanent redirect, graph |
| publish/restore | article, all home pagination, archive/search, affected taxonomy, graph |
| unpublish/delete/move out | old article to 404, all affected lists, private tombstone, graph |
| irrelevant page | no paths, no graph, acknowledge |

Include Chinese taxonomy names, a two-segment article slug, a three-plus-segment slug, non-default locale prefixes, duplicate paths, and an article on `/page/3`.

Assert that only `/search` is enumerated. Historical `/search/<keyword>` routes remain on the existing 300-second ISR fallback because the set of past keywords is not knowable.

Run:

```bash
pnpm test -- __tests__/lib/notion-webhook/routePlan.test.ts --runInBand
```

Expected: FAIL because the planner does not exist.

- [ ] **Step 2: Implement deterministic planning**

The planner must be pure: no Redis, Notion, `res`, clock, or environment reads. Encode each dynamic path segment with `encodeURIComponent`, retain `/` separators in article slugs, omit the default locale prefix, and prefix every non-default locale route. When a private tombstone has `pendingEventAt` equal to the selected queue score but `processedEventAt` is older, plan the unpublish actions again instead of treating the event as complete.

Use `Math.ceil(publicPostCount / postsPerPage)` for home pagination. Revalidate pages `2..N`; `/` represents page 1. For an old/new count change, use the larger count so a removed last page is also regenerated to 404.

- [ ] **Step 3: Verify and commit the planner**

```bash
pnpm test -- __tests__/lib/notion-webhook/routePlan.test.ts --runInBand
git add lib/notion-webhook/routePlan.ts __tests__/lib/notion-webhook/routePlan.test.ts
git commit -m "feat(notion): plan exact webhook revalidation paths"
```

Expected: every route-matrix case PASS with stable sorted output.

---

### Task 6: Reuse the Existing Knowledge Graph with a 60-Second Dirty Claim

**Files:**
- Create: `lib/knowledge-graph/serverRefresh.ts`
- Modify: `lib/knowledge-graph/store.ts`
- Modify: `lib/knowledge-graph/refresh.ts`
- Modify: `pages/api/knowledge-graph.ts`
- Test: `__tests__/lib/knowledge-graph/store.test.ts`
- Test: `__tests__/lib/knowledge-graph/refresh.test.ts`
- Test: `__tests__/pages/knowledge-graph-server-refresh.test.ts`

**Interfaces:**
- Produces: `refreshServerKnowledgeGraph({locale, claimWindowMs})`.
- Preserves: normal API GET uses `600_000`; dirty consumer uses `60_000`.

- [ ] **Step 1: Write failing configurable-claim tests**

Assert a normal refresh at `12:03` claims the ten-minute `12:00` window, while a dirty refresh claims the one-minute `12:03` window. A second dirty refresh in that minute skips; the next minute may refresh.

Run:

```bash
pnpm test -- __tests__/lib/knowledge-graph/store.test.ts __tests__/lib/knowledge-graph/refresh.test.ts --runInBand
```

Expected: FAIL because the claim window is fixed at ten minutes.

- [ ] **Step 2: Add the optional claim window without changing defaults**

Use:

```ts
acquireRefreshClaim(owner: string, windowMs?: number): Promise<RefreshClaim | null>
```

and:

```ts
interface RefreshDependencies {
  claimWindowMs?: number
}
```

Validate `windowMs` as a positive safe integer. `refreshKnowledgeGraph()` passes it to the existing store method; omission retains `600_000`.

- [ ] **Step 3: Extract the Docker dependency factory**

Move the dependency construction currently embedded in `pages/api/knowledge-graph.ts` into `serverRefresh.ts`. Both callers must still use `fetchKnowledgeGraphSiteData`, `fetchKnowledgeGraphPageBlocks`, the Worker/direct transport, the current Redis graph store, and the existing incremental `lastEditedDate` logic.

- [ ] **Step 4: Verify graph regressions and commit**

```bash
pnpm test -- __tests__/lib/knowledge-graph __tests__/pages/knowledge-graph-server-refresh.test.ts --runInBand
git add lib/knowledge-graph pages/api/knowledge-graph.ts __tests__/lib/knowledge-graph __tests__/pages/knowledge-graph-server-refresh.test.ts
git commit -m "feat(graph): allow one-minute webhook refresh claims"
```

Expected: all graph tests PASS; no second graph store or snapshot exists.

---

### Task 7: Consume Dirty Pages Through the Existing Revalidation Endpoint

**Files:**
- Create: `lib/notion-webhook/consumer.ts`
- Modify: `pages/api/revalidate.js`
- Test: `__tests__/lib/notion-webhook/consumer.test.ts`
- Test: `__tests__/pages/revalidate-dirty.test.ts`

**Interfaces:**
- Produces: `consumeDirtyPages({revalidate, now})` and `bootstrapRouteState()`.
- Preserves: current `{path}`, `{paths}`, and `{all:true}` request bodies and response shapes.

- [ ] **Step 1: Write failing consumer orchestration tests**

Assert this order:

1. acquire consumer lock;
2. read quiet queue entries and their scores;
3. return without Notion access when the queue is empty;
4. perform exactly one configured fresh-directory pass;
5. read old snapshots and build plans;
6. save an idempotent old-slug redirect and, only for private transitions, an unprocessed protective tombstone;
7. call eager `res.revalidate()` for every planned exact path;
8. invoke the existing graph refresh once when any plan requires it;
9. commit each successful page's final route snapshot with `processedEventAt` equal to the selected queue score;
10. acknowledge each successful page with compare-and-delete.

Cover partial path failure, Notion failure, graph failure, a newer event arriving during work, irrelevant pages, and two dirty pages sharing the same paths.

Run:

```bash
pnpm test -- __tests__/lib/notion-webhook/consumer.test.ts --runInBand
```

Expected: FAIL because the consumer does not exist.

- [ ] **Step 2: Implement the consumer with bounded work**

Process at most `50` quiet page IDs per invocation. Deduplicate route paths across the batch, but maintain a path-to-page dependency map so a page is acknowledged only when all paths it requires succeeded. Call graph refresh once per batch with `claimWindowMs: 60_000`. Treat a graph result of `skipped` as incomplete for graph-dependent pages unless graph state proves `refreshedAt >= selected queue score`; otherwise retain those pages for the next minute.

Do not commit an ordinary public snapshot before its required paths and graph work succeed. For unpublish/delete, write only the protective `public:false` tombstone first so ISR regeneration cannot read a stale public body; keep its old `processedEventAt` and set `pendingEventAt` so a retry still plans the old route and listing invalidations. Clear `pendingEventAt` only in the final successful snapshot.

Return operational metadata only:

```ts
type ConsumeResult = {
  status: 'empty' | 'busy' | 'processed'
  selected: number
  acknowledged: number
  retained: number
  queueDepth: number
  paths: Array<{path: string; ok: boolean; error?: string}>
  elapsedMs: number
}
```

- [ ] **Step 3: Write failing endpoint compatibility tests**

Test bearer authentication, `{dirty:true}`, `{bootstrap:true}`, method restriction, missing Redis, and the existing single/multi/all operations. Use `res.revalidate = jest.fn().mockResolvedValue(undefined)` and assert dirty mode is eager.

Run:

```bash
pnpm test -- __tests__/pages/revalidate-dirty.test.ts --runInBand
```

Expected: FAIL because dirty/bootstrap bodies are not recognized.

- [ ] **Step 4: Extend `/api/revalidate` without changing its URL**

Select operations explicitly:

```js
const { path, paths, all, dirty, bootstrap } = req.body || {}
```

Reject mutually conflicting operation fields with `400`. Compare the bearer token with a constant-time helper. `bootstrap` performs a source-confirmed read, writes all current public snapshots, and does not revalidate pages; it is idempotent. `dirty` calls the consumer. Existing operations keep their current behavior.

- [ ] **Step 5: Verify and commit the consumer**

```bash
pnpm test -- __tests__/lib/notion-webhook/consumer.test.ts __tests__/pages/revalidate-dirty.test.ts --runInBand
git add lib/notion-webhook/consumer.ts pages/api/revalidate.js __tests__/lib/notion-webhook/consumer.test.ts __tests__/pages/revalidate-dirty.test.ts
git commit -m "feat(notion): consume dirty pages through revalidation"
```

Expected: dirty failure retains work, newer events survive acknowledgement, and old API cases PASS.

---

### Task 8: Enforce Private Tombstones and Stored Slug Redirects at Page Resolution

**Files:**
- Modify: `lib/db/SiteDataApi.js`
- Modify: `pages/[prefix]/index.js`
- Modify: `pages/[prefix]/[slug]/index.js`
- Modify: `pages/[prefix]/[slug]/[...suffix].js`
- Test: `__tests__/pages/stored-slug-redirect.test.js`
- Test: `__tests__/lib/db/private-route-tombstone.test.js`

**Interfaces:**
- Consumes: Task 4 `isExplicitlyPrivate` and `getStoredRedirect`.
- Produces: 404 for explicitly private page IDs and permanent redirect for inactive old paths.

- [ ] **Step 1: Write failing private-route tests**

Mock `fetchGlobalAllData()` to return a seven-day fallback containing a published article while route state contains `public:false`. Assert `resolvePostProps()` returns `post:null` and never calls `fetchNotionPageBlocks()` for that article.

Run:

```bash
pnpm test -- __tests__/lib/db/private-route-tombstone.test.js --runInBand
```

Expected: FAIL because stale metadata still resolves the article.

- [ ] **Step 2: Add the tombstone guard before body fetch**

After normal slug/UUID matching but before `ensureBlockMap`, query explicit route state by stable page ID. A missing snapshot remains fail-open for backward compatibility; an explicit private tombstone is fail-closed.

- [ ] **Step 3: Write failing redirect tests for every dynamic route depth**

Cover one segment, two segments, three-plus segments, locale destination, flattened chains, and active slug precedence. The active-page case must never query the redirect map.

Run:

```bash
pnpm test -- __tests__/pages/stored-slug-redirect.test.js --runInBand
```

Expected: FAIL because only legacy Notion-ID redirects exist.

- [ ] **Step 4: Add redirect lookup after normal resolution fails**

Each `getStaticProps` must return exactly one of `{props,revalidate}`, `{redirect}`, or `{notFound:true}`. When `props.post` exists, return it immediately. Only when it is absent, build the normalized requested path from route params and locale, then call `getStoredRedirect` and return `{redirect:{destination, permanent:true}}` when present.

- [ ] **Step 5: Run route regressions and commit**

```bash
pnpm test -- __tests__/lib/db/private-route-tombstone.test.js __tests__/pages/stored-slug-redirect.test.js __tests__/pages/legacy-notion-redirect.test.js __tests__/pages/locale-routing.test.js __tests__/pages/public-isr-policy.test.js --runInBand
git add lib/db/SiteDataApi.js pages/'[prefix]' __tests__/lib/db/private-route-tombstone.test.js __tests__/pages/stored-slug-redirect.test.js
git commit -m "feat(notion): guard unpublished routes and redirect old slugs"
```

Expected: explicit private content cannot be loaded from stale metadata, and all redirect depths PASS.

---

### Task 9: Add Safe VPS Setup and One-Minute systemd Scheduling

**Files:**
- Create: `deploy/systemd/notionnext-notion-refresh.service`
- Create: `deploy/systemd/notionnext-notion-refresh.timer`
- Create: `deploy/scripts/run-notion-refresh.sh`
- Create: `deploy/scripts/configure-notion-webhook-vps.sh`
- Create: `deploy/docs/NOTION-WEBHOOK.md`
- Modify: `.env.example`
- Modify: `package.json`
- Test: `__tests__/deploy/notion-webhook-scripts.test.js`

**Interfaces:**
- Produces: repeatable install, setup, finish, status, and disable operations for `tencent-vps`.
- Uses: `/opt/notionnext/.env.production`, `127.0.0.1:3030`, and the existing `REVALIDATION_TOKEN`.

- [ ] **Step 1: Write failing deployment contract tests**

Assert:

- every script has `set -euo pipefail` and never uses `set -x`;
- secrets are transferred through stdin or root-only files, never command-line flags;
- the runner sends `POST {"dirty":true}` to `http://127.0.0.1:3030/api/revalidate`;
- curl receives the Authorization header through `--config -`, not argv;
- service is `Type=oneshot` with a timeout;
- timer runs every minute with `Persistent=true`;
- configurator uses `docker compose up -d --no-deps --force-recreate app`;
- setup/verification token files are mode `0600` and deleted after finish;
- disable stops the timer but does not delete Redis content caches.

Run:

```bash
pnpm test -- __tests__/deploy/notion-webhook-scripts.test.js --runInBand
```

Expected: FAIL because deployment files do not exist.

- [ ] **Step 2: Implement the host runner and units**

The runner reads `/opt/notionnext/.env.production`, validates `REVALIDATION_TOKEN`, and pipes a curl config like this:

```bash
printf 'header = "Authorization: Bearer %s"\n' "$REVALIDATION_TOKEN"
printf 'header = "Content-Type: application/json"\n'
printf 'url = "http://127.0.0.1:3030/api/revalidate"\n'
printf 'data = "{\\"dirty\\":true}"\n'
```

Pipe it to `curl --silent --show-error --fail-with-body --max-time 240 --config -`. The secret must not appear in the process argument list.

- [ ] **Step 3: Implement the configurator modes**

Support exactly:

```text
configure-notion-webhook-vps.sh <ssh-alias> install
configure-notion-webhook-vps.sh <ssh-alias> begin-setup
configure-notion-webhook-vps.sh <ssh-alias> show-token
configure-notion-webhook-vps.sh <ssh-alias> finish
configure-notion-webhook-vps.sh <ssh-alias> status
configure-notion-webhook-vps.sh <ssh-alias> disable
```

`show-token` is the only mode allowed to print the one-time token and must print a warning first. `finish` copies it directly from the container into a root-only temporary file, atomically updates `.env.production`, removes `NOTION_WEBHOOK_SETUP_MODE`, deletes the container token file, recreates only `app`, calls `{bootstrap:true}`, and enables the timer. It must stop if bootstrap is not `ok:true`.

- [ ] **Step 4: Document variables and operations**

Add only private server variables:

```dotenv
# NOTION_WEBHOOK_VERIFICATION_TOKEN=
# NOTION_WEBHOOK_SETUP_MODE=false
```

Do not use `NEXT_PUBLIC_`. Document that the subscription is created in the Notion Connection UI, uses `https://www.one2agi.com/api/notion-webhook`, and subscribes only to the six page event types.

Add:

```json
"test:notion-webhook": "jest __tests__/lib/notion-webhook __tests__/pages/notion-webhook.test.ts __tests__/pages/revalidate-dirty.test.ts __tests__/pages/stored-slug-redirect.test.js __tests__/deploy/notion-webhook-scripts.test.js --runInBand"
```

- [ ] **Step 5: Verify and commit deployment assets**

```bash
pnpm test -- __tests__/deploy/notion-webhook-scripts.test.js --runInBand
bash -n deploy/scripts/run-notion-refresh.sh deploy/scripts/configure-notion-webhook-vps.sh
git add deploy/systemd deploy/scripts/run-notion-refresh.sh deploy/scripts/configure-notion-webhook-vps.sh deploy/docs/NOTION-WEBHOOK.md .env.example package.json __tests__/deploy/notion-webhook-scripts.test.js
git commit -m "feat(deploy): schedule Notion webhook refreshes"
```

Expected: tests PASS and shell syntax exits `0`.

---

### Task 10: Full Verification, Deployment, and Real Acceptance

**Files:**
- Modify only if evidence requires it: files introduced in Tasks 1-9.
- Record operations: `deploy/docs/DEPLOY-LOG.md` only after successful production acceptance.

**Interfaces:**
- Produces: verified local build, deployed subscription/timer, and measured one-to-two-minute visibility.

- [ ] **Step 1: Run focused and full local verification**

```bash
pnpm test:notion-webhook
pnpm test -- __tests__/lib/cache __tests__/lib/knowledge-graph __tests__/lib/plugins/notionComments.test.js __tests__/pages --runInBand
pnpm lint
pnpm type-check
pnpm build
```

Expected: every command exits `0`. Capture exact failures; do not describe the feature as complete if any required command fails.

- [ ] **Step 2: Verify production-mode ISR locally**

Start the built app with `NEXT_PRIVATE_DEBUG_CACHE=1`, enqueue a signed real-fixture event against localhost, trigger `{dirty:true}`, and verify logs show `REVALIDATED` for the exact article/list paths. Confirm an empty queue does not call Notion.

- [ ] **Step 3: Deploy through the existing image workflow**

```bash
./deploy/scripts/deploy.sh tencent-vps
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps install
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps begin-setup
```

Create the production subscription in Notion, run `show-token`, paste the token into Notion's verification form, then:

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps finish
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps status
```

Expected: bootstrap succeeds, timer is active, and queue depth is zero before the test edit.

- [ ] **Step 4: Execute real product acceptance**

On the dedicated published test article verify body, title/summary, slug, category/tag, Draft/unpublish, restore, inline `@page` graph relation, comment create/reply/moderation, Worker-disabled direct fallback, and timer pause with five-minute ISR fallback.

For each content operation record:

```text
Notion edit timestamp
Webhook receive timestamp
Timer start timestamp
Revalidation finish timestamp
First uncached public GET timestamp and HTTP result
```

Success criterion: normal changes become visible within `120` seconds of webhook receipt; the old slug returns a permanent redirect; private content returns `404`; comments update without article revalidation.

- [ ] **Step 5: Verify operational evidence**

```bash
ssh tencent-vps 'systemctl status notionnext-notion-refresh.timer --no-pager'
ssh tencent-vps 'journalctl -u notionnext-notion-refresh.service -n 100 --no-pager'
ssh tencent-vps 'cd /opt/notionnext && sudo docker compose exec -T redis redis-cli ZCARD notion:refresh:dirty'
curl -sS -I https://www.one2agi.com/
curl -sS https://www.one2agi.com/api/health
```

Expected: active timer, no secret-bearing logs, queue returns to `0`, homepage is `200`, and health reports `ok:true`.

- [ ] **Step 6: Commit acceptance documentation**

Append only measured results and rollback commands to `deploy/docs/DEPLOY-LOG.md`, then:

```bash
git add deploy/docs/DEPLOY-LOG.md
git commit -m "docs(deploy): record Notion webhook acceptance"
```

---

## Rollback Gate

Rollback is operational and does not delete content caches:

```bash
./deploy/scripts/configure-notion-webhook-vps.sh tencent-vps disable
```

Then pause/delete the Notion subscription. Existing five-minute ISR, Worker/direct Notion transport, Redis fallback, knowledge graph GET behavior, and dynamic comments remain active. If application code must also roll back, deploy the prior image tag; do not delete `redis-data` or `notion-cache` volumes.

## Completion Checklist

- Real, redacted fixtures exist and are the source of parser tests.
- Webhook signature is checked against exact raw bytes.
- Redis queue failures return `503`; successful queue writes return `200`.
- Quiet-window deduplication and compare-and-delete prevent lost newer events.
- Empty queue performs zero Notion requests.
- Dirty reads are source-confirmed and cannot silently use stale fallback.
- Bootstrap exists before subscription activation.
- Explicit private tombstones block stale article resurrection.
- Old slug redirects work for every supported route depth and locale.
- Graph dirty refresh can run once per minute without changing normal ten-minute refresh behavior.
- Existing comments remain dynamic and do not enqueue ISR work.
- Existing `{path}`, `{paths}`, and `{all:true}` revalidation calls remain compatible.
- systemd and deployment scripts expose no secrets in argv or logs.
- Focused tests, regressions, lint, type-check, build, local ISR, and real production acceptance all pass.
