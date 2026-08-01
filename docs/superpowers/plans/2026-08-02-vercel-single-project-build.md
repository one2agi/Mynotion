# Vercel Single-Project Build Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `main` once on Vercel without Notion 429 retry storms and serve the successful deployment at `www.jichang.world`, with the apex permanently redirected to `www`.

**Architecture:** Retain the Vercel project that already owns `www.jichang.world` and the complete production environment. Disconnect the duplicate Git project before pushing, persist build-rate state across limiter instances, count failed attempts, apply a conservative Vercel request rate, then move and redirect the apex domain only after the retained project is READY.

**Tech Stack:** Next.js 14, TypeScript, Jest, Vercel CLI/API, GitHub

## Global Constraints

- Keep full build-time prerendering.
- Do not expose or copy sensitive environment variable values.
- Keep Notion fetch failures fatal to the build.
- Do not force-push Git.
- Do not delete the obsolete Vercel project until `www` and apex routing are verified.

---

### Task 1: Stop duplicate Git deployments

**Files:**
- No repository files modified.

**Interfaces:**
- Consumes: Vercel project `jichangtuijie` and authenticated local Vercel CLI.
- Produces: one active Git-linked Vercel project for `one2agi/Mynotion` `main`.

- [ ] **Step 1: Re-read both project links and domains**

Run the safe-field project and domain API queries and confirm that the retained project owns `www.jichang.world`, while `jichangtuijie` owns only `jichang.world`.

- [ ] **Step 2: Link a temporary local directory to the duplicate project**

Run `vercel_link_tmp=$(mktemp -d)` followed by `vercel link --yes --project jichangtuijie --cwd "$vercel_link_tmp"`.

- [ ] **Step 3: Disconnect the duplicate Git integration**

Run `vercel git disconnect --cwd "$vercel_link_tmp"` and verify through `/v9/projects/prj_V8FZSPSnoEZDk1lA94IVGD4o5Hsg` that the duplicate project's `link` is absent while the retained project's Git link is unchanged.

### Task 2: Persist and enforce build request spacing

**Files:**
- Create: `__tests__/lib/db/notion/RateLimiter.test.ts`
- Modify: `lib/db/notion/RateLimiter.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `new RateLimiter(maxRequestsPerMinute, lockFilePath, minIntervalMs)`.
- Produces: the existing `enqueue(key, requestFunc)` API with shared file-backed rate state.

- [ ] **Step 1: Write the failing test**

Create a test that uses two limiter instances with the same temporary lock path. The first request rejects; the second succeeds. Assert that the second request starts only after the configured minimum interval. This fails on the current code because failures and separate instances do not share `lastRequestTime`.

- [ ] **Step 2: Run the test to verify RED**

Run `pnpm test -- __tests__/lib/db/notion/RateLimiter.test.ts --runInBand --modulePathIgnorePatterns='/node_modules.stale-pnpm/'` and confirm the observed interval is below the expected threshold.

- [ ] **Step 3: Implement file-backed rate state**

Derive a state path from the lock path, read a validated `{ windowStart, requestCount, lastRequestTime }` object while holding the existing lock, wait as required, and write the reserved attempt before calling `requestFunc`. Use in-memory state only when no lock path is configured.

- [ ] **Step 4: Ignore the generated state file**

Add `/.notion-api-lock.state` beside the existing `/.notion-api-lock` rule.

- [ ] **Step 5: Run the test to verify GREEN**

Run the same targeted test and confirm it passes.

### Task 3: Set a conservative Vercel build rate

**Files:**
- Modify: `__tests__/deploy/vercel-build-contract.test.js`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `vercel.json.buildCommand`.
- Produces: `BUILD_MODE=true`, `NOTION_BUILD_RATE_MAX_PER_MINUTE=20`, and `NOTION_BUILD_RATE_MIN_INTERVAL_MS=3000` in the actual `next build` process.

- [ ] **Step 1: Extend the build-contract probe and verify RED**

Record the two rate environment variables in the fake `next` probe and assert the literal values `20` and `3000`. Run the targeted test and confirm it fails against the current command.

- [ ] **Step 2: Update the Vercel build command**

Set `buildCommand` to `BUILD_MODE=true NOTION_BUILD_RATE_MAX_PER_MINUTE=20 NOTION_BUILD_RATE_MIN_INTERVAL_MS=3000 next build`.

- [ ] **Step 3: Verify GREEN and regression coverage**

Run the Vercel contract, limiter, and Notion transport tests together. Run Prettier, Node syntax checking, TypeScript checking for the changed TypeScript file, and `git diff --check`.

### Task 4: Publish once and verify the real build

**Files:**
- Commit only the limiter, tests, ignore rule, Vercel configuration, design, and plan.

**Interfaces:**
- Consumes: one active Git-linked Vercel project.
- Produces: a READY production deployment for the retained project.

- [ ] **Step 1: Commit and push `main`**

Use a Conventional Commit message and push normally to `origin/main` after confirming remote `main` has not advanced.

- [ ] **Step 2: Monitor the retained deployment**

Use the pushed SHA with GitHub commit statuses, take the returned Vercel deployment ID, and run `vercel inspect` with that ID and `--logs`. Success requires compilation, all static pages, and READY status with no Notion 429.

- [ ] **Step 3: If 429 remains, lower only the configured rate**

Keep the single-project topology and reduce the Vercel rate values. Do not restore the duplicate Git integration and do not mask Notion errors.

### Task 5: Consolidate domains and retire the duplicate project

**Files:**
- No repository files modified.

**Interfaces:**
- Consumes: the READY automatic deployment URL and both current project-domain records.
- Produces: `www.jichang.world` serving production and `jichang.world` returning a permanent redirect to the same path on `www`.

- [ ] **Step 1: Move the apex domain to the retained project**

Run `vercel domains add jichang.world moravekcarriger368-6701s-projects --force` only after the retained build is READY.

- [ ] **Step 2: Configure the permanent redirect**

PATCH `/v9/projects/prj_rNse3RuglGWATjVsOaooVdUtic8u/domains/jichang.world` with `redirect=www.jichang.world` and `redirectStatusCode=308`.

- [ ] **Step 3: Verify public behavior**

Check `www` homepage and `robots.txt`, inspect canonical output, and verify that apex paths and queries redirect to the matching `www` URL.

- [ ] **Step 4: Delete the obsolete project**

Re-read its domains and Git link. Run `vercel project remove jichangtuijie` only when it owns no custom domain and has no active Git link, then verify that only the retained project remains active.
