# Task 2 Report

## Status

DONE

## TDD Evidence

1. RED: Added a focused public-contract test, then ran `pnpm type-check`. This demonstrated a missing shared type contract, not graph-builder behavior: TypeScript reported TS2305 for the six absent exports from `lib/knowledge-graph/types.ts`: `GraphNode`, `GraphEdge`, `PublicGraph`, `PublishedPage`, `PageSnapshot`, and `PageSnapshotMap`.
2. GREEN: Added those contracts to the shared Task 1 type module and updated the builder to import its public input and output types. `pnpm type-check` then passed.

## Implementation

- Implemented the Task 2 graph builder and breadth-first neighborhood selector.
- Centralized graph contracts in `lib/knowledge-graph/types.ts` so Task 2 producers and future consumers use one public definition.
- Added a focused contract test that exercises the shared page, snapshot, node, edge, and graph shapes through `buildPublicGraph`.
- The graph builder retains published pages with no edges, rejects self-links and non-published targets, normalizes undirected edges, and orders output deterministically.
- The neighborhood selector remains renderer-independent and returns new arrays without mutating its input graph.

## Verification

- `pnpm test -- __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/build.test.ts --runInBand`: PASS, 2 suites and 11 tests.
- `pnpm type-check`: PASS.
- Self-review: checked the complete Task 2 diff for scope, graph normalization, breadth-first depth selection, and input immutability. No findings.

## Commit

- Included in the Task 2 completion commit on `codex/notion-knowledge-graph`.

## Review Fix: Canonical Page IDs

### TDD Evidence

1. RED: Added the hyphenated UUID regression and build-input immutability assertions. Running `pnpm test -- __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/build.test.ts --runInBand` failed in `canonicalizes hyphenated page IDs before resolving normalized links`: public nodes retained hyphens and `edges` was empty.
2. GREEN: `buildPublicGraph` now applies Task 1's `normalizePageId` to published page IDs and snapshot link targets at the build boundary. The same focused command passed: 2 suites, 12 tests.
3. Reversible RED proof after GREEN: locally replaced only the two `normalizePageId` calls with raw values, ran the same focused Jest command, and observed the same single canonical-ID failure (1 failed, 11 passed). Restored both calls immediately; no temporary code remains.
4. Restored GREEN: the exact focused Jest command passed again with 2 suites and 12 tests. `pnpm type-check` also passed.

### Review Fix Scope

- Public graph node IDs and edge endpoints use normalized lowercase, hyphen-free Notion IDs.
- Valid links survive when `PublishedPage.id` values are hyphenated while snapshot keys and links are normalized.
- The regression test verifies neither the published-page array nor the snapshot map is mutated.

## Review Fix: Hyphenated Snapshot Keys

1. RED: Added `resolves canonical links from hyphenated snapshot keys without mutation`. The focused Task 1+2 Jest command failed only in that test because the builder looked up canonical node IDs directly in the unnormalized snapshot map, producing an empty edge list.
2. GREEN: The builder now makes one private normalized snapshot-key lookup before iterating nodes, so both hyphenated and canonical source keys resolve without scanning the map per node or mutating inputs.
3. Verification: `pnpm test -- __tests__/lib/knowledge-graph/extract.test.ts __tests__/lib/knowledge-graph/build.test.ts --runInBand` passed with 2 suites and 13 tests; `pnpm type-check` passed.
