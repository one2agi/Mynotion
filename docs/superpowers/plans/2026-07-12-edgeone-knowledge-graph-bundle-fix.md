# EdgeOne Knowledge Graph Bundle Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make the knowledge graph Cloud Function bundle successfully with EdgeOne while preserving database Relation links and inline @page links.

**Architecture:** Replace the Cloud Function dependency on the full SiteDataApi with a dedicated server-only Notion source that returns only graph metadata and raw Relation properties. Keep full block fetching for changed pages, but move its generic helpers behind a JSX-free server utility module so the complete function dependency graph is safe for EdgeOne's .js loader.

**Tech Stack:** Next.js 14, TypeScript, Jest 29, esbuild 0.25, notion-client, notion-utils, EdgeOne Makers Cloud Functions, EdgeOne Pages Blob.

## Global Constraints

- Preserve Relation properties and inline @page mentions as indistinguishable undirected edges.
- Publish only configured Post and Published pages.
- Preserve multi-language fail-closed refresh and prior-graph fallback behavior.
- Do not make React, themes, lib/global.js, lib/utils/index.js, or SiteDataApi reachable from the Cloud Function bundle.
- Keep the 10-minute minimum refresh interval, Blob keys, and frontend behavior unchanged.
- Use Node 22 and pnpm 9.15.0.
- Capture and sanitize a real Notion database record-map shape before finalizing the source fixture.

---

## File Map

- Create lib/utils/serverRuntime.js for JSX-free deepClone and delay helpers.
- Modify lib/utils/index.js to re-export those helpers for existing callers.
- Modify lib/db/notion/getPostBlocks.js to import server helpers directly.
- Create lib/knowledge-graph/notionSource.ts for minimal database metadata parsing.
- Modify cloud-functions/api/knowledge-graph.ts to use the dedicated source.
- Create __tests__/cloud-functions/knowledge-graph-bundle.test.ts for the EdgeOne loader boundary.
- Create __tests__/lib/utils/serverRuntime.test.js.
- Create __tests__/lib/knowledge-graph/notionSource.test.ts.
- Create __tests__/fixtures/notion/knowledge-graph-database.json from a sanitized real response.
- Modify __tests__/cloud-functions/knowledge-graph.test.ts for the new integration.

---

### Task 1: Reproduce the EdgeOne Bundle Failure

**Files:**
- Create: __tests__/cloud-functions/knowledge-graph-bundle.test.ts

**Interfaces:**
- Consumes: cloud-functions/api/knowledge-graph.ts.
- Produces: a regression test that uses esbuild's default .js loader.

- [ ] **Step 1: Write the failing bundle test**

~~~ts
/** @jest-environment node */

import path from 'node:path'
import { build } from 'esbuild'

test('bundles the knowledge graph Cloud Function with EdgeOne-compatible loaders', async () => {
  await expect(
    build({
      absWorkingDir: process.cwd(),
      bundle: true,
      entryPoints: [
        path.join(process.cwd(), 'cloud-functions/api/knowledge-graph.ts')
      ],
      external: ['@edgeone/pages-blob'],
      format: 'esm',
      logLevel: 'silent',
      platform: 'node',
      target: 'node22',
      tsconfig: path.join(process.cwd(), 'tsconfig.json'),
      write: false
    })
  ).resolves.toBeDefined()
})
~~~

- [ ] **Step 2: Run RED**

Run:

~~~bash
pnpm test -- __tests__/cloud-functions/knowledge-graph-bundle.test.ts --runInBand
~~~

Expected: FAIL with The JSX syntax extension is not currently enabled and at least one known frontend .js file.

- [ ] **Step 3: Reproduce with the esbuild CLI**

~~~bash
pnpm exec esbuild cloud-functions/api/knowledge-graph.ts \
  --bundle --platform=node --format=esm --target=node22 \
  --external:@edgeone/pages-blob --log-level=verbose \
  --outfile=/tmp/notionnext-knowledge-graph-before.mjs
~~~

Expected: non-zero exit with the same JSX loader class of failure. Record only module paths, never Notion content or environment values.

- [ ] **Step 4: Commit the RED test**

~~~bash
git add __tests__/cloud-functions/knowledge-graph-bundle.test.ts
git commit -m "test(graph): reproduce EdgeOne function bundle failure"
~~~

---

### Task 2: Isolate Generic Server Runtime Helpers

**Files:**
- Create: lib/utils/serverRuntime.js
- Modify: lib/utils/index.js:275-301
- Modify: lib/db/notion/getPostBlocks.js:1-8
- Create: __tests__/lib/utils/serverRuntime.test.js

**Interfaces:**
- Produces: deepClone(value) and delay(ms) from lib/utils/serverRuntime.js.
- Preserves: the same exports from lib/utils/index.js.
- Changes: getPostBlocks.js imports both helpers directly from serverRuntime.js.

- [ ] **Step 1: Write failing helper tests**

~~~js
import { deepClone, delay } from '@/lib/utils/serverRuntime'

test('deepClone copies nested values and serializes Date values', () => {
  const source = { nested: [{ editedAt: new Date('2026-07-12T00:00:00Z') }] }
  const result = deepClone(source)

  expect(result).toEqual({
    nested: [{ editedAt: '2026-07-12T00:00:00.000Z' }]
  })
  expect(result).not.toBe(source)
  expect(result.nested).not.toBe(source.nested)
})

test('delay resolves after the requested timer fires', async () => {
  jest.useFakeTimers()
  const task = delay(25)
  jest.advanceTimersByTime(25)
  await expect(task).resolves.toBeUndefined()
  jest.useRealTimers()
})
~~~

- [ ] **Step 2: Run RED**

~~~bash
pnpm test -- __tests__/lib/utils/serverRuntime.test.js --runInBand
~~~

Expected: FAIL because the serverRuntime module does not exist.

- [ ] **Step 3: Add the server-only helper module**

~~~js
export function deepClone(value) {
  if (Array.isArray(value)) return value.map(item => deepClone(item))
  if (!value || typeof value !== 'object') return value

  const clone = {}
  for (const key of Object.keys(value)) {
    const item = value[key]
    clone[key] =
      item instanceof Date ? item.toISOString() : deepClone(item)
  }
  return clone
}

export const delay = ms =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })
~~~

- [ ] **Step 4: Preserve old imports and update the server caller**

Remove the old helper bodies from lib/utils/index.js and add:

~~~js
export { deepClone, delay } from './serverRuntime'
~~~

Change getPostBlocks.js to:

~~~js
import { deepClone, delay } from '../../utils/serverRuntime'
~~~

- [ ] **Step 5: Run GREEN**

~~~bash
pnpm test --   __tests__/lib/utils/serverRuntime.test.js   __tests__/lib/notion-data-format.test.js   --runInBand
~~~

Expected: both suites PASS.

- [ ] **Step 6: Confirm the remaining RED is narrower**

~~~bash
pnpm test -- __tests__/cloud-functions/knowledge-graph-bundle.test.ts --runInBand
~~~

Expected: still FAIL because SiteDataApi remains reachable, but getPostBlocks.js no longer reaches lib/utils/index.js.

- [ ] **Step 7: Commit**

~~~bash
git add lib/utils/serverRuntime.js lib/utils/index.js   lib/db/notion/getPostBlocks.js __tests__/lib/utils/serverRuntime.test.js
git commit -m "refactor(server): isolate JSX-free runtime helpers"
~~~

---

### Task 3: Build the Minimal Notion Graph Source

**Files:**
- Create: lib/knowledge-graph/notionSource.ts
- Create: __tests__/lib/knowledge-graph/notionSource.test.ts
- Create: __tests__/fixtures/notion/knowledge-graph-database.json

**Interfaces:**

~~~ts
export type KnowledgeGraphPropertyNames = {
  title: string
  slug: string
  type: string
  status: string
}

export type KnowledgeGraphSourceOptions = {
  pageId: string
  locale?: string
  postUrlPrefix: string
  propertyNames: KnowledgeGraphPropertyNames
  fetchDatabase(id: string, from: string): Promise<NotionRecordMap | null>
  fetchPageValues(ids: string[]): Promise<Record<string, unknown>>
}

export async function fetchKnowledgeGraphSiteData(
  options: KnowledgeGraphSourceOptions
): Promise<{ allPages: GraphSourcePage[]; schema: NotionSchema }>
~~~

- [ ] **Step 1: Capture a real fixture before writing parser expectations**

Run the current production Notion path:

~~~bash
pnpm build
~~~

Retain one database root block, its collection/schema, selected collection query/view, and two page blocks including the real 相关引用 Relation shape. Replace page IDs, titles, slugs, space/user IDs, URLs, and timestamps with deterministic values. Do not invent nesting absent from the response. Save it to __tests__/fixtures/notion/knowledge-graph-database.json.

- [ ] **Step 2: Write failing source tests**

~~~ts
import fixture from '@/__tests__/fixtures/notion/knowledge-graph-database.json'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'

const propertyNames = {
  title: 'title',
  slug: 'slug',
  type: 'type',
  status: 'status'
}

test('maps article metadata and preserves raw Relation values', async () => {
  const result = await fetchKnowledgeGraphSiteData({
    pageId: fixture.databaseId,
    locale: 'zh-CN',
    postUrlPrefix: 'article',
    propertyNames,
    fetchDatabase: async () => fixture.recordMap,
    fetchPageValues: async () => fixture.missingPageValues
  })

  expect(result.schema.related).toEqual({
    name: '相关引用',
    type: 'relation'
  })
  expect(result.allPages).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: fixture.expected.sourceId,
        title: fixture.expected.title,
        slug: fixture.expected.slug,
        href: '/zh-CN/article/' + fixture.expected.slug,
        type: 'Post',
        status: 'Published',
        properties: expect.objectContaining({
          related: fixture.expected.relationValue
        })
      })
    ])
  )
})

test('fails when the configured page is not a database', async () => {
  await expect(
    fetchKnowledgeGraphSiteData({
      pageId: '00000000000000000000000000000099',
      postUrlPrefix: 'article',
      propertyNames,
      fetchDatabase: async () => ({ block: {} }),
      fetchPageValues: async () => ({})
    })
  ).rejects.toThrow('Knowledge graph Notion database is unavailable')
})
~~~

- [ ] **Step 3: Run RED**

~~~bash
pnpm test -- __tests__/lib/knowledge-graph/notionSource.test.ts --runInBand
~~~

Expected: FAIL because notionSource.ts does not exist.

- [ ] **Step 4: Implement the source**

The main flow must be:

~~~ts
const databaseMap = await options.fetchDatabase(
  options.pageId,
  'knowledge-graph-database'
)
const database = readDatabase(databaseMap, options.pageId)
if (!database) {
  throw new TypeError('Knowledge graph Notion database is unavailable')
}

const missingIds = database.pageIds.filter(id => !database.block[id])
const missingValues = missingIds.length
  ? await options.fetchPageValues(missingIds)
  : {}
const block = { ...database.block, ...missingValues }

const allPages = database.pageIds.flatMap(id => {
  const value = unwrapRecordValue(block[id])
  if (!value || value.parent_id !== database.collectionId) return []
  return [mapPage(value, id, database.schema, options)]
})

return { allPages, schema: database.schema }
~~~

Implement these exact helper rules:

- Unwrap up to three nested value objects.
- Resolve hyphenated/non-hyphenated IDs with normalizePageId.
- Use selected collection query results before page_sort fallback, matching getAllPageIds behavior.
- Find property IDs by schema[propertyId].name matching configured names.
- Read title, slug, type, and status with getTextContent from notion-utils.
- Use last_edited_time as lastEditedDate.
- Preserve value.properties unchanged for Relation extraction.
- Build href from locale, normalized postUrlPrefix, and slug.
- Read icon only from value.format.page_icon.
- Throw the explicit database error for missing root, collection, schema, or page IDs.

- [ ] **Step 5: Run source, Relation, mention, and refresh tests**

~~~bash
pnpm test --   __tests__/lib/knowledge-graph/notionSource.test.ts   __tests__/lib/knowledge-graph/extract.test.ts   __tests__/lib/knowledge-graph/refresh.test.ts   --runInBand
~~~

Expected: all suites PASS, including existing real Relation and @page fixtures.

- [ ] **Step 6: Commit**

~~~bash
git add lib/knowledge-graph/notionSource.ts   __tests__/lib/knowledge-graph/notionSource.test.ts   __tests__/fixtures/notion/knowledge-graph-database.json
git commit -m "feat(graph): add server-only Notion source"
~~~

---

### Task 4: Integrate the Server-Only Source

**Files:**
- Modify: cloud-functions/api/knowledge-graph.ts:1-130
- Modify: __tests__/cloud-functions/knowledge-graph.test.ts

**Interfaces:**
- Consumes: fetchKnowledgeGraphSiteData from Task 3.
- Preserves: handler, server config, refresh scheduling, and response contracts.
- Removes: production imports and mocks of SiteDataApi.

- [ ] **Step 1: Update the integration test first**

Replace the SiteDataApi mock with:

~~~ts
jest.mock('@/lib/knowledge-graph/notionSource', () => ({
  fetchKnowledgeGraphSiteData: jest.fn()
}))
~~~

Assert:

~~~ts
expect(fetchKnowledgeGraphSiteData).toHaveBeenCalledWith(
  expect.objectContaining({
    pageId: expect.any(String),
    postUrlPrefix: expect.any(String),
    propertyNames: expect.objectContaining({
      title: expect.any(String),
      slug: expect.any(String),
      type: expect.any(String),
      status: expect.any(String)
    }),
    fetchDatabase: expect.any(Function),
    fetchPageValues: expect.any(Function)
  })
)
~~~

- [ ] **Step 2: Run RED**

~~~bash
pnpm test -- __tests__/cloud-functions/knowledge-graph.test.ts --runInBand
~~~

Expected: FAIL because the function still calls SiteDataApi.

- [ ] **Step 3: Replace the production dependency**

Remove the SiteDataApi import. Import:

~~~ts
import {
  fetchInBatches,
  fetchNotionPageBlocks
} from '@/lib/db/notion/getPostBlocks'
import { fetchKnowledgeGraphSiteData } from '@/lib/knowledge-graph/notionSource'
~~~

Configure refresh with:

~~~ts
fetchGlobalAllData: () =>
  fetchConfiguredSiteData({
    notionPageId: BLOG.NOTION_PAGE_ID,
    fetchSiteData: ({ pageId, locale }) =>
      fetchKnowledgeGraphSiteData({
        pageId,
        locale,
        postUrlPrefix: BLOG.POST_URL_PREFIX,
        propertyNames: {
          title: BLOG.NOTION_PROPERTY_NAME.title,
          slug: BLOG.NOTION_PROPERTY_NAME.slug,
          type: BLOG.NOTION_PROPERTY_NAME.type,
          status: BLOG.NOTION_PROPERTY_NAME.status
        },
        fetchDatabase: (id, from) => fetchNotionPageBlocks(id, from),
        fetchPageValues: fetchInBatches
      })
  })
~~~

- [ ] **Step 4: Run integration and bundle GREEN**

~~~bash
pnpm test --   __tests__/cloud-functions/knowledge-graph.test.ts   __tests__/cloud-functions/knowledge-graph-bundle.test.ts   --runInBand
~~~

Expected: both PASS. The bundle must exclude react, lib/global.js, themes/theme.js, and SiteDataApi.js.

- [ ] **Step 5: Commit**

~~~bash
git add cloud-functions/api/knowledge-graph.ts   __tests__/cloud-functions/knowledge-graph.test.ts
git commit -m "fix(graph): isolate EdgeOne function dependencies"
~~~

---

### Task 5: Full Verification and EdgeOne Acceptance

**Files:**
- Modify only if a verification failure identifies a source-controlled defect.

- [ ] **Step 1: Run focused tests**

~~~bash
pnpm test --   __tests__/cloud-functions/knowledge-graph.test.ts   __tests__/cloud-functions/knowledge-graph-bundle.test.ts   __tests__/lib/knowledge-graph/notionSource.test.ts   __tests__/lib/knowledge-graph/extract.test.ts   __tests__/lib/knowledge-graph/refresh.test.ts   --runInBand
~~~

Expected: all listed suites PASS.

- [ ] **Step 2: Run repository verification**

~~~bash
pnpm test -- --runInBand --silent
pnpm type-check
pnpm lint
pnpm build
~~~

Expected: at least 47 suites PASS, type-check exits 0, lint has no errors, and the production build exits 0.

- [ ] **Step 3: Run deterministic EdgeOne-compatible bundling**

~~~bash
pnpm exec esbuild cloud-functions/api/knowledge-graph.ts   --bundle --platform=node --format=esm --target=node22   --external:@edgeone/pages-blob   --outfile=/tmp/notionnext-knowledge-graph-after.mjs
~~~

Expected: exit 0, output file exists, and no .js JSX loader errors appear.

- [ ] **Step 4: Run the official EdgeOne local builder**

~~~bash
pnpm dlx edgeone makers dev
~~~

Expected: Cloud Functions build completes and localhost:8088 starts without the JSX loader error. If authentication is required, use the user's existing token through --token; never print or commit it.

- [ ] **Step 5: Smoke the function**

~~~bash
KNOWLEDGE_GRAPH_URL=http://localhost:8088/api/knowledge-graph   pnpm smoke:knowledge-graph
~~~

Expected: HTTP 200 with counts or HTTP 202 initializing; no draft/private payload is logged.

- [ ] **Step 6: Check repository state**

~~~bash
git diff --check main...HEAD
git status --short
~~~

Expected: no whitespace errors and no uncommitted files.

- [ ] **Step 7: Request review**

Use superpowers:requesting-code-review for main...codex/fix-edgeone-graph-bundle. Resolve blocking findings and rerun affected gates. Present merge and push choices; do not modify main without explicit approval.
