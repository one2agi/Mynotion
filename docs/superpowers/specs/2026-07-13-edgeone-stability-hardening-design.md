# EdgeOne Stability Hardening Design

## Goal

Reduce first-visit failures and latency on EdgeOne Makers without changing the
knowledge graph, Notion `@page` behavior, Clerk-protected routes, payments, or
other API features.

The first delivery is deliberately smaller than a full SSR-to-ISR migration. It
adds a 60-second edge cache to public SSR pages, removes public traffic from
Next.js Middleware, and moves legacy Notion UUID redirects onto the existing
page route that already knows how to resolve Notion pages.

## Confirmed Evidence

- Production first-screen JavaScript and CSS intermittently return HTTP 545.
  The same hashed URL alternates between valid HTTP 200 content and 545, so the
  files are present and valid.
- EdgeOne CLI local development cuts off an initial proxied request after about
  5.4 seconds while the underlying Next.js development server can continue
  compiling or fetching Notion data for much longer.
- A successful production homepage request still takes roughly 6-8 seconds
  because `pages/index.js` uses `getServerSideProps` and reads Notion data for
  uncached requests.
- The production Next.js middleware manifest excludes `/_next/static`, so
  Middleware alone cannot explain every static-asset 545.
- The EdgeOne CLI reports an edge-function code package of 4.31 MB, close to its
  5 MB warning threshold.
- The deployed `/redirect.json` returns 404. The generator in
  `lib/utils/redirect.js` has no active caller.
- A previous `prebuild` generator was intentionally reverted in commit
  `47cb19b0`: EdgeOne bypassed that lifecycle hook, and direct Node ESM execution
  failed on JSX imported through the RSS generator. This design does not revive
  that approach.
- Inline Notion `@page` links are converted to site slugs in
  `lib/db/notion/convertInnerUrl.js` using `allPages`; they do not require the
  UUID redirect in Middleware.

## Considered Approaches

### A. Keep global Middleware and add an early UUID check

This is the smallest patch. It avoids fetching `/redirect.json` for most
requests but still initializes Middleware for all public page traffic and still
depends on a missing generated file.

Rejected because it leaves the most failure-prone request boundary in the
critical path and does not repair the broken mapping lifecycle.

### B. Cache public SSR and move UUID redirects to the page route

This is the selected approach. Middleware is limited to routes that actually
need Clerk authorization. Public pages bypass it. The existing one-segment page
route resolves a UUID only when somebody visits a UUID URL and returns a
permanent redirect to the canonical slug.

This preserves current locale-prefixed SSR routing and avoids repeating the
historical `/_next/data/{buildId}/zh-CN.json` regression.

### C. Convert the public site to ISR or a full static export

This removes most runtime rendering but is a larger migration. The repository
already documents a locale JSON routing regression caused by converting the
affected pages to `getStaticProps`. A full static export would also require a
separate design for Clerk, payments, and dynamic APIs.

Deferred until the smaller hardening has production measurements.

## Architecture

### 1. Public SSR edge caching

Create a small server-only cache-control helper with one public contract:

```js
setPublicPageCache(res, {
  maxAge: 60,
  staleWhileRevalidate: 60
})
```

It sets:

```text
Cache-Control: public, s-maxage=60, stale-while-revalidate=60
```

Apply it only to public SSR listing pages:

- `pages/index.js`
- `pages/archive/index.js`
- `pages/page/[page].js`

Do not apply it to Clerk dashboards, authentication callbacks, payment routes,
or user-specific APIs.

Normal Notion edits become visible after the current cached response expires,
normally within 60 seconds. If regeneration temporarily fails, EdgeOne may
serve the previous good response for up to one additional 60-second window
instead of showing an error.

### 2. Lightweight Middleware boundary

Remove UUID parsing, `redirect.json` fetching, Notion utilities, and the full
blog configuration import from `middleware.ts`.

Middleware will match only the routes that its current code actually protects:

- `/dashboard` and descendants
- `/user/organization-selector` and descendants
- `/user/orgid/*`
- `/admin/*/memberships`
- `/admin/*/domain`

Public pages, article routes, API routes that are currently public, Next.js
assets, images, and metadata files will not enter Middleware.

If Clerk is not configured, matched routes continue with `NextResponse.next()`.
If Clerk is configured, the existing login and permission behavior remains.

### 3. Legacy Notion UUID redirect

The existing `pages/[prefix]/index.js` route uses blocking fallback. Extend its
`getStaticProps` behavior before the normal `resolvePostProps` call:

1. Detect whether `prefix` is a valid Notion page ID or UUID.
2. Read the shared published-page index through `getSharedAllPages`; this uses
   the existing site-data cache and does not fetch arbitrary Notion pages.
3. If it belongs to a published site page, return a permanent Next.js redirect
   to its canonical `href`, preserving the active locale prefix.
4. If it cannot be resolved to a published site page, return `notFound` without
   falling back to `fetchPageFromNotion`.
5. For normal slugs, preserve the current rendering and ISR behavior exactly.

This removes the need for `public/redirect.json` and avoids performing any
extra network request on ordinary page visits.

### 4. Knowledge graph and inline mention isolation

No files under `lib/knowledge-graph`, `components/KnowledgeGraph`, or the graph
cloud function are modified.

The inline mention conversion in `lib/db/notion/convertInnerUrl.js` remains the
primary route for clicking `@page` links rendered inside an article. The UUID
route is a fallback for bookmarks, external links, and any unresolved raw
Notion URL.

## Error Handling

- Cache-control setup is a synchronous header operation and must not prevent a
  page response if `res` is unavailable in a test harness.
- A UUID that is absent, private, unpublished, malformed, or unavailable from
  Notion returns 404 and is never redirected to an unrelated page.
- Redirect destinations must be local canonical paths; absolute third-party
  URLs are rejected.
- Existing Notion fetch failures continue through the repository's current
  cache and error handling. No new retry loop is added to Middleware.

## Testing Strategy

### Unit and contract tests

- Cache helper produces the exact public cache header and rejects invalid
  negative or non-numeric durations.
- The three public SSR pages call the helper; dashboard/auth pages do not.
- Middleware matcher includes every protected route and excludes `/`, article
  paths, `/_next/static`, `/_next/image`, and public API paths.
- A known 32-character ID and a hyphenated UUID return a canonical permanent
  redirect from `[prefix]`.
- Unknown IDs return `notFound`; ordinary slugs preserve existing props and
  revalidation.
- Existing locale routing, Notion link, and knowledge graph tests remain green.

### Build and local runtime verification

- Run focused Jest tests first, then the full relevant Jest suite.
- Run `pnpm type-check` and `pnpm build` with Node 22.
- Inspect `.next/server/middleware-manifest.json` and prove that public and
  static paths do not match Middleware while protected routes do.
- Run `edgeone makers dev`, record the CLI package-size warning, and compare
  homepage/static-resource behavior after warm-up. Development compilation
  time is recorded separately and is not treated as a production failure.

### Production verification

After deployment:

- Confirm homepage responses advertise the intended edge cache policy.
- Confirm a known raw Notion ID redirects to its canonical localized slug.
- Confirm an article `@page` link navigates to the correct article.
- Repeat the existing first-screen asset probe for at least 180 requests and
  record every non-200 response and EdgeOne request UUID.
- Do not declare the 545 issue fixed unless the production probe confirms it.
  Remaining 545s are platform evidence for EdgeOne support because static
  resources do not execute project Middleware.

## Non-Goals

- No full ISR conversion in this delivery.
- No static export migration.
- No Website Security Acceleration product or DNS change.
- No client-side infinite reload or hidden retry loop for failed chunks.
- No changes to graph extraction, graph storage, payment contracts, or Clerk
  permission rules.

## Rollback

The change is isolated on `codex/edgeone-stability-hardening`. Reverting the
cache helper calls, Middleware matcher, and UUID route behavior restores the
previous application behavior. No database or storage migration is involved.

## Acceptance Criteria

- Public homepage, archive, and pagination responses use the approved
  60-second edge-cache policy.
- Homepage, articles, and `/_next/static` do not match project Middleware.
- Clerk-protected routes still match and enforce the same decisions.
- Raw Notion IDs redirect to canonical local slugs without `redirect.json`.
- Inline Notion `@page` navigation and knowledge graph tests are unchanged and
  passing.
- Type checking and production build pass.
- Production asset probing is reported separately; any remaining 545 is not
  misreported as an application fix.
