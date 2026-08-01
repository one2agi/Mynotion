# Vercel Build Under Six Minutes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the measured production Vercel build to at most six minutes without restoring Notion request bursts.

**Architecture:** Keep the existing shared cross-worker `RateLimiter` unchanged. Tune only the Vercel build contract from 20 requests per minute at 3000 ms spacing to 50 requests per minute at 1200 ms spacing, then validate against the real deployment timeline.

**Tech Stack:** Next.js, Vercel, Jest, pnpm 9.15.0

## Global Constraints

- Keep full prerendering.
- Keep Notion requests globally serialized during builds.
- Keep failed requests consuming rate-limit slots.
- Production success requires `READY`, zero 429 entries, and at most six minutes elapsed build time.

---

### Task 1: Tune and verify the Vercel build contract

**Files:**
- Modify: `__tests__/deploy/vercel-build-contract.test.js`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `vercel.json.buildCommand`
- Produces: build environment values `NOTION_BUILD_RATE_MAX_PER_MINUTE=50` and `NOTION_BUILD_RATE_MIN_INTERVAL_MS=1200`

- [ ] **Step 1: Write the failing contract expectation**

Change the expected values in the existing test to:

```js
notionRateMaxPerMinute: '50',
notionRateMinIntervalMs: '1200'
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm test -- __tests__/deploy/vercel-build-contract.test.js --runInBand`

Expected: FAIL because `vercel.json` still supplies `20` and `3000`.

- [ ] **Step 3: Apply the minimal production change**

Set `vercel.json.buildCommand` to:

```json
"BUILD_MODE=true NOTION_BUILD_RATE_MAX_PER_MINUTE=50 NOTION_BUILD_RATE_MIN_INTERVAL_MS=1200 next build"
```

- [ ] **Step 4: Verify GREEN and related behavior**

Run:

```bash
pnpm test -- __tests__/deploy/vercel-build-contract.test.js __tests__/lib/db/notion/RateLimiter.test.ts __tests__/lib/db/notion/getNotionAPI.test.js --runInBand
pnpm exec prettier --check vercel.json __tests__/deploy/vercel-build-contract.test.js
git diff --check
```

Expected: all selected tests and checks pass.

- [ ] **Step 5: Commit, push, and validate production**

```bash
git add docs/superpowers/specs/2026-08-02-vercel-build-under-six-minutes-design.md docs/superpowers/plans/2026-08-02-vercel-build-under-six-minutes.md __tests__/deploy/vercel-build-contract.test.js vercel.json
git commit -m "perf(vercel): keep production builds under six minutes"
git push origin main
```

Monitor the resulting deployment events. Accept only `READY`, zero occurrences
of `429 Too Many Requests`, and a first-build-event to last-build-event elapsed
time of no more than 360 seconds.
