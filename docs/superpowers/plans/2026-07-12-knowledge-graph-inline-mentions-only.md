# Knowledge Graph Inline Mentions Only Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Generate public graph edges only from Notion `@页面` mentions in published article bodies.

**Architecture:** Keep the block-scoped mention extractor and undirected graph builder. Remove relation-property merging, then bump the cache namespace so old relation-aware snapshots cannot survive.

**Tech Stack:** TypeScript, Next.js 14, Jest, EdgeOne Pages Blob, pnpm 9.15.0

## Global Constraints

- Only a Notion page mention decoration in an article body creates an edge.
- Database relation properties, including `相关引用`, never create edges.
- Ordinary hyperlinks do not create edges.
- Reciprocal mentions render as one ordinary undirected edge.
- Self-mentions, unpublished targets, and foreign-page blocks remain excluded.
- Do not modify the Notion database property or add graph UI.
- Use pnpm and retain Node.js >=20 <25 support.

---

### Task 1: Restrict Graph Snapshots To Body Mentions

**Files:**
- Modify: `lib/knowledge-graph/extract.ts`
- Modify: `lib/knowledge-graph/refresh.ts`
- Modify: `lib/knowledge-graph/store.ts`
- Modify: `__tests__/lib/knowledge-graph/extract.test.ts`
- Modify: `__tests__/lib/knowledge-graph/refresh.test.ts`
- Modify: `__tests__/lib/knowledge-graph/store.test.ts`

**Interfaces:**
- Consumes: `extractInlineMentionPageIds(input: ExtractPageLinksInput): string[]`
- Produces: `RefreshSnapshot.links` containing body mention targets only.
- Preserves: `buildPublicGraph` undirected deduplication and published-node filtering.

- [ ] **Step 1: Add failing contract tests**

In `extract.test.ts`, remove relation-helper assertions and exercise `extractInlineMentionPageIds`. Add a page root with a relation property and a body with one `['p', targetId]` mention; expect only the body target. Add an ordinary `['a', '/article/target']` hyperlink decoration; expect no target.

In `refresh.test.ts`, replace relation-merging tests with assertions that relation properties neither change an unchanged snapshot nor enter a newly stored snapshot. Stored and published links must equal body mentions only.

In `store.test.ts`, seed `v4/` as legacy and expect current keys under `v5/`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
pnpm test -- --runInBand __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/refresh.test.ts __tests__/lib/knowledge-graph/store.test.ts
```

Expected: relation values are still merged and cache keys still use `v4/`.

- [ ] **Step 3: Implement the minimal change**

In `extract.ts`, keep `extractInlineMentionPageIds`, including relation-property exclusion on the page root. Remove `extractRelationPageIds` and remove `extractPageLinks` if no production caller remains. Preserve scoped block traversal and `['p', pageId]` parsing.

In `refresh.ts`, assign unchanged, newly fetched, and fallback snapshots directly. Remove `withCurrentRelations`, `RefreshPage.pageValue`, and its global-property mapping. Keep `RefreshPage.schema` because it prevents relation properties from being parsed as body mentions.

In `store.ts`, change `CACHE_PREFIX` to `v5/` and restrict graph-version key validation to `v5/graph/versions/...`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run Step 2 again. Expected: all three suites pass and relation-only inputs produce no edge.

- [ ] **Step 5: Run regression checks**

```bash
pnpm test -- --runInBand __tests__/lib/knowledge-graph __tests__/cloud-functions/knowledge-graph.test.ts __tests__/cloud-functions/knowledge-graph-bundle.test.ts
pnpm type-check
pnpm exec prettier --check lib/knowledge-graph/extract.ts lib/knowledge-graph/refresh.ts lib/knowledge-graph/store.ts __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/refresh.test.ts __tests__/lib/knowledge-graph/store.test.ts
pnpm exec eslint lib/knowledge-graph/extract.ts lib/knowledge-graph/refresh.ts lib/knowledge-graph/store.ts
```

Expected: every command exits 0.

- [ ] **Step 6: Verify locally and commit**

Restart the single EdgeOne process so `v5/` initializes. Request `/api/knowledge-graph` until it returns 200 and confirm no edge is produced solely by `相关引用`.

```bash
git add lib/knowledge-graph/extract.ts lib/knowledge-graph/refresh.ts lib/knowledge-graph/store.ts __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/refresh.test.ts __tests__/lib/knowledge-graph/store.test.ts
git commit -m "fix(graph): derive edges from body mentions only"
```

Do not stage `.superpowers/sdd/task-2-report.md` or unrelated changes.
