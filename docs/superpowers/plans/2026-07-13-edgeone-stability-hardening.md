# EdgeOne Stability Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce EdgeOne first-visit latency and failures by caching public SSR responses, removing public traffic from Middleware, and resolving legacy Notion UUID URLs without `redirect.json`.

**Architecture:** Public SSR pages share a small server-only cache-header helper. Next.js Middleware becomes an authentication-only boundary for the five protected route families. The existing one-segment page route detects raw Notion IDs, resolves them only against the published site-page index, and returns a canonical local redirect before the normal slug resolver runs.

**Tech Stack:** Next.js 14 Pages Router, React 18, Node.js 22, JavaScript/TypeScript, Jest with `next/jest`, pnpm 9.15.0, EdgeOne Makers CLI.

## Global Constraints

- Work on branch `codex/edgeone-stability-hardening` in the existing WSL checkout.
- Use pnpm 9.15.0 and Node.js 22; do not use npm or yarn.
- Preserve `.serena/project.yml` and `AGENTS.md` as unrelated user changes and never stage them.
- Do not modify knowledge-graph extraction, rendering, storage, or cloud functions.
- Do not change Clerk permission decisions, payment routes, or external API contracts.
- Keep locale-prefixed pages on `getServerSideProps`; do not reintroduce the historical locale JSON 404.
- Follow RED-GREEN-REFACTOR for every implementation task.
- Use Conventional Commits.

---

### Task 1: Cache public SSR listing pages at the edge

**Files:**
- Create: `lib/cache/publicPageCache.js`
- Create: `__tests__/lib/cache/publicPageCache.test.js`
- Create: `__tests__/pages/public-page-cache.test.js`
- Modify: `pages/index.js`
- Modify: `pages/archive/index.js`
- Modify: `pages/page/[page].js`

**Interfaces:**
- Produces: `setPublicPageCache(res, options?)` in `lib/cache/publicPageCache.js`.
- Default output: `Cache-Control: public, s-maxage=60, stale-while-revalidate=60`.
- Consumed by the three public `getServerSideProps` implementations before any early return.

- [ ] **Step 1: Write the failing helper test**

Create `__tests__/lib/cache/publicPageCache.test.js`:

```js
import {
  PUBLIC_PAGE_CACHE_CONTROL,
  setPublicPageCache
} from '@/lib/cache/publicPageCache'

describe('setPublicPageCache', () => {
  test('sets the approved 60 second edge cache policy', () => {
    const res = { setHeader: jest.fn() }

    setPublicPageCache(res)

    expect(PUBLIC_PAGE_CACHE_CONTROL).toBe(
      'public, s-maxage=60, stale-while-revalidate=60'
    )
    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      PUBLIC_PAGE_CACHE_CONTROL
    )
  })

  test('is harmless when a response object is unavailable', () => {
    expect(() => setPublicPageCache()).not.toThrow()
    expect(() => setPublicPageCache({})).not.toThrow()
  })

  test.each([[-1, 60], [60, -1], ['60', 60], [60, NaN]])(
    'rejects invalid durations maxAge=%p stale=%p',
    (maxAge, staleWhileRevalidate) => {
      expect(() =>
        setPublicPageCache(
          { setHeader: jest.fn() },
          { maxAge, staleWhileRevalidate }
        )
      ).toThrow(TypeError)
    }
  )
})
```

- [ ] **Step 2: Run the helper test and confirm RED**

Run:

```bash
pnpm test -- __tests__/lib/cache/publicPageCache.test.js --runInBand
```

Expected: FAIL because `lib/cache/publicPageCache.js` does not exist.

- [ ] **Step 3: Implement the cache helper**

Create `lib/cache/publicPageCache.js`:

```js
const DEFAULT_MAX_AGE = 60
const DEFAULT_STALE_WHILE_REVALIDATE = 60

function assertDuration(name, value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`)
  }
}

export const PUBLIC_PAGE_CACHE_CONTROL =
  'public, s-maxage=60, stale-while-revalidate=60'

export function setPublicPageCache(
  res,
  {
    maxAge = DEFAULT_MAX_AGE,
    staleWhileRevalidate = DEFAULT_STALE_WHILE_REVALIDATE
  } = {}
) {
  assertDuration('maxAge', maxAge)
  assertDuration('staleWhileRevalidate', staleWhileRevalidate)
  if (typeof res?.setHeader !== 'function') return

  const value =
    maxAge === DEFAULT_MAX_AGE &&
    staleWhileRevalidate === DEFAULT_STALE_WHILE_REVALIDATE
      ? PUBLIC_PAGE_CACHE_CONTROL
      : `public, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`
  res.setHeader('Cache-Control', value)
}
```

- [ ] **Step 4: Run the helper test and confirm GREEN**

Run the same focused Jest command. Expected: PASS with all helper cases green.

- [ ] **Step 5: Write the failing page integration contract test**

Create `__tests__/pages/public-page-cache.test.js`. Read the three public page
sources and assert each imports `setPublicPageCache`, accepts `res` in
`getServerSideProps`, and calls `setPublicPageCache(res)`. Also read
`pages/dashboard/[[...index]].js` and `pages/auth/index.js` and assert neither
imports nor calls the helper.

```js
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const publicPages = [
  'pages/index.js',
  'pages/archive/index.js',
  'pages/page/[page].js'
]
const privatePages = [
  'pages/dashboard/[[...index]].js',
  'pages/auth/index.js'
]

describe('public SSR edge cache wiring', () => {
  test.each(publicPages)('%s sets public page cache', file => {
    const source = read(file)
    expect(source).toMatch(
      /import\s+\{\s*setPublicPageCache\s*\}\s+from\s+['"]@\/lib\/cache\/publicPageCache['"]/
    )
    expect(source).toMatch(
      /getServerSideProps\s*\(\s*\{[^}]*\bres\b[^}]*\}\s*\)/s
    )
    expect(source).toMatch(/setPublicPageCache\(res\)/)
  })

  test.each(privatePages)('%s never uses public page cache', file => {
    expect(read(file)).not.toMatch(/setPublicPageCache/)
  })
})
```

The source contract is intentional: importing the complete pages would execute
large theme and Notion dependency graphs and obscure the cache boundary under
test.

- [ ] **Step 6: Run the page contract test and confirm RED**

Run:

```bash
pnpm test -- __tests__/pages/public-page-cache.test.js --runInBand
```

Expected: FAIL because none of the three public pages use the helper yet.

- [ ] **Step 7: Wire the helper into all public SSR listing paths**

Use these exact signatures while preserving each function body:

```js
import { setPublicPageCache } from '@/lib/cache/publicPageCache'

// pages/index.js and pages/archive/index.js
export async function getServerSideProps({ locale, res }) {
  setPublicPageCache(res)
  // existing logic remains unchanged
}

// pages/page/[page].js
export async function getServerSideProps({ params, locale, res }) {
  setPublicPageCache(res)
  // existing logic remains unchanged
}
```

Call the helper before validation in `pages/page/[page].js` so valid and 404
responses follow one explicit policy. Do not touch dashboard or auth pages.

- [ ] **Step 8: Run focused cache and locale tests**

Run:

```bash
pnpm test -- \
  __tests__/lib/cache/publicPageCache.test.js \
  __tests__/pages/public-page-cache.test.js \
  __tests__/pages/locale-routing.test.js \
  --runInBand
```

Expected: PASS; locale contract still requires SSR.

- [ ] **Step 9: Commit Task 1**

```bash
git add lib/cache/publicPageCache.js \
  __tests__/lib/cache/publicPageCache.test.js \
  __tests__/pages/public-page-cache.test.js \
  pages/index.js pages/archive/index.js 'pages/page/[page].js'
git commit -m "perf(edgeone): cache public SSR pages"
```

---

### Task 2: Remove public traffic and UUID work from Middleware

**Files:**
- Create: `__tests__/middleware-routing.test.ts`
- Modify: `middleware.ts`

**Interfaces:**
- Produces: literal `config.matcher` entries for only the current Clerk-protected route families.
- Preserves: tenant login redirect and tenant-admin permission checks.
- Removes: UUID parsing, `redirect.json` fetches, Notion utilities, and `blog.config` from the edge bundle.

- [ ] **Step 1: Write the failing Middleware routing test**

Create a Jest test that imports `config` from `middleware.ts`, verifies the
exact literal matcher list, and leaves generated-regex proof to the production
`.next/server/middleware-manifest.json` check in Task 4.

Expected protected patterns:

```js
[
  '/dashboard/:path*',
  '/user/organization-selector/:path*',
  '/user/orgid/:path*',
  '/admin/:orgId/memberships',
  '/admin/:orgId/domain'
]
```

The test must also assert that the Middleware source contains no
`redirect.json`, `UUID_REDIRECT`, `notion-utils`, `checkStrIsNotionId`, or
`blog.config` reference.

```ts
import fs from 'fs'
import path from 'path'

jest.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: jest.fn(handler => handler),
  createRouteMatcher: jest.fn(() => jest.fn(() => false))
}))
jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ type: 'next' })),
    redirect: jest.fn()
  }
}))

describe('middleware route boundary', () => {
  test('matches only Clerk-protected routes', async () => {
    const { config } = await import('../middleware')
    expect(config.matcher).toEqual([
      '/dashboard/:path*',
      '/user/organization-selector/:path*',
      '/user/orgid/:path*',
      '/admin/:orgId/memberships',
      '/admin/:orgId/domain'
    ])
  })

  test('contains no public UUID redirect work', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'middleware.ts'),
      'utf8'
    )
    for (const forbidden of [
      'redirect.json',
      'UUID_REDIRECT',
      'notion-utils',
      'checkStrIsNotionId',
      'blog.config'
    ]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
```

- [ ] **Step 2: Run the routing test and confirm RED**

```bash
pnpm test -- __tests__/middleware-routing.test.ts --runInBand
```

Expected: FAIL against the current global matcher and UUID fetch code.

- [ ] **Step 3: Slim Middleware to authentication only**

Remove these imports:

```ts
import { checkStrIsNotionId, getLastPartOfUrl } from '@/lib/utils'
import { idToUuid } from 'notion-utils'
import BLOG from './blog.config'
```

Replace the matcher with the exact protected list from Step 1. Replace
`noAuthMiddleware` with a synchronous pass-through function that returns
`NextResponse.next()`. Preserve `isTenantRoute`, `isTenantAdminRoute`, and all
existing Clerk decisions.

```ts
export const config = {
  matcher: [
    '/dashboard/:path*',
    '/user/organization-selector/:path*',
    '/user/orgid/:path*',
    '/admin/:orgId/memberships',
    '/admin/:orgId/domain'
  ]
}

const noAuthMiddleware = () => NextResponse.next()
```

- [ ] **Step 4: Run Middleware and knowledge-graph boundary tests**

```bash
pnpm test -- \
  __tests__/middleware-routing.test.ts \
  __tests__/components/NotionLink.test.js \
  __tests__/lib/knowledge-graph/extract.test.ts \
  --runInBand
```

Expected: PASS with no graph or inline-link regression.

- [ ] **Step 5: Commit Task 2**

```bash
git add middleware.ts __tests__/middleware-routing.test.ts
git commit -m "perf(edgeone): limit middleware to protected routes"
```

---

### Task 3: Resolve legacy Notion UUID URLs in the page route

**Files:**
- Create: `lib/utils/legacyNotionRedirect.js`
- Create: `__tests__/lib/utils/legacyNotionRedirect.test.js`
- Create: `__tests__/pages/legacy-notion-redirect.test.js`
- Modify: `pages/[prefix]/index.js`

**Interfaces:**
- Produces: `resolveLegacyNotionRedirect({ value, allPages, locale })` returning `{ destination, permanent: true } | null`.
- Consumes: `getSharedAllPages({ locale })` only for UUID-shaped one-segment routes.
- Security: matches only `Published` pages already present in the site database index.

- [ ] **Step 1: Write the failing resolver unit test**

Cover these cases with realistic fixtures:

- 32-character Notion ID matches a hyphenated page ID.
- Hyphenated UUID matches the same page.
- Published page returns a local destination and `permanent: true`.
- Locale is prefixed once, never duplicated.
- Ordinary slug, unknown UUID, unpublished page, menu row, missing href,
  absolute URL, and protocol-relative URL all return `null`.

```js
import {
  isLegacyNotionId,
  resolveLegacyNotionRedirect
} from '@/lib/utils/legacyNotionRedirect'

const compactId = '1234567890abcdef1234567890abcdef'
const uuid = '12345678-90ab-cdef-1234-567890abcdef'
const published = {
  id: uuid,
  status: 'Published',
  type: 'Post',
  href: '/article/example'
}

describe('legacy Notion redirect resolver', () => {
  test.each([compactId, uuid])('recognizes and redirects %s', value => {
    expect(isLegacyNotionId(value)).toBe(true)
    expect(
      resolveLegacyNotionRedirect({
        value,
        allPages: [published],
        locale: 'zh-CN'
      })
    ).toEqual({
      destination: '/zh-CN/article/example',
      permanent: true
    })
  })

  test('does not duplicate an existing locale prefix', () => {
    expect(
      resolveLegacyNotionRedirect({
        value: compactId,
        allPages: [{ ...published, href: '/zh-CN/article/example' }],
        locale: 'zh-CN'
      })
    ).toEqual({
      destination: '/zh-CN/article/example',
      permanent: true
    })
  })

  test.each([
    ['article-slug', [published]],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [published]],
    [compactId, [{ ...published, status: 'Draft' }]],
    [compactId, [{ ...published, type: 'Menu' }]],
    [compactId, [{ ...published, href: '' }]],
    [compactId, [{ ...published, href: 'https://example.com' }]],
    [compactId, [{ ...published, href: '//example.com' }]]
  ])('returns null for unsafe or unresolved input', (value, allPages) => {
    expect(
      resolveLegacyNotionRedirect({ value, allPages, locale: 'zh-CN' })
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run the resolver test and confirm RED**

```bash
pnpm test -- __tests__/lib/utils/legacyNotionRedirect.test.js --runInBand
```

Expected: FAIL because the resolver does not exist.

- [ ] **Step 3: Implement the pure resolver**

Use `idToUuid` for normalization and the existing `checkStrIsNotionId` /
`checkStrIsUuid` validators. Require:

```js
page.status === 'Published'
!page.type?.includes('Menu')
page.id normalized === input normalized
page.href startsWith('/') && !page.href.startsWith('//')
```

Normalize `locale` to one leading segment and avoid adding it when `href`
already starts with that segment.

```js
import { idToUuid } from 'notion-utils'
import { checkStrIsNotionId, checkStrIsUuid } from '@/lib/utils'

export function isLegacyNotionId(value) {
  if (typeof value !== 'string') return false
  const compact = value.replaceAll('-', '')
  return (
    /^[a-f0-9]{32}$/i.test(compact) &&
    (checkStrIsNotionId(value) || checkStrIsUuid(value))
  )
}

export function resolveLegacyNotionRedirect({ value, allPages, locale }) {
  if (!isLegacyNotionId(value) || !Array.isArray(allPages)) return null
  const normalizedId = idToUuid(value.replaceAll('-', ''))
  const page = allPages.find(candidate => {
    const href = candidate?.href
    return (
      candidate?.id === normalizedId &&
      candidate?.status === 'Published' &&
      !candidate?.type?.includes('Menu') &&
      typeof href === 'string' &&
      href.startsWith('/') &&
      !href.startsWith('//')
    )
  })
  if (!page) return null

  const cleanLocale = String(locale || '').replace(/^\/+|\/+$/g, '')
  const localePrefix = cleanLocale ? `/${cleanLocale}` : ''
  const destination =
    localePrefix && !page.href.startsWith(`${localePrefix}/`)
      ? `${localePrefix}${page.href}`
      : page.href
  return { destination, permanent: true }
}
```

- [ ] **Step 4: Run the resolver test and confirm GREEN**

Run the same focused test. Expected: PASS.

- [ ] **Step 5: Write the failing page-route contract test**

The test reads `pages/[prefix]/index.js` and asserts:

- `getSharedAllPages` is imported.
- `resolveLegacyNotionRedirect` is imported.
- UUID-shaped `prefix` is checked before `resolvePostProps`.
- A resolved redirect is returned directly.
- An unresolved UUID returns `{ notFound: true }` without calling the arbitrary
  Notion-page fallback.
- Ordinary slug flow still calls `resolvePostProps` and retains `revalidate`.

```js
const fs = require('fs')
const path = require('path')

describe('legacy Notion redirect page integration', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'pages/[prefix]/index.js'),
    'utf8'
  )

  test('resolves published UUIDs before normal post props', () => {
    expect(source).toMatch(/import\s+\{[^}]*getSharedAllPages[^}]*\}/s)
    expect(source).toMatch(
      /import\s+\{[^}]*isLegacyNotionId[^}]*resolveLegacyNotionRedirect[^}]*\}/s
    )
    expect(source.indexOf('isLegacyNotionId(prefix)')).toBeLessThan(
      source.indexOf('resolvePostProps({')
    )
    expect(source).toMatch(/if\s*\(redirect\)\s*return\s*\{\s*redirect\s*\}/s)
    expect(source).toMatch(
      /if\s*\(isLegacyNotionId\(prefix\)\)[\s\S]*return\s*\{\s*notFound:\s*true\s*\}/
    )
  })

  test('keeps normal slug ISR behavior', () => {
    expect(source).toContain('resolvePostProps({')
    expect(source).toMatch(/revalidate:/)
  })
})
```

- [ ] **Step 6: Run the page-route contract test and confirm RED**

```bash
pnpm test -- __tests__/pages/legacy-notion-redirect.test.js --runInBand
```

Expected: FAIL before route integration.

- [ ] **Step 7: Integrate the resolver before normal slug resolution**

In `getStaticProps`:

1. Detect UUID shape using an exported `isLegacyNotionId` helper.
2. Fetch `allPages` with `getSharedAllPages({ locale, from: 'legacy-notion-redirect' })`.
3. Return the resolver result when found.
4. Return `{ notFound: true }` when the input is UUID-shaped but not published.
5. Run the existing `resolvePostProps` path unchanged for non-UUID slugs.

```js
if (isLegacyNotionId(prefix)) {
  const allPages = await getSharedAllPages({
    locale,
    from: 'legacy-notion-redirect'
  })
  const redirect = resolveLegacyNotionRedirect({
    value: prefix,
    allPages,
    locale
  })
  if (redirect) return { redirect }
  return { notFound: true }
}

const props = await resolvePostProps({ prefix, locale })
```

- [ ] **Step 8: Run focused redirect, locale, and inline-link tests**

```bash
pnpm test -- \
  __tests__/lib/utils/legacyNotionRedirect.test.js \
  __tests__/pages/legacy-notion-redirect.test.js \
  __tests__/pages/locale-routing.test.js \
  __tests__/components/NotionLink.test.js \
  __tests__/lib/knowledge-graph/extract.test.ts \
  --runInBand
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add lib/utils/legacyNotionRedirect.js \
  __tests__/lib/utils/legacyNotionRedirect.test.js \
  __tests__/pages/legacy-notion-redirect.test.js \
  'pages/[prefix]/index.js'
git commit -m "fix(routing): resolve legacy Notion page IDs"
```

---

### Task 4: Verify production contracts and EdgeOne behavior

**Files:**
- Modify only if verification exposes a defect in Tasks 1-3.
- Update: `docs/superpowers/plans/2026-07-13-edgeone-stability-hardening.md` checkbox state.

**Interfaces:**
- Consumes all earlier changes.
- Produces fresh test, type-check, build, matcher, and EdgeOne CLI evidence.

- [ ] **Step 1: Run all task-focused tests together**

```bash
pnpm test -- \
  __tests__/lib/cache/publicPageCache.test.js \
  __tests__/pages/public-page-cache.test.js \
  __tests__/middleware-routing.test.ts \
  __tests__/lib/utils/legacyNotionRedirect.test.js \
  __tests__/pages/legacy-notion-redirect.test.js \
  __tests__/pages/locale-routing.test.js \
  __tests__/components/NotionLink.test.js \
  __tests__/lib/knowledge-graph/extract.test.ts \
  --runInBand
```

Expected: all suites and tests pass.

- [ ] **Step 2: Run type checking**

```bash
pnpm type-check
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 3: Run production build**

```bash
pnpm build
```

Expected: exit 0. The route table still shows homepage as dynamic SSR and
article/listing routes retain their existing rendering modes.

- [ ] **Step 4: Prove production Middleware route boundaries**

Load `.next/server/middleware-manifest.json` with Node and test its generated
regexes. Expected:

```text
/                                      false
/article/example                       false
/_next/static/chunks/main.js           false
/_next/image                           false
/api/user                              false
/dashboard                             true
/dashboard/settings                    true
/user/organization-selector            true
/user/orgid/example                    true
/admin/example/memberships             true
/admin/example/domain                  true
```

- [ ] **Step 5: Run EdgeOne CLI local smoke test**

Start:

```bash
/home/morav/.local/share/bin/edgeone makers dev --port 8788 --debug --skip-env-sync
```

After readiness, request `/` and one emitted `/_next/static` asset repeatedly.
Record cold-development compilation separately. Expect warm requests to return
HTTP 200 and confirm public requests do not execute Middleware logs.

- [ ] **Step 6: Verify Git scope**

```bash
git status --short
git diff main...HEAD --stat
git diff --check main...HEAD
```

Expected: `.serena/project.yml` and `AGENTS.md` remain unstaged user changes;
task commits contain only the approved cache, Middleware, redirect, test, and
documentation files.

- [ ] **Step 7: Commit plan progress if checkbox state changed**

```bash
git add -f docs/superpowers/plans/2026-07-13-edgeone-stability-hardening.md
git commit -m "docs(edgeone): record stability hardening verification"
```

## Post-Deployment Verification

Deployment is an explicit user action or separate authorization gate. After it
is deployed, repeat at least 180 first-screen asset requests, record every
non-200 and EdgeOne request UUID, verify the homepage cache headers, exercise a
known raw Notion UUID redirect, and click a rendered Notion `@page` link. Do not
claim the platform 545 issue is eliminated until this production probe passes.
