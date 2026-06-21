# Project Structure

[中文](./PROJECT_STRUCTURE.md)

## Top-level directories (common)

- `pages/`: Next.js route entry (`getStaticProps/getStaticPaths`). The 4 top-level pages under locale routes (`index.js` / `archive/index.js` / `page/[page].js` / `dashboard/[[...index]].js`) use `getServerSideProps` instead — see [ARCHITECTURE.en.md](./ARCHITECTURE.en.md#locale-json-data-endpoints)
- `themes/`: Theme implementations (UI + theme config)
- `components/`: Cross-theme reusable components
- `lib/`: Core logic (data, cache, utilities, config read)
- `conf/`: Split config files aggregated by `blog.config.js`
- `__tests__/`: Unit tests
- `scripts/`: Engineering scripts
- `.github/`: Issue/PR templates and collaboration metadata

## Key files

- `blog.config.js`: aggregated config entry
- `lib/config.js`: `siteConfig()` read logic (with priority)
- `lib/db/SiteDataApi.js`: core site-data assembly
- `CONTRIBUTING.md`: external contribution entry
- `docs/README.md`: docs navigation (zh)
- `docs/README.en.md`: docs navigation (en)

## Change suggestions

- **Global rules**: prefer `lib/db/` or `lib/utils/`
- **Theme visuals**: prefer `themes/<theme>/`
- **New config keys**: add in `conf/*.config.js`, aggregate from `blog.config.js`
- **Avoid copying same business logic across many `pages/*`**
