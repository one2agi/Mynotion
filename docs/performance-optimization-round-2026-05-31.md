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
- Bumped package version to `4.9.5.9`.
