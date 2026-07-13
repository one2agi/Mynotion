# Remove Clerk and Global Edge Middleware Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task with review checkpoints. Do not use a Git worktree; create the named branch in the existing WSL checkout.

**Goal:** Remove the unused Clerk login and demo dashboard stack, eliminate the root Next.js middleware entry from the EdgeOne deployment, preserve provider-owned comments and all real blog features, and produce a measurable production A/B result for intermittent HTTP 545 responses.

**Architecture:** The application becomes a public blog without a site-wide account provider. Comments retain their own provider identity. The Pages Router renders directly through the existing app shell and global context, while TechGrow treats all visitors uniformly under its own rules. No replacement middleware, global redirect, or authentication edge function is introduced.

**Tech Stack:** Next.js 14 Pages Router, React 18, Node.js 22, pnpm 9.15.0, Jest, EdgeOne Makers CLI, WSL Bash.

**Approved design:** `docs/superpowers/specs/2026-07-13-remove-clerk-edgeone-design.md`

## Global Constraints

- Start from `main` after commit `8afbe0c3` and create branch
  `codex/remove-clerk-edgeone-middleware` in the existing checkout.
- Do not create a worktree.
- Preserve `.serena/project.yml` and `AGENTS.md` as unrelated user changes.
  Never stage or modify them.
- Use `pnpm`; do not use npm or yarn.
- Follow RED-GREEN-REFACTOR for every behavior or architecture boundary.
- Do not modify comment payloads, comment-provider configuration, Notion page
  resolution, knowledge-graph code, SSR cache duration, payment code, or
  external API contracts.
- Keep `/auth/result` and `pages/auth/index.js`; they are part of the article
  password flow, not Clerk login.
- Do not add a replacement `middleware.*`, `proxy.*`, global redirect, or
  route-wide Edge Function.
- Use Conventional Commits and keep commits small enough to revert
  independently.
- Do not claim HTTP 545 is fixed until post-deployment probes pass.

---

## Task 0: Establish the implementation branch and baseline

**Files:** No source changes.

- [ ] **Step 1: Verify the starting point and preserve unrelated changes**

Run:

```bash
git branch --show-current
git status --short
git log -1 --oneline
git merge-base --is-ancestor 8afbe0c3 HEAD
```

Expected:

- Current branch is `main`.
- The ancestry check exits 0, proving `HEAD` includes design commit `8afbe0c3`.
- Only `.serena/project.yml` and `AGENTS.md` are modified before the task
  branch is created.

- [ ] **Step 2: Create the implementation branch**

Run:

```bash
git switch -c codex/remove-clerk-edgeone-middleware
```

Expected: Git switches to the new branch without altering the two unrelated
working-tree files.

- [ ] **Step 3: Run the focused baseline tests**

Run:

```bash
pnpm test -- __tests__/middleware-routing.test.ts __tests__/pages/public-page-cache.test.js __tests__/pages/locale-routing.test.js __tests__/lib/plugins/notionComments.test.js --runInBand
```

Expected: all existing focused tests pass before removal begins. Record the
suite and test counts as the baseline.

---

## Task 1: Remove the Clerk middleware and demo routes

**Files:**

- Create: `__tests__/auth-removal-boundary.test.js`
- Delete: `__tests__/middleware-routing.test.ts`
- Modify: `__tests__/pages/public-page-cache.test.js`
- Modify: `__tests__/pages/locale-routing.test.js`
- Delete: `middleware.ts`
- Modify: `conf/layout-map.config.js`
- Delete: `pages/sign-in/[[...index]].js`
- Delete: `pages/sign-up/[[...index]].js`
- Delete: `pages/dashboard/[[...index]].js`
- Delete: `pages/api/user.ts`

- [ ] **Step 1: Write the failing core-removal boundary test**

Create `__tests__/auth-removal-boundary.test.js` with explicit product
boundaries:

```js
const fs = require('fs')
const path = require('path')

const root = process.cwd()
const exists = file => fs.existsSync(path.resolve(root, file))
const read = file => fs.readFileSync(path.resolve(root, file), 'utf8')
const clerkPackage = ['@clerk', '/'].join('')

const retiredPaths = [
  'middleware.ts',
  'pages/sign-in',
  'pages/sign-up',
  'pages/dashboard',
  'pages/api/user.ts'
]

describe('auth-free blog architecture', () => {
  test.each(retiredPaths)('%s is retired', file => {
    expect(exists(file)).toBe(false)
  })

  test('real comments and article password auth remain present', () => {
    for (const file of [
      'components/Comment.js',
      'pages/api/notion-comments.js',
      'pages/auth/index.js'
    ]) {
      expect(exists(file)).toBe(true)
      expect(read(file)).not.toContain(clerkPackage)
    }
  })
})
```

- [ ] **Step 2: Run the new test and confirm RED**

Run:

```bash
pnpm test -- __tests__/auth-removal-boundary.test.js --runInBand
```

Expected: FAIL because the middleware and account/demo routes still exist.
Confirm the failure names those real boundaries; do not proceed if it fails for
a test syntax or fixture error.

- [ ] **Step 3: Delete the retired route surface**

Delete the middleware, Clerk pages, and demo user API listed above. Remove the
three retired layout mappings from `conf/layout-map.config.js`, while
preserving `/auth/result: LayoutAuth`.

- [ ] **Step 4: Replace obsolete routing assertions**

- Delete `__tests__/middleware-routing.test.ts`; the new architecture test is
  its replacement and asserts that middleware is absent.
- In `__tests__/pages/public-page-cache.test.js`, remove
  `pages/dashboard/[[...index]].js` from `privatePages` and retain
  `pages/auth/index.js`.
- In `__tests__/pages/locale-routing.test.js`, remove the dashboard entry from
  `PAGES_REQUIRING_SSR`. Keep the three public locale SSR pages unchanged.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run:

```bash
pnpm test -- __tests__/auth-removal-boundary.test.js __tests__/pages/public-page-cache.test.js __tests__/pages/locale-routing.test.js __tests__/lib/plugins/notionComments.test.js --runInBand
```

Expected: all focused suites pass. This proves the obsolete edge middleware and
account routes are gone while comments, article password auth, public cache
wiring, and locale SSR contracts remain. The still-installed Clerk client keeps
this intermediate commit buildable until Task 2 removes all client consumers.

- [ ] **Step 6: Inspect and commit only Task 1**

Run:

```bash
git diff --check
git status --short
git add middleware.ts conf/layout-map.config.js pages/sign-in pages/sign-up pages/dashboard pages/api/user.ts __tests__/auth-removal-boundary.test.js __tests__/middleware-routing.test.ts __tests__/pages/public-page-cache.test.js __tests__/pages/locale-routing.test.js
git diff --cached --check
git diff --cached --name-status
git commit -m "refactor(auth): remove Clerk middleware and demo routes"
```

Expected: `.serena/project.yml` and `AGENTS.md` remain unstaged.

---

## Task 2: Remove the Clerk client, dashboard components, and theme controls

**Files:**

- Create: `__tests__/themes/auth-free-contract.test.js`
- Modify: `pages/_app.js`
- Modify: `lib/global.js`
- Modify: `components/TechGrow.js`
- Delete: `components/ui/dashboard/DashboardBody.js`
- Delete: `components/ui/dashboard/DashboardButton.js`
- Delete: `components/ui/dashboard/DashboardHeader.js`
- Delete: `components/ui/dashboard/DashboardItemAffliate.js`
- Delete: `components/ui/dashboard/DashboardItemBalance.js`
- Delete: `components/ui/dashboard/DashboardItemHome.js`
- Delete: `components/ui/dashboard/DashboardItemMembership.js`
- Delete: `components/ui/dashboard/DashboardItemOrder.js`
- Delete: `components/ui/dashboard/DashboardMenuList.js`
- Delete: `components/ui/dashboard/DashboardSignOutButton.js`
- Delete: `components/ui/dashboard/DashboardUser.js`
- Modify: `themes/starter/index.js`
- Modify: `themes/starter/components/Header.js`
- Modify: `themes/starter/config.js`
- Modify: `themes/proxio/index.js`
- Modify: `themes/proxio/components/Header.js`
- Modify: `themes/gitbook/index.js`
- Modify: `themes/gitbook/components/Header.js`
- Modify: `themes/magzine/index.js`
- Modify: `themes/magzine/components/Header.js`

- [ ] **Step 1: Write the failing theme contract test**

Create `__tests__/themes/auth-free-contract.test.js`:

```js
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const themeFiles = ['starter', 'proxio', 'gitbook', 'magzine'].flatMap(theme => [
  `themes/${theme}/index.js`,
  `themes/${theme}/components/Header.js`
])
const forbidden = [
  ['@clerk', '/'].join(''),
  'LayoutSignIn',
  'LayoutSignUp',
  'LayoutDashboard',
  'DashboardButton',
  'DashboardBody',
  'DashboardHeader'
]

describe('themes do not expose retired account UI', () => {
  test.each(themeFiles)('%s is account-free', file => {
    const source = read(file)
    for (const token of forbidden) {
      expect(source).not.toContain(token)
    }
  })

  test('starter generic CTA defaults do not point to retired routes', () => {
    const config = read('themes/starter/config.js')
    expect(config).not.toContain("'/sign-in'")
    expect(config).not.toContain("'/sign-up'")

    const header = read('themes/starter/components/Header.js')
    expect(header).toContain('STARTER_NAV_BUTTON_1_TEXT')
    expect(header).toContain('STARTER_NAV_BUTTON_1_URL')
    expect(header).toContain('STARTER_NAV_BUTTON_2_TEXT')
    expect(header).toContain('STARTER_NAV_BUTTON_2_URL')
  })

  test('the app shell, global state, and TechGrow are account-free', () => {
    for (const file of ['pages/_app.js', 'lib/global.js']) {
      const source = read(file)
      expect(source).not.toContain(['@clerk', '/'].join(''))
      expect(source).not.toMatch(/ClerkProvider|useUser|isSignedIn/)
    }

    const techGrow = read('components/TechGrow.js')
    expect(techGrow).not.toMatch(/isSignedIn|isLoaded/)
    expect(techGrow).toMatch(/isBrowser\s*&&\s*blogId/)
    expect(techGrow).toMatch(/if\s*\(lock\)/)
  })

  test('demo dashboard components are removed', () => {
    expect(
      fs.existsSync(path.resolve(process.cwd(), 'components/ui/dashboard'))
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run the theme test and confirm RED**

Run:

```bash
pnpm test -- __tests__/themes/auth-free-contract.test.js --runInBand
```

Expected: FAIL on the existing Clerk imports, provider/global state, TechGrow
account exemption, account layouts, dashboard components, and starter defaults.

- [ ] **Step 3: Remove the app-shell provider and global account state**

In `pages/_app.js`:

- Remove `@clerk/localizations` and dynamic Clerk imports.
- Remove `enableClerk`.
- Keep `AppErrorBoundary`, `GlobalContextProvider`, the theme layout, SEO, page
  component, and `ExternalPlugins` in their current order.
- Return `content` directly.
- Retain `next/dynamic` only if another import in the file still needs it;
  otherwise remove that unused import too.

In `lib/global.js`:

- Remove the `useUser` import and environment-key branch.
- Remove `isLoaded`, `isSignedIn`, and `user` from `contextValue` and its
  `useMemo` dependencies.
- Preserve all unrelated global state.

In `components/TechGrow.js`:

- Stop reading `isLoaded` and `isSignedIn` from `useGlobal()`.
- Remove the signed-in-user early return.
- Change the load guard to `isBrowser && blogId`.
- Remove `isLoaded` from effect dependencies.
- Preserve all TechGrow-owned verification and locking rules.

- [ ] **Step 4: Remove dashboard components and account layouts**

Delete the entire `components/ui/dashboard/` directory.

For each theme index:

- Remove Clerk imports.
- Remove dashboard component imports.
- Remove `LayoutSignIn`, `LayoutSignUp`, and `LayoutDashboard` definitions.
- Remove their exports from the theme object.
- Remove imports such as `SignInForm` or `SignUpForm` if they become unused.
- Preserve all public layouts and theme exports.

Files:

```text
themes/starter/index.js
themes/proxio/index.js
themes/gitbook/index.js
themes/magzine/index.js
```

- [ ] **Step 5: Remove account controls from theme headers**

For starter, proxio, gitbook, and magzine headers:

- Remove Clerk and dashboard imports.
- Remove environment-key checks and signed-in/signed-out branches.
- Preserve logo, menus, dark mode, search, responsive navigation, and custom
  navigation.

For `themes/starter/components/Header.js`, keep the two configurable controls as
generic CTAs. Read text and URL once per button and render a button only when
both values are non-empty. Do not label this block as login functionality.

In `themes/starter/config.js`, set the default CTA text and URL values to empty
strings so a fresh configuration does not expose retired links:

```js
STARTER_NAV_BUTTON_1_TEXT: '',
STARTER_NAV_BUTTON_1_URL: '',
STARTER_NAV_BUTTON_2_TEXT: '',
STARTER_NAV_BUTTON_2_URL: '',
```

- [ ] **Step 6: Run the theme test and lint the touched files**

Run:

```bash
pnpm test -- __tests__/themes/auth-free-contract.test.js --runInBand
pnpm exec eslint pages/_app.js lib/global.js components/TechGrow.js themes/starter/index.js themes/starter/components/Header.js themes/starter/config.js themes/proxio/index.js themes/proxio/components/Header.js themes/gitbook/index.js themes/gitbook/components/Header.js themes/magzine/index.js themes/magzine/components/Header.js __tests__/themes/auth-free-contract.test.js
```

Expected: theme contract passes and ESLint reports no unused imports or JSX
errors.

- [ ] **Step 7: Commit the client and theme cleanup**

Run:

```bash
git add pages/_app.js lib/global.js components/TechGrow.js components/ui/dashboard themes/starter themes/proxio themes/gitbook themes/magzine __tests__/themes/auth-free-contract.test.js
git diff --cached --check
git diff --cached --name-status
git commit -m "refactor(auth): remove Clerk client and account UI"
```

Expected: only the four theme families and their new contract test are staged.

---

## Task 3: Remove Clerk packages and environment contracts

**Files:**

- Create: `__tests__/config/auth-dependencies.test.js`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `lib/config/env-validation.js`

- [ ] **Step 1: Write the failing dependency contract test**

Create `__tests__/config/auth-dependencies.test.js`:

```js
const fs = require('fs')
const path = require('path')

const read = file => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const clerk = ['clerk'].join('')

describe('Clerk is not a deployment dependency', () => {
  test.each(['package.json', 'pnpm-lock.yaml'])(
    '%s contains no Clerk package',
    file => {
      expect(read(file).toLowerCase()).not.toContain(clerk)
    }
  )

  test('environment validation does not require Clerk keys', () => {
    const source = read('lib/config/env-validation.js')
    expect(source).not.toMatch(/CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY/)
  })
})
```

- [ ] **Step 2: Run the dependency test and confirm RED**

Run:

```bash
pnpm test -- __tests__/config/auth-dependencies.test.js --runInBand
```

Expected: FAIL because `package.json`, the lockfile, and environment validation
still contain Clerk.

- [ ] **Step 3: Remove dependencies through pnpm**

Run:

```bash
pnpm remove @clerk/nextjs @clerk/localizations
```

Expected: pnpm updates `package.json` and `pnpm-lock.yaml` without changing the
package-manager version or unrelated dependencies.

- [ ] **Step 4: Remove environment validation**

In `lib/config/env-validation.js`, remove only
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` validation entries.
Keep Redis and all unrelated security/service validation.

- [ ] **Step 5: Confirm GREEN and inspect the lockfile result**

Run:

```bash
pnpm test -- __tests__/config/auth-dependencies.test.js --runInBand
rg -n "@clerk|CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY" package.json pnpm-lock.yaml lib/config/env-validation.js || true
pnpm install --frozen-lockfile
```

Expected:

- The test passes.
- `rg` returns no matches.
- Frozen-lockfile install succeeds, proving `package.json` and lockfile agree.

- [ ] **Step 6: Commit dependency removal**

Run:

```bash
git add package.json pnpm-lock.yaml lib/config/env-validation.js __tests__/config/auth-dependencies.test.js
git diff --cached --check
git diff --cached --name-status
git commit -m "chore(deps): remove Clerk packages"
```

---

## Task 4: Retire stale Clerk and dashboard documentation

**Files:**

- Modify: `docs/developer/ARCHITECTURE.md`
- Modify: `docs/developer/ARCHITECTURE.en.md`
- Modify: `docs/user-guide/deploy/build-tuning.md`
- Modify: `docs/user-guide/development/own-theme.md`
- Modify: `docs/user-guide/comments/overview.md`
- Modify: `docs/developer/MEMBERSHIP_COMMENTS_ROADMAP.md`
- Modify: `OPTIMIZATION_SUMMARY.md`

- [ ] **Step 1: Update current architecture documentation**

- Remove the dashboard SSR row from both architecture documents.
- Change the build-tuning exception count from four pages to three and remove
  the retired dashboard path.
- Remove sign-in/sign-up layout examples from the custom-theme guide.
- State in the comments overview that comment identity belongs to the selected
  comment provider; do not recommend the removed site-wide Clerk integration.
- Add a clear historical/retired notice to
  `MEMBERSHIP_COMMENTS_ROADMAP.md`: the bundled Clerk demo was removed on
  2026-07-13 and any future member system requires a new design. Preserve the
  rest as historical proposal context rather than silently rewriting it.
- Remove the outdated Clerk dependency entry from `OPTIMIZATION_SUMMARY.md`.

- [ ] **Step 2: Check current docs without rewriting history**

Run:

```bash
rg -n "pages/dashboard|LayoutSignIn|LayoutSignUp|@clerk/nextjs" docs/developer/ARCHITECTURE.md docs/developer/ARCHITECTURE.en.md docs/user-guide/deploy/build-tuning.md docs/user-guide/development/own-theme.md docs/user-guide/comments/overview.md OPTIMIZATION_SUMMARY.md || true
rg -n "Clerk" docs/user-guide/changelog docs/developer/MEMBERSHIP_COMMENTS_ROADMAP.md
```

Expected:

- Current architecture and guide files have no stale route/layout/dependency
  references.
- Historical changelog entries remain.
- The roadmap contains the new retirement notice and may retain clearly marked
  historical Clerk discussion.

- [ ] **Step 3: Commit documentation separately**

Run:

```bash
git add docs/developer/ARCHITECTURE.md docs/developer/ARCHITECTURE.en.md docs/user-guide/deploy/build-tuning.md docs/user-guide/development/own-theme.md docs/user-guide/comments/overview.md docs/developer/MEMBERSHIP_COMMENTS_ROADMAP.md OPTIMIZATION_SUMMARY.md
git diff --cached --check
git commit -m "docs(auth): retire Clerk integration guidance"
```

---

## Task 5: Run full local and EdgeOne verification

**Files:** No intended source changes. If verification exposes a defect, return
to the relevant task, add a failing regression test, fix it, and commit the fix
before continuing.

- [ ] **Step 1: Prove the source tree is auth-free without scanning history**

Run:

```bash
rg -l --hidden --glob '!node_modules' --glob '!.next' --glob '!.git' --glob '!.env*' --glob '!docs/superpowers/**' --glob '!docs/user-guide/changelog/**' --glob '!docs/developer/MEMBERSHIP_COMMENTS_ROADMAP.md' "@clerk|CLERK_SECRET_KEY|CLERK_PUBLISHABLE_KEY|LayoutSignIn|LayoutSignUp|LayoutDashboard|DashboardButton" . || true
test ! -e middleware.ts
test ! -d pages/sign-in
test ! -d pages/sign-up
test ! -d pages/dashboard
test ! -d components/ui/dashboard
```

Expected: `rg` prints no current-code/config matches and all `test` commands
exit 0.

- [ ] **Step 2: Run focused regression suites**

Run:

```bash
pnpm test -- __tests__/auth-removal-boundary.test.js __tests__/themes/auth-free-contract.test.js __tests__/config/auth-dependencies.test.js __tests__/pages/public-page-cache.test.js __tests__/pages/locale-routing.test.js __tests__/lib/plugins/notionComments.test.js --runInBand
```

Expected: all focused suites pass.

- [ ] **Step 3: Run the complete quality gate**

Run each command separately:

```bash
pnpm lint
pnpm type-check
pnpm exec jest --runInBand
pnpm build
```

Expected:

- Lint exits 0.
- Type checking exits 0.
- All Jest suites and tests pass.
- Production build exits 0 and lists no sign-in, sign-up, dashboard, or
  `/api/user` route.

- [ ] **Step 4: Assert that Next.js emitted no middleware manifest entry**

After `pnpm build`, run:

```bash
node - <<'NODE'
const fs = require('fs')
const file = '.next/server/middleware-manifest.json'
const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
const entries = Object.keys(manifest.middleware || {})
if (entries.length) {
  throw new Error(`Unexpected middleware entries: ${entries.join(', ')}`)
}
console.log('middleware entries: 0')
NODE
```

Expected: `middleware entries: 0`.

- [ ] **Step 5: Run the EdgeOne Makers local adapter check**

Start the local adapter in a terminal:

```bash
/home/morav/.local/share/bin/edgeone makers dev --port 8788 --debug --skip-env-sync
```

After it reports readiness, run in another terminal:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/
asset=$(curl -sS http://127.0.0.1:8788/ | grep -oE '/_next/static/[^" ]+\.js' | head -1)
test -n "$asset"
for i in $(seq 1 10); do
  curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:8788$asset"
done
```

Expected: home and ten asset requests return 200 after initial local
compilation. Stop the dev process with Ctrl-C.

If `.edgeone/edge-functions/config.json` exists, inspect it:

```bash
node - <<'NODE'
const fs = require('fs')
const file = '.edgeone/edge-functions/config.json'
if (!fs.existsSync(file)) {
  console.log('EdgeOne config not emitted by this CLI version')
  process.exit(0)
}
const config = JSON.parse(fs.readFileSync(file, 'utf8'))
if (config.middleware) {
  throw new Error(`Unexpected EdgeOne middleware: ${JSON.stringify(config.middleware)}`)
}
console.log('EdgeOne middleware: absent')
NODE
```

Expected: the generated adapter configuration has no global middleware.

- [ ] **Step 6: Verify scope and commit integrity**

Run:

```bash
git status --short
git diff main...HEAD --check
git diff main...HEAD --stat
git log --oneline main..HEAD
```

Expected:

- `.serena/project.yml` and `AGENTS.md` remain the only unrelated working-tree
  modifications.
- Branch commits contain only the approved removal, tests, dependencies, and
  documentation.
- No uncommitted task file remains.

---

## Task 6: Integration and automatic deployment gate

Merging and pushing change remote state and trigger an automatic EdgeOne
deployment. Perform this task only after local verification passes and the user
authorizes integration for this implementation.

- [ ] **Step 1: Merge the verified branch into local main**

Run:

```bash
git switch main
git merge --no-ff codex/remove-clerk-edgeone-middleware
```

Expected: merge succeeds without touching the two unrelated working-tree files.

- [ ] **Step 2: Re-run a proportionate post-merge gate**

Run:

```bash
pnpm test -- __tests__/auth-removal-boundary.test.js __tests__/themes/auth-free-contract.test.js __tests__/config/auth-dependencies.test.js __tests__/lib/plugins/notionComments.test.js --runInBand
pnpm type-check
```

Expected: all tests pass and type checking exits 0.

- [ ] **Step 3: Push main only after authorization**

Run:

```bash
git push origin main
```

Expected: push succeeds and EdgeOne starts its automatic deployment.

Do not delete the feature branch until production verification is complete.

---

## Task 7: Verify the deployed A/B result

**External state:** Read-only production probing is authorized as verification.
Submitting a test comment is an external write and requires explicit user
approval; loading existing comments does not.

- [ ] **Step 1: Confirm the new deployment is live**

Check EdgeOne deployment status or identify a changed build ID from the
homepage. Do not begin the probe against the previous build.

- [ ] **Step 2: Probe cache-busting homepage requests**

Run:

```bash
rm -f /tmp/one2agi-home-probe.tsv
for i in $(seq 1 60); do
  url="https://www.one2agi.com/?edgeone_ab=$(date +%s%N)-$i"
  result=$(curl -sS -D "/tmp/one2agi-home-$i.headers" -o /dev/null \
    -w '%{http_code}\t%{time_total}' "$url")
  printf '%s\t%b\n' "$i" "$result" | tee -a /tmp/one2agi-home-probe.tsv
  if [[ "$result" == 545$'\t'* ]]; then
    rg -i 'x-nws-log-uuid' "/tmp/one2agi-home-$i.headers" || true
  fi
done
cut -f2 /tmp/one2agi-home-probe.tsv | sort | uniq -c
```

Expected: 60 HTTP 200 responses and zero 545 responses. If any 545 appears,
immediately repeat that request with response headers preserved and record
`x-nws-log-uuid`.

- [ ] **Step 3: Probe one immutable static asset**

Discover a hashed JavaScript asset from the deployed homepage and request it at
least 60 times:

```bash
asset=$(curl -sS https://www.one2agi.com/ | grep -oE '/_next/static/[^" ]+\.js' | head -1)
test -n "$asset"
for i in $(seq 1 60); do
  curl -sS -o /dev/null -w '%{http_code}\t%{time_total}\n' \
    "https://www.one2agi.com$asset"
done | tee /tmp/one2agi-asset-probe.tsv
cut -f1 /tmp/one2agi-asset-probe.tsv | sort | uniq -c
```

Expected: 60 HTTP 200 responses and zero 545 responses.

- [ ] **Step 4: Probe Next data and real product flows**

- Open the homepage, a tag page, and a known article through client-side
  navigation; verify no `Loading initial props cancelled` error appears.
- Inspect the corresponding `/_next/data/{buildId}/...json` requests and repeat
  representative URLs at least 20 times each.
- Load an article's configured comment provider and existing comments.
- Verify a Notion inline `@page` link.
- Open and navigate the knowledge graph.
- Confirm Live2D errors separately; they are not evidence of server 545.

Expected: navigation and real blog features work, comments load without Clerk,
and all data requests return 200.

- [ ] **Step 5: Decide based on evidence**

If every functional check passes and all probe rounds contain zero 545:

- Report that removal has passed the observed A/B test.
- Continue monitoring; describe the result as measured mitigation, not a proof
  that EdgeOne can never return 545.
- Delete the local feature branch when the user agrees the deployment is stable.

If any 545 remains:

- Preserve status counts, timing, URL class, headers, and `x-nws-log-uuid`.
- Report that Clerk middleware removal did not eliminate the platform error.
- Escalate to EdgeOne with the captured request identifiers and the evidence
  that `.next` and EdgeOne adapter outputs contain no global middleware.
- Do not restore Clerk or break comments as a speculative response.

## Final Acceptance Checklist

- [ ] Root `middleware.ts` is absent.
- [ ] Clerk packages, imports, providers, environment contracts, and account UI
      are absent from current source and configuration.
- [ ] Sign-in, sign-up, dashboard, and demo user API routes are absent.
- [ ] Starter generic CTAs remain configurable but have no login defaults.
- [ ] Article password auth remains.
- [ ] Comments remain provider-owned and focused comment tests pass.
- [ ] Notion page links, knowledge graph, SSR cache policy, and locale SSR
      behavior are unchanged.
- [ ] All four modified themes compile.
- [ ] Lint, type checking, full tests, production build, and EdgeOne local smoke
      check pass.
- [ ] Git scope excludes `.serena/project.yml` and `AGENTS.md`.
- [ ] Production probing is completed before declaring the 545 mitigation
      successful.
