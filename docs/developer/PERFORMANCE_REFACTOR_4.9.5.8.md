# Performance Refactor 4.9.5.8

This release focuses on restoring rendering performance after the project grew from a single-theme site into a multi-theme runtime.

## Goals

- Keep all existing themes and plugin configuration behavior intact.
- Reduce first-load JavaScript and unnecessary hydration work.
- Reduce static page data sent to the browser.
- Keep visual output stable while moving non-critical work out of the critical render path.

## What Changed

### Runtime loading

- Clerk runtime code now loads only when Clerk authentication is enabled.
- The global user bridge is isolated from the default global provider path.
- Theme modules are loaded through explicit dynamic import loaders, so the active theme path stays lazy.
- Waline recent comments now load `@waline/client` only when a recent-comment component needs it.

### Third-party plugins

- Custom CSS, custom JS, external scripts, external styles, AOS initialization, and webfont loading are delayed with idle scheduling.
- Global JavaScript evaluation is skipped when the configured script is empty.
- The theme switcher no longer renders all theme preview assets before the drawer is opened.

### Page data size

- `latestPosts`, `prev`, `next`, and `recommendPosts` are trimmed to client-facing summary fields.
- Article `blockMap` payloads drop Notion audit metadata, permission fields, empty user maps, and unused collection/view records.
- Notice payloads are pruned to the reachable notice page blocks instead of carrying unrelated site database records.
- Homepage and article static JSON are now below Next.js large page data warning thresholds in the sample build.

### LCP and images

- Endspace marks the first visible post card image as eager/high-priority.
- Endspace preloads the first post cover and preconnects to the image host when applicable.
- Non-priority Endspace post cards keep lazy async image loading.

### Guardrails

- Added `npm run perf:budget`.
- The budget script writes `.perf/bundle-budget.json` and checks key chunk categories without failing local development by default.

## Measured Results

Using the current sample build:

- Homepage data `zh-CN.json`: about `315KB` before, about `36KB` after.
- Largest sample article data `article/example-1.json`: about `164KB` before, about `113KB` after.
- `next build` no longer reports large page data warnings for these routes.
- Shared first-load JavaScript remains within the configured budget.

## Validation

The performance refactor was validated with:

- `npm.cmd run build`
- `npm.cmd run lint`
- `npm.cmd run type-check`
- `npm.cmd test -- --runInBand --runTestsByPath __tests__\components\NotionLink.test.js __tests__\components\LazyImage.test.js`
- `npm.cmd run perf:budget`
- Browser smoke test for `http://localhost:3000/article/guide?theme=nav`

## Release

Version: `4.9.5.8`
