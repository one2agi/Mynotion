# Remove Clerk and Global Middleware for EdgeOne Design

**Date:** 2026-07-13
**Status:** Approved for implementation planning

## Background

The production site intermittently returns HTTP 545 from EdgeOne on the home
page, hashed static assets, images, and `/_next/data` requests. EdgeOne defines
545 as an Edge Function execution exception. The same immutable asset can
alternate between 200 and 545, so the failure is not isolated to Notion data,
SSR page generation, or the knowledge graph.

The repository currently has a root `middleware.ts` that imports Clerk. Even
though its matcher is limited to account-related routes, the presence of a
Next.js middleware entry can cause the deployment adapter to create and load a
global edge execution layer before route matching. Local EdgeOne output has
also shown a large middleware bundle. Removing the root middleware is therefore
the cleanest available A/B test for this failure mode.

The Clerk-backed functionality is not part of the actual blog product:

- `/dashboard/**` is explicitly a visual demonstration without real account,
  membership, balance, order, or affiliate functionality.
- The repository has no implemented pages for the protected organization and
  administration matchers.
- Blog comments use their own providers and identity models. They do not use
  Clerk.

The product decision is to keep the existing comment-provider identity flow and
fully remove Clerk, the login and registration pages, and the demo dashboard.

## Goals

1. Remove the root Next.js middleware so EdgeOne no longer needs to deploy the
   Clerk middleware bundle.
2. Remove unused Clerk authentication and demo dashboard code from the client,
   server, themes, configuration, and dependencies.
3. Preserve all real blog functionality, especially comments, Notion inline
   page mentions, the knowledge graph, SSR caching, search, taxonomy, and
   localization.
4. Produce an observable A/B result: after deployment, repeated production
   probes must show whether 545 responses have stopped.
5. Keep the change isolated and reversible through normal Git revert.

## Non-goals

- Replacing Clerk with another account system.
- Requiring visitors to create a blog account before commenting.
- Changing any comment provider or comment data format.
- Changing payment, membership, order, balance, or affiliate behavior; the
  existing dashboard versions of these features are demo-only and will be
  removed.
- Changing the 60-second public SSR cache policy.
- Claiming that EdgeOne 545 is fixed before post-deployment probing confirms it.

## Options Considered

### Option A: Disable Clerk only through environment variables

This has the smallest source change, but it leaves the root middleware, Clerk
imports, dependencies, theme branches, and accidental re-enable paths in the
repository. It also does not provide a clean EdgeOne middleware A/B test.

**Decision:** Rejected.

### Option B: Keep authentication code but bypass middleware on EdgeOne

This could avoid some edge execution while retaining future account code. It
would require platform-specific conditions and leave unused client and theme
complexity behind. The product has no planned account feature that justifies
that cost.

**Decision:** Rejected.

### Option C: Fully remove Clerk and the demo account experience

This matches the current product, removes the global middleware entry, reduces
the client and deployment dependency surface, and creates the strongest A/B
test for the EdgeOne failure.

**Decision:** Selected.

## Detailed Design

### 1. Remove the global edge authentication layer

Delete the root `middleware.ts`. Do not replace it with another middleware,
proxy, redirect layer, or route-wide edge function.

The removed matchers are either for the demo dashboard or for routes that do
not exist in this repository. No real public blog route requires their
protection.

### 2. Remove account routes and demo API

Remove:

- `pages/sign-in/[[...index]].js`
- `pages/sign-up/[[...index]].js`
- `pages/dashboard/[[...index]].js`
- `pages/api/user.ts`

The retired `/sign-in`, `/sign-up`, and `/dashboard/**` URLs will use the
site's existing not-found behavior. The implementation must not add a redirect
that recreates global middleware or another edge interception layer.

### 3. Remove demo dashboard UI

Delete `components/ui/dashboard/` and remove all imports and render paths that
reference its components.

This removes only demonstration screens. It does not remove a functioning
customer account, payment, subscription, balance, order, or affiliate system.

### 4. Remove Clerk from the application shell and global state

In `pages/_app.js`, remove the Clerk localization import, dynamic
`ClerkProvider` import, environment-variable branch, and provider wrapper. The
existing error boundary, global context, theme layout, SEO, and external plugin
render order must remain unchanged.

In `lib/global.js`, remove `useUser`, Clerk environment detection, and the
`isLoaded`, `isSignedIn`, and `user` context fields. All unrelated global state
must retain its current behavior.

### 5. Define TechGrow behavior without blog accounts

`components/TechGrow.js` currently exempts a signed-in Clerk user from the
article verification flow. After removal, there is no blog-account exemption:
all visitors follow the configured TechGrow allowlist, denylist, password-lock,
and read-more rules.

This is an intentional product behavior. It does not alter TechGrow's own
verification mechanism, cookies, QR code flow, or article locking rules.

### 6. Remove account layouts and controls from themes

For the starter, proxio, gitbook, and magzine themes:

- Remove Clerk component imports.
- Remove `LayoutSignIn`, `LayoutSignUp`, and `LayoutDashboard` definitions and
  exports.
- Remove sign-in, user-profile, and dashboard controls from headers.
- Preserve dark-mode, search, menu, logo, mobile navigation, and other theme
  behavior.

The starter theme may retain its generic configurable call-to-action buttons,
but their defaults must not create links to retired login or registration
routes. Rendering should remain conditional on meaningful button content.

Remove the retired layout keys from `conf/layout-map.config.js`.

### 7. Remove dependencies and configuration

Remove `@clerk/nextjs` and `@clerk/localizations` from `package.json` and update
`pnpm-lock.yaml` through pnpm. Remove Clerk-specific environment validation
rules from `lib/config/env-validation.js`.

No Clerk publishable or secret key should be required after the change. Stale
keys in the EdgeOne project may be removed operationally after the code change,
but their presence must not affect the application.

### 8. Preserve comment identity and submission

`components/Comment.js`, `pages/api/notion-comments.js`, and provider-specific
comment components must not gain a Clerk dependency.

Existing identity behavior remains provider-owned:

- Giscus and Utterances may use GitHub identity.
- Twikoo, Waline, Artalk, and similar providers use their own configured model.
- Notion Comments continues to accept and validate its existing author,
  nickname, email, and content fields.

Removing Clerk must not change comment request formats, moderation, rate
limits, or stored records.

## Expected Product Impact

### Removed

- Blog login and registration screens.
- Demo dashboard and account menu.
- Clerk user-profile and sign-out controls.
- The signed-in-user exemption from TechGrow verification.

### Preserved

- Reading and navigating public pages.
- Notion `@page` links and legacy Notion-page-ID resolution.
- Knowledge graph rendering and navigation.
- Comment display and submission through configured providers.
- Search, tags, categories, archives, localization, themes, SEO, analytics, and
  external plugins.
- Public SSR cache headers and 60-second stale revalidation behavior.

## Testing Strategy

Implementation must follow test-first removal boundaries:

1. Add a static architecture test that initially fails while Clerk,
   `middleware.ts`, and account routes still exist.
2. Add or update theme contract tests so removed account layouts and imports are
   detected without weakening unrelated theme coverage.
3. Preserve and run comment tests, including Notion comment validation and API
   behavior, to prove that comment functionality is independent of Clerk.
4. Update routing and public-cache tests only where they intentionally reference
   the retired dashboard or middleware.
5. Run lint, type checking, the full Jest suite, and a production build.
6. Run the EdgeOne CLI build or inspection flow and verify that the generated
   configuration contains no global Next.js middleware entry and no Clerk
   bundle.

Tests must demonstrate the expected RED-to-GREEN transition. Existing tests
must not simply be deleted to make the suite pass; each obsolete assertion must
be replaced by an assertion for the new product boundary when appropriate.

## Deployment Verification

After the automatic EdgeOne deployment:

1. Confirm the deployed build corresponds to the removal commit.
2. Probe the home page repeatedly with unique query strings to avoid relying on
   warm cache hits.
3. Probe one immutable hashed asset repeatedly.
4. Probe representative `/_next/data` routes for the home page, an article, and
   a tag page.
5. Open an article and submit or load a comment using the configured production
   comment provider.
6. Verify Notion inline page links and the knowledge graph.
7. Record status counts, response times, and any `x-nws-log-uuid` from a 545.

The change is considered successful only if functional checks pass and the
multi-round probes show no 545 responses. If 545 persists, the result still
provides useful evidence that the exception is above the removed Clerk
middleware layer and should be escalated to EdgeOne with request identifiers.

## Rollback

Keep the removal in isolated conventional commits. If a real required feature
is found to depend on Clerk, revert the relevant commit and redeploy. Do not
restore middleware merely to recover comments, because comments do not depend
on it.

## Acceptance Criteria

- No tracked source file imports `@clerk/*`.
- `package.json` and `pnpm-lock.yaml` contain no Clerk packages.
- The root `middleware.ts` no longer exists and EdgeOne output contains no
  global Next.js middleware entry.
- Account and demo dashboard routes/components are absent.
- All configured comment systems remain buildable and their existing tests
  pass.
- All supported themes compile without account layouts or controls.
- Lint, type checking, full tests, and production build pass.
- Post-deployment probes and functional smoke tests are recorded before making
  any claim that 545 is fixed.
