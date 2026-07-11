# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

NotionNext is a static blog system built on **Next.js** that uses **Notion as a CMS**. Content is fetched from Notion via `notion-client` / `react-notion-x` and rendered as a static site (or SSR on Vercel). The site supports 30+ swappable themes, multi-language, and various comment/analytics plugins.

Node.js >=20 <25 required (active deployment uses **Node 22** via `edgeone.json`). Package manager is **pnpm 9.15.0** (enforced via `packageManager` field — do not use npm/yarn).

## Key Commands

```bash
# Development
pnpm dev              # Start Next.js dev server (localhost:3000)
pnpm build           # Production build (sets BUILD_MODE=true)
pnpm export          # Static export (sets BUILD_MODE=true EXPORT=true)

# Code quality
pnpm lint            # ESLint check
pnpm lint:fix       # Auto-fix ESLint issues
pnpm type-check     # TypeScript type check (no output)
pnpm format         # Prettier format all files
pnpm quality        # Aggregated quality check script

# Pre-commit (runs automatically via git hook)
pnpm pre-commit     # lint:fix → format → type-check

# Testing
pnpm test            # Run Jest tests
pnpm test -- path/to/file  # Run a single test file
pnpm test:watch      # Watch mode
pnpm test:coverage   # With coverage report
pnpm test:ci         # CI mode (no watch, with coverage)

# Performance
pnpm perf:audit:themes   # Audit all themes' Lighthouse scores → docs/performance/
pnpm perf:lighthouse     # Run Lighthouse CI

# Utilities
pnpm dev-tools           # List all dev-tools commands
pnpm dev-tools clean     # Clean caches and build artifacts
pnpm setup-hooks         # Install git hooks
```

## High-Level Architecture

### Configuration

All site config lives in `blog.config.js` (root) and the `/conf/` directory. `blog.config.js` is the single entry point that spreads in modular configs from `/conf/`:
- `conf/comment.config` — comment plugins (Twikoo, Giscus, Utterances, etc.)
- `conf/contact.config` — author contact info
- `conf/post.config` — post list behavior
- `conf/analytics.config` — analytics providers
- `conf/image.config`, `font.config`, `code.config`, `animation.config` — site aesthetics
- `conf/layout-map.config` — custom route → layout mappings
- `conf/notion.config` — Notion database extensions
- `conf/ai.config` — AI features (summaries, chatbots)
- `conf/performance.config` — performance toggles

Environment variables follow `NEXT_PUBLIC_*` naming convention for client-exposed values. `process.env.NOTION_PAGE_ID` is the only critical required env var.

### Theme System

Themes live in `/themes/<theme-name>/`. Each theme is a self-contained module (components, styles, page layouts). The active theme is set via `NEXT_PUBLIC_THEME` in `blog.config.js`. Themes can define custom page layouts via `conf/layout-map.config`.

To add a new theme: create a folder under `/themes/`, then reference it by folder name in `blog.config.js`. See `docs/developer/THEME_MIGRATION_GUIDE.md` for the full theme contract.

### Data Flow

1. Notion API (`notion-client`) fetches blocks/pages from a Notion database
2. `react-notion-x` renders Notion block tree to React components
3. `lib/build/` contains server-side build helpers (env, page generation, ISR revalidation)
4. `lib/cache/` holds caching utilities (Redis via `ioredis`, memory-cache)
5. `lib/plugins/` — notion-x extensions and middleware

### Pages (File-System Routing)

- `/pages/index.js` — home page
- `/pages/[prefix]/[slug]` — post page (with optional locale prefix)
- `/pages/archive.js`, `/pages/category/[slug].js`, `/pages/tag/[slug].js` — listing pages
- `/pages/api/` — API routes (revalidation, etc.)
- `/pages/sitemap.xml.js` — sitemap generation

### Multi-Language

Multiple languages are configured via `NOTION_PAGE_ID` with `lang:pageId` syntax (e.g., `zh:xxx,en:yyy`). The `lib/lang.js` maps locale prefixes to label strings. Locale detection happens in `lib/utils/pageId.js` and is applied in `next.config.js` to produce per-locale static paths.

### Build Modes

Three modes controlled by env vars:
- **Dev** (`pnpm dev`): standard Next.js dev, no export
- **SSR/ISR** (`pnpm build`): `BUILD_MODE=true`, pages use ISR with `NEXT_REVALIDATE_SECOND`
- **Static** (`pnpm export`): `BUILD_MODE=true EXPORT=true`, full static HTML export (used for Docker/self-hosted)

### Middleware

`middleware.ts` at root handles locale prefix stripping and redirects.

## File Organization Notes

- `/components/` — Shared React components (many are feature-flagged via `blog.config.js`)
- `/lib/config.js` — Internal config utilities (not user-facing)
- `/lib/server/` — Server-only code (DB, auth, server utilities)
- `/types/` — TypeScript type definitions
- `/hooks/` — Custom React hooks
- `/styles/` — Global CSS (Tailwind + custom)
- `/public/` — Static assets served as `/<filename>`
- `/docs/` — Bilingual developer/user docs
- `/scripts/` — Build scripts, dev-tools, quality checks
- `/__tests__/` — Jest test files (co-located or in `tests/` subdirectory)

## Conventional Commits

All commits must follow `<type>(<scope>): <description>` format. Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`.

## Performance Requirements for New Themes

New or significantly modified themes must pass `pnpm perf:audit:themes` before merge, targeting: Performance >= 60, SEO >= 90, LCP <= 4000ms, CLS <= 0.1. Results are written to `docs/performance/theme-audit-latest.md` and `.json`.

## External API Integration — Testing Discipline

**背景**：2026-06-21 同日连续发生两个生产事故（queryOrder 字段名 + notify GET/POST），
都是因为"测试想象"与"外部 API 真实行为"不一致。两次都通过 41+ 个单元测试
但生产订单永久丢失。

### 强制规则（External API 集成时必读）

1. **真实 fixture 优先于 mock**
   - 写测试前先 curl 真实 API（或 sandbox）抓响应
   - 把真实响应作为 test fixture（不是"想象 API 应该返回什么"）
   - 反例：mock 用 `{tradeStatus: 'TRADE_SUCCESS'}` 当 Z-Pay 实际返回 `{status: 0}`

2. **HTTP 行为必须实测，不能凭直觉**
   - 调一次真实 API 看 GET 还是 POST、headers、body 格式
   - 文档没明说 ≠ "应该用主流方式"
   - 反例：Z-Pay notify 实际用 GET，但代码凭"支付都用 POST"写了只接受 POST

3. **测试第一次跑就 pass = 没在测对的东西**
   - 必须先看到 RED（测试失败）才写实现
   - 第一次跑就过 → 大概率 mock 在测自己
   - 修复后跑测试必须看到原 RED 测试从 fail 变 pass

4. **覆盖率 ≠ 正确性**
   - 100% 覆盖的代码可以是 100% 错误
   - 至少 1 个测试用真实 API 响应作为 fixture
   - 所有 mock 跟真实响应对比一次（在 PR review 时）

5. **审查 PR 必须查外部 API 文档**
   - 看到 mock → 问"这是真实响应还是想象？"
   - 看到字段名 → 查官方文档确认（不要类比推断）
   - 看到 method 限制 → 实测一次确认

6. **部署后做真实冒烟测试**
   - HTTP 200 + 错误 status = 看起来正常，实际是 bug
   - 必须真实下单 → 真实付款 → 查后端真有记录
   - 不能只看 HTTP 200

### 适用场景

- 支付（Z-Pay、微信、支付宝、Stripe、PayPal）
- 短信、邮件、地图、翻译、AI
- 任何"代码消费外部 API"的功能
- **新接任何外部 API = 默认走这个流程**

### 真实案例

- `lib/payment-mock-vs-reality-lesson.md`（triggers via memory）
- `lib/payment-notify-method-mismatch.md`
- Z-Pay queryOrder 字段名 bug、notify GET/POST bug

### 7 句警句（用于团队对齐）

1. "测试通过"只能证明"代码做了测试期望它做的事"。期望本身对不对，需要第二个独立来源验证。
2. 没有"外部真理源"的测试 = 自我实现的预言。
3. 覆盖率衡量"代码被运行过多少次"，不衡量"代码与外部系统契约是否正确"。
4. 测试第一次跑就 pass = 没在测对的东西。TDD 核心价值是"看 fail → 知道在测什么"。
5. HTTP 200 + 错误 status = 看起来正常，实际是 bug。
6. "看起来对"≠"对"。审查 PR 时必须查文档，不能凭直觉。
7. 内部自洽 ≠ 外部正确。N 个测试彼此一致 = 它们有共同的错误，不是它们都对。
