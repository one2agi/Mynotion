# Performance Optimization Round 2026-05-31

- Branch: `codex/performance-optimization`
- Scope: reduce first render and main-thread blocking while keeping existing themes/plugins/config compatibility.
- User-facing behavior: no functional changes in plugin/config capabilities.

## Completed changes
- Delayed Clerk provider runtime loading in `_app.js` (client-only dynamic import) to remove Clerk runtime from SSR/initial render.
- Moved callout image adjustment side-effect in `hooks/useAdjustStyle.js` to `requestIdleCallback`-style scheduling.
- In `components/ExternalPlugins.js`:
  - Added idle-ready gate state.
  - Plugin block mount is deferred until browser idle (`runWhenIdle` ~900ms), while `THEME_SWITCH` remains renderable immediately.
  - Preserved all existing plugin rendering conditions and dynamic imports.
- Kept existing plugin list/config checks unchanged.

## Validation
- `yarn eslint components/ExternalPlugins.js hooks/useAdjustStyle.js pages/_app.js`
- `yarn type-check`
- `yarn build`
- `yarn perf:budget`
- `npm.cmd test -- --runInBand --runTestsByPath __tests__/components/NotionLink.test.js __tests__/components/LazyImage.test.js`

## Version
- Bumped package version to `4.9.5.10`.

## Acceptance snapshot (2026-05-31, 19:00)
- `node scripts/perf-baseline.js --mode=compare`
- Build time: `66.405s` (vs previous: `-2001 ms`)
- Static assets: `4.86 MB` (vs previous: `0 B`)
- Server assets: `12.36 MB` (vs previous: `-23,930 B`)

## Acceptance snapshot (2026-05-31, 19:10)
- `node scripts/perf-baseline.js --mode=compare`
- Build time: `57.57s` (vs previous: `-8.835 s`)
- Static assets: `4.86 MB` (vs previous: `+67 B`)
- Server assets: `12.38 MB` (vs previous: `+23.38 KB`)

## Changes in this round (2026-05-31, 19:20)
- `scripts/audit-theme-performance.js`
  - Use platform-safe Lighthouse entry on Windows (`lighthouse.cmd`) with `shell` mode.
  - Catch and continue on per-theme failures; audit results now include explicit failure rows instead of hard stop.
  - Extend generated markdown with optional error column for failed themes.
- `components/GoogleAdsense.js`
  - Migrate `setTimeout`-based ad initialization and embed replacement to idle scheduling (`runWhenIdle`) to reduce main-thread contention during initial load.
  - Keep runtime behavior and ad IDs intact (no config/feature change).

## Validation
- `cmd /c yarn eslint scripts\\audit-theme-performance.js components\\GoogleAdsense.js`
- `cmd /c yarn perf:audit:themes`
- `cmd /c yarn perf:compare`

## Acceptance snapshot (2026-05-31, 19:20)
- `node scripts/perf-baseline.js --mode=compare`
- Build time: `70.03s` (vs previous: `+12.462 s`)
- Static assets: `4.86 MB` (vs previous: `+9 B`)
- Server assets: `12.35 MB` (vs previous: `-35.97 KB`)

## Theme audit snapshot (2026-05-31, 19:20)
- `yarn perf:audit:themes` completed with 10 themes passing and 10 failures in this environment.
- Top performant themes currently show `nav` around `80` and `commerce/heo/other` around `95+` with total JS payload around `169KB` in the generated reports.
- Failed themes are tracked in `docs/performance/theme-audit-latest.md` for incremental triage.
