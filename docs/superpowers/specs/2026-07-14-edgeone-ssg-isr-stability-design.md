# Stabilize EdgeOne with Public-Page SSG and Five-Minute ISR

**Date:** 2026-07-14
**Status:** Approved for implementation planning

## Background

The production blog is deployed on EdgeOne Makers and must remain there. The
site has intermittently returned HTTP 545 for the home page and Next.js page
data. EdgeOne documents 545 as an Edge Function execution exception.

Removing Clerk and the root Next.js middleware materially improved the result:

- The previous production build returned five 545 responses in 32 recorded
  cache-bypassing home-page requests.
- The first production build without Clerk middleware returned no 545 response
  in 180 requests, but two article-data requests ended without any HTTP
  response.
- Cache-miss requests remained slow: the home page averaged about 9.56 seconds,
  tag data about 8.72 seconds, and successful article data about 16.40 seconds.
- A hashed JavaScript asset averaged about 0.57 seconds.

This evidence separates the problem into two layers. Static EdgeOne delivery is
healthy, while requests that enter the Next.js dynamic or ISR path remain slow
and occasionally unstable. The generated EdgeOne/OpenNext package is also about
4.31 MB against the documented 5 MB Edge Function package limit, so adding more
global edge work is not an acceptable stabilization strategy.

The product requirement is to keep EdgeOne, preserve comments and the knowledge
graph, and continue reflecting Notion changes without requiring a deployment.
Existing content should update through a single five-minute policy. Newly
published content should remain reachable without a deployment, even though its
first request may need to generate the page.

## Goals

1. Serve every public content route as a pre-generated page whenever possible.
2. Use one 300-second ISR policy for public page content.
3. Pre-generate every article that is published at deployment time.
4. Allow an article published after deployment to generate on its first request.
5. Keep stale public content available when background regeneration fails.
6. Prevent a transient `/_next/data` failure from leaving the visitor on a
   broken navigation state.
7. Preserve comments, payments, subscriptions, article-password flows, the
   knowledge graph, and all other real dynamic APIs.
8. Fix the locale-prefixed JSON routing contract before retiring the remaining
   SSR workarounds.
9. Verify the production result with both cache-hit and cache-miss probes before
   claiming stability has improved.

## Non-goals

- Switching to `pnpm export` or a fully static export.
- Requiring a deployment after each Notion edit or publication.
- Adding a Notion webhook.
- Adding a five-minute scheduled refresh job.
- Restoring Clerk or a root Next.js middleware.
- Buying EdgeOne website-security acceleration to address 545.
- Caching `/api/*`, authentication, comments, payments, or other personalized
  responses at the public edge.
- Changing knowledge-graph extraction semantics or comment-provider behavior.
- Guaranteeing that a page changes exactly 300 seconds after a Notion edit.

## Options Considered

### Option A: Keep SSR and only lengthen CDN caching

This is the smallest change. It reduces the number of dynamic executions, but a
cold EdgeOne node still needs to run SSR for the home page, archive, and list
pagination. The observed home-page cache-miss latency shows that this does not
remove the unstable path.

**Decision:** Rejected as the end state. It may be used only as a temporary
rollback state while locale-aware SSG is being verified.

### Option B: Use a full static export

This removes the Next.js server-rendering path entirely, but it also removes
ISR and the Pages Router API runtime. Comments, payments, subscriptions,
article-password behavior, and other APIs would need to be migrated before the
site could work normally.

**Decision:** Rejected.

### Option C: Pre-generate public pages and retain dynamic APIs

Public content uses SSG plus ISR. Existing pages are generated at deployment,
then updated on demand after a five-minute validity period. Newly published
paths use blocking fallback once and become cached pages. Real APIs remain
dynamic and uncached.

**Decision:** Selected.

## Architecture

### Public content plane

The public content plane contains:

- Home page.
- Archive.
- Post-list pagination.
- Published posts and pages.
- Tags and tag pagination.
- Categories and category pagination.
- Search landing and supported generated search routes.

These routes use `getStaticProps` with the shared 300-second revalidation value.
Every published path known during the build is returned from `getStaticPaths`
and pre-generated. The build must no longer limit normal ISR builds to only the
current priority-page subset.

Dynamic content routes keep `fallback: 'blocking'`. A page published after the
last deployment is therefore generated on its first request and cached after
that request. This is an intentional exception to the usual static request
path and is required to support publishing without deployment.

### Dynamic feature plane

The dynamic feature plane remains outside public page caching:

- `/api/notion-comments` and configured external comment providers.
- Payment creation, notification, and query APIs.
- Subscription and cache-management APIs.
- Article-password authentication routes.
- RSS API fallback.
- Knowledge graph Cloud Function.

No public cache header may be added to these routes. Automatic retry logic must
not replay their mutations.

### Knowledge graph

The knowledge graph remains a separate EdgeOne Cloud Function backed by
EdgeOne Blob. Its existing ten-minute refresh policy remains independent from
the five-minute public-page ISR policy. The Node.js Cloud Function maximum
duration is raised to 120 seconds in `edgeone.json` because graph generation
performs multi-page Notion I/O.

## Content Update Semantics

The 300-second setting is an eligibility interval, not a cron schedule.

For an existing page:

1. EdgeOne serves the generated page during its valid period.
2. After 300 seconds, the next request can trigger regeneration.
3. The triggering visitor receives the available stale page when the platform
   supports stale delivery.
4. A successful regeneration replaces the cached page for later visitors.
5. A failed regeneration leaves the stale page available.

If nobody requests an expired page, no regeneration runs until the next
request. There is no Notion webhook and no scheduled refresh.

For a newly published page:

1. A regenerated list page discovers and links the new publication.
2. The first article request uses blocking fallback to generate it.
3. Later requests use the generated page and its ISR lifecycle.

For an unpublished or deleted page, the next successful regeneration must
return not-found behavior. List pages remove it on their next successful ISR
update.

## Unified Cache Policy

One shared public-content configuration provides a default revalidation value
of 300 seconds. Individual public pages must not silently retain a conflicting
60-second literal. The existing environment and Notion configuration surface
may remain, but production is configured to 300 and every public route obtains
the value through the same helper.

Where response headers are under application control, public HTML and page data
use the equivalent of:

```text
public, s-maxage=300, stale-while-revalidate=86400
```

The intent is:

- Five minutes of normal shared-edge freshness.
- Up to one day of stale availability during a regeneration or platform
  failure.
- No long-lived browser cache for HTML.
- Normal long-term browser and edge caching for hashed `/_next/static/*`
  assets.

The implementation must not create a broad rule that force-caches every JSON
response. In particular, `/api/*` remains dynamic. Cache keys must preserve
parameters that change content, including locale and theme. Transient parameters
that do not change content, such as known `utm_*` and Giscus callback
parameters, may be removed from the browser URL to reduce cache fragmentation.

## Locale-Prefixed Data Routing

The current home, archive, and post-list pagination pages use SSR as a workaround
for locale-prefixed `/_next/data` 404 responses. The HTML rewrite that strips a
locale prefix does not by itself create the matching pre-generated JSON file.

The implementation must establish an explicit EdgeOne-compatible routing
contract for all affected paths before changing them back to SSG:

- `/zh-CN/`
- `/zh-CN/archive`
- `/zh-CN/page/{n}`
- Their `/_next/data/{buildId}/zh-CN/...json` equivalents.

The fix may use build-time locale-aware paths and narrowly scoped
`edgeone.json` rewrites, but it must be derived from the actual Next.js build
manifest rather than assumed. It must not restore middleware. Tests must inspect
the production build artifacts, and EdgeOne CLI requests must prove that both
HTML and JSON return 200. The SSR workaround is removed only after this contract
passes.

## Client Navigation Recovery

A narrowly scoped recovery layer protects Next.js page-data GET requests. It
applies only to same-origin `/_next/data/*` requests and never to API mutations.

Behavior:

1. Retry HTTP 545, 502, 503, and 504 responses, and retry network disconnects.
2. Use at most two retries with short increasing delays, initially 300 ms and
   1000 ms.
3. Do not retry an aborted request when the user intentionally starts another
   navigation.
4. If retries are exhausted, perform one full navigation to the target URL.
5. Store a per-build, per-URL recovery guard in `sessionStorage` so a full-load
   failure cannot cause an infinite loop.
6. Clear the guard after a successful route completion.

The recovery unit must be isolated and independently tested. Comments, payment
notifications, order creation, subscriptions, and all other POST requests are
outside its scope.

## Build and Deployment Behavior

Normal deployment continues to use `pnpm build`; the site does not use static
export. The build reads Notion once through the existing shared build caches and
generates every currently published route.

The build must remain under the EdgeOne Makers 20-minute build limit. If future
content growth approaches that limit, the project may later introduce a
measured path cap, but the current design intentionally pre-generates all
published content.

After deployment, a verification tool waits for the production Build ID to
change and requests canonical URLs without random query parameters. It covers
the home page, archive, taxonomy pages, every published article, and their page
data. This provides limited cache warming in the probe region and verifies the
actual deployed build. It is not described as global EdgeOne pre-warming.

## Error Handling and Observability

Production probes record:

- Build ID.
- Request group and URL.
- HTTP or curl/network result.
- Total duration.
- Edge cache status.
- Inner function status when present.
- `X-NWS-LOG-UUID` and function request ID when present.

HTTP 545 and empty-response disconnects are counted separately. A failed ISR
refresh must not proactively purge a usable stale page. EdgeOne support tickets
can include the recorded request identifiers from both the old and new builds.

## Expected Product Impact

### Preserved

- Notion edits update without deployment.
- New Notion publications become reachable without deployment.
- Comments remain real-time and provider-owned.
- Knowledge graph behavior remains intact with its independent ten-minute
  refresh.
- Payment, subscription, password, RSS, search, taxonomy, localization, SEO,
  analytics, themes, and Notion page mentions remain available.

### Changed

- Existing page updates become eligible after five minutes rather than after
  one minute.
- A newly published article may be slow on its first request after deployment.
- During an EdgeOne or Notion refresh failure, a visitor can see stale content
  for up to one day instead of receiving an error.
- Home, archive, and pagination stop performing ordinary request-time SSR after
  their locale JSON contract is proven.

## Test Strategy

Implementation follows test-driven development. Tests must first demonstrate
the current conflicting behavior before production code is changed.

### Unit and contract tests

- Every public content page uses the shared 300-second ISR policy.
- Home, archive, and pagination expose `getStaticProps`, not
  `getServerSideProps`, after the locale contract is ready.
- Normal builds return all published content paths, not only priority paths.
- Dynamic routes retain blocking fallback for publications created after a
  deployment.
- API and authentication routes never receive the public cache policy.
- Page-data recovery retries only eligible GET failures, respects aborts, stops
  after two retries, and permits only one full navigation.
- Locale-aware build artifacts include or correctly route every required
  `zh-CN` JSON endpoint.
- Existing comment, payment, password, and knowledge-graph test suites remain
  green.

### Local integration verification

- `pnpm lint` has no errors.
- `pnpm type-check` passes.
- The complete Jest suite passes.
- `pnpm build` succeeds and finishes below the platform time limit.
- Build output contains HTML and JSON for every currently published article.
- The generated EdgeOne/OpenNext package stays below 5 MB and does not grow
  materially from the current baseline.
- EdgeOne CLI returns 200 for representative HTML, `/_next/data`, static asset,
  comment-read, and knowledge-graph requests.
- EdgeOne CLI reports no global Next.js middleware entry.

### Production verification

After the automatic deployment:

1. Confirm that the production Build ID changed.
2. Execute 180 canonical cache-hit or warming requests across home HTML,
   representative page data, and hashed static assets.
3. Execute 180 deliberate cache-miss stress requests in the same groups.
4. Require zero 545 responses and zero empty-response disconnects for the
   acceptance run.
5. Target a cached public-page P95 below two seconds.
6. With a user-performed edit or separate authorization to modify production
   Notion content, edit an existing article and verify that it updates without
   a deployment after the five-minute eligibility interval and a triggering
   request.
7. With the same authorization boundary, publish a new article and verify list
   discovery, first-request blocking generation, and second-request cache
   delivery.
8. Verify unpublish behavior only when the user performs or separately
   authorizes the mutation. Independently verify comment reads,
   article-password flow, payment endpoint health without creating an order,
   and the knowledge graph.

Production smoke testing is read-only by default. Editing, publishing, or
unpublishing Notion content, posting a test comment, or creating a real payment
order requires a user-performed action or separate user authorization.

## Rollout

1. Implement on a dedicated `codex/` feature branch in the existing working
   directory.
2. Preserve the user's unrelated `.serena/project.yml` and `AGENTS.md` changes.
3. Land locale artifact tests before converting the remaining SSR pages.
4. Land shared ISR and all-path generation behind tests.
5. Land client recovery and EdgeOne configuration separately so failures are
   attributable.
6. Run full local and EdgeOne CLI verification.
7. Merge to `main`, push, and wait for the production Build ID to change.
8. Run the complete production verification before declaring the incident
   resolved.

## Rollback

Keep locale routing, ISR conversion, client recovery, and EdgeOne Cloud
Function configuration in separable conventional commits. If locale navigation
or a real dynamic feature regresses, revert the responsible commits and redeploy.
The prior Clerk/middleware removal remains in place and is not part of this
rollback.

## Acceptance Criteria

- The default and production public-content revalidation value is 300 seconds.
- Every currently published article is pre-generated during a normal build.
- Newly published article paths retain blocking fallback.
- Home, archive, and pagination use SSG plus ISR after locale JSON verification.
- All required `/zh-CN` HTML and page-data routes return 200 locally and through
  EdgeOne CLI.
- Public stale content remains available during failed regeneration.
- Page-data recovery is bounded and cannot replay API mutations or loop reloads.
- Comments, payments, subscriptions, password flows, and the knowledge graph
  preserve their contracts.
- The full quality, build, EdgeOne CLI, and production probe gates pass.
- No Notion webhook, periodic refresh schedule, full static export, root
  middleware, or security-acceleration dependency is introduced.
