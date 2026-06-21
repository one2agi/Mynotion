# Architecture Overview

[中文](./ARCHITECTURE.md)

## Core flow

NotionNext main flow can be simplified as:

1. **Data access layer** (`lib/db/`)  
   Fetches Notion data, normalizes structure, maps fields, handles cache and dedup.
2. **Server data assembly** (`lib/db/SiteDataApi.js`)  
   Produces `allPages`, `tagOptions`, `categoryOptions`, `siteInfo`, etc.
3. **Routing layer** (`pages/`)  
   Handles route-level filtering, pagination, and render preparation.
   Exception: 4 pages under locale routes use `getServerSideProps` (see "Locale JSON data endpoints" below).
4. **Theme layer** (`themes/`)  
   Themes consume the same props contract and render different UI.

### Locale JSON data endpoints

`next.config.js` uses rewrites (not Next.js native i18n) to strip the locale prefix:

```js
{ source: '/:locale(zh|en)/:path*', destination: '/:path*' }
```

HTML routes work (rewrites apply at request time). But Next.js only generates `/_next/data/{buildId}/*.json` files at build time for **actual page file paths** — not for rewritten source paths. The client router prefetching `/_next/data/{buildId}/zh-CN/archive.json` finds no file, returns 404, and falls back to a full page reload — losing SPA navigation.

**Trade-off**: the 4 top-level pages under locale routes use `getServerSideProps` (SSR at request time), skipping the pre-built JSON file lookup. Multi-segment pages (`[prefix]/[slug]`, `category/[slug]`, `tag/[slug]`, `search/[keyword]`) keep `getStaticProps`, since their rewritten multi-segment paths still match the generated data files.

Affected pages (commits `5d81d8fb` / `573c577e` / `33d1b338` / `5e705434`):

| Page | Before | After |
| --- | --- | --- |
| `pages/index.js` | `getStaticProps` | `getServerSideProps` |
| `pages/archive/index.js` | `getStaticProps` | `getServerSideProps` |
| `pages/page/[page].js` | `getStaticProps` + `getStaticPaths` | `getServerSideProps` |
| `pages/dashboard/[[...index]].js` | `getStaticProps` + `getStaticPaths` | `getServerSideProps` |

Regression guard: `__tests__/pages/locale-routing.test.js` structurally asserts the 4 pages above must export `getServerSideProps` and must not export `getStaticProps`.

## Config priority

Priority (high -> low):

1. Notion Config page key
2. Environment variable
3. Local config (`blog.config.js` + `conf/*.config.js`)

## Why “move rules to data layer”

If a sorting/filtering rule is global business logic, place it in data layer instead of duplicating it in route files.

Benefits:

- Smaller change surface
- Lower risk of missing routes
- Consistent behavior across themes

## Cache & build

- Cache modules: `lib/cache/`
- Build prefetch/concurrency: `lib/build/`
- Changes here can impact CI speed and deployment stability; include validation notes.

