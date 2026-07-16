# Landing / Content Domain Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make `www.one2agi.com` a starter-only brand homepage and `way.one2agi.com` the single owner of every content route while preserving shared Notion, Redis, and webhook processing.

**Architecture:** Build the same Pages Router application twice with explicit `landing` and `content` roles. Route users and crawlers at the link/nginx/SEO boundaries, then consume the shared webhook queue once in the content container and fan out only homepage revalidation to the landing container.

**Tech Stack:** Next.js 14 Pages Router, React 18, Jest, Docker Compose, nginx, Redis, Bash.

## Global Constraints

- Node.js 22 and pnpm 9.15.0.
- Preserve shared Notion data, Redis data, webhook queue, route state, and knowledge graph source.
- Never share `.next`, build IDs, static bundles, or rendered ISR output across the two containers.
- `www` serves only `/`; `way` owns all content routes.
- Preserve path and query string in permanent redirects.
- Follow test-first RED → GREEN for every behavior change.

---

### Task 1: Site-role link routing

**Files:**
- Create: `lib/site-role.js`
- Modify: `components/SmartLink.js`
- Test: `__tests__/lib/site-role.test.js`
- Test: `__tests__/components/SmartLink.test.js`

**Interfaces:**
- Produces: `getSiteRole()`, `isLandingSite()`, and `resolveSiteHref(href, options)`.
- Consumes: `NEXT_PUBLIC_SITE_ROLE`, `NEXT_PUBLIC_CONTENT_SITE_URL`, and the current `NEXT_PUBLIC_LINK`.

- [x] Write tests proving `/` and anchors stay local, content paths become `https://way.one2agi.com/...`, query/hash are preserved, and absolute owned content links do not open a new tab.
- [x] Run `pnpm test -- __tests__/lib/site-role.test.js __tests__/components/SmartLink.test.js --runInBand` and verify failure because the helper/behavior does not exist.
- [x] Implement the pure URL resolver and use it in SmartLink before external-link classification.
- [x] Re-run the two test files and verify all tests pass.

### Task 2: Redirect and Sitemap boundaries

**Files:**
- Modify: `deploy/nginx/www.one2agi.com.conf`
- Modify: `pages/sitemap.xml.js`
- Test: `__tests__/deploy/domain-routing.test.js`
- Test: `__tests__/pages/sitemap-role.test.js`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SITE_ROLE`, current `NEXT_PUBLIC_LINK`, and nginx `$request_uri`.
- Produces: infrastructure allowlist plus 308 content redirect; homepage-only landing Sitemap.

- [x] Write failing contract tests for exact root proxying, infrastructure proxying, 308 `$request_uri` preservation, and landing Sitemap avoiding Notion reads.
- [x] Run `pnpm test -- __tests__/deploy/domain-routing.test.js __tests__/pages/sitemap-role.test.js --runInBand` and confirm expected failures.
- [x] Add nginx locations and an early landing Sitemap branch returning only the canonical homepage.
- [x] Re-run both tests and verify pass.

### Task 3: Single-consumer dual-site revalidation

**Files:**
- Create: `lib/notion-webhook/revalidateTargets.ts`
- Modify: `pages/api/revalidate.js`
- Test: `__tests__/lib/notion-webhook/revalidateTargets.test.ts`
- Test: `__tests__/pages/revalidate-dirty.test.ts`

**Interfaces:**
- Produces: `revalidateContentPath({ path, revalidateLocal, fetchImpl, landingUrl, token })`.
- Consumes: existing `consumeDirtyPages`, `LANDING_REVALIDATION_URL`, `REVALIDATION_TOKEN`, and the content site role.

- [x] Add tests proving every path revalidates locally, only `/` fans out to landing, Bearer authentication is used, malformed/non-2xx responses reject, and landing role never fans out.
- [x] Run the focused tests and observe failure before implementation.
- [x] Implement the helper and wire the dirty consumer callback through it.
- [x] Re-run focused tests and verify pass.

### Task 4: Docker and scheduler ownership

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `deploy/scripts/run-notion-refresh.sh`
- Modify: `deploy/scripts/configure-notion-webhook-vps.sh`
- Modify: `deploy/scripts/deploy.sh`
- Modify: `deploy/scripts/deploy-way.sh`
- Test: `__tests__/deploy/domain-routing.test.js`
- Test: `__tests__/deploy/notion-webhook-scripts.test.js`

**Interfaces:**
- Main build: role `landing`, link `https://www.one2agi.com`, content URL `https://way.one2agi.com`.
- Way build: role `content`, link `https://way.one2agi.com`, landing revalidation URL `http://app:3000/api/revalidate`.
- Scheduler target: `http://127.0.0.1:3031/api/revalidate`.

- [x] Extend contract tests to require the exact build args/runtime variables, independent cache volumes, port 3031 scheduler ownership, and correct smoke-test ports.
- [x] Run deploy tests and verify they fail on the old configuration.
- [x] Pass public variables through Docker build/runner, configure both Compose services, and update scheduler/deploy scripts.
- [x] Re-run deploy tests and shell syntax checks.

### Task 5: Operations documentation

**Files:**
- Modify: `deploy/docs/NOTION-WEBHOOK.md`
- Modify: `deploy/docs/DEPLOY-LOG.md`
- Create: `deploy/docs/DOMAIN-ROLES.md`

**Interfaces:**
- Documents the role matrix, shared/separate cache matrix, deployment order, smoke checks, and rollback.

- [x] Document the final operational behavior and exact verification commands.
- [x] Run `git diff --check` and a secret-pattern scan over the diff.

### Task 5.5: Landing build scope

**Files:**
- Modify: `lib/build/staticPaths.js`
- Modify: dynamic pagination, category, tag, and search route pages
- Test: `__tests__/lib/staticPaths.test.js`
- Test: `__tests__/pages/public-isr-policy.test.js`

- [x] Add failing tests that require the landing role to omit concrete content paths.
- [x] Gate dynamic static-path generation for the landing build while keeping the content build unchanged.
- [x] Verify the landing build has no concrete article/list routes and the content build retains the complete route set.

### Task 6: Full verification and commit

**Files:** all changed files above.

- [x] Run focused domain, Sitemap, webhook, and deploy tests.
- [x] Run `pnpm lint`, `pnpm type-check`, and `pnpm test -- --runInBand`.
- [x] Build both roles with the production-safe test database configuration available in the environment; if credentials are unavailable, report that limitation without claiming builds passed.
- [x] Inspect `git diff --stat`, `git diff --check`, and ensure no secret is present.
- [x] Commit with Conventional Commits message `feat(routing): split landing and content domains`.
