# Cloudflare Worker Primary Notion API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route Notion `/api/v3` content requests through an authenticated Cloudflare Worker, fall back to direct Notion when that channel fails, and leave the existing ISR and Redis cache behavior unchanged.

**Architecture:** A small no-cache Worker validates a shared secret and transparently forwards Notion POST requests. The application owns Worker-backed and direct `notion-client` instances behind one circuit-breaking transport selector; existing callers, retries, ISR, and cache fallback continue to use the same `notionAPI` interface.

**Tech Stack:** Node.js 22, Next.js 14 Pages Router, `notion-client` 7.10.0, Jest, pnpm 9.15.0, Cloudflare Workers/Wrangler 4, Docker Compose, Redis 7.

## Global Constraints

- Work in the existing `codex/cloudflare-notion-worker` branch and current checkout; do not create a worktree.
- Preserve and never stage the user's unrelated `AGENTS.md`, `deploy/scripts/deploy.sh`, and `deploy/scripts/weekly-check.sh` changes.
- Use pnpm only; do not use npm or yarn.
- Keep `NEXT_PUBLIC_REVALIDATE_SECOND=300`, Redis TTLs, stale fallback order, and empty-value rejection unchanged.
- Proxy only `https://www.notion.so/api/v3`; leave `api.notion.com/v1`, signed files, images, video, comments, payments, OAuth, and the knowledge graph transport unchanged.
- Never cache Worker POST responses and never log Notion cookies, tokens, request bodies, response bodies, or the proxy secret.
- Keep the Cloudflare account token and proxy shared secret outside Git, Docker image layers, command output, and application logs.
- Follow RED -> GREEN for every production-code behavior.
- Use the existing `./deploy/scripts/deploy.sh tencent-vps` script for the application deployment and the new Worker deployment script for Cloudflare.

---

## File Map

### New files

- `cloudflare/notion-api-proxy/src/worker.js` — authenticated, path-restricted, no-cache Notion transport proxy.
- `cloudflare/notion-api-proxy/wrangler.jsonc` — reproducible Worker deployment configuration without credentials.
- `__tests__/cloudflare/notion-api-proxy.test.js` — Worker request/response contract tests.
- `lib/db/notion/notionTransport.js` — channel classification, circuit breaker, and Worker/direct selection.
- `__tests__/lib/db/notion/notionTransport.test.js` — transport state-machine tests.
- `__tests__/lib/db/notion/getNotionAPI.test.js` — client construction and public-interface integration tests.
- `deploy/scripts/deploy-notion-worker.sh` — credential-safe Wrangler deployment and health check.
- `deploy/scripts/configure-notion-proxy-vps.sh` — idempotent VPS runtime-environment update and app restart.
- `__tests__/deploy/notion-worker-scripts.test.js` — deployment-script secret-handling and rollback contracts.

### Modified files

- `lib/db/notion/getNotionAPI.js` — create Worker/direct clients with `ofetchOptions` and delegate channel choice.
- `.env.example` — document optional Worker URL, shared secret, timeout, and circuit interval.
- `package.json` — add Worker test/deploy commands using a pinned Wrangler version.
- `deploy/docs/DEPLOY-LOG.md` — document the transport, verification, and rollback commands.

---

### Task 1: Implement the restricted Worker contract

**Files:**
- Create: `cloudflare/notion-api-proxy/src/worker.js`
- Create: `cloudflare/notion-api-proxy/wrangler.jsonc`
- Create: `__tests__/cloudflare/notion-api-proxy.test.js`

**Interfaces:**
- Consumes: `Request`, `fetch`, and `env.NOTION_PROXY_TOKEN` from the Workers runtime.
- Produces: `handleRequest(request, env, executionCtx, fetchImpl): Promise<Response>` and the default Worker export.

- [ ] **Step 1: Write failing Worker contract tests**

Cover `GET /health`, missing secret, invalid path/method, valid POST forwarding, secret-header removal, upstream response markers, `Cache-Control: no-store`, and upstream exception to marked HTTP 502. Use a fake `fetchImpl` that captures the outgoing `Request`; do not mock an imagined Notion response shape beyond a real HTTP status/body transport fixture.

- [ ] **Step 2: Run the Worker test and verify RED**

Run: `pnpm test -- __tests__/cloudflare/notion-api-proxy.test.js --runInBand`

Expected: FAIL because `cloudflare/notion-api-proxy/src/worker.js` does not exist.

- [ ] **Step 3: Implement the minimal Worker**

Implement these exact contracts:

```js
export const PROXY_TOKEN_HEADER = 'x-notion-proxy-token'
export const UPSTREAM_HEADER = 'x-notion-proxy-upstream'
export const CHANNEL_ERROR_HEADER = 'x-notion-proxy-channel-error'

export async function handleRequest(
  request,
  env,
  executionCtx,
  fetchImpl = fetch
) { /* validate, stream, mark, no-store */ }

export default {
  fetch(request, env, executionCtx) {
    return handleRequest(request, env, executionCtx)
  }
}
```

The target must be constructed as `https://www.notion.so${url.pathname}${url.search}`. Delete `host`, `cf-connecting-ip`, `cf-ray`, `cf-visitor`, and `x-notion-proxy-token` before the subrequest. Return a generic JSON 502 on exceptions and never serialize the caught exception.

- [ ] **Step 4: Add Worker configuration**

Create `wrangler.jsonc` with name `notionnext-notion-api-proxy`, entrypoint `src/worker.js`, compatibility date `2026-07-15`, `workers_dev: true`, and Worker observability enabled. Do not add `account_id`, routes, tokens, or secrets.

- [ ] **Step 5: Run the Worker test and verify GREEN**

Run: `pnpm test -- __tests__/cloudflare/notion-api-proxy.test.js --runInBand`

Expected: PASS with all Worker contract cases green.

- [ ] **Step 6: Commit the Worker contract**

```bash
git add cloudflare/notion-api-proxy __tests__/cloudflare/notion-api-proxy.test.js
git commit -m "feat(notion): add restricted Cloudflare API proxy"
```

---

### Task 2: Implement Worker/direct transport selection

**Files:**
- Create: `lib/db/notion/notionTransport.js`
- Create: `__tests__/lib/db/notion/notionTransport.test.js`

**Interfaces:**
- Consumes: two objects exposing the same async Notion methods, plus a clock and logger.
- Produces: `createNotionTransport(options)` returning `{ call(methodName, ...args), getState() }`.

- [ ] **Step 1: Write failing transport state-machine tests**

Tests must demonstrate:

```text
proxy disabled -> direct only
Worker success -> no direct call
network/channel failure -> direct fallback + circuit open
open circuit -> direct only
expired circuit -> Worker probe
successful probe -> circuit closed
forwarded Notion 400/401/403/404/429 -> throw without direct fallback
proxy credential/route rejection -> direct fallback
```

Construct errors with and without `response.headers.get()` so classification is tested against the real ofetch-style surface instead of message text.

- [ ] **Step 2: Run the transport test and verify RED**

Run: `pnpm test -- __tests__/lib/db/notion/notionTransport.test.js --runInBand`

Expected: FAIL because `lib/db/notion/notionTransport.js` does not exist.

- [ ] **Step 3: Implement the minimal state machine**

Use these exports:

```js
export const DEFAULT_PROXY_CIRCUIT_MS = 60_000

export function isProxyChannelError(error) { /* header/status/response classification */ }

export function createNotionTransport({
  proxyClient,
  directClient,
  proxyEnabled,
  circuitMs = DEFAULT_PROXY_CIRCUIT_MS,
  now = Date.now,
  logger = console
}) { /* call + getState */ }
```

Only channel failures trigger immediate direct fallback. Store `openUntil` in module-local transport state. Log method, selected channel, elapsed milliseconds, and status class only.

- [ ] **Step 4: Run the transport test and verify GREEN**

Run: `pnpm test -- __tests__/lib/db/notion/notionTransport.test.js --runInBand`

Expected: PASS with every transition green.

- [ ] **Step 5: Commit the transport selector**

```bash
git add lib/db/notion/notionTransport.js __tests__/lib/db/notion/notionTransport.test.js
git commit -m "feat(notion): add Worker direct fallback transport"
```

---

### Task 3: Integrate transport without changing callers or cache behavior

**Files:**
- Modify: `lib/db/notion/getNotionAPI.js`
- Create: `__tests__/lib/db/notion/getNotionAPI.test.js`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `createNotionTransport`, `NotionAPI`, and optional runtime variables.
- Preserves: `notionAPI.getPage`, `getBlocks`, `getSignedFileUrls`, `getUsers`, and `__call`.

- [ ] **Step 1: Write failing integration tests**

Mock the `NotionAPI` constructor and assert:

- Missing proxy configuration constructs/uses only direct mode.
- Complete proxy configuration creates a Worker client with
  `ofetchOptions.headers['x-notion-proxy-token']` and timeout.
- The direct client base URL is always `https://www.notion.so/api/v3` and never
  receives the proxy header.
- Existing exported methods still delegate through one in-flight-deduplicated
  call boundary.
- Legacy `syncRecordValues` compatibility is represented through supported
  `ofetchOptions`, not ignored `kyOptions`.

- [ ] **Step 2: Run the integration test and verify RED**

Run: `pnpm test -- __tests__/lib/db/notion/getNotionAPI.test.js --runInBand`

Expected: FAIL because the current module constructs one client with `kyOptions`.

- [ ] **Step 3: Integrate the two clients**

Parse bounded numeric environment settings:

```text
NOTION_API_PROXY_TIMEOUT_MS default 6000, allowed 1000..30000
NOTION_API_PROXY_CIRCUIT_MS default 60000, allowed 1000..600000
```

Enable proxy mode only when URL and token are both non-empty. Use
`ofetchOptions.timeout` and `ofetchOptions.headers`. Preserve auth token,
active-user, timezone, method names, in-flight deduplication, and build-time
rate limiting.

- [ ] **Step 4: Document environment variables**

Add commented examples to `.env.example` without real account identifiers,
Worker hostnames, or secrets. Document that removing URL/token restores direct
mode.

- [ ] **Step 5: Run focused regression tests and verify GREEN**

Run:

```bash
pnpm test -- __tests__/lib/db/notion/getNotionAPI.test.js __tests__/lib/db/notion/notionTransport.test.js __tests__/lib/db/notion/getPostBlocks.test.js __tests__/lib/cache/cache_manager.test.js __tests__/lib/cache/redis_fallback.test.js --runInBand
```

Expected: PASS with no cache contract changes.

- [ ] **Step 6: Commit the application integration**

```bash
git add lib/db/notion/getNotionAPI.js __tests__/lib/db/notion/getNotionAPI.test.js .env.example
git commit -m "feat(notion): prefer Worker with direct fallback"
```

---

### Task 4: Add credential-safe deployment scripts and operations documentation

**Files:**
- Create: `deploy/scripts/deploy-notion-worker.sh`
- Create: `deploy/scripts/configure-notion-proxy-vps.sh`
- Modify: `package.json`
- Modify: `deploy/docs/DEPLOY-LOG.md`

**Interfaces:**
- `deploy-notion-worker.sh` consumes `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, and `NOTION_API_PROXY_TOKEN`; optionally consumes
  `NOTION_API_PROXY_URL`; deploys and verifies the Worker.
- `configure-notion-proxy-vps.sh <ssh-alias>` consumes
  `NOTION_API_PROXY_URL` and `NOTION_API_PROXY_TOKEN`; idempotently updates
  `/opt/notionnext/.env.production`, restarts `app`, and verifies `/api/health`.

- [ ] **Step 1: Write failing script contract tests**

Create structural Jest assertions in `__tests__/deploy/notion-worker-scripts.test.js`
that require `set -euo pipefail`, reject missing variables, prevent `set -x`,
pin Wrangler, use `wrangler secret put`, avoid command-line secret arguments,
update VPS environment through standard input, and provide a direct-mode
rollback command.

- [ ] **Step 2: Run script tests and verify RED**

Run: `pnpm test -- __tests__/deploy/notion-worker-scripts.test.js --runInBand`

Expected: FAIL because both scripts are missing.

- [ ] **Step 3: Implement deployment scripts**

The Worker script must run Wrangler with environment variables only, pipe the
proxy secret on standard input, deploy from `cloudflare/notion-api-proxy`, and
call `/health`. The VPS script must transfer a temporary mode-600 environment
fragment through SSH standard input, replace only the four
`NOTION_API_PROXY_*` keys, restart only `app`, and never print secret values.

- [ ] **Step 4: Add package scripts and deployment documentation**

Add `deploy:notion-worker` and `test:notion-worker`. Document deployment,
health verification, channel-log checks, direct-mode rollback, and token
rotation in `DEPLOY-LOG.md`.

- [ ] **Step 5: Run script tests and shell syntax checks**

Run:

```bash
pnpm test -- __tests__/deploy/notion-worker-scripts.test.js --runInBand
bash -n deploy/scripts/deploy-notion-worker.sh
bash -n deploy/scripts/configure-notion-proxy-vps.sh
```

Expected: Jest PASS and both `bash -n` commands exit 0.

- [ ] **Step 6: Commit deployment support**

```bash
git add deploy/scripts/deploy-notion-worker.sh deploy/scripts/configure-notion-proxy-vps.sh __tests__/deploy/notion-worker-scripts.test.js package.json deploy/docs/DEPLOY-LOG.md
git commit -m "chore(deploy): automate Notion Worker rollout"
```

---

### Task 5: Verify locally, deploy, and test production failure modes

**Files:**
- No new tracked files required.
- Local reports may be written under ignored `.artifacts/`.

**Interfaces:**
- Consumes the two deployment scripts, existing Docker deployment script, VPS SSH alias `tencent-vps`, and production health/public endpoints.
- Produces verified Worker URL, deployed Docker image, configured VPS runtime, and latency/error evidence.

- [ ] **Step 1: Run full local verification**

Run:

```bash
pnpm lint
pnpm type-check
pnpm test -- --runInBand
pnpm build
```

Expected: all commands exit 0. Record pre-existing unrelated warnings separately.

- [ ] **Step 2: Deploy and verify the Worker using the script**

Provide credentials only as process environment variables and run:

```bash
./deploy/scripts/deploy-notion-worker.sh
```

Expected: Wrangler deployment succeeds, `/health` returns HTTP 200, an
unauthenticated `/api/v3/loadPageChunk` returns 401, and no secret is printed.

- [ ] **Step 3: Run a real Notion contract test through Worker**

Use the current public `NOTION_PAGE_ID` with a real `loadPageChunk` request and
then the real `notion-client.getPage` flow. Compare HTTP status and required
record-map keys with direct Notion; do not save response bodies.

- [ ] **Step 4: Deploy application code with the existing script**

Run:

```bash
./deploy/scripts/deploy.sh tencent-vps
```

Expected: image transfer/load succeeds, Compose restarts, `/api/health` returns
200, and smoke tests pass before proxy variables are enabled.

- [ ] **Step 5: Configure Worker runtime variables using the script**

Run with secret values in process environment only:

```bash
./deploy/scripts/configure-notion-proxy-vps.sh tencent-vps
```

Expected: the app restarts, `/api/health` returns 200, and logs show the Worker
channel without exposing credentials.

- [ ] **Step 6: Run 200 real VPS requests and record percentiles**

Exercise real `loadPageChunk`/`queryCollection` traffic through the configured
application or a credential-safe probe. Record success/failure counts and
P50/P95/P99 latency under `.artifacts/`; do not store content or secrets.

- [ ] **Step 7: Verify direct fallback**

Temporarily set an invalid proxy URL with the configuration script, request a
cache-miss test key or invoke the transport probe, and confirm logs record
`direct-fallback`. Restore the valid Worker URL immediately and confirm Worker
traffic resumes after the circuit interval.

- [ ] **Step 8: Verify cache fallback without destructive cache changes**

Use a controlled test process with both transports pointed to unreachable
targets while reading a pre-seeded test cache key. Confirm Redis fallback is
returned and the successful production Redis keys are neither deleted nor
overwritten.

- [ ] **Step 9: Run final production smoke checks**

Verify from VPS and the public Internet:

```text
/api/health
/
/archive
one representative article
/api/knowledge-graph
Worker /health
```

Inspect recent app logs for Worker/direct channel selection, Notion failures,
empty-data cache skips, and secret leakage. Report exact HTTP results and any
remaining limitations.
